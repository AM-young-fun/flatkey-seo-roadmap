import { prisma } from "@/lib/prisma";
import { envBool } from "@/lib/env";
import { SERP_CONFIG_ID } from "@/lib/dataforseo-serp";
import { operationStateLabels, plannedRankingTime, schedulerState, nextCollectorTime, configuredAutomationPlans, automationConfigurationVerifiedAt, type OperationsStatus } from "@/lib/operations";
import { keywordCyclePlan } from "@/lib/keyword-cycle";
import { SERP_COLLECTION_SITE } from "@/lib/serp-targets";
import { serpPeriod } from "@/lib/serp-periods";

const iso = (value: Date | null) => value?.toISOString() ?? null;
const state = (value: string) => operationStateLabels[value] ?? "状态异常";
export async function loadOperationsStatus(now = new Date()): Promise<OperationsStatus> {
  // Metadata only. Opening this view never calls a provider or starts a job.
  const [config, connection, checks, rankings, discoveries, reports, collectors] = await Promise.all([
    prisma.serpMonitorConfig.findUnique({ where: { id: SERP_CONFIG_ID }, select: { paidEnabled: true, authorizationVersion: true, nextDueAt: true, maxRunCostMicros: true, maxMonthCostMicros: true } }),
    prisma.dataForSeoConnection.findUnique({ where: { siteDomain: "flatkey.ai" }, select: { scheduleEnabled: true } }),
    prisma.schedulerCheck.findMany({ orderBy: { startedAt: "desc" }, take: 4 }),
    prisma.serpMonitorRun.findMany({ where: { scope: { in: ["SCHEDULED", "SAMPLE"] } }, orderBy: { createdAt: "desc" }, take: 4, select: { id: true, scope: true, periodKey: true, periodLabel: true, status: true, queryCount: true, startedAt: true, completedAt: true } }),
    prisma.dataForSeoRun.findMany({ where: { siteDomain: SERP_COLLECTION_SITE, requestId: { startsWith: "discovery-" } }, orderBy: { createdAt: "desc" }, take: 4, select: { requestId: true, siteDomain: true, status: true, createdAt: true, completedAt: true } }),
    prisma.weeklyTraffic.findMany({ orderBy: { importedAt: "desc" }, take: 3, select: { id: true, siteDomain: true, periodStart: true, periodEnd: true, collectedAt: true, importedAt: true } }),
    prisma.collectorRun.findMany({orderBy:{updatedAt:"desc"},take:6,select:{id:true,kind:true,periodStart:true,status:true,startedAt:true,completedAt:true,detail:true,checkedItems:true}}),
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
    ...collectors.map(row=>({id:row.id,name:`Codex · ${{SHEETS:"三表同步",GA4:"周报采集与总结",AHREFS:"Ahrefs数据"}[row.kind]??"采集"}`,state:state(row.status),startedAt:row.startedAt.toISOString(),completedAt:iso(row.completedAt),detail:row.detail??`${row.periodStart} · 核对 ${row.checkedItems} 项`})),
    ...checks.map(row => ({ id: `check:${row.id}`, name: "线上调度检查", state: state(row.status), startedAt: row.startedAt.toISOString(), completedAt: iso(row.completedAt), detail: `新词：${state(row.discoveryStatus ?? "UNAVAILABLE")} · 排名：${state(row.serpStatus ?? "UNAVAILABLE")} · 付费提交 ${row.paidRequests} 批` })),
    ...rankings.map(row => ({ id: `serp:${row.id}`, name: `实际排名 · ${row.scope === "SAMPLE" && row.periodKey === "2026-10-2" ? "2026年10月第1期" : row.periodLabel}`, state: state(row.status), startedAt: row.startedAt.toISOString(), completedAt: iso(row.completedAt), detail: `${row.queryCount.toLocaleString()} 次国家关键词查询` })),
    ...discoveries.map(row => ({ id: `labs:${row.requestId}`, name: `新词发现 · ${row.siteDomain}`, state: state(row.status), startedAt: row.createdAt.toISOString(), completedAt: iso(row.completedAt), detail: row.requestId.match(/-(US|JP|ES|BR)$/)?.[1] ?? "四国市场", ...(row.status === "IMPORT_FAILED" ? {failedDiscoveryId:row.requestId} : {}) })),
    ...reports.map(row => ({ id: `report:${row.id}`, name: `流量周期快照 · ${row.siteDomain}`, state: "已保存", startedAt: row.importedAt.toISOString(), completedAt: row.importedAt.toISOString(), detail: `${row.periodStart.toISOString().slice(0, 10)} 至 ${row.periodEnd.toISOString().slice(0, 10)} · 外部采集器导入` })),
  ].sort((a, b) => b.startedAt.localeCompare(a.startedAt)).slice(0, 10);
  return {
    checkedAt: now.toISOString(),
    automationConfigurationVerifiedAt,
    controls: { enabled: rankingEnabled && discoveryEnabled, emergencyStopped: stopped, maxRunCostMicros: config?.maxRunCostMicros ?? 0, maxMonthCostMicros: config?.maxMonthCostMicros ?? 0, discoveryMaxCostMicros: cycle.maxDiscoveryCostMicros },
    scheduler: { configured: Boolean(process.env.CRON_SECRET), cadence: "每5分钟检查及续跑任务", state: schedulerState(last, now), lastStartedAt: iso(last?.startedAt ?? null), lastCompletedAt: iso(last?.completedAt ?? null) },
    plans: [
      { id: "rankings", name: "DataForSEO 新词与排名", location: "项目服务器 · Vercel", cadence: "隔周周四 08:00", state: rankingEnabled && discoveryEnabled ? "自动执行已启用" : "自动付费未启用", nextAt, currentExecution, note: "仅Flatkey：先发现业务新词，再查询已有合适页面的正式词；美国、日本、西班牙、巴西。" },
      { id: "traffic", name: "五站 GA4 / GSC 与页面台账", location: "GitHub Actions · 服务器采集", cadence: "每日 10:30", state: "服务器定时 · 成功待回执", nextAt:nextCollectorTime(now,"traffic"), note: "自然搜索与来源实际日期分别保存，回补近期数据；三表同步和博客任务不重复采集。任何来源缺失均保留原因。" },
      ...configuredAutomationPlans(now),
    ], records,
  };
}
