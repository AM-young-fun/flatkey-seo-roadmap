import "server-only";
import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { decryptDataForSeoCredentials } from "@/lib/dataforseo-credentials";
import { SERP_CONFIG_ID, SERP_DEFAULT_CONFIG, serpTaskId } from "@/lib/dataforseo-serp";
import { serpPeriod, serpPeriodFromKey } from "@/lib/serp-periods";
import { workflowWeek } from "@/lib/seo-workflow";
import { GROWTH_COLLECTION_KIND, GROWTH_COLLECTION_SCOPE, GrowthCollectionError, approveGrowthCollection, assertGrowthCollectionApproval, assertGrowthCollectionManifest, buildGrowthCollectionManifest, buildGrowthCollectionRequest, collectionHash, growthCollectionCommandSchema, type GrowthCollectionState, type GrowthCollectionManifest } from "@/lib/growth-collection";
import { loadGrowthWorkspace } from "./growth-workspace";

const json=(value:unknown)=>JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const recordKey=(period:string)=>`${GROWTH_COLLECTION_KIND}:${period}`;
type Reader=Pick<Prisma.TransactionClient,"seoWorkflowRecord">;
const effectiveIdentity=(manifest:GrowthCollectionManifest)=>collectionHash({sourceHash:manifest.sourceHash,configRevision:manifest.configRevision,connectionVersion:manifest.connectionVersion,targets:manifest.targets,reused:manifest.reused,held:manifest.held,queries:manifest.queries,maxCostMicros:manifest.maxCostMicros});
export async function readGrowthCollection(periodKey:string,db:Reader=prisma):Promise<GrowthCollectionState|null>{
  serpPeriodFromKey(periodKey);
  const row=await db.seoWorkflowRecord.findUnique({where:{key:recordKey(periodKey)},select:{payload:true}});
  if(!row)return null;
  const state=row.payload as unknown as GrowthCollectionState;
  assertGrowthCollectionManifest(state.manifest);
  if(state.id!==periodKey || !Number.isSafeInteger(state.version))throw new GrowthCollectionError("record_invalid","已存采集清单身份无效，请核对原记录");
  return state;
}
export async function loadGrowthCollection(periodKey=serpPeriod().key){
  const state=await readGrowthCollection(periodKey);
  const run=state?.runId?await prisma.serpMonitorRun.findUnique({where:{id:state.runId},select:{id:true,status:true,queryCount:true,targetCount:true,reservedCostMicros:true,actualCostMicros:true,completedAt:true}}):null;
  return{state,run,paidRequests:0,message:"清单/批准与原SERP账本独立留证；当前读取不采集、不启用付费计划。"};
}
/** Freeze, review, and reserve the exact manifest. Reservation creates normal
 * SerpMonitorRun/Task rows only: no provider request, no switch/cursor mutation. */
