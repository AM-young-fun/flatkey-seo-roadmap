import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { workerTokenMatches } from "@/lib/automation-credentials";
import { claimProjectJob, enqueueProjectJobs, failProjectJob, finishProjectJob } from "@/lib/services/project-jobs";
import { SOURCE_SYNC_SOURCES, sourceSyncSchema } from "@/lib/source-sync";
import { syncKeywordSources } from "@/lib/services/source-sync";
import { readImportJson } from "@/lib/ranking-import";
import { displayDataChanged } from "@/lib/services/display-change";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export const maxDuration=60;
const headers={"Cache-Control":"private, no-store"};
const inputSchema=z.object({action:z.enum(["claim","heartbeat","batch","complete","fail"]),jobId:z.string().max(200).optional(),leaseToken:z.string().uuid().optional(),batch:z.unknown().optional(),readRows:z.number().int().min(0).max(10000).optional(),errorCode:z.enum(["DWS_AUTH","SHEET_READ_FAILED","SHEET_SCHEMA_CHANGED","SHEET_CHANGED_DURING_READ"]).optional()}).strict();
export async function POST(request:Request) {
  try {
    const config=await prisma.projectAutomation.findUnique({where:{id:"default"}});
    if(!config || !workerTokenMatches(request.headers.get("authorization"),config.workerTokenHash))return NextResponse.json({message:"采集器认证失败"},{status:401,headers});
    const input=inputSchema.parse(await readImportJson(request));
    await prisma.projectAutomation.update({where:{id:"default"},data:{workerSeenAt:new Date()}});
    if(!config.sheetsEnabled)return NextResponse.json({status:"PAUSED"},{headers});
    if(input.action==="heartbeat")return NextResponse.json({status:"READY"},{headers});
    if(input.action==="claim") {
      await enqueueProjectJobs();
      const job=await claimProjectJob("SHEETS");
      if(!job)return NextResponse.json({job:null},{headers});
      const source=SOURCE_SYNC_SOURCES[job.sourceId as keyof typeof SOURCE_SYNC_SOURCES];
      return NextResponse.json({job:{id:job.id,sourceId:job.sourceId,leaseToken:job.leaseToken,source}},{headers});
    }
    const job=await prisma.projectJob.findFirst({where:{id:input.jobId??"",kind:"SHEETS",status:"RUNNING",leaseToken:input.leaseToken??"",leaseUntil:{gt:new Date()}}});
    if(!job)return NextResponse.json({message:"任务租约已失效"},{status:409,headers});
    if(input.action==="fail") {await failProjectJob(job,input.errorCode??"SHEET_READ_FAILED");return NextResponse.json({status:"RECORDED"},{headers});}
    const saved=z.object({keys:z.array(z.string()),changedRows:z.number(),batches:z.array(z.string())}).parse(job.payload??{keys:[],changedRows:0,batches:[]});
    if(input.action==="batch") {
      const batch=sourceSyncSchema.parse(input.batch);
      if(batch.sourceId!==job.sourceId || batch.action!=="apply" || batch.rows.length>30 || !batch.collectedAt)throw new Error("BATCH_INVALID");
      // Unattended reads capture source facts; they cannot claim semantic page
      // verification or bypass the existing human curation rules.
      if(batch.rows.some(row=>row.publication.pageVerified||row.keywords.some(word=>word.pageIntentMatched||word.relevance!=="REVIEW")))throw new Error("BATCH_REVIEW_REQUIRED");
      if(saved.batches.includes(batch.requestId))return NextResponse.json({status:"SAVED"},{headers});
      if(batch.rows.some(row=>saved.keys.includes(row.rowKey)))throw new Error("DUPLICATE_ROW");
      const preview=await syncKeywordSources({...batch,action:"preview",expectedStateHash:undefined});
      const result=await syncKeywordSources({...batch,expectedStateHash:preview.stateHash});
      const changed=await prisma.projectJob.updateMany({where:{id:job.id,leaseToken:job.leaseToken,status:"RUNNING"},data:{leaseUntil:new Date(Date.now()+10*60000),payload:{keys:[...saved.keys,...batch.rows.map(row=>row.rowKey)],changedRows:saved.changedRows+result.sourceSummary.changedRows,batches:[...saved.batches,batch.requestId]} as Prisma.InputJsonValue}});
      if(changed.count!==1)return NextResponse.json({message:"任务租约已失效"},{status:409,headers});
      return NextResponse.json({status:"SAVED"},{headers});
    }
    if(input.readRows===undefined || input.readRows!==saved.keys.length || input.readRows===0)throw new Error("READ_INCOMPLETE");
    await finishProjectJob(job,{status:"COMPLETED",completedAt:new Date(),errorCode:null,detail:`已完整检查 ${saved.keys.length} 行 · 变更 ${saved.changedRows} 行`});
    if(saved.changedRows)await displayDataChanged();
    return NextResponse.json({status:"COMPLETED"},{headers});
  }catch{return NextResponse.json({message:"同步未完成，请保留原任务重试"},{status:400,headers});}
}
