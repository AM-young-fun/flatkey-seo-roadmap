import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { envBool } from "@/lib/env";
import { decryptDataForSeoCredentials } from "@/lib/dataforseo-credentials";
import { workflowWeek } from "@/lib/seo-workflow";
import { collectionHash,GrowthCollectionError } from "@/lib/growth-collection";
import { ENDPOINT,normalizeApprovedRankedKeywordsPage } from "@/lib/dataforseo-labs.cjs";
import { GROWTH_DISCOVERY_KIND,growthDiscoveryCommandSchema,buildGrowthDiscoveryManifest,assertGrowthDiscoveryManifest,approvedDiscoveryPageRequest,type GrowthDiscoveryState } from "@/lib/growth-discovery";
import { postDataForSeoLabsTask } from "./dataforseo-labs-client";
const json=(value:unknown)=>JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue,key=(id:string)=>`${GROWTH_DISCOVERY_KIND}:${id}`;
export async function loadGrowthDiscovery(id:string){const row=await prisma.seoWorkflowRecord.findUnique({where:{key:key(id)},select:{payload:true}});return row?row.payload as unknown as GrowthDiscoveryState:null;}
/** No fetch/provider client. Claims expose one exact approved request to the
 * existing worker and durably reserve it; saved raw receipts advance the cursor. */
