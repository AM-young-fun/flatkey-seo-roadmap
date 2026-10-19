import { prisma } from "@/lib/prisma";
import { envBool } from "@/lib/env";
import { SERP_CONFIG_ID } from "@/lib/dataforseo-serp";
import { operationStateLabels, plannedRankingTime, schedulerState, type OperationsStatus } from "@/lib/operations";
import { keywordCyclePlan } from "@/lib/keyword-cycle";
import { SERP_COLLECTION_SITE } from "@/lib/serp-targets";
import { serpPeriod } from "@/lib/serp-periods";

const iso = (value: Date | null) => value?.toISOString() ?? null;
const state = (value: string) => operationStateLabels[value] ?? "状态异常";
export async function loadOperationsStatus(now = new Date()): Promise<OperationsStatus> {
  // Metadata only. Opening this view never calls a provider or starts a job.
  const [config, connection, checks, rankings, discoveries, reports] = await Promise.all([
    prisma.serpMonitorConfig.findUnique({ where: { id: SERP_CONFIG_ID }, select: { paidEnabled: true, authorizationVersion: true, nextDueAt: true, maxRunCostMicros: true, maxMonthCostMicros: true } }),
    prisma.dataForSeoConnection.findUnique({ where: { siteDomain: "flatkey.ai" }, select: { scheduleEnabled: true } }),
    prisma.schedulerCheck.findMany({ orderBy: { startedAt: "desc" }, take: 4 }),
    prisma.serpMonitorRun.findMany({ orderBy: { createdAt: "desc" }, take: 4, select: { id: true, scope: true, periodKey: true, periodLabel: true, status: true, queryCount: true, startedAt: true, completedAt: true } }),
    prisma.dataForSeoRun.findMany({ where: { siteDomain: SERP_COLLECTION_SITE, requestId: { startsWith: "discovery-" } }, orderBy: { createdAt: "desc" }, take: 4, select: { requestId: true, siteDomain: true, status: true, createdAt: true, completedAt: true } }),
    prisma.weeklyTraffic.findMany({ orderBy: { importedAt: "desc" }, take: 3, select: { id: true, siteDomain: true, periodStart: true, periodEnd: true, collectedAt: true, importedAt: true } }),
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
    ...checks.map(row => ({ id: `check:${row.id}`, name: "线上调度检查", state: state(row.status), startedAt: row.startedAt.toISOString(), completedAt: iso(row.completedAt), detail: `新词：${state(row.discoveryStatus ?? "UNAVAILABLE")} · 排名：${state(row.serpStatus ?? "UNAVAILABLE")} · 付费提交 ${row.paidRequests} 批` })),
    ...rankings.map(row => ({ id: `serp:${row.id}`, name: `实际排名 · ${row.scope === "SAMPLE" && row.periodKey === "2026-10-2" ? "2026年10月第1期" : row.periodLabel}`, state: state(row.status), startedAt: row.startedAt.toISOString(), completedAt: iso(row.completedAt), detail: `${row.queryCount.toLocaleString()} 次国家关键词查询` })),
    ...discoveries.map(row => ({ id: `labs:${row.requestId}`, name: `新词发现 · ${row.siteDomain}`, state: state(row.status), startedAt: row.createdAt.toISOString(), completedAt: iso(row.completedAt), detail: row.requestId.match(/-(US|JP|ES|BR)$/)?.[1] ?? "四国市场", ...(row.status === "IMPORT_FAILED" ? {failedDiscoveryId:row.requestId} : {}) })),
    ...reports.map(row => ({ id: `report:${row.id}`, name: `流量周报 · ${row.siteDomain}`, state: "已保存", startedAt: row.importedAt.toISOString(), completedAt: row.importedAt.toISOString(), detail: `${row.periodStart.toISOString().slice(0, 10)} 至 ${row.periodEnd.toISOString().slice(0, 10)} · 外部采集器导入` })),
  ].sort((a, b) => b.startedAt.localeCompare(a.startedAt)).slice(0, 10);
  return {
    checkedAt: now.toISOString(),
    controls: { enabled: rankingEnabled && discoveryEnabled, emergencyStopped: stopped, maxRunCostMicros: config?.maxRunCostMicros ?? 0, maxMonthCostMicros: config?.maxMonthCostMicros ?? 0, discoveryMaxCostMicros: cycle.maxDiscoveryCostMicros },
    scheduler: { configured: Boolean(process.env.CRON_SECRET), cadence: "每5分钟检查及续跑任务", state: schedulerState(last, now), lastStartedAt: iso(last?.startedAt ?? null), lastCompletedAt: iso(last?.completedAt ?? null) },
    plans: [
      { id: "rankings", name: "关键词排名", location: "线上项目 · Vercel", cadence: "隔周周二 10:30", state: rankingEnabled && discoveryEnabled ? "自动执行已启用" : "自动付费未启用", nextAt, currentExecution, note: "仅Flatkey：先发现业务新词，再查询已有合适页面的正式词；美国、日本、西班牙、巴西。" },
      { id: "sheets", name: "三张协作表", location: "外部已登录采集器", cadence: "每日 10:30（计划）", state: "未接入线上自动读取", nextAt: null, note: "线上接收新增和变更。下方同步状态表示已保存数据，不代表当天检查成功。" },
      { id: "traffic", name: "流量周报", location: "外部采集器 → 线上汇总", cadence: "每周二整理上周数据", state: "长期自动采集未启用", nextAt: null, note: "GA4仍需外部采集；Codex 中的单次补齐与线上计划独立。排名采集周等待本期结果。" },
    ], records,
  };
}
