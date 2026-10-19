import { createHash, randomUUID } from "node:crypto";
import { Prisma, type SerpMonitorConfig, type SerpMonitorRun, type SerpMonitorTask } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { decryptDataForSeoCredentials } from "@/lib/dataforseo-credentials";
import { envBool } from "@/lib/env";
import { ImportRequestError } from "@/lib/ranking-import";
import { loadScheduledSerpMonitoringCohort as loadSerpTargetCohort } from "@/lib/services/serp-targets";
import { nextSerpPeriodKey, periodDue, serpPeriod, serpPeriodFromKey } from "@/lib/serp-periods";
import { buildSerpTask, groupSerpMarketQueries, configForSerpRegion, isSerpRegion, normalizeSerpAdvanced, providerCostMicros, providerIdIsSafe, providerTaskEnvelope,
  quoteSerpTargets, SERP_CONFIG_ID, SERP_DEFAULT_CONFIG, SERP_MARKETS, SERP_NORMALIZATION_VERSION, SERP_PRICE_PER_QUERY_MICROS, SERP_TASK_GET_URL, SERP_TASK_POST_URL,
  serpTaskId, type SerpMonitorMutation } from "@/lib/dataforseo-serp";
import { parseSerpSampleBalance, SERP_USER_DATA_URL, SERP_SAMPLE_AUTHORIZATION_HASH, SERP_SAMPLE_MAX_QUERIES, SERP_SAMPLE_MAX_BUDGET_MICROS, SERP_SAMPLE_SAFETY_MARGIN_MICROS } from "@/lib/serp-sample";
import type { SerpMonitorConfiguration, SerpMonitorPreview, SerpMonitorRunDto, SerpMonitorStatus, SerpRunState, SerpTaskState } from "@/lib/serp-monitor-types";