export async function saveGrowthDiscovery(raw:unknown,actor:"human"|"collector",now=new Date()){
  const command=growthDiscoveryCommandSchema.parse(raw);
  return prisma.$transaction(async tx=>{
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"dataforseo:discovery-budget"}))`;
    const row=await tx.seoWorkflowRecord.findUnique({where:{key:key(command.id)}}),current=row?.payload as unknown as GrowthDiscoveryState|null;
    if((current?.version??0)!==command.expectedVersion)throw new GrowthCollectionError("discovery_version","分页记录已变化，请读回原版本");
    let state:GrowthDiscoveryState,request:unknown=null;
    if(command.action==="prepare"){
      if(current?.pages.length)throw new GrowthCollectionError("discovery_started","已有原分页账本，不能替换或重置游标");
      const connection=await tx.dataForSeoConnection.findUnique({where:{siteDomain:"flatkey.ai"}});if(!connection)throw new GrowthCollectionError("discovery_connection","缺少真实连接，不猜账号");
      state={id:command.id,version:(current?.version??0)+1,manifest:buildGrowthDiscoveryManifest(command,connection.connectionVersion,now),approval:null,pages:[],nextPage:0,complete:false,reason:"REVIEW_PENDING"};
    }else{
      if(!current)throw new GrowthCollectionError("discovery_missing","请先冻结辅助发现分页清单");assertGrowthDiscoveryManifest(current.manifest);
      if(command.manifestHash!==current.manifest.hash)throw new GrowthCollectionError("discovery_hash","不是用户当前审核的确切分页清单");
      state=structuredClone(current);state.version++;
      if(command.action==="approve"){
        if(actor!=="human")throw new GrowthCollectionError("human_required","分页及费用只能由真实登录用户同源确认",403);
        if(command.maxCostMicros!==current.manifest.maxCostMicros||current.pages.length||Date.parse(current.manifest.expiresAt)<=now.getTime())throw new GrowthCollectionError("discovery_cap","须批准当前未过期的确切页清单及费用上限");
        state.approval={actor:"human",hash:command.manifestHash,maxCostMicros:command.maxCostMicros,approvedAt:now.toISOString()};state.reason="APPROVED";
      }else if(command.action==="claim"){
        if(envBool("DISABLE_EXTERNAL_FETCH"))throw new GrowthCollectionError("discovery_stopped","外部请求紧急停止，未预留新页");
        const next=approvedDiscoveryPageRequest(current,now);if(!next)return{state:current,request:null,maySubmit:false,paidRequests:0};
        const connection=await tx.dataForSeoConnection.findUnique({where:{siteDomain:"flatkey.ai"}});if(connection?.connectionVersion!==current.manifest.connectionVersion)throw new GrowthCollectionError("discovery_connection_changed","连接已变化，须复核原清单");
        if(await tx.dataForSeoRun.findUnique({where:{requestId:next.page.runId}}))throw new GrowthCollectionError("discovery_page_exists","原页账本已存在，禁止重新请求");
        const reserved=(await tx.dataForSeoRun.aggregate({where:{createdAt:{gte:new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),1))}},_sum:{budgetCostMicros:true}}))._sum.budgetCostMicros??0;
        const reservedHere=current.pages.reduce((sum,page)=>sum+current.manifest.pages[page.index].maxCostMicros,0);
        if(reserved+next.page.maxCostMicros>5000000||reservedHere+next.page.maxCostMicros>current.manifest.maxCostMicros)throw new GrowthCollectionError("discovery_budget","超过原Labs月度或已批准分页预算，未扩大预算");
        await tx.dataForSeoRun.create({data:{requestId:next.page.runId,siteDomain:current.manifest.site,status:"PENDING",requestHash:collectionHash(next.task),requestJson:json([next.task]),connectionVersion:connection!.connectionVersion,estimatedCostMicros:next.page.maxCostMicros,budgetCostMicros:next.page.maxCostMicros}});
        state.pages.push({index:next.page.index,runId:next.page.runId,offset:next.page.offset,status:"CLAIMED",rawHash:null,returned:null,total:null,truncated:null,collectedAt:null,actualCostMicros:null});state.reason="PAGE_CLAIMED";
        request={endpoint:ENDPOINT,requestId:next.page.runId,body:[next.task],page:next.page.index,offset:next.page.offset,limit:current.manifest.limit,maxCostMicros:next.page.maxCostMicros};
      }else{
        const saved=state.pages.find(page=>page.index===command.page),page=current.manifest.pages[command.page];if(!saved||!page)throw new GrowthCollectionError("discovery_unclaimed","该页未沿已批清单预留，不能接入外来回执");
        const rawHash=collectionHash(command.raw);if(saved.rawHash&&saved.rawHash!==rawHash)throw new GrowthCollectionError("discovery_receipt_changed","原页已有不同回执，不覆盖历史");
        if(command.rawText&&collectionHash(JSON.parse(command.rawText))!==rawHash)throw new GrowthCollectionError("discovery_raw_mismatch","原始回执文本与解析内容不同，不能覆盖原页");
        if(saved.rawHash&&saved.collectedAt!==command.collectedAt)throw new GrowthCollectionError("discovery_receipt_time_changed","原页采集时间已有存证，不能重标");
        if(saved.rawHash===rawHash&&saved.status==="SAVED")return{state:current,request:null,maySubmit:false,paidRequests:0};
        if(Date.parse(command.collectedAt)>now.getTime()+300000)throw new GrowthCollectionError("discovery_future_receipt","未来采样不能入账为已完成分页");
        let normalized:ReturnType<typeof normalizeApprovedRankedKeywordsPage>|null=null;
        try{normalized=normalizeApprovedRankedKeywordsPage(command.raw,{runId:page.runId,collectedAt:command.collectedAt,limit:state.manifest.limit,scope:{site:state.manifest.site,country:state.manifest.country,language:state.manifest.language,offset:page.offset}});}catch{/* Durable raw evidence remains available for review; never re-submit. */}
        const priorCost=state.pages.filter(item=>item.index!==command.page).reduce((sum,item)=>sum+(item.actualCostMicros??0),0),valid=normalized&&normalized.actualCostMicros!==null&&normalized.costWithinEstimate===true&&normalized.rejectedItems.every(item=>item.reason==="duplicate_observation")&&priorCost+normalized.actualCostMicros<=state.manifest.maxCostMicros;
        saved.rawHash=rawHash;saved.collectedAt=command.collectedAt;saved.status=valid?"SAVED":"UNKNOWN";saved.returned=normalized?.returnedItems??null;saved.total=normalized?.totalMatchingCount??null;saved.truncated=normalized?.truncated??null;saved.actualCostMicros=normalized?.actualCostMicros??null;
        await tx.dataForSeoRun.update({where:{requestId:page.runId},data:{rawResponse:command.rawText??JSON.stringify(command.raw),collectedAt:new Date(command.collectedAt),normalized:normalized?json(normalized):Prisma.JsonNull,actualCostMicros:normalized?.actualCostMicros??null,budgetCostMicros:Math.max(page.maxCostMicros,normalized?.actualCostMicros??0),status:valid?"COMPLETED":"UNKNOWN",completedAt:valid?now:null,errorCode:valid?null:"PAGE_RECEIPT_REQUIRES_REVIEW"}});
        if(valid&&normalized){state.nextPage=Math.max(state.nextPage,command.page+1);const totals=state.pages.filter(item=>item.status==="SAVED").map(item=>item.total);const sameTotal=totals.every(total=>total===normalized.totalMatchingCount),covered=state.pages.filter(item=>item.status==="SAVED").reduce((sum,item)=>sum+(item.returned??0),0);state.complete=sameTotal&&covered===normalized.totalMatchingCount&&page.offset+normalized.returnedItems>=normalized.totalMatchingCount;state.reason=!sameTotal?"TOTAL_CHANGED":state.complete?"COMPLETE":normalized.returnedItems<state.manifest.limit?"SHORT_PAGE":state.nextPage>=state.manifest.maxPages?"APPROVED_PAGE_LIMIT_REACHED":"NEXT_APPROVED_PAGE";}else state.reason="PAGE_RECEIPT_UNKNOWN";
      }
    }
    const data={kind:GROWTH_DISCOVERY_KIND,recordId:state.id,weekStart:workflowWeek(now),siteDomain:state.manifest.site,status:state.complete?"completed":state.reason,version:state.version,payload:json(state)};
    if(current){const updated=await tx.seoWorkflowRecord.updateMany({where:{key:key(state.id),version:command.expectedVersion},data});if(updated.count!==1)throw new GrowthCollectionError("discovery_conflict","分页保存冲突，先读回原记录");}else await tx.seoWorkflowRecord.create({data:{key:key(state.id),...data}});
    await tx.seoWorkflowEvent.create({data:{requestId:`gd:${state.id}:${state.version}`,requestHash:collectionHash({actor,command}),recordKey:key(state.id),kind:GROWTH_DISCOVERY_KIND,version:state.version,payload:json(state)}});
    const readback=await tx.seoWorkflowRecord.findUnique({where:{key:key(state.id)},select:{payload:true}});if(collectionHash(readback?.payload)!==collectionHash(state))throw new GrowthCollectionError("discovery_readback","分页记录读回不一致",503);
    return{state,request,maySubmit:Boolean(request),paidRequests:0};
  },{maxWait:10000,timeout:30000});
}

async function markDiscoveryPageUnknown(id:string,index:number,errorCode:string){
  return prisma.$transaction(async tx=>{
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"dataforseo:discovery-budget"}))`;
    const stored=await tx.seoWorkflowRecord.findUnique({where:{key:key(id)}}),current=stored?.payload as unknown as GrowthDiscoveryState|null;
    if(!current)return null;const page=current.pages.find(page=>page.index===index);if(!page||page.status==="SAVED")return current;
    if(page.status==="UNKNOWN"&&current.reason===errorCode)return current;
    const state=structuredClone(current);state.version++;state.pages.find(page=>page.index===index)!.status="UNKNOWN";state.reason=errorCode;state.complete=false;
    await tx.dataForSeoRun.update({where:{requestId:page.runId},data:{status:"UNKNOWN",errorCode}});
    const changed=await tx.seoWorkflowRecord.updateMany({where:{key:key(id),version:current.version},data:{payload:json(state),version:state.version,status:"UNKNOWN"}});
    if(changed.count!==1)throw new GrowthCollectionError("discovery_conflict","原分页状态已变化，请读取原账本");
    await tx.seoWorkflowEvent.create({data:{requestId:`gd:${id}:${state.version}`,requestHash:collectionHash({id,index,errorCode}),recordKey:key(id),kind:GROWTH_DISCOVERY_KIND,version:state.version,payload:json(state)}});
    const readback=await tx.seoWorkflowRecord.findUnique({where:{key:key(id)},select:{payload:true}});if(collectionHash(readback?.payload)!==collectionHash(state))throw new GrowthCollectionError("discovery_unknown_readback","未知分页状态读回不一致，禁止新提交",503);
    return state;
  });
}

