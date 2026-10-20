import { randomBytes, randomUUID } from "node:crypto";
import { Prisma, type ProjectJob } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { beijingDay, projectDueJobs, retryAt, trafficReadyAt } from "@/lib/project-schedule";
import { decryptAutomationCredential, tokenHash } from "@/lib/automation-credentials";
import { collectGa4Period, ga4Client, GA4_PROPERTY, GA4_TIMEZONE, mergeGa4Periods, type Ga4Period } from "@/lib/ga4-collector";
import { weeklyEvidenceSchema } from "@/lib/weekly-evidence-schema";
import { reportPeriods } from "@/lib/weekly-traffic";
import { serpPeriod } from "@/lib/serp-periods";
import { rankingImportSchema } from "@/lib/ranking-import";
import { importSeo } from "@/lib/services/seo-import";
import { displayDataChanged } from "@/lib/services/display-change";

export async function automationConfig() {
  return prisma.projectAutomation.upsert({where:{id:"default"},create:{id:"default"},update:{}});
}
export async function enqueueProjectJobs(now = new Date()) {
  const config = await automationConfig();
  const jobs = projectDueJobs(now).filter(job=>job.kind === "TRAFFIC" ? config.trafficEnabled : config.sheetsEnabled);
  if (jobs.length) await prisma.projectJob.createMany({data:jobs,skipDuplicates:true});
  // A missed daily check is replaced by today's full read, never replayed as a
  // destructive historical snapshot. Weekly jobs remain independently durable.
  await prisma.projectJob.updateMany({where:{kind:"SHEETS",periodStart:{lt:beijingDay(now)},status:{in:["QUEUED","BLOCKED","RETRY","FAILED"]}},data:{status:"SUPERSEDED",completedAt:now,detail:"由当天完整检查替代"}});
  return config;
}
export async function claimProjectJob(kind: "TRAFFIC" | "SHEETS", now = new Date()) {
  // UPDATE ... SKIP LOCKED is one statement: concurrent cron/worker invocations
  // cannot both own a job. An expired owner cannot commit using its old token.
  const leaseToken = randomUUID(), leaseUntil = new Date(now.getTime()+10*60000);
  const rows = await prisma.$queryRaw<ProjectJob[]>`UPDATE "ProjectJob" SET status='RUNNING', "leaseToken"=${leaseToken}, "leaseUntil"=${leaseUntil}, "startedAt"=COALESCE("startedAt",${now}), "updatedAt"=${now}, payload=CASE WHEN kind='SHEETS' THEN NULL ELSE payload END
    WHERE id=(SELECT id FROM "ProjectJob" WHERE kind=${kind} AND "nextAttemptAt"<=${now}
      AND (kind!='SHEETS' OR "periodStart"=${beijingDay(now)})
      AND (status IN ('QUEUED','RETRY','WAITING_DATA','WAITING_KEYWORDS') OR (status='RUNNING' AND "leaseUntil"<${now}))
      ORDER BY "dueAt", id FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING *`;
  return rows[0] ?? null;
}
export async function finishProjectJob(job: Pick<ProjectJob,"id"|"leaseToken">, data: Prisma.ProjectJobUpdateManyMutationInput) {
  const result=await prisma.projectJob.updateMany({where:{id:job.id,leaseToken:job.leaseToken,status:"RUNNING",leaseUntil:{gt:new Date()}},data:{...data,leaseToken:null,leaseUntil:null}});
  if (result.count!==1) throw new Error("JOB_LEASE_LOST");
}
export async function failProjectJob(job: ProjectJob, code: string) {
  const attempts=job.attempts+1, blocked=["GA4_AUTH_FAILED","GA4_PERMISSION","GA4_REGISTRATION_EVENT_UNVERIFIED","GA4_TIMEZONE_MISMATCH","CREDENTIAL_INVALID","DWS_AUTH"].includes(code);
  await finishProjectJob(job,{status:blocked?"BLOCKED":attempts>=4?"FAILED":"RETRY",attempts,errorCode:code,detail:blocked?"请检查取数连接授权":attempts>=4?"已停止自动重试，请检查连接后重试":"取数未完成，将自动重试",nextAttemptAt:retryAt(attempts,new Date())});
}
export async function rotateWorkerToken() {
  const secret=`fk_worker_${randomBytes(32).toString("base64url")}`;
  await automationConfig();
  await prisma.projectAutomation.update({where:{id:"default"},data:{workerTokenHash:tokenHash(secret),workerSeenAt:null}});
  return secret;
}
function storedPeriod(analysis: unknown): Ga4Period | null {
  const checked=weeklyEvidenceSchema.safeParse(analysis);
  if (!checked.success || !checked.data.newVisitorFunnel || !checked.data.directRegistrationCountries) return null;
  const data=checked.data;
  return {totals:data.totals.current,channels:data.channels.map(row=>({name:row.name,newUsers:row.newUsers.current,newRegistrations:row.registrations.current})),
    directCountries:Object.fromEntries(Object.entries(data.directRegistrationCountries!).map(([name,value])=>[name,value.current])),funnel:data.newVisitorFunnel!.current};
}
export async function keywordDependency(periodStart: string) {
  const publication=new Date(trafficReadyAt(periodStart));
  const slot=serpPeriod(publication), day=beijingDay(publication);
  if(slot.start!==day) return false;
  const [config,run]=await Promise.all([prisma.serpMonitorConfig.findUnique({where:{id:"default"},select:{paidEnabled:true}}),prisma.serpMonitorRun.findUnique({where:{periodKey_scope:{periodKey:slot.key,scope:"SCHEDULED"}},select:{status:true}})]);
  // An explicitly disabled paid cycle must not trigger paid work or block GA4.
  return Boolean((run && run.status!=="COMPLETED") || (!run && config?.paidEnabled));
}
export async function runProjectJobs(now = new Date()) {
  const config=await enqueueProjectJobs(now);
  if(!config.trafficEnabled) return {status:"DISABLED"};
  const job=await claimProjectJob("TRAFFIC",now);
  if(!job) return {status:"IDLE"};
  try {
    const ready=trafficReadyAt(job.periodStart);
    if(now<ready) {await finishProjectJob(job,{status:"WAITING_DATA",nextAttemptAt:ready,detail:"周报已排队，18:30 读取完整周数据"});return {status:"WAITING_DATA"};}
    const periods=reportPeriods(job.periodStart);
    const existing=await prisma.weeklyTraffic.findFirst({where:{siteDomain:"flatkey.ai",periodStart:new Date(job.periodStart),periodEnd:new Date(periods.current.end),ga4PropertyId:GA4_PROPERTY,timezone:GA4_TIMEZONE,registrationMetric:"sign_up_success_distinct_users"},orderBy:{collectedAt:"desc"}});
    const evidence=weeklyEvidenceSchema.safeParse(existing?.analysis);
    const existingComplete=Boolean(existing && evidence.success && evidence.data.totals.current.newUsers===existing.newUsers && evidence.data.totals.current.newRegistrations===existing.newRegistrations);
    let payload=job.payload ? rankingImportSchema.parse(job.payload) : null;
    // An authenticated manual/one-time full import can satisfy the same job.
    // Never overwrite it with an older collection or fetch it a second time.
    if(!existingComplete && !payload) {
      // A saved full report or staged result can finish even when credentials
      // have since been removed; only new provider reads require a connection.
      if(!config.ga4Credentials) {
        await finishProjectJob(job,{status:"BLOCKED",errorCode:"GA4_NOT_CONNECTED",detail:"GA4 服务账号待连接"});
        return {status:"BLOCKED"};
      }
      let key:unknown;
      try {key=JSON.parse(decryptAutomationCredential(config.ga4Credentials));} catch {throw new Error("CREDENTIAL_INVALID");}
      const client=await ga4Client(key);
      const previous=await prisma.weeklyTraffic.findFirst({where:{siteDomain:"flatkey.ai",periodStart:new Date(periods.previous.start),periodEnd:new Date(periods.previous.end),ga4PropertyId:GA4_PROPERTY,timezone:GA4_TIMEZONE,registrationMetric:"sign_up_success_distinct_users"},orderBy:{collectedAt:"desc"}});
      const cached=storedPeriod(previous?.analysis);
      const comparable=previous && cached?.totals.newUsers===previous.newUsers && cached?.totals.newRegistrations===previous.newRegistrations ? cached : null;
      const [current,before]=await Promise.all([collectGa4Period(client,periods.current),comparable??collectGa4Period(client,periods.previous)]);
      const analysis=mergeGa4Periods(current,before);
      payload=rankingImportSchema.parse({requestId:`project-weekly:${job.periodStart}`,targetDomain:"flatkey.ai",traffic:[{periodStart:periods.current.start,periodEnd:periods.current.end,timezone:GA4_TIMEZONE,...current.totals,scope:"all_users",registrationMetric:"sign_up_success_distinct_users",ga4PropertyId:GA4_PROPERTY,collectedAt:new Date().toISOString(),analysis}]});
      const saved=await prisma.projectJob.updateMany({where:{id:job.id,leaseToken:job.leaseToken,status:"RUNNING"},data:{payload:payload as unknown as Prisma.InputJsonValue}});
      if(saved.count!==1)throw new Error("JOB_LEASE_LOST");
    }
    if(await keywordDependency(job.periodStart)) {
      await finishProjectJob(job,{status:"WAITING_KEYWORDS",nextAttemptAt:new Date(Date.now()+5*60000),detail:"流量已备妥，等待本期关键词；不会重新请求 GA4"});
      return {status:"WAITING_KEYWORDS"};
    }
    // The lease is checked before the idempotent import. A crash after import
    // is harmless: the next owner reuses its stable request ID / saved report.
    const lease=await prisma.projectJob.findFirst({where:{id:job.id,leaseToken:job.leaseToken,leaseUntil:{gt:new Date()}}});
    if(!lease)throw new Error("JOB_LEASE_LOST");
    if(!existingComplete && payload) await importSeo(payload);
    await finishProjectJob(job,{status:"COMPLETED",completedAt:new Date(),errorCode:null,detail:existingComplete?"复用已保存的完整周报":"完整周报已保存，沿用上期数据对比"});
    await displayDataChanged();
    return {status:"COMPLETED"};
  } catch(error) {
    const code=error instanceof Error && /^[A-Z_]+$/.test(error.message)?error.message:"TRAFFIC_VALIDATION_FAILED";
    if(code!=="JOB_LEASE_LOST")await failProjectJob(job,code);
    return {status:code};
  }
}