const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const OPEN_RUNS = ["PLANNED", "RUNNING", "UNKNOWN"];
const TERMINAL_TASKS = ["COMPLETE", "INCOMPLETE", "FAILED"];
const hasTime = (deadline: number | undefined, reserveMs = 15_000) => deadline === undefined || Date.now() + reserveMs < deadline;
const requestTimeout = (deadline: number | undefined, maximum: number) => Math.max(1, Math.min(maximum, (deadline ?? Infinity) - Date.now() - 10_000));
// All 402xx account/limit failures stop further paid submission. Keep the
// ledger paused for review rather than burning through later batches.
const accountCode = (code: number) => [40100, 40104].includes(code) || (code >= 40200 && code < 40300);
const connectionFingerprint = (ciphertext: string) => createHash("sha256").update(ciphertext).digest("hex");
// The authenticated management page owns normal authorization. Deployment
// configuration retains the emergency stop, not a second hidden paid switch.
export const isSerpPaidEnvironmentEnabled = () => !envBool("DISABLE_EXTERNAL_FETCH");
export const isSerpScheduleAuthorized = (row: { paidEnabled: boolean; authorizationVersion?: number } | null) => row?.paidEnabled === true && row.authorizationVersion === 1;
function configuration(row: SerpMonitorConfig | null): SerpMonitorConfiguration {
  if (!row) return { ...SERP_DEFAULT_CONFIG };
  return { region: "US", regions: [...SERP_MARKETS], languageCode: "en", locationCode: 2840,
    device: row.device as "desktop", depth: row.depth as 100, intervalDays: row.intervalDays as 14, paidEnabled: row.paidEnabled,
    schedule: "BIWEEKLY_TUESDAY", scheduleDays: [2], timezone: "Asia/Shanghai", localTime: "10:30",
    maxRunCostMicros: row.maxRunCostMicros, maxMonthCostMicros: row.maxMonthCostMicros, revision: row.revision,
    nextDueAt: row.nextDueAt?.toISOString() ?? null };
}
const monthStart = (now = new Date()) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
async function monthReserved(tx: Prisma.TransactionClient = prisma) {
  return (await tx.serpMonitorRun.aggregate({ where: { OR: [{ createdAt: { gte: monthStart() } }, { completedAt: { gte: monthStart() } }, { status: { in: OPEN_RUNS } }] }, _sum: { reservedCostMicros: true } }))._sum.reservedCostMicros ?? 0;
}
async function runDto(run: SerpMonitorRun): Promise<SerpMonitorRunDto> {
  const groups = await prisma.serpMonitorTask.groupBy({ by: ["state"], where: { runId: run.id }, _count: true });
  return { id: run.id, scope: (run.scope ?? "SCHEDULED") as "SCHEDULED" | "SAMPLE", status: run.status as SerpRunState, targetCount: run.targetCount, queryCount: run.queryCount,
    estimatedCostMicros: run.estimatedCostMicros, reservedCostMicros: run.reservedCostMicros, actualCostMicros: run.actualCostMicros,
    startedAt: run.startedAt.toISOString(), completedAt: run.completedAt?.toISOString() ?? null, errorCode: run.errorCode,
    periodKey: run.periodKey, periodLabel: run.periodLabel, periodStart: run.periodStart.toISOString(), periodEnd: run.periodEnd.toISOString(),
    taskCounts: Object.fromEntries(groups.map(group => [group.state, group._count])) as Partial<Record<SerpTaskState, number>> };
}
export async function loadSerpMonitorStatus(): Promise<SerpMonitorStatus> {
  const [row, connection, cohort, runs, reserved] = await Promise.all([
    prisma.serpMonitorConfig.findUnique({ where: { id: SERP_CONFIG_ID } }),
    prisma.dataForSeoConnection.findUnique({ where: { siteDomain: "flatkey.ai" }, select: { loginMasked: true } }),
    loadSerpTargetCohort(), prisma.serpMonitorRun.findMany({ orderBy: { createdAt: "desc" }, take: 10 }), monthReserved(),
  ]);
  const config = configuration(row), quote = quoteSerpTargets(cohort.targets, SERP_MARKETS), environmentEnabled = isSerpPaidEnvironmentEnabled();
  const bySite: Record<string, number> = {};
  for (const target of cohort.targets) bySite[target.siteDomain] = (bySite[target.siteDomain] ?? 0) + 1;
  return { config, cronConfigured: Boolean(process.env.CRON_SECRET), gate: { environmentEnabled, persistedEnabled: isSerpScheduleAuthorized(row), canSpend: environmentEnabled && isSerpScheduleAuthorized(row) },
    connection: { configured: Boolean(connection), loginMasked: connection?.loginMasked ?? null },
    cohort: { hash: cohort.hash, targetCount: quote.targetCount, queryCount: quote.queryCount, allTargetCount: cohort.allTargetCount, heldTargetCount: cohort.heldTargetCount, bySite }, quote,
    budget: { monthReservedCostMicros: reserved, monthLimitMicros: config.maxMonthCostMicros }, runs: await Promise.all(runs.map(runDto)) };
}
export async function previewSerpMonitor(): Promise<SerpMonitorPreview> {
  const [row, cohort] = await Promise.all([prisma.serpMonitorConfig.findUnique({ where: { id: SERP_CONFIG_ID } }), loadSerpTargetCohort()]);
  return { action: "preview", cohortHash: cohort.hash, quote: quoteSerpTargets(cohort.targets, SERP_MARKETS), configuration: configuration(row), paidEnabled: false,
    message: "仅预览目标、去重查询及费用；未提交供应商任务。隔周周二10:30上海时间采集，付费抓取保持关闭。" };
}
async function configureDisabled(input: Extract<SerpMonitorMutation, { action: "configure" }>) {
  await prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"serp-monitor:budget"}))`;
    const current = await tx.serpMonitorConfig.findUnique({ where: { id: SERP_CONFIG_ID } });
    if (input.expectedRevision !== undefined && input.expectedRevision !== (current?.revision ?? 0)) throw new ImportRequestError("配置已变化，请刷新后重试", 409);
    // The legacy setup route can only pause. Enabling requires a signed fee
    // preview through the authenticated operations controls.
    const values = { paidEnabled: false, region: "US", languageCode: "en", locationCode: 2840, device: "desktop", depth: 100, schedule: "BIWEEKLY_TUESDAY", intervalDays: 14,
      maxRunCostMicros: input.maxRunCostMicros ?? current?.maxRunCostMicros ?? SERP_DEFAULT_CONFIG.maxRunCostMicros,
      maxMonthCostMicros: input.maxMonthCostMicros ?? current?.maxMonthCostMicros ?? SERP_DEFAULT_CONFIG.maxMonthCostMicros };
    await tx.serpMonitorConfig.upsert({ where: { id: SERP_CONFIG_ID }, create: { id: SERP_CONFIG_ID, ...values }, update: { ...values, revision: { increment: 1 } } });
  });
  return loadSerpMonitorStatus();
}
function requirePaidEnvironment() {
  if (!isSerpPaidEnvironmentEnabled()) throw new ImportRequestError("付费SERP抓取尚未启用，本次未请求供应商", 409);
}
async function reserveRun(id: string, expectedCohortHash: string, earlyPeriodKey?: string) {
  requirePaidEnvironment();
  const cohort = await loadSerpTargetCohort(), groups = groupSerpMarketQueries(cohort.targets), quote = quoteSerpTargets(cohort.targets, SERP_MARKETS), period = earlyPeriodKey ? serpPeriodFromKey(earlyPeriodKey) : serpPeriod(new Date());
  if (expectedCohortHash !== cohort.hash) throw new ImportRequestError("正式目标已变化，请重新预览目标和费用", 409);
  if (groups.length === 0) throw new ImportRequestError("没有可监控的正式目标", 409);
  const reservation = await prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"serp-monitor:budget"}))`;
    const existing = await tx.serpMonitorRun.findUnique({ where: { id } });
    if (existing) {
      if (existing.cohortHash !== expectedCohortHash) throw new ImportRequestError("采集标识已用于其他目标快照", 409);
      return { run: existing, duplicate: true };
    }
    if (await tx.serpMonitorRun.findUnique({ where: { periodKey_scope: { periodKey: period.key, scope: "SCHEDULED" } } })) throw new ImportRequestError("本期已有SERP采集账本，请查看或续跑原记录，不能重复扣费", 409);
    const row = await tx.serpMonitorConfig.findUnique({ where: { id: SERP_CONFIG_ID } }), config = configuration(row);
    if (!isSerpScheduleAuthorized(row)) throw new ImportRequestError("请先在数据管理开启隔周自动更新，本次未请求供应商", 409);
    if (earlyPeriodKey && (!row?.nextDueAt || row.nextDueAt.toISOString() !== period.dueAt || Date.parse(period.dueAt) - Date.now() > 86400000)) throw new ImportRequestError("只能提前执行24小时内的下一计划期", 409);
    if (!earlyPeriodKey && row?.nextDueAt && row.nextDueAt.getTime() > Date.now()) throw new ImportRequestError("尚未到下次隔周周二的采集时间", 409);
    if (await tx.serpMonitorRun.findFirst({ where: { status: { in: OPEN_RUNS } }, select: { id: true } })) throw new ImportRequestError("已有未完成或结果不明的SERP采集，请续跑原账本，不能重复扣费", 409);
    if (quote.maxCostMicros > config.maxRunCostMicros || await monthReserved(tx) + quote.maxCostMicros > config.maxMonthCostMicros) {
      // Commit the pause rather than rolling it back with the error. Otherwise
      // the next discovery cycle could keep spending while SERP is over cap.
      await tx.serpMonitorConfig.updateMany({ where: { id: SERP_CONFIG_ID }, data: { paidEnabled: false, authorizationVersion: 0, revision: { increment: 1 } } });
      return { run: null, duplicate: false };
    }
    const connection = await tx.dataForSeoConnection.findUnique({ where: { siteDomain: "flatkey.ai" } });
    if (!connection) throw new ImportRequestError("请先保存DataForSEO连接", 409);
    decryptDataForSeoCredentials(connection.encryptedCredentials);
    // Validate every query before reserving or sending the first paid batch.
    const tasks = groups.map(group => { const taskId = serpTaskId(id, group.queryKey); return { id: taskId, runId: id, queryKey: group.queryKey, region: group.region,
      keyword: group.keyword, targetsJson: json(group.targets), state: "PLANNED", requestJson: json(buildSerpTask(group, taskId, configForSerpRegion(group.region, config))) }; });
    const run = await tx.serpMonitorRun.create({ data: { id, scope: "SCHEDULED", periodKey: period.key, periodLabel: period.label,
      periodStart: new Date(`${period.start}T00:00:00+08:00`), periodEnd: new Date(`${period.end}T23:59:59.999+08:00`),
      status: "PLANNED", cohortHash: cohort.hash, cohortJson: json(cohort.allTargets), configJson: json({ ...config,
        allTargetCount: cohort.allTargetCount, allTargetHash: cohort.allTargetHash,
        selectedTargetIds: cohort.targets.map(target => `${target.siteDomain}:${target.keywordId}`),
        connectionHash: connectionFingerprint(connection.encryptedCredentials) }),
      queryCount: groups.length, targetCount: cohort.targets.length, estimatedCostMicros: quote.maxCostMicros, reservedCostMicros: quote.maxCostMicros, connectionVersion: connection.connectionVersion } });
    await tx.serpMonitorTask.createMany({ data: tasks });
    return { run, duplicate: false };
  }, { maxWait: 10_000, timeout: 30_000 });
  if (!reservation.run) throw new ImportRequestError("SERP采集超过单轮或月度预算上限，自动更新已暂停，本次未请求供应商", 409);
  return { run: reservation.run, duplicate: reservation.duplicate };
}
async function credentials() {
  const connection = await prisma.dataForSeoConnection.findUnique({ where: { siteDomain: "flatkey.ai" } });
  if (!connection) throw new ImportRequestError("DataForSEO连接不存在", 409);
  return { ...decryptDataForSeoCredentials(connection.encryptedCredentials), connectionVersion: connection.connectionVersion, connectionHash: connectionFingerprint(connection.encryptedCredentials) };
}
const basicHeader = (value: { apiLogin: string; apiPassword: string }) => `Basic ${Buffer.from(`${value.apiLogin}:${value.apiPassword}`).toString("base64")}`;
const rawRecord = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};