/** Persist byte-for-byte provider text before JSON parsing. A worker crash
 * after this point is recovered with a local replay, never another POST. */
async function cacheDiscoveryPageRaw(runId:string,rawResponse:string,collectedAt:Date){
  return prisma.$transaction(async tx=>{
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"dataforseo:discovery-budget"}))`;
    const run=await tx.dataForSeoRun.findUnique({where:{requestId:runId}});
    if(!run)throw new GrowthCollectionError("discovery_run_missing","原页账本不存在，停止提交");
    if(run.rawResponse&&run.rawResponse!==rawResponse)throw new GrowthCollectionError("discovery_raw_changed","已有不同原始回执，不覆盖");
    if(run.rawResponse)return run.collectedAt??collectedAt;
    await tx.dataForSeoRun.update({where:{requestId:runId},data:{rawResponse,collectedAt,status:"RECEIVED"}});
    const readback=await tx.dataForSeoRun.findUnique({where:{requestId:runId},select:{rawResponse:true,collectedAt:true}});if(readback?.rawResponse!==rawResponse)throw new GrowthCollectionError("discovery_raw_readback","原始供应商回执读回不一致，停止推进",503);
    return readback.collectedAt??collectedAt;
  });
}

/** Approved auxiliary collection is independent of core monitoring. Every page
 * has one durable claim and one non-retryable POST; UNKNOWN is never retried. */
export async function runGrowthDiscoveryCron(options:{deadline?:number;now?:Date}={}){
  const deadline=options.deadline??Date.now()+210000,clock=()=>options.now??new Date();let paidRequests=0;
  if(envBool("DISABLE_EXTERNAL_FETCH"))return{status:"DISABLED",paidRequests};
  const records=await prisma.seoWorkflowRecord.findMany({where:{kind:GROWTH_DISCOVERY_KIND},select:{payload:true},orderBy:{updatedAt:"asc"},take:100});
  const pending=records.map(row=>row.payload as unknown as GrowthDiscoveryState).filter(state=>state.approval&&!state.complete);
  let state=pending.find(state=>!["APPROVED_PAGE_LIMIT_REACHED","SHORT_PAGE","TOTAL_CHANGED"].includes(state.reason));
  if(!state)return{status:pending.length?"DISCOVERY_REVIEW_REQUIRED":"AWAITING_REVIEWED_DISCOVERY_MANIFEST",paidRequests};
  while(Date.now()+15000<deadline){
    assertGrowthDiscoveryManifest(state.manifest);
    if(!state.approval||state.approval.actor!=="human"||state.approval.hash!==state.manifest.hash||state.approval.maxCostMicros!==state.manifest.maxCostMicros)return{status:"NEEDS_REVIEW",paidRequests};
    const unresolved=state.pages.find(page=>page.status!=="SAVED");
    // Recover a received raw page locally. A pending/UNKNOWN page with no raw
    // response cannot prove whether the supplier accepted it, so never re-POST.
    if(unresolved){
      const run=await prisma.dataForSeoRun.findUnique({where:{requestId:unresolved.runId}});
      if(!run?.rawResponse||!run.collectedAt)return{status:"NEEDS_REVIEW",paidRequests,manifestId:state.id};
      try{const saved=await saveGrowthDiscovery({action:"receipt",id:state.id,expectedVersion:state.version,manifestHash:state.manifest.hash,page:unresolved.index,collectedAt:run.collectedAt.toISOString(),raw:JSON.parse(run.rawResponse),rawText:run.rawResponse},"collector",clock());state=saved.state;if(state.pages.some(page=>page.status==="UNKNOWN"))return{status:"NEEDS_REVIEW",paidRequests,manifestId:state.id};if(state.complete)return{status:"COMPLETE",paidRequests,manifestId:state.id};continue;}
      catch{await markDiscoveryPageUnknown(state.id,unresolved.index,"CACHED_PAGE_REQUIRES_REVIEW");return{status:"NEEDS_REVIEW",paidRequests,manifestId:state.id};}
    }
    let next:ReturnType<typeof approvedDiscoveryPageRequest>;
    try{next=approvedDiscoveryPageRequest(state,clock());}catch{return{status:"NEEDS_REVIEW",paidRequests,manifestId:state.id};}
    if(!next)return{status:state.complete?"COMPLETE":state.reason,paidRequests,manifestId:state.id};
    let claimed:Awaited<ReturnType<typeof saveGrowthDiscovery>>;
    try{claimed=await saveGrowthDiscovery({action:"claim",id:state.id,expectedVersion:state.version,manifestHash:state.manifest.hash},"collector",clock());}
    catch{return{status:"ALREADY_CLAIMED_OR_NEEDS_REVIEW",paidRequests,manifestId:state.id};}
    if(!claimed.request||!claimed.maySubmit)return{status:"NEEDS_REVIEW",paidRequests,manifestId:state.id};state=claimed.state;
    try{
      const [live,connection,ledger]=await Promise.all([loadGrowthDiscovery(state.id),prisma.dataForSeoConnection.findUnique({where:{siteDomain:"flatkey.ai"}}),prisma.dataForSeoRun.findUnique({where:{requestId:next.page.runId}})]);
      if(envBool("DISABLE_EXTERNAL_FETCH")||!live||live.version!==state.version||live.manifest.hash!==state.manifest.hash||live.approval?.actor!=="human"||live.approval.hash!==state.manifest.hash||live.approval.maxCostMicros!==state.manifest.maxCostMicros||ledger?.status!=="PENDING"||ledger.rawResponse||ledger.requestHash!==collectionHash(next.task)||connection?.connectionVersion!==state.manifest.connectionVersion||!connection.encryptedCredentials)throw new Error("PRE_SUBMIT_CHANGED");
      const auth=decryptDataForSeoCredentials(connection.encryptedCredentials);
      paidRequests++;
      const rawResponse=await postDataForSeoLabsTask(next.task,auth,Math.max(1,deadline-Date.now()-10000));
      const collectedAt=await cacheDiscoveryPageRaw(next.page.runId,rawResponse,clock());
      const saved=await saveGrowthDiscovery({action:"receipt",id:state.id,expectedVersion:state.version,manifestHash:state.manifest.hash,page:next.page.index,collectedAt:collectedAt.toISOString(),raw:JSON.parse(rawResponse),rawText:rawResponse},"collector",clock());state=saved.state;
      if(state.pages.some(page=>page.status==="UNKNOWN"))return{status:"NEEDS_REVIEW",paidRequests,manifestId:state.id};
      if(state.complete)return{status:"COMPLETE",paidRequests,manifestId:state.id};
    }catch{await markDiscoveryPageUnknown(state.id,next.page.index,"SUBMISSION_OUTCOME_UNKNOWN");return{status:"NEEDS_REVIEW",paidRequests,manifestId:state.id};}
  }
  return{status:"CONTINUATION_REQUIRED",paidRequests,manifestId:state.id};
}