export async function saveGrowthCollection(raw:unknown,actor:"human"|"collector",now=new Date()){
  const command=growthCollectionCommandSchema.parse(raw),eventId=`growth-collection:${command.requestId}`,requestHash=collectionHash({actor,command});
  const [workspace,config,connection]=await Promise.all([loadGrowthWorkspace(false,now),prisma.serpMonitorConfig.findUnique({where:{id:SERP_CONFIG_ID}}),prisma.dataForSeoConnection.findUnique({where:{siteDomain:"flatkey.ai"}})]);
  if(!workspace.reconciliation.sources.some(source=>source.name.startsWith("全部已存SERP")&&source.available))throw new GrowthCollectionError("saved_results_unavailable","已存SERP尚未读齐，不能丢弃已有结果重新付费",503);
  if(!config||!connection)throw new GrowthCollectionError("connection_missing","真实预算配置或供应商连接未就绪，未提交任何请求");
  const proposal=buildGrowthCollectionManifest(workspace,command.periodKey,{revision:config.revision,connectionVersion:connection.connectionVersion},now);
  return prisma.$transaction(async tx=>{
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"serp-monitor:budget"}))`;
    const replay=await tx.seoWorkflowEvent.findUnique({where:{requestId:eventId}});
    if(replay){if(replay.requestHash!==requestHash)throw new GrowthCollectionError("idempotency_conflict","同一操作编号已用于不同内容或身份");return{state:replay.payload as unknown as GrowthCollectionState,replay:true,paidRequests:0};}
    const current=await readGrowthCollection(command.periodKey,tx);
    if((current?.version??0)!==command.expectedVersion)throw new GrowthCollectionError("version_conflict","采集清单已变化，请刷新后重试");
    let state:GrowthCollectionState;
    if(command.action==="prepare"){
      if(current?.runId)throw new GrowthCollectionError("run_exists","本期已保留原采集账本，不能重建或替换清单");
      state={id:command.periodKey,version:(current?.version??0)+1,manifest:proposal,approval:null,runId:null};
    }else{
      if(!current)throw new GrowthCollectionError("manifest_missing","请先冻结完整清单和费用");
      if(current.manifest.hash!==command.manifestHash)throw new GrowthCollectionError("manifest_changed","不是当前确切清单，须重新审核");
      if(command.action==="approve"){
        if(effectiveIdentity(proposal)!==effectiveIdentity(current.manifest))throw new GrowthCollectionError("source_changed","页面/词库或可复用结果已变化，请先更新清单，避免重复收费");
        state=approveGrowthCollection(current,command,actor,now);
      }else{
        if(command.action==="reserve"||command.allowSubmit)assertGrowthCollectionApproval(current,now);
        else if(!current.approval)throw new GrowthCollectionError("approval_required","缺少原已审记录，不能冒用采集账本",403);
        state={...current,version:current.version+1};
        if(!current.runId){
          if(command.action==="resume")throw new GrowthCollectionError("run_missing","请先将已审清单存入原SERP执行账本");
          if(effectiveIdentity(proposal)!==effectiveIdentity(current.manifest))throw new GrowthCollectionError("source_changed","已存复用结果、页面或目标已变化，未预留新费用，请更新审核清单");
          if(Date.parse(current.manifest.periodDueAt)>now.getTime())throw new GrowthCollectionError("not_due","未到原锚点对应时刻，未提前采集");
          const live=await tx.serpMonitorConfig.findUnique({where:{id:SERP_CONFIG_ID}}),liveConnection=await tx.dataForSeoConnection.findUnique({where:{siteDomain:"flatkey.ai"}});
          if(!live||!liveConnection||live.revision!==current.manifest.configRevision||liveConnection.connectionVersion!==current.manifest.connectionVersion)throw new GrowthCollectionError("configuration_changed","预算或连接版本已变化，须重新审核");
          const reserved=(await tx.serpMonitorRun.aggregate({where:{OR:[{createdAt:{gte:new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),1))}},{completedAt:{gte:new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),1))}},{status:{in:["PLANNED","RUNNING","UNKNOWN"]}}]},_sum:{reservedCostMicros:true}}))._sum.reservedCostMicros??0;
          if(current.manifest.maxCostMicros>live.maxRunCostMicros||reserved+current.manifest.maxCostMicros>live.maxMonthCostMicros)throw new GrowthCollectionError("budget_exceeded","超过原单轮/月度预算上限；未调整预算或开关");
          if(await tx.serpMonitorRun.findFirst({where:{status:{in:["PLANNED","RUNNING","UNKNOWN"]}},select:{id:true}}))throw new GrowthCollectionError("open_run","仍有原采集账本未完成或结果不明，先续跑/核对，不重复建账");
          if(current.manifest.queries.length){
            decryptDataForSeoCredentials(liveConnection.encryptedCredentials);
            const runId=`serp-growth-${command.periodKey}-${current.manifest.hash.slice(0,16)}`;
            const existing=await tx.serpMonitorRun.findUnique({where:{periodKey_scope:{periodKey:command.periodKey,scope:GROWTH_COLLECTION_SCOPE}}});
            if(existing)throw new GrowthCollectionError("period_exists","本期已有增长采集账本，须沿原runId，不另建付费批次");
            const period=serpPeriodFromKey(command.periodKey),tasks=current.manifest.queries.map(query=>{const id=serpTaskId(runId,query.key);return{id,runId,queryKey:query.key,keyword:query.keyword,region:query.country,state:"PLANNED",targetsJson:json(query.targetIds.map(targetId=>{const target=current.manifest.targets.find(item=>item.id===targetId)!;return{siteDomain:target.site,keywordId:target.keywordId,keyword:target.keyword,targetUrls:target.publishedUrls};})),requestJson:json(buildGrowthCollectionRequest(query,id))};});
            await tx.serpMonitorRun.create({data:{id:runId,scope:GROWTH_COLLECTION_SCOPE,periodKey:period.key,periodLabel:period.label,periodStart:new Date(`${period.start}T00:00:00+08:00`),periodEnd:new Date(`${period.end}T23:59:59.999+08:00`),status:"PLANNED",cohortHash:current.manifest.hash,cohortJson:json(current.manifest.targets),configJson:json({...SERP_DEFAULT_CONFIG,growthCollection:{recordKey:recordKey(command.periodKey),periodKey:command.periodKey,manifestHash:current.manifest.hash},connectionHash:createHash("sha256").update(liveConnection.encryptedCredentials).digest("hex")}),queryCount:tasks.length,targetCount:current.manifest.targets.length,estimatedCostMicros:current.manifest.maxCostMicros,reservedCostMicros:current.manifest.maxCostMicros,connectionVersion:liveConnection.connectionVersion}});
            await tx.serpMonitorTask.createMany({data:tasks});state.runId=runId;
          }
        }
      }
    }
    const data={kind:GROWTH_COLLECTION_KIND,recordId:command.periodKey,weekStart:workflowWeek(now),siteDomain:null,status:state.runId?"reserved":state.approval?"approved":"review_pending",version:state.version,payload:json(state)};
    if(current){const updated=await tx.seoWorkflowRecord.updateMany({where:{key:recordKey(command.periodKey),version:command.expectedVersion},data});if(updated.count!==1)throw new GrowthCollectionError("version_conflict","保存时清单已变化");}
    else await tx.seoWorkflowRecord.create({data:{key:recordKey(command.periodKey),...data}});
    await tx.seoWorkflowEvent.create({data:{requestId:eventId,requestHash,recordKey:recordKey(command.periodKey),kind:GROWTH_COLLECTION_KIND,version:state.version,payload:json(state)}});
    const readback=await readGrowthCollection(command.periodKey,tx);if(collectionHash(readback)!==collectionHash(state))throw new GrowthCollectionError("readback_failed","采集清单保存后读回不一致",503);
    return{state:readback!,replay:false,paidRequests:0};
  },{maxWait:10000,timeout:30000});
}

/** Existing scheduled coordinator calls this instead of treating Labs success
 * as permission to spend. An approved immutable manifest is the only paid edge. */
export async function runGrowthCollectionCron(options:{deadline?:number;now?:Date}={}){
  const now=options.now??new Date();
  const records=await prisma.seoWorkflowRecord.findMany({where:{kind:GROWTH_COLLECTION_KIND,status:{in:["approved","reserved"]}},select:{payload:true},orderBy:{updatedAt:"asc"},take:20});
  const states=records.map(row=>row.payload as unknown as GrowthCollectionState);
  if(!states.length)return{status:"AWAITING_REVIEWED_MANIFEST",paidRequests:0};
  const activeRuns=await prisma.serpMonitorRun.findMany({where:{scope:GROWTH_COLLECTION_SCOPE,status:{in:["PLANNED","RUNNING","UNKNOWN"]}},select:{id:true}});
  const activeIds=new Set(activeRuns.map(run=>run.id));
  let state=states.find(state=>state.runId&&activeIds.has(state.runId)&&state.approval)??states.find(state=>!state.runId&&state.approval&&Date.parse(state.manifest.periodDueAt)<=now.getTime()&&Date.parse(state.manifest.expiresAt)>now.getTime());
  if(!state)return{status:"AWAITING_REVIEWED_MANIFEST",paidRequests:0};
  if(!state.runId){
    const saved=await saveGrowthCollection({action:"reserve",requestId:`reserve:${state.manifest.hash}`,expectedVersion:state.version,periodKey:state.id,manifestHash:state.manifest.hash},"collector",now);
    state=saved.state;
  }
  if(!state.runId)return{status:"EXISTING_RESULTS_REUSED",paidRequests:0,periodKey:state.id};
  // Dynamic import keeps the read/prepare service free of paid execution edges.
  const {resumeGrowthCollectionRun}=await import("./serp-monitor");
  const run=await resumeGrowthCollectionRun(state.runId,{allowSubmit:true,deadline:options.deadline});
  return{status:run.status,paidRequests:run.paidRequests,periodKey:state.id,runId:state.runId,run};
}