async function submitOneBatch(runId: string, sampleAuthorizationHash?: string, deadline?: number): Promise<number> {
  // Leave room for balance lookup, reservation, one non-retryable POST, raw
  // persistence and its atomic receipt association before the worker exits.
  if (!hasTime(deadline, 75_000)) return 0;
  if (!sampleAuthorizationHash) requirePaidEnvironment();
  else if (sampleAuthorizationHash !== SERP_SAMPLE_AUTHORIZATION_HASH || envBool("DISABLE_EXTERNAL_FETCH")) throw new ImportRequestError("小批抓取授权无效或外部请求已暂停", 409);
  const connection = await credentials();
  if (!sampleAuthorizationHash) {
    const run = await prisma.serpMonitorRun.findUniqueOrThrow({ where: { id: runId } });
    if (run.status === "UNKNOWN" || run.errorCode?.startsWith("ACCOUNT_")) return 0;
    const planned = await prisma.serpMonitorTask.findMany({ where: { runId, state: "PLANNED" }, select: { id: true } });
    if (!planned.length) return 0;
    try {
      const response = await fetch(SERP_USER_DATA_URL, { method: "GET", redirect: "error", cache: "no-store",
        signal: AbortSignal.timeout(requestTimeout(deadline, 5000)), headers: { Authorization: basicHeader(connection) } });
      if (!response.ok) throw new Error("BALANCE_UNAVAILABLE");
      const available = parseSerpSampleBalance(await response.json());
      if (available < planned.length * SERP_PRICE_PER_QUERY_MICROS + SERP_SAMPLE_SAFETY_MARGIN_MICROS) {
        await prisma.serpMonitorRun.update({ where: { id: runId }, data: { status: "UNKNOWN", errorCode: "ACCOUNT_BALANCE_INSUFFICIENT" } }); return 0;
      }
    } catch {
      await prisma.serpMonitorRun.update({ where: { id: runId }, data: { status: "UNKNOWN", errorCode: "ACCOUNT_BALANCE_UNVERIFIED" } }); return 0;
    }
  }
  if (!hasTime(deadline, 60_000)) return 0;
  const batch = await prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"serp-monitor:budget"}))`;
    const config = await tx.serpMonitorConfig.findUnique({ where: { id: SERP_CONFIG_ID } });
    const run = await tx.serpMonitorRun.findUniqueOrThrow({ where: { id: runId } });
    if (sampleAuthorizationHash) {
      if (process.env.DATAFORSEO_SERP_PAID_ENABLED === "true" || config?.paidEnabled || run.scope !== "SAMPLE" || run.sampleAuthorizationHash !== sampleAuthorizationHash) throw new ImportRequestError("小批授权不匹配，或全量计划未保持关闭", 409);
      const approved = rawRecord(run.configJson), cap = approved.sampleMaxBudgetMicros, balance = approved.sampleBalanceBeforeMicros;
      const expiration = Date.parse(String(approved.sampleAuthorizationExpiresAt ?? ""));
      if (approved.sampleAuthorizationHash !== sampleAuthorizationHash || !Number.isFinite(expiration) || expiration < Date.now() ||
        !Number.isSafeInteger(cap) || Number(cap) > SERP_SAMPLE_MAX_BUDGET_MICROS || !Number.isSafeInteger(balance) ||
        run.queryCount < 1 || run.queryCount > SERP_SAMPLE_MAX_QUERIES || run.estimatedCostMicros !== run.queryCount * SERP_PRICE_PER_QUERY_MICROS ||
        run.reservedCostMicros !== run.estimatedCostMicros || run.reservedCostMicros > Number(cap) || run.reservedCostMicros + SERP_SAMPLE_SAFETY_MARGIN_MICROS > Number(balance)) throw new ImportRequestError("小批授权已过期或超出余额预算，未提交任务", 409);
      const allTasks = await tx.serpMonitorTask.findMany({ where: { runId } });
      if (allTasks.length !== run.queryCount) throw new ImportRequestError("小批任务清单与授权不一致", 409);
      const targetIds = new Set<string>(), marketCoverage = new Map<string, Set<string>>(), marketTargets = new Map<string, string>();
      const frozen = new Map<string, Record<string, unknown>>((Array.isArray(run.cohortJson) ? run.cohortJson : []).map(raw => {
        const item = rawRecord(raw); return [`${item.siteDomain}:${item.keywordId}`, item] as const;
      }));
      for (const task of allTasks) {
        if (!isSerpRegion(task.region) || task.queryKey !== `${task.region}:${task.keyword.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase()}`) throw new ImportRequestError("小批国家或查询标识不一致", 409);
        const keywordKey = task.queryKey.slice(3), coverage = marketCoverage.get(keywordKey) ?? new Set<string>();
        coverage.add(task.region); marketCoverage.set(keywordKey, coverage);
        if (!Array.isArray(task.targetsJson)) throw new ImportRequestError("小批目标清单无效", 409);
        const taskTargetIds: string[] = [];
        for (const raw of task.targetsJson) {
          const target = rawRecord(raw), id = `${target.siteDomain}:${target.keywordId}`, original = frozen.get(id);
          if (!original || typeof original.keyword !== "string" || original.keyword.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase() !== keywordKey ||
            typeof target.keyword !== "string" || target.keyword.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase() !== keywordKey ||
            !Array.isArray(target.targetUrls) || !Array.isArray(original.targetUrls) ||
            JSON.stringify([...target.targetUrls].sort()) !== JSON.stringify([...original.targetUrls].sort())) throw new ImportRequestError("小批目标与冻结的正式词库不一致", 409);
          targetIds.add(id); taskTargetIds.push(id);
        }
        const targetSnapshot = JSON.stringify(taskTargetIds.sort());
        if (!taskTargetIds.length || new Set(taskTargetIds).size !== taskTargetIds.length || (marketTargets.has(keywordKey) && marketTargets.get(keywordKey) !== targetSnapshot)) throw new ImportRequestError("同一关键词在四国的目标集合不一致", 409);
        marketTargets.set(keywordKey, targetSnapshot);
        const expected = buildSerpTask({ keyword: task.keyword, queryKey: task.queryKey, targets: [] }, task.id, configForSerpRegion(task.region));
        const saved = rawRecord(task.requestJson);
        if (Object.keys(saved).length !== Object.keys(expected).length || Object.entries(expected).some(([key, value]) => saved[key] !== value)) throw new ImportRequestError("小批查询参数已变化，未提交任务", 409);
      }
      if ([...marketCoverage.values()].some(coverage => coverage.size !== SERP_MARKETS.length || SERP_MARKETS.some(region => !coverage.has(region)))) throw new ImportRequestError("小批必须完整覆盖四个国家，未提交任务", 409);
      const allowed = Array.isArray(approved.selectedTargetIds) ? approved.selectedTargetIds : [];
      if (allowed.length !== targetIds.size || new Set(allowed).size !== targetIds.size || run.targetCount !== targetIds.size || allowed.some(id => typeof id !== "string" || !targetIds.has(id))) throw new ImportRequestError("小批目标超出授权范围", 409);
    } else if (!isSerpScheduleAuthorized(config) || (run.scope ?? "SCHEDULED") !== "SCHEDULED") throw new ImportRequestError("全量付费SERP抓取已关闭或任务范围不符", 409);
    if (run.status === "UNKNOWN") throw new ImportRequestError("供应商接收结果不明，禁止重复提交", 409);
    if (run.connectionVersion !== connection.connectionVersion || rawRecord(run.configJson).connectionHash !== connection.connectionHash) throw new ImportRequestError("采集期间连接已变化，请先核对原账本", 409);
    const active = await tx.serpMonitorTask.findFirst({ where: { runId, state: { in: ["SUBMITTING", "UNKNOWN"] } } });
    if (active) return [];
    const selected = await tx.serpMonitorTask.findMany({ where: { runId, state: "PLANNED" }, orderBy: [{ keyword: "asc" }, { region: "asc" }], take: 100 });
    if (!selected.length) return [];
    await tx.serpMonitorTask.updateMany({ where: { id: { in: selected.map(task => task.id) }, state: "PLANNED" }, data: { state: "SUBMITTING", submittedAt: new Date() } });
    await tx.serpMonitorRun.update({ where: { id: runId }, data: { status: "RUNNING" } });
    return selected;
  }, { maxWait: 10_000, timeout: 20_000 });
  if (!batch.length) return 0;
  let raw: string;
  try {
    // The reservation above is durable. Exactly one POST for this batch, no
    // retries/redirects: a lost response is UNKNOWN, never PLANNED again.
    const response = await fetch(SERP_TASK_POST_URL, { method: "POST", redirect: "error", signal: AbortSignal.timeout(requestTimeout(deadline, 12_000)),
      headers: { "Content-Type": "application/json", Authorization: basicHeader(connection) }, body: JSON.stringify(batch.map(task => task.requestJson)) });
    raw = await response.text();
    // Even HTTP errors may follow accepted tasks. Preserve the response and
    // decide each task using its echoed tag, never assume a free retry.
  } catch {
    await markUnknown(runId, batch.map(task => task.id), "SUBMISSION_OUTCOME_UNKNOWN");
    return batch.length;
  }
  await prisma.serpMonitorTask.updateMany({ where: { id: { in: batch.map(task => task.id) }, state: "SUBMITTING" }, data: { submissionRaw: raw } });
  await associateSubmissionReceipt(runId, batch, raw);
  return batch.length;
}
// One fixed, single-use user authorization can submit only its small reserved
// ledger. It never changes either scheduled spending gate or its due date.
export async function submitSerpSampleBatch(runId: string, authorizationHash: string) {
  return submitOneBatch(runId, authorizationHash);
}
async function enforceCostBoundsInTransaction(tx: Prisma.TransactionClient, runId: string, batchIds?: string[], batchReportedCost: number | null = null) {
    const run = await tx.serpMonitorRun.findUniqueOrThrow({ where: { id: runId } });
    const total = (await tx.serpMonitorTask.aggregate({ where: { runId }, _sum: { costMicros: true } }))._sum.costMicros ?? 0;
    const batchTotal = batchIds ? (await tx.serpMonitorTask.aggregate({ where: { id: { in: batchIds } }, _sum: { costMicros: true } }))._sum.costMicros ?? 0 : 0;
    const observed = Math.max(total, run.actualCostMicros ?? 0, batchIds && batchReportedCost != null ? total - batchTotal + batchReportedCost : 0);
    const excessiveTask = await tx.serpMonitorTask.findFirst({ where: { runId, costMicros: { gt: SERP_PRICE_PER_QUERY_MICROS } }, select: { id: true } });
    if (excessiveTask || observed > run.reservedCostMicros || (batchIds && batchReportedCost != null && batchReportedCost > batchIds.length * SERP_PRICE_PER_QUERY_MICROS) || run.errorCode?.startsWith("COST_")) {
      // Keep every accepted provider ID available for free retrieval. Preserve
      // the original reservation, raising it if the already-paid receipt is
      // higher; no subsequent paid batch may proceed without manual review.
      await tx.serpMonitorRun.update({ where: { id: runId }, data: { status: "UNKNOWN", errorCode: "COST_LIMIT_EXCEEDED",
        actualCostMicros: observed, reservedCostMicros: Math.max(run.reservedCostMicros, observed) } });
    }
}
async function enforceCostBounds(runId: string, batchIds?: string[], batchReportedCost: number | null = null) {
  await prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"serp-monitor:budget"}))`;
    await enforceCostBoundsInTransaction(tx, runId, batchIds, batchReportedCost);
  }, { maxWait: 10_000, timeout: 20_000 });
}
async function associateSubmissionReceipt(runId: string, batch: SerpMonitorTask[], raw: string) {
  let parsed: Record<string, unknown>;
  try { parsed = rawRecord(JSON.parse(raw)); } catch { await markUnknown(runId, batch.map(task => task.id), "INVALID_SUBMISSION_RECEIPT"); return; }
  const providerTasks = Array.isArray(parsed.tasks) ? parsed.tasks.map(rawRecord) : [];
  const providerIds = providerTasks.map(task => task.id).filter(providerIdIsSafe);
  let accountError = accountCode(Number(parsed.status_code)) ? `ACCOUNT_${parsed.status_code}` : null;
  const changes: Array<{ id: string; state: string; providerId: string | null; cost: number | null; error: string | null }> = batch.map(task => {
    const matches = providerTasks.filter(item => rawRecord(item.data).tag === task.id), received = matches[0];
    const code = Number(received?.status_code), id = received?.id;
    if (accountCode(code)) accountError = `ACCOUNT_${code}`;
    if (parsed.status_code !== 20000 || matches.length !== 1 || (providerIdIsSafe(id) && providerIds.filter(value => value === id).length !== 1)) {
      return { id: task.id, state: "UNKNOWN", providerId: null, cost: null, error: "UNMATCHED_SUBMISSION_RECEIPT" };
    }
    const cost = providerCostMicros(received.cost);
    if (providerIdIsSafe(id) && [20000, 20100, 20101, 20102].includes(code)) return { id: task.id, state: "QUEUED", providerId: id, cost, error: null };
    if (code >= 40000 && code < 50000) return { id: task.id, state: "FAILED", providerId: null, cost, error: `PROVIDER_${code}` };
    return { id: task.id, state: "UNKNOWN", providerId: null, cost, error: "UNCONFIRMED_PROVIDER_TASK" };
  });
  // Associate a whole committed POST and enforce its budget in one transaction.
  // Another worker cannot submit the next batch between receipt writes and an
  // account/cost stop. Raw submission evidence was saved before this step.
  await prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"serp-monitor:budget"}))`;
    const existing = await tx.serpMonitorTask.findMany({ where: { providerTaskId: { in: changes.flatMap(change => change.providerId ? [change.providerId] : []) } }, select: { id: true, providerTaskId: true } });
    for (const change of changes) if (change.providerId && existing.some(task => task.providerTaskId === change.providerId && task.id !== change.id)) {
      change.state = "UNKNOWN"; change.error = "PROVIDER_ID_ALREADY_OWNED"; change.providerId = null;
    }
    const values = Prisma.join(changes.map(change => Prisma.sql`(${change.id}::text, ${change.state}::text,
      ${change.providerId}::text, ${change.cost}::integer, ${change.error}::text)`));
    await tx.$executeRaw(Prisma.sql`
      /* serp-monitor:submission-receipts */
      UPDATE "SerpMonitorTask" AS task SET state = receipt.state, "providerTaskId" = receipt.provider_id,
        "costMicros" = COALESCE(receipt.cost, task."costMicros"), "errorCode" = receipt.error, "updatedAt" = CURRENT_TIMESTAMP
      FROM (VALUES ${values}) AS receipt(id, state, provider_id, cost, error)
      WHERE task.id = receipt.id AND task."runId" = ${runId} AND task.state = 'SUBMITTING'
    `);
    if (accountError || changes.some(change => change.state === "UNKNOWN")) await tx.serpMonitorRun.update({ where: { id: runId }, data: {
      status: "UNKNOWN", errorCode: accountError ?? "UNCONFIRMED_PROVIDER_TASK",
    } });
    await enforceCostBoundsInTransaction(tx, runId, batch.map(task => task.id), providerCostMicros(parsed.cost));
  }, { maxWait: 10_000, timeout: 20_000 });
}
async function markUnknown(runId: string, ids: string[], errorCode: string) {
  await prisma.$transaction(async tx => {
    await tx.serpMonitorTask.updateMany({ where: { id: { in: ids }, state: "SUBMITTING" }, data: { state: "UNKNOWN", errorCode } });
    await tx.serpMonitorRun.update({ where: { id: runId }, data: { status: "UNKNOWN", errorCode } });
  });
}
type ResultChange = { id: string; cost: number | null; normalized: Prisma.InputJsonValue | null; checkedAt: Date | null; state: string; errorCode: string | null };
async function saveNormalizedResults(runId: string, changes: ResultChange[], marker = "serp-monitor:normalized-results") {
  if (!changes.length) return;
  const values = Prisma.join(changes.map(change => Prisma.sql`(${change.id}::text, ${change.cost}::integer,
    ${change.normalized === null ? null : JSON.stringify(change.normalized)}::jsonb, ${change.checkedAt}::timestamp,
    ${change.state}::text, ${change.errorCode}::text)`));
  // The marker is selected internally, never from a request. Both paths use
  // exactly the same guarded update and never overwrite unreceived evidence.
  await prisma.$transaction(tx => tx.$executeRaw(Prisma.sql`
    ${Prisma.raw(`/* ${marker} */`)}
    UPDATE "SerpMonitorTask" AS task SET "costMicros" = settled.cost, "normalizedJson" = settled.normalized,
      "checkedAt" = settled.checked_at, state = settled.state, "errorCode" = settled.error, "updatedAt" = CURRENT_TIMESTAMP
    FROM (VALUES ${values}) AS settled(id, cost, normalized, checked_at, state, error)
    WHERE task.id = settled.id AND task."runId" = ${runId}
      AND task.state IN ('RECEIVED', 'INCOMPLETE', 'COMPLETE')
      AND (task."costMicros" IS DISTINCT FROM settled.cost OR task."normalizedJson" IS DISTINCT FROM settled.normalized
        OR task."checkedAt" IS DISTINCT FROM settled.checked_at OR task.state IS DISTINCT FROM settled.state
        OR task."errorCode" IS DISTINCT FROM settled.error)
  `), { maxWait: 5_000, timeout: 10_000 });
  if (changes.some(change => change.cost !== null && change.cost > SERP_PRICE_PER_QUERY_MICROS)) await enforceCostBounds(runId);
}
async function replayTasks(tasks: SerpMonitorTask[], config: SerpMonitorConfiguration) {
  if (!tasks.length) return;
  const changes: ResultChange[] = [];
  for (const task of tasks) {
    if (!task.rawResponse || !task.providerTaskId) continue;
    let cost = task.costMicros;
    try {
      const raw = JSON.parse(task.rawResponse), receipt = providerTaskEnvelope(raw, task.providerTaskId);
      // Successful GET is the settled cost, including refunds. Submission raw
      // remains immutable evidence of the original prepayment.
      cost = (receipt.status_code === 20000 ? providerCostMicros(receipt.cost) : null) ?? cost;
      const normalized = normalizeSerpAdvanced(raw, { providerTaskId: task.providerTaskId, keyword: task.keyword,
        config: configForSerpRegion((task.region ?? config.region) as SerpMonitorConfiguration["region"], config) });
      changes.push({ id: task.id, cost, normalized: json(normalized), checkedAt: new Date(normalized.checkedAt),
        state: normalized.captureComplete ? "COMPLETE" : "INCOMPLETE", errorCode: normalized.captureComplete ? null : "ORGANIC_STRUCTURE_INVALID" });
    } catch {
      changes.push({ id: task.id, cost, normalized: null, checkedAt: null, state: "INCOMPLETE", errorCode: "RESULT_VALIDATION_FAILED_V2" });
    }
  }
  await saveNormalizedResults(tasks[0].runId, changes);
}

async function repairCachedSampleResults(run: SerpMonitorRun) {
  if (run.scope !== "SAMPLE") return;
  // Upgrade the entire bounded trial locally. Versioned normalized results
  // separate completed collection from full top100 coverage. A single SQL
  // update also settles cached fees; subsequent resumes issue no repair writes.
  const cached = await prisma.serpMonitorTask.findMany({ where: { runId: run.id, state: { in: ["RECEIVED", "INCOMPLETE", "COMPLETE"] },
    rawResponse: { not: null }, providerTaskId: { not: null } }, take: SERP_SAMPLE_MAX_QUERIES });
  const changes: Array<{ id: string; cost: number | null; normalized: Prisma.InputJsonValue | null; checkedAt: Date | null; state: string; errorCode: string | null }> = [];
  for (const task of cached) {
    let cost = task.costMicros;
    try {
      const raw = JSON.parse(task.rawResponse!), receipt = providerTaskEnvelope(raw, task.providerTaskId!);
      cost = (receipt.status_code === 20000 ? providerCostMicros(receipt.cost) : null) ?? task.costMicros;
      const current = rawRecord(task.normalizedJson);
      const currentVersion = current.normalizationVersion === SERP_NORMALIZATION_VERSION && typeof current.captureComplete === "boolean" &&
        Number.isInteger(current.organicCount) && Number.isInteger(current.coveredThroughRank) &&
        ["EXACT", "AUTOCORRECTED"].includes(String(current.queryStatus)) && Object.hasOwn(current, "correctedKeyword") &&
        Object.hasOwn(current, "spellType") && Object.hasOwn(current, "pagesCount");
      const normalized = currentVersion ? current : normalizeSerpAdvanced(raw, {
        providerTaskId: task.providerTaskId!, keyword: task.keyword,
        config: configForSerpRegion((task.region ?? "US") as SerpMonitorConfiguration["region"], run.configJson as unknown as SerpMonitorConfiguration),
      });
      const state = normalized.captureComplete === true ? "COMPLETE" : "INCOMPLETE", errorCode = state === "COMPLETE" ? null : "ORGANIC_STRUCTURE_INVALID";
      const checkedAt = new Date(String(normalized.checkedAt));
      if (!Number.isFinite(checkedAt.getTime())) throw new Error("INVALID_CACHED_TIMESTAMP");
      if (!currentVersion || cost !== task.costMicros || state !== task.state || errorCode !== task.errorCode) changes.push({
        id: task.id, cost, normalized: json(normalized), checkedAt, state, errorCode,
      });
    } catch {
      // No fabricated capture or timestamp for invalid cached evidence. The
      // versioned error prevents endlessly rewriting an immutable bad receipt.
      if (task.errorCode !== "RESULT_VALIDATION_FAILED_V2" || cost !== task.costMicros) changes.push({
        id: task.id, cost, normalized: null, checkedAt: null, state: "INCOMPLETE", errorCode: "RESULT_VALIDATION_FAILED_V2",
      });
    }
  }
  if (!changes.length) return;
  await saveNormalizedResults(run.id, changes, "serp-monitor:upgrade-cached-sample-results");
}

type PollChange = { task: SerpMonitorTask; state: string; raw: string | null; cost: number | null; error: string | null; accountError: string | null };
async function fetchResult(task: SerpMonitorTask, authorization: string, deadline?: number): Promise<PollChange> {
  const pending = (error: string, accountError: string | null = null): PollChange => ({ task, state: "QUEUED", raw: null, cost: task.costMicros, error, accountError });
  if (!hasTime(deadline, 20_000)) return pending("POLL_TIME_BUDGET");
  if (!providerIdIsSafe(task.providerTaskId)) return pending("POLL_INVALID_PROVIDER_ID");
  let raw: string;
  try {
    const response = await fetch(`${SERP_TASK_GET_URL}/${task.providerTaskId}`, { method: "GET", redirect: "error",
      signal: AbortSignal.timeout(requestTimeout(deadline, 8_000)), headers: { Authorization: authorization } });
    if (!response.ok) return pending(`POLL_HTTP_${response.status}`, [401, 403].includes(response.status) ? `ACCOUNT_HTTP_${response.status}` : null);
    raw = await response.text();
  } catch { return pending("POLL_RETRY_FREE"); }
  let received: Record<string, unknown>;
  try {
    const body = JSON.parse(raw), rootCode = Number(rawRecord(body).status_code);
    if (accountCode(rootCode)) return pending(`PROVIDER_${rootCode}`, `ACCOUNT_${rootCode}`);
    received = providerTaskEnvelope(body, task.providerTaskId);
  }
  catch { return pending("POLL_INVALID_RECEIPT"); }
  const code = Number(received.status_code);
  if ([20100, 20101, 20102, 40602].includes(code)) return pending("PROVIDER_NOT_READY");
  if (accountCode(code)) return pending(`PROVIDER_${code}`, `ACCOUNT_${code}`);
  if (code !== 20000) return { task, state: "FAILED", raw, cost: task.costMicros, error: `PROVIDER_${code}`, accountError: null };
  return { task, state: "RECEIVED", raw, cost: providerCostMicros(received.cost) ?? task.costMicros, error: null, accountError: null };
}
async function pollResults(runId: string, config: SerpMonitorConfiguration, limit: number, dueBefore: Date, deadline?: number) {
  if (limit <= 0 || envBool("DISABLE_EXTERNAL_FETCH") || !hasTime(deadline, 30_000)) return 0;
  // Claim a bounded group before free GETs. This is a retry timestamp, not a
  // paid reservation; interrupted free reads become eligible again shortly.
  const tasks = await prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`serp-monitor:poll:${runId}`}))`;
    const selected = await tx.serpMonitorTask.findMany({ where: { runId, state: "QUEUED", providerTaskId: { not: null },
      OR: [{ lastPolledAt: null }, { lastPolledAt: { lt: dueBefore } }] },
      orderBy: [{ lastPolledAt: { sort: "asc", nulls: "first" } }, { keyword: "asc" }, { region: "asc" }], take: Math.min(40, limit) });
    if (selected.length) await tx.serpMonitorTask.updateMany({ where: { id: { in: selected.map(task => task.id) }, state: "QUEUED" }, data: { lastPolledAt: new Date() } });
    return selected;
  }, { maxWait: 5_000, timeout: 10_000 });
  if (!tasks.length) return 0;
  const authorization = basicHeader(await credentials());
  const changes: PollChange[] = [];
  // Gather at most 40 known-ID responses with eight requests in flight. Save
  // the group in two SQL statements instead of two writes for every keyword.
  // If a free response is lost before caching, only its free GET is retried.
  for (let index = 0; index < tasks.length && hasTime(deadline, 30_000); index += 8) {
    const wave = await Promise.all(tasks.slice(index, index + 8).map(task => fetchResult(task, authorization, deadline)));
    changes.push(...wave);
    if (wave.some(change => change.accountError || (change.cost !== null && change.cost > SERP_PRICE_PER_QUERY_MICROS))) break;
  }
  if (!changes.length) return 0;
  const accountError = changes.find(change => change.accountError)?.accountError;
  const costAnomaly = changes.some(change => change.cost !== null && change.cost > SERP_PRICE_PER_QUERY_MICROS);
  const values = Prisma.join(changes.map(change => Prisma.sql`(${change.task.id}::text, ${change.state}::text,
    ${change.raw}::text, ${change.cost}::integer, ${change.error}::text)`));
  // Raw evidence is durable before parsing. Only an exceptional account/fee
  // response needs the paid-budget lock and full cost audit; normal settled
  // fees cannot exceed the already-guarded per-query prepayment.
  await prisma.$transaction(async tx => {
    if (accountError || costAnomaly) await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"serp-monitor:budget"}))`;
    await tx.$executeRaw(Prisma.sql`
      /* serp-monitor:raw-results */
      UPDATE "SerpMonitorTask" AS task SET state = receipt.state, "rawResponse" = COALESCE(receipt.raw, task."rawResponse"),
        "costMicros" = receipt.cost, "errorCode" = receipt.error, "updatedAt" = CURRENT_TIMESTAMP
      FROM (VALUES ${values}) AS receipt(id, state, raw, cost, error)
      WHERE task.id = receipt.id AND task."runId" = ${runId} AND task.state = 'QUEUED'
    `);
    if (accountError) await tx.serpMonitorRun.update({ where: { id: runId }, data: { status: "UNKNOWN", errorCode: accountError } });
    if (costAnomaly) await enforceCostBoundsInTransaction(tx, runId);
  }, { maxWait: 5_000, timeout: 15_000 });
  await replayTasks(changes.filter(change => change.state === "RECEIVED").map(change => ({ ...change.task, rawResponse: change.raw, costMicros: change.cost })), config);
  return changes.filter(change => change.error !== "POLL_TIME_BUDGET").length;
}

async function finalizeRun(runId: string) {
  return prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"serp-monitor:budget"}))`;
    const run = await tx.serpMonitorRun.findUniqueOrThrow({ where: { id: runId } });
    const counts = await tx.serpMonitorTask.groupBy({ by: ["state"], where: { runId }, _count: true });
    if (counts.some(group => group.state === "UNKNOWN" || group.state === "SUBMITTING")) {
      // An active POST may still be in flight. Only truly unknown or stale
      // reservations block the run; never regress a successful task receipt.
      if (counts.some(group => group.state === "UNKNOWN")) await tx.serpMonitorRun.update({ where: { id: runId }, data: { status: "UNKNOWN" } });
      return run;
    }
    const reported = (await tx.serpMonitorTask.aggregate({ where: { runId }, _sum: { costMicros: true } }))._sum.costMicros;
    const actual = reported ?? run.actualCostMicros;
    if (run.errorCode?.startsWith("COST_")) return tx.serpMonitorRun.update({ where: { id: runId }, data: { status: "UNKNOWN",
      actualCostMicros: Math.max(actual ?? 0, run.actualCostMicros ?? 0), reservedCostMicros: Math.max(run.reservedCostMicros, actual ?? 0, run.actualCostMicros ?? 0) } });
    // An account stop needs an explicit review; finishing free reads cannot
    // silently reopen spending or advance the next scheduled period.
    if (run.errorCode?.startsWith("ACCOUNT_")) return tx.serpMonitorRun.update({ where: { id: runId }, data: { status: "UNKNOWN", actualCostMicros: actual } });
    if (counts.some(group => !TERMINAL_TASKS.includes(group.state))) return tx.serpMonitorRun.update({ where: { id: runId }, data: { actualCostMicros: actual } });
    const complete = counts.every(group => group.state === "COMPLETE"), anyResult = counts.some(group => ["COMPLETE", "INCOMPLETE"].includes(group.state));
    const status = complete ? "COMPLETED" : anyResult ? "PARTIAL" : "FAILED";
    // Replaying a repaired parser may resolve a formerly partial run. Correct
    // its status while preserving the original completion time and cadence.
    if (run.completedAt) return run.status === status && run.actualCostMicros === actual ? run : tx.serpMonitorRun.update({ where: { id: runId }, data: {
      status, actualCostMicros: actual, errorCode: complete ? null : "SOME_TASKS_NOT_VERIFIED" } });
    const completedAt = new Date();
    const finished = await tx.serpMonitorRun.update({ where: { id: runId }, data: { status, actualCostMicros: actual, completedAt,
      errorCode: complete ? null : "SOME_TASKS_NOT_VERIFIED" } });
    if ((run.scope ?? "SCHEDULED") === "SCHEDULED") await tx.serpMonitorConfig.updateMany({ where: { id: SERP_CONFIG_ID }, data: { nextDueAt: periodDue(nextSerpPeriodKey(run.periodKey)) } });
    return finished;
  }, { maxWait: 10_000, timeout: 20_000 });
}
async function expireStaleSubmissions(runId: string) {
  // Persisted POST receipts recover locally in their original batches. This
  // never repeats a paid request, even if the worker stopped mid-association.
  const received = await prisma.serpMonitorTask.findMany({ where: { runId, state: "SUBMITTING", submissionRaw: { not: null } } });
  for (const saved of new Set(received.flatMap(task => task.submissionRaw ? [task.submissionRaw] : []))) {
    const originalBatch = await prisma.serpMonitorTask.findMany({ where: { runId, submissionRaw: saved } });
    await associateSubmissionReceipt(runId, originalBatch, saved);
  }
  const stale = await prisma.serpMonitorTask.findMany({ where: { runId, state: "SUBMITTING", submittedAt: { lt: new Date(Date.now() - 2 * 60_000) } }, select: { id: true } });
  if (stale.length) await markUnknown(runId, stale.map(task => task.id), "SUBMISSION_WORKER_INTERRUPTED");
}
export async function resumeSerpMonitorRun(runId: string, options: { allowSubmit?: boolean; pollLimit?: number; pollDueBefore?: Date; deadline?: number } = {}) {
  if (!hasTime(options.deadline)) return runDto(await prisma.serpMonitorRun.findUniqueOrThrow({ where: { id: runId } }));
  await expireStaleSubmissions(runId);
  const run = await prisma.serpMonitorRun.findUnique({ where: { id: runId } });
  if (!run) throw new ImportRequestError("未找到SERP采集账本", 404);
  await repairCachedSampleResults(run);
  const config = run.configJson as unknown as SerpMonitorConfiguration;
  const cached = await prisma.serpMonitorTask.findMany({ where: { runId, state: "RECEIVED", rawResponse: { not: null } }, take: 40 });
  await replayTasks(cached, config);
  await pollResults(runId, config, options.pollLimit ?? 40, options.pollDueBefore ?? new Date(Date.now() - 30_000), options.deadline);
  // Paid continuation follows free collection so a large submission backlog
  // cannot starve already-paid results. Pausing paid gates does not stop GETs.
  if (options.allowSubmit && (run.scope ?? "SCHEDULED") === "SCHEDULED" && isSerpPaidEnvironmentEnabled()) {
    const current = await prisma.serpMonitorRun.findUniqueOrThrow({ where: { id: runId } });
    if (current.status !== "UNKNOWN") await submitOneBatch(runId, undefined, options.deadline);
  }
  return runDto(await finalizeRun(runId));
}

