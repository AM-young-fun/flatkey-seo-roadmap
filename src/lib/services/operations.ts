import { prisma } from "@/lib/prisma";
import { envBool } from "@/lib/env";
import { SERP_CONFIG_ID } from "@/lib/dataforseo-serp";
import { operationStateLabels, plannedRankingTime, schedulerState, type OperationsStatus } from "@/lib/operations";
import { keywordCyclePlan } from "@/lib/keyword-cycle";
import { SERP_COLLECTION_SITE } from "@/lib/serp-targets";
import { serpPeriod } from "@/lib/serp-periods";
import { jobLabels, nextDailyAt, nextWeeklyAt } from "@/lib/project-schedule";

const iso = (value: Date | null) => value?.toISOString() ?? null;
const state = (value: string) => operationStateLabels[value] ?? "状态异常";
export async function loadOperationsStatus(now = new Date()): Promise<OperationsStatus> {
  // Metadata only. Opening this view never calls a provider or starts a job.
  const [config, connection, checks, rankings, discoveries, reports, automation, jobs] = await Promise.all([
    prisma.serpMonitorConfig.findUnique({ where: { id: SERP_CONFIG_ID }, select: { paidEnabled: true, authorizationVersion: true, nextDueAt: true, maxRunCostMicros: true, maxMonthCostMicros: true } }),
    prisma.dataForSeoConnection.findUnique({ where: { siteDomain: "flatkey.ai" }, select: { scheduleEnabled: true } }),
    prisma.schedulerCheck.findMany({ orderBy: { startedAt: "desc" }, take: 4 }),
    prisma.serpMonitorRun.findMany({ orderBy: { createdAt: "desc" }, take: 4, select: { id: true, scope: true, periodKey: true, periodLabel: true, status: true, queryCount: true, startedAt: true, completedAt: true } }),
    prisma.dataForSeoRun.findMany({ where: { siteDomain: SERP_COLLECTION_SITE, requestId: { startsWith: "discovery-" } }, orderBy: { createdAt: "desc" }, take: 4, select: { requestId: true, siteDomain: true, status: true, createdAt: true, completedAt: true } }),
    prisma.weeklyTraffic.findMany({ orderBy: { importedAt: "desc" }, take: 3, select: { id: true, siteDomain: true, periodStart: true, periodEnd: true, collectedAt: true, importedAt: true } }),
    prisma.projectAutomation.findUnique({where:{id:"default"},select:{trafficEnabled:true,sheetsEnabled:true,ga4VerifiedAt:true,workerSeenAt:true}}),
    prisma.projectJob.findMany({orderBy:{updatedAt:"desc"},take:12,select:{id:true,kind:true,sourceId:true,periodStart:true,dueAt:true,startedAt:true,completedAt:true,status:true,detail:true,errorCode:true}}),
  ]);
  const stopped = envBool("DISABLE_EXTERNAL_FETCH"), last = checks[0] ?? null;
  const rankingEnabled = !stopped && config?.paidEnabled === true && config.authorizationVersion === 1;
  const discoveryEnabled = rankingEnabled && connection?.scheduleEnabled === true;
  const cycle = keywordCyclePlan(now, config?.nextDueAt ? serpPeriod(config.nextDueAt).key : undefined);
  const currentDiscoveries = discoveries.filter(row => cycle.jobs.some(job => job.requestId === row.requestId));
  const currentRanking = rankings.find(row => row.scope === "SCHEDULED" && row.periodKey === cycle.period.key);
  const started = currentDiscoveries.length > 0 || Boolean(currentRanking);
  const nextAt = plannedRankingTime(now, config?.nextDueAt ?? null, started ? [cycle.period.key] : []);
  const completedMarkets = currentDiscoveries.filter(row => row.status === "COMPLETED").length;
  const currentExecution = !started ? undefined : `${cycle.period.label} · ${currentRanking ? `实际排名${state(currentRanking.status)}` : `新词发现 ${completedMarkets}/${cycle.jobs.length} 国已完成，实际排名待开始`}`;
  const records: OperationsStatus["records"] = [
    ...jobs.map(row=>({id:`job:${row.id}`,name:row.kind==="TRAFFIC"?`流量周报 · ${row.periodStart}`:`三表同步 · ${{api_main:"API",cloud_main:"云服务",optimization:"SEO"}[row.sourceId??""]??"来源"}`,state:jobLabels[row.status]??"状态异常",startedAt:(row.startedAt??row.dueAt).toISOString(),completedAt:iso(row.completedAt),detail:[row.detail,row.errorCode].filter(Boolean).join(" · ")})),
    ...checks.map(row => ({ id: `check:${row.id}`, name: "线上调度检查", state: state(row.status), startedAt: row.startedAt.toISOString(), completedAt: iso(row.completedAt), detail: `新词：${state(row.discoveryStatus ?? "UNAVAILABLE")} · 排名：${state(row.serpStatus ?? "UNAVAILABLE")} · 付费提交 ${row.paidRequests} 批` })),
    ...rankings.map(row => ({ id: `serp:${row.id}`, name: `实际排名 · ${row.scope === "SAMPLE" && row.periodKey === "2026-10-2" ? "2026年10月第1期" : row.periodLabel}`, state: state(row.status), startedAt: row.startedAt.toISOString(), completedAt: iso(row.completedAt), detail: `${row.queryCount.toLocaleString()} 次国家关键词查询` })),
    ...discoveries.map(row => ({ id: `labs:${row.requestId}`, name: `新词发现 · ${row.siteDomain}`, state: state(row.status), startedAt: row.createdAt.toISOString(), completedAt: iso(row.completedAt), detail: row.requestId.match(/-(US|JP|ES|BR)$/)?.[1] ?? "四国市场", ...(row.status === "IMPORT_FAILED" ? {failedDiscoveryId:row.requestId} : {}) })),
    ...reports.map(row => ({ id: `report:${row.id}`, name: `流量周报 · ${row.siteDomain}`, state: "已保存", startedAt: row.importedAt.toISOString(), completedAt: row.importedAt.toISOString(), detail: `${row.periodStart.toISOString().slice(0, 10)} 至 ${row.periodEnd.toISOString().slice(0, 10)}` })),
  ].sort((a, b) => b.startedAt.localeCompare(a.startedAt)).slice(0, 10);
  return {
    checkedAt: now.toISOString(),
    controls: { enabled: rankingEnabled && discoveryEnabled, emergencyStopped: stopped, maxRunCostMicros: config?.maxRunCostMicros ?? 0, maxMonthCostMicros: config?.maxMonthCostMicros ?? 0, discoveryMaxCostMicros: cycle.maxDiscoveryCostMicros },
    scheduler: { configured: Boolean(process.env.CRON_SECRET), cadence: "每5分钟检查及续跑任务", state: schedulerState(last, now), lastStartedAt: iso(last?.startedAt ?? null), lastCompletedAt: iso(last?.completedAt ?? null) },
    plans: [
      { id: "rankings", name: "关键词排名", location: "线上项目 · Vercel", cadence: "隔周周二 10:30", state: rankingEnabled && discoveryEnabled ? "自动执行已启用" : "自动付费未启用", nextAt, currentExecution, note: "仅Flatkey：先发现业务新词，再查询已有合适页面的正式词；美国、日本、西班牙、巴西。" },
      { id: "sheets", name: "三张协作表", location: "项目队列 · DWS 常驻采集器", cadence: "每日 10:30", state: automation?.sheetsEnabled===false?"已暂停":automation?.workerSeenAt && now.getTime()-automation.workerSeenAt.getTime()<5*60000?"采集器在线":"等待采集器连接", nextAt:nextDailyAt(now), currentExecution:jobs.find(row=>row.kind==="SHEETS")?.detail??undefined, note: "按稳定编号增量入库，保留人工审核及页面关联；完整读取后才记录检查完成。采集器须部署在保持 DWS 登录的常驻主机。" },
      { id: "traffic", name: "流量周报", location: "线上项目 · GA4 Data API", cadence: "每周二 10:30 开始整理", state:automation?.trafficEnabled===false?"已暂停":automation?.ga4VerifiedAt?"自动取数已连接":"等待 GA4 授权", nextAt:nextWeeklyAt(now), currentExecution:jobs.find(row=>row.kind==="TRAFFIC")?.detail??undefined, note: "18:30 读取已结束的周二至周一；上期复用存档。采集周等待关键词完成，非采集周明确标注。需要服务账号的属性只读权限，不依赖 Codex。" },
    ], records,
  };
}