export async function mutateSerpMonitor(input: SerpMonitorMutation) {
  if (input.action === "preview") return previewSerpMonitor();
  if (input.action === "configure") return configureDisabled(input);
  if (input.action === "replay") {
    const run = await prisma.serpMonitorRun.findUnique({ where: { id: input.runId } });
    if (!run) throw new ImportRequestError("未找到SERP采集账本", 404);
    if (run.scope === "SAMPLE") {
      await repairCachedSampleResults(run);
      return { action: "replay", run: await runDto(await finalizeRun(input.runId)) };
    }
    const tasks = await prisma.serpMonitorTask.findMany({ where: { runId: input.runId, state: { in: ["RECEIVED", "INCOMPLETE", "COMPLETE"] }, rawResponse: { not: null } },
      orderBy: { updatedAt: "asc" }, take: run.scope === "SAMPLE" ? SERP_SAMPLE_MAX_QUERIES : 100 });
    await replayTasks(tasks, run.configJson as unknown as SerpMonitorConfiguration);
    return { action: "replay", run: await runDto(await finalizeRun(input.runId)) };
  }
  if (input.action === "resume") return { action: "resume", run: await resumeSerpMonitorRun(input.runId) };
  const reserved = await reserveRun(input.idempotencyKey, input.expectedCohortHash);
  if (!reserved.duplicate) await submitOneBatch(reserved.run.id);
  return { action: "start", duplicate: reserved.duplicate, run: await runDto(await finalizeRun(reserved.run.id)) };
}

// Authenticated cycle worker only: this advances the already configured slot,
// preserving the same period key so tomorrow's cron cannot bill it again.
export async function startSerpScheduledPeriod(periodKey: string, expectedCohortHash: string, deadline: number) {
  const reserved = await reserveRun(`serp-cycle-${periodKey}`, expectedCohortHash, periodKey);
  if (!reserved.duplicate) await submitOneBatch(reserved.run.id, undefined, deadline);
  return runDto(await finalizeRun(reserved.run.id));
}

export async function runSerpMonitorCron(options: { maxDurationMs?: number; allowStart?: boolean; periodKey?: string } = {}) {
  // Count reservation/DB time too, leaving the enclosing 300s route a safety
  // margin. The global external stop still blocks both paid and free traffic.
  const startedAt = Date.now(), deadline = startedAt + Math.min(240_000, Math.max(0, options.maxDurationMs ?? 240_000));
  if (envBool("DISABLE_EXTERNAL_FETCH")) return { status: "DISABLED", reason: "EXTERNAL_FETCH_DISABLED", paidRequests: 0 };
  if (!hasTime(deadline)) return { status: "TIME_BUDGET_EXHAUSTED", paidRequests: 0, continuationRequired: true };
  const row = await prisma.serpMonitorConfig.findUnique({ where: { id: SERP_CONFIG_ID } });
  const canSpend = isSerpPaidEnvironmentEnabled() && isSerpScheduleAuthorized(row);
  // A paused scheduled ledger may still contain paid tasks whose IDs are safe
  // to retrieve. Never include the separately authorized sample in this cron.
  let run = await prisma.serpMonitorRun.findFirst({ where: { scope: "SCHEDULED", status: { in: OPEN_RUNS } }, orderBy: { createdAt: "asc" } });
  if (!run) {
    if (!canSpend) return { status: "DISABLED", reason: "PAID_SERP_DISABLED", paidRequests: 0 };
    if (options.allowStart === false) return { status: "WAITING_FOR_DISCOVERY", paidRequests: 0 };
    if (!row?.nextDueAt) return { status: "NOT_SCHEDULED", paidRequests: 0 };
    if (row.nextDueAt.getTime() > Date.now() && !options.periodKey) return { status: "NOT_DUE", nextDueAt: row.nextDueAt.toISOString(), paidRequests: 0 };
    const requestedPeriod = options.periodKey ? serpPeriodFromKey(options.periodKey) : serpPeriod(new Date());
    const existingPeriod = await prisma.serpMonitorRun.findUnique({ where: { periodKey_scope: { periodKey: requestedPeriod.key, scope: "SCHEDULED" } } });
    if (existingPeriod) return { status: "PERIOD_ALREADY_CAPTURED", runId: existingPeriod.id, paidRequests: 0 };
    if (!hasTime(deadline, 90_000)) return { status: "TIME_BUDGET_EXHAUSTED", paidRequests: 0, continuationRequired: true };
    const cohort = await loadSerpTargetCohort();
    run = (await reserveRun(`serp-${randomUUID()}`, cohort.hash, options.periodKey)).run;
  }
  let paidRequests = 0, freeResultsChecked = 0;
  // Fix the due cutoff for this invocation. A not-ready response is tried once
  // here and cannot monopolize later unpolled tasks or cause a hot retry loop.
  const pollDueBefore = new Date(startedAt - 10 * 60_000);
  while (hasTime(deadline, 35_000)) {
    await expireStaleSubmissions(run.id);
    const current = await prisma.serpMonitorRun.findUniqueOrThrow({ where: { id: run.id } });
    const config = current.configJson as unknown as SerpMonitorConfiguration;
    const cached = await prisma.serpMonitorTask.findMany({ where: { runId: run.id, state: "RECEIVED", rawResponse: { not: null } }, take: 40 });
    await replayTasks(cached, config);
    const checked = await pollResults(run.id, config, 40, pollDueBefore, deadline);
    freeResultsChecked += checked;
    const latest = await prisma.serpMonitorRun.findUniqueOrThrow({ where: { id: run.id } });
    let submitted = 0;
    const liveConfig = await prisma.serpMonitorConfig.findUnique({ where: { id: SERP_CONFIG_ID } });
    if (latest.status !== "UNKNOWN" && isSerpPaidEnvironmentEnabled() && isSerpScheduleAuthorized(liveConfig) && hasTime(deadline, 75_000)) {
      submitted = await submitOneBatch(run.id, undefined, deadline);
      if (submitted) paidRequests++;
    }
    if (!checked && !submitted && !cached.length) break;
  }
  const finished = await finalizeRun(run.id), dto = await runDto(finished);
  const remaining = (dto.taskCounts.PLANNED ?? 0) + (dto.taskCounts.SUBMITTING ?? 0) + (dto.taskCounts.QUEUED ?? 0) + (dto.taskCounts.RECEIVED ?? 0) + (dto.taskCounts.UNKNOWN ?? 0);
  const stillEnabled = isSerpPaidEnvironmentEnabled() && isSerpScheduleAuthorized(await prisma.serpMonitorConfig.findUnique({ where: { id: SERP_CONFIG_ID } }));
  return { status: finished.status === "UNKNOWN" ? "NEEDS_REVIEW" : remaining ? stillEnabled ? "ACTIVE" : "PAUSED" : "FINISHED",
    runId: run.id, paidRequests, freeResultsChecked, remainingQueries: remaining, continuationRequired: remaining > 0, run: dto };
}
