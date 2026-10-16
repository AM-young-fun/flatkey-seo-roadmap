import { createHash, randomUUID } from "node:crypto";
import { Prisma, type SerpMonitorConfig, type SerpMonitorRun, type SerpMonitorTask } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { decryptDataForSeoCredentials } from "@/lib/dataforseo-credentials";
import { envBool } from "@/lib/env";
import { ImportRequestError } from "@/lib/ranking-import";
import { loadSerpTargetCohort } from "@/lib/services/serp-targets";
import { nextSerpPeriodKey, periodDue, serpPeriod } from "@/lib/serp-periods";
import { buildSerpTask, groupSerpQueries, normalizeSerpAdvanced, providerCostMicros, providerIdIsSafe, providerTaskEnvelope,
  quoteSerpTargets, SERP_CONFIG_ID, SERP_DEFAULT_CONFIG, SERP_PRICE_PER_QUERY_MICROS, SERP_TASK_GET_URL, SERP_TASK_POST_URL,
  serpTaskId, type SerpMonitorMutation } from "@/lib/dataforseo-serp";
import type { SerpMonitorConfiguration, SerpMonitorPreview, SerpMonitorRunDto, SerpMonitorStatus, SerpRunState, SerpTaskState } from "@/lib/serp-monitor-types";

const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const OPEN_RUNS = ["PLANNED", "RUNNING", "UNKNOWN"];
const TERMINAL_TASKS = ["COMPLETE", "INCOMPLETE", "FAILED"];
const connectionFingerprint = (ciphertext: string) => createHash("sha256").update(ciphertext).digest("hex");
export const isSerpPaidEnvironmentEnabled = () => process.env.DATAFORSEO_SERP_PAID_ENABLED === "true" && !envBool("DISABLE_EXTERNAL_FETCH");
function configuration(row: SerpMonitorConfig | null): SerpMonitorConfiguration {
  if (!row) return { ...SERP_DEFAULT_CONFIG };
  return { region: row.region as "US", languageCode: row.languageCode as "en", locationCode: row.locationCode as 2840,
    device: row.device as "desktop", depth: row.depth as 100, intervalDays: row.intervalDays as 14, paidEnabled: row.paidEnabled,
    schedule: row.schedule as "SEMI_MONTHLY", scheduleDays: [1, 16], timezone: "Asia/Shanghai", localTime: "10:30",
    maxRunCostMicros: row.maxRunCostMicros, maxMonthCostMicros: row.maxMonthCostMicros, revision: row.revision,
    nextDueAt: row.nextDueAt?.toISOString() ?? null };
}
const monthStart = (now = new Date()) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
async function monthReserved(tx: Prisma.TransactionClient = prisma) {
  return (await tx.serpMonitorRun.aggregate({ where: { OR: [{ createdAt: { gte: monthStart() } }, { completedAt: { gte: monthStart() } }, { status: { in: OPEN_RUNS } }] }, _sum: { reservedCostMicros: true } }))._sum.reservedCostMicros ?? 0;
}
async function runDto(run: SerpMonitorRun): Promise<SerpMonitorRunDto> {
  const groups = await prisma.serpMonitorTask.groupBy({ by: ["state"], where: { runId: run.id }, _count: true });
  return { id: run.id, status: run.status as SerpRunState, targetCount: run.targetCount, queryCount: run.queryCount,
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
  const config = configuration(row), quote = quoteSerpTargets(cohort.targets), environmentEnabled = isSerpPaidEnvironmentEnabled();
  const bySite: Record<string, number> = {};
  for (const target of cohort.targets) bySite[target.siteDomain] = (bySite[target.siteDomain] ?? 0) + 1;
  return { config, cronConfigured: Boolean(process.env.CRON_SECRET), gate: { environmentEnabled, persistedEnabled: config.paidEnabled, canSpend: environmentEnabled && config.paidEnabled },
    connection: { configured: Boolean(connection), loginMasked: connection?.loginMasked ?? null },
    cohort: { hash: cohort.hash, targetCount: quote.targetCount, queryCount: quote.queryCount, bySite }, quote,
    budget: { monthReservedCostMicros: reserved, monthLimitMicros: config.maxMonthCostMicros }, runs: await Promise.all(runs.map(runDto)) };
}
export async function previewSerpMonitor(): Promise<SerpMonitorPreview> {
  const [row, cohort] = await Promise.all([prisma.serpMonitorConfig.findUnique({ where: { id: SERP_CONFIG_ID } }), loadSerpTargetCohort()]);
  return { action: "preview", cohortHash: cohort.hash, quote: quoteSerpTargets(cohort.targets), configuration: configuration(row), paidEnabled: false,
    message: "仅预览目标、去重查询及费用；未提交供应商任务。每月1日和16日10:30上海时间采集，每月两期，付费抓取保持关闭。" };
}
async function configureDisabled(input: Extract<SerpMonitorMutation, { action: "configure" }>) {
  await prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"serp-monitor:budget"}))`;
    const current = await tx.serpMonitorConfig.findUnique({ where: { id: SERP_CONFIG_ID } });
    if (input.expectedRevision !== undefined && input.expectedRevision !== (current?.revision ?? 0)) throw new ImportRequestError("配置已变化，请刷新后重试", 409);
    // This product release intentionally has no enable mutation. The explicit
    // false is enforced by both Zod and this write path, including reconnects.
    const values = { paidEnabled: false, region: "US", languageCode: "en", locationCode: 2840, device: "desktop", depth: 100, schedule: "SEMI_MONTHLY", intervalDays: 14,
      maxRunCostMicros: input.maxRunCostMicros ?? current?.maxRunCostMicros ?? SERP_DEFAULT_CONFIG.maxRunCostMicros,
      maxMonthCostMicros: input.maxMonthCostMicros ?? current?.maxMonthCostMicros ?? SERP_DEFAULT_CONFIG.maxMonthCostMicros };
    await tx.serpMonitorConfig.upsert({ where: { id: SERP_CONFIG_ID }, create: { id: SERP_CONFIG_ID, ...values }, update: { ...values, revision: { increment: 1 } } });
  });
  return loadSerpMonitorStatus();
}
function requirePaidEnvironment() {
  if (!isSerpPaidEnvironmentEnabled()) throw new ImportRequestError("付费SERP抓取尚未启用，本次未请求供应商", 409);
}
async function reserveRun(id: string, expectedCohortHash: string) {
  requirePaidEnvironment();
  const cohort = await loadSerpTargetCohort(), groups = groupSerpQueries(cohort.targets), quote = quoteSerpTargets(cohort.targets), period = serpPeriod(new Date());
  if (expectedCohortHash !== cohort.hash) throw new ImportRequestError("正式目标已变化，请重新预览目标和费用", 409);
  if (groups.length === 0) throw new ImportRequestError("没有可监控的正式目标", 409);
  return prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"serp-monitor:budget"}))`;
    const existing = await tx.serpMonitorRun.findUnique({ where: { id } });
    if (existing) {
      if (existing.cohortHash !== expectedCohortHash) throw new ImportRequestError("采集标识已用于其他目标快照", 409);
      return { run: existing, duplicate: true };
    }
    if (await tx.serpMonitorRun.findUnique({ where: { periodKey: period.key } })) throw new ImportRequestError("本期已有SERP采集账本，请查看或续跑原记录，不能重复扣费", 409);
    const row = await tx.serpMonitorConfig.findUnique({ where: { id: SERP_CONFIG_ID } }), config = configuration(row);
    if (!row?.paidEnabled) throw new ImportRequestError("付费SERP抓取保持关闭，本次未请求供应商", 409);
    if (row.nextDueAt && row.nextDueAt.getTime() > Date.now()) throw new ImportRequestError("尚未到下次每月1日或16日的采集时间", 409);
    if (await tx.serpMonitorRun.findFirst({ where: { status: { in: OPEN_RUNS } }, select: { id: true } })) throw new ImportRequestError("已有未完成或结果不明的SERP采集，请续跑原账本，不能重复扣费", 409);
    if (quote.maxCostMicros > config.maxRunCostMicros || await monthReserved(tx) + quote.maxCostMicros > config.maxMonthCostMicros) throw new ImportRequestError("SERP采集超过单轮或月度预算上限，本次未请求供应商", 409);
    const connection = await tx.dataForSeoConnection.findUnique({ where: { siteDomain: "flatkey.ai" } });
    if (!connection) throw new ImportRequestError("请先保存DataForSEO连接", 409);
    decryptDataForSeoCredentials(connection.encryptedCredentials);
    // Validate every query before reserving or sending the first paid batch.
    const tasks = groups.map(group => { const taskId = serpTaskId(id, group.queryKey); return { id: taskId, runId: id, queryKey: group.queryKey,
      keyword: group.keyword, targetsJson: json(group.targets), state: "PLANNED", requestJson: json(buildSerpTask(group, taskId, config)) }; });
    const run = await tx.serpMonitorRun.create({ data: { id, periodKey: period.key, periodLabel: period.label,
      periodStart: new Date(`${period.start}T00:00:00+08:00`), periodEnd: new Date(`${period.end}T23:59:59.999+08:00`),
      status: "PLANNED", cohortHash: cohort.hash, cohortJson: json(cohort.targets), configJson: json({ ...config, connectionHash: connectionFingerprint(connection.encryptedCredentials) }),
      queryCount: groups.length, targetCount: cohort.targets.length, estimatedCostMicros: quote.maxCostMicros, reservedCostMicros: quote.maxCostMicros, connectionVersion: connection.connectionVersion } });
    await tx.serpMonitorTask.createMany({ data: tasks });
    return { run, duplicate: false };
  }, { maxWait: 10_000, timeout: 30_000 });
}
async function credentials() {
  const connection = await prisma.dataForSeoConnection.findUnique({ where: { siteDomain: "flatkey.ai" } });
  if (!connection) throw new ImportRequestError("DataForSEO连接不存在", 409);
  return { ...decryptDataForSeoCredentials(connection.encryptedCredentials), connectionVersion: connection.connectionVersion, connectionHash: connectionFingerprint(connection.encryptedCredentials) };
}
const basicHeader = (value: { apiLogin: string; apiPassword: string }) => `Basic ${Buffer.from(`${value.apiLogin}:${value.apiPassword}`).toString("base64")}`;
const rawRecord = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};

async function submitOneBatch(runId: string): Promise<number> {
  requirePaidEnvironment();
  const connection = await credentials();
  const batch = await prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"serp-monitor:budget"}))`;
    const config = await tx.serpMonitorConfig.findUnique({ where: { id: SERP_CONFIG_ID } });
    if (!config?.paidEnabled) throw new ImportRequestError("付费SERP抓取已关闭", 409);
    const run = await tx.serpMonitorRun.findUniqueOrThrow({ where: { id: runId } });
    if (run.status === "UNKNOWN") throw new ImportRequestError("供应商接收结果不明，禁止重复提交", 409);
    if (run.connectionVersion !== connection.connectionVersion || rawRecord(run.configJson).connectionHash !== connection.connectionHash) throw new ImportRequestError("采集期间连接已变化，请先核对原账本", 409);
    const active = await tx.serpMonitorTask.findFirst({ where: { runId, state: { in: ["SUBMITTING", "UNKNOWN"] } } });
    if (active) return [];
    const selected = await tx.serpMonitorTask.findMany({ where: { runId, state: "PLANNED" }, orderBy: { queryKey: "asc" }, take: 100 });
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
    const response = await fetch(SERP_TASK_POST_URL, { method: "POST", redirect: "error", signal: AbortSignal.timeout(12_000),
      headers: { "Content-Type": "application/json", Authorization: basicHeader(connection) }, body: JSON.stringify(batch.map(task => task.requestJson)) });
    raw = await response.text();
    // Even HTTP errors may follow accepted tasks. Preserve the response and
    // decide each task using its echoed tag, never assume a free retry.
  } catch {
    await markUnknown(runId, batch.map(task => task.id), "SUBMISSION_OUTCOME_UNKNOWN");
    return batch.length;
  }
  await prisma.serpMonitorTask.updateMany({ where: { id: { in: batch.map(task => task.id) }, state: "SUBMITTING" }, data: { submissionRaw: raw } });
  let parsed: Record<string, unknown>;
  try { parsed = rawRecord(JSON.parse(raw)); } catch { await markUnknown(runId, batch.map(task => task.id), "INVALID_SUBMISSION_RECEIPT"); return batch.length; }
  const providerTasks = Array.isArray(parsed.tasks) ? parsed.tasks.map(rawRecord) : [];
  const seenProviderIds = new Set<string>();
  for (const task of batch) {
    const matches = providerTasks.filter(item => rawRecord(item.data).tag === task.id);
    const received = matches[0], providerId = received?.id;
    if (parsed.status_code !== 20000 || matches.length !== 1 || (providerIdIsSafe(providerId) && seenProviderIds.has(providerId))) {
      await markUnknown(runId, [task.id], "UNMATCHED_SUBMISSION_RECEIPT"); continue;
    }
    if (providerIdIsSafe(providerId) && [20000, 20100, 20101, 20102].includes(Number(received.status_code))) {
      seenProviderIds.add(providerId);
      await prisma.serpMonitorTask.updateMany({ where: { id: task.id, state: "SUBMITTING" }, data: { state: "QUEUED", providerTaskId: providerId,
        costMicros: providerCostMicros(received.cost), errorCode: null } });
    } else if (Number(received.status_code) >= 40000 && Number(received.status_code) < 50000) {
      await prisma.serpMonitorTask.updateMany({ where: { id: task.id, state: "SUBMITTING" }, data: { state: "FAILED", costMicros: providerCostMicros(received.cost), errorCode: `PROVIDER_${received.status_code}` } });
    } else { await markUnknown(runId, [task.id], "UNCONFIRMED_PROVIDER_TASK"); }
  }
  await enforceCostBounds(runId, batch.map(task => task.id), providerCostMicros(parsed.cost));
  return batch.length;
}
async function enforceCostBounds(runId: string, batchIds?: string[], batchReportedCost: number | null = null) {
  await prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"serp-monitor:budget"}))`;
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
  }, { maxWait: 10_000, timeout: 20_000 });
}
async function markUnknown(runId: string, ids: string[], errorCode: string) {
  await prisma.$transaction(async tx => {
    await tx.serpMonitorTask.updateMany({ where: { id: { in: ids }, state: "SUBMITTING" }, data: { state: "UNKNOWN", errorCode } });
    await tx.serpMonitorRun.update({ where: { id: runId }, data: { status: "UNKNOWN", errorCode } });
  });
}
async function replayTask(task: SerpMonitorTask, config: SerpMonitorConfiguration) {
  if (!task.rawResponse || !task.providerTaskId) return;
  try {
    const normalized = normalizeSerpAdvanced(JSON.parse(task.rawResponse), { providerTaskId: task.providerTaskId, keyword: task.keyword, config });
    await prisma.serpMonitorTask.updateMany({ where: { id: task.id, state: { in: ["RECEIVED", "INCOMPLETE"] } }, data: { normalizedJson: json(normalized), checkedAt: new Date(normalized.checkedAt),
      state: normalized.completeDepth ? "COMPLETE" : "INCOMPLETE", errorCode: normalized.completeDepth ? null : "ORGANIC_DEPTH_NOT_VERIFIED" } });
  } catch {
    await prisma.serpMonitorTask.updateMany({ where: { id: task.id, state: "RECEIVED" }, data: { state: "INCOMPLETE", errorCode: "RESULT_VALIDATION_FAILED" } });
  }
}
async function pollTask(task: SerpMonitorTask, config: SerpMonitorConfiguration, authorization: string) {
  if (!providerIdIsSafe(task.providerTaskId)) return;
  let raw: string;
  try {
    const response = await fetch(`${SERP_TASK_GET_URL}/${task.providerTaskId}`, { method: "GET", redirect: "error", signal: AbortSignal.timeout(8_000), headers: { Authorization: authorization } });
    if (!response.ok) { await prisma.serpMonitorTask.updateMany({ where: { id: task.id, state: "QUEUED" }, data: { lastPolledAt: new Date(), errorCode: `POLL_HTTP_${response.status}` } }); return; }
    raw = await response.text();
  } catch { await prisma.serpMonitorTask.updateMany({ where: { id: task.id, state: "QUEUED" }, data: { lastPolledAt: new Date(), errorCode: "POLL_RETRY_FREE" } }); return; }
  let received: Record<string, unknown>;
  try { received = providerTaskEnvelope(JSON.parse(raw), task.providerTaskId); }
  catch { await prisma.serpMonitorTask.updateMany({ where: { id: task.id, state: "QUEUED" }, data: { lastPolledAt: new Date(), errorCode: "POLL_INVALID_RECEIPT" } }); return; }
  if ([20100, 20101, 20102, 40602].includes(Number(received.status_code))) {
    await prisma.serpMonitorTask.updateMany({ where: { id: task.id, state: "QUEUED" }, data: { lastPolledAt: new Date(), errorCode: "PROVIDER_NOT_READY" } }); return;
  }
  if (received.status_code !== 20000) {
    await prisma.serpMonitorTask.updateMany({ where: { id: task.id, state: "QUEUED" }, data: { lastPolledAt: new Date(), state: "FAILED", rawResponse: raw, errorCode: `PROVIDER_${received.status_code}` } }); return;
  }
  // Cache the complete free GET before parsing. A parser/database interruption
  // can replay this receipt locally without submitting another paid task.
  const persisted = await prisma.serpMonitorTask.updateMany({ where: { id: task.id, state: "QUEUED" }, data: { state: "RECEIVED", rawResponse: raw,
    lastPolledAt: new Date(), costMicros: Math.max(task.costMicros ?? 0, providerCostMicros(received.cost) ?? 0), errorCode: null } });
  if (persisted.count) {
    await replayTask({ ...task, rawResponse: raw }, config);
    if ((providerCostMicros(received.cost) ?? 0) > SERP_PRICE_PER_QUERY_MICROS) await enforceCostBounds(task.runId);
  }
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
    const actual = reported == null && run.actualCostMicros == null ? null : Math.max(reported ?? 0, run.actualCostMicros ?? 0);
    if (run.errorCode?.startsWith("COST_")) return tx.serpMonitorRun.update({ where: { id: runId }, data: { status: "UNKNOWN",
      actualCostMicros: actual, reservedCostMicros: Math.max(run.reservedCostMicros, actual ?? 0) } });
    if (counts.some(group => !TERMINAL_TASKS.includes(group.state))) return tx.serpMonitorRun.update({ where: { id: runId }, data: { actualCostMicros: actual } });
    const complete = counts.every(group => group.state === "COMPLETE"), anyResult = counts.some(group => ["COMPLETE", "INCOMPLETE"].includes(group.state));
    const status = complete ? "COMPLETED" : anyResult ? "PARTIAL" : "FAILED";
    // Replaying a repaired parser may resolve a formerly partial run. Correct
    // its status while preserving the original completion time and cadence.
    if (run.completedAt) return run.status === status ? run : tx.serpMonitorRun.update({ where: { id: runId }, data: {
      status, actualCostMicros: actual, errorCode: complete ? null : "SOME_TASKS_NOT_VERIFIED" } });
    const completedAt = new Date();
    const finished = await tx.serpMonitorRun.update({ where: { id: runId }, data: { status, actualCostMicros: actual, completedAt,
      errorCode: complete ? null : "SOME_TASKS_NOT_VERIFIED" } });
    await tx.serpMonitorConfig.updateMany({ where: { id: SERP_CONFIG_ID }, data: { nextDueAt: periodDue(nextSerpPeriodKey(run.periodKey)) } });
    return finished;
  }, { maxWait: 10_000, timeout: 20_000 });
}
async function expireStaleSubmissions(runId: string) {
  // A worker can stop after saving the POST receipt but before associating its
  // task IDs. Recover those associations locally; never submit the batch again.
  const received = await prisma.serpMonitorTask.findMany({ where: { runId, state: "SUBMITTING", submissionRaw: { not: null } } });
  for (const task of received) {
    try {
      const raw = rawRecord(JSON.parse(task.submissionRaw!));
      const matches = (Array.isArray(raw.tasks) ? raw.tasks.map(rawRecord) : []).filter(item => rawRecord(item.data).tag === task.id);
      const receipt = matches[0];
      if (raw.status_code !== 20000 || matches.length !== 1) continue;
      if (providerIdIsSafe(receipt.id) && [20000, 20100, 20101, 20102].includes(Number(receipt.status_code))) {
        await prisma.serpMonitorTask.updateMany({ where: { id: task.id, state: "SUBMITTING" }, data: { state: "QUEUED", providerTaskId: receipt.id,
          costMicros: providerCostMicros(receipt.cost), errorCode: null } });
      } else if (Number(receipt.status_code) >= 40000 && Number(receipt.status_code) < 50000) {
        await prisma.serpMonitorTask.updateMany({ where: { id: task.id, state: "SUBMITTING" }, data: { state: "FAILED", costMicros: providerCostMicros(receipt.cost), errorCode: `PROVIDER_${receipt.status_code}` } });
      }
    } catch { /* Keep unresolved reservations blocked for the stale check. */ }
  }
  // A process stop before parsing must not skip the receipt's fee guard when
  // recovering IDs. The full batch receipt includes all original task tags.
  for (const saved of new Set(received.flatMap(task => task.submissionRaw ? [task.submissionRaw] : []))) {
    try {
      const raw = rawRecord(JSON.parse(saved)), ids = (Array.isArray(raw.tasks) ? raw.tasks.map(rawRecord) : [])
        .map(task => rawRecord(task.data).tag).filter((value): value is string => typeof value === "string");
      if (ids.length) await enforceCostBounds(runId, ids, providerCostMicros(raw.cost));
    } catch { /* Unparseable receipts remain unresolved, never resubmitted. */ }
  }
  const stale = await prisma.serpMonitorTask.findMany({ where: { runId, state: "SUBMITTING", submittedAt: { lt: new Date(Date.now() - 2 * 60_000) } }, select: { id: true } });
  if (stale.length) await markUnknown(runId, stale.map(task => task.id), "SUBMISSION_WORKER_INTERRUPTED");
}
export async function resumeSerpMonitorRun(runId: string, options: { allowSubmit?: boolean; pollLimit?: number; pollDueBefore?: Date } = {}) {
  await expireStaleSubmissions(runId);
  const run = await prisma.serpMonitorRun.findUnique({ where: { id: runId } });
  if (!run) throw new ImportRequestError("未找到SERP采集账本", 404);
  if (options.allowSubmit && isSerpPaidEnvironmentEnabled() && run.status !== "UNKNOWN") await submitOneBatch(runId);
  const config = run.configJson as unknown as SerpMonitorConfiguration;
  const cached = await prisma.serpMonitorTask.findMany({ where: { runId, state: "RECEIVED", rawResponse: { not: null } }, take: 40 });
  for (const task of cached) await replayTask(task, config);
  const tasks = await prisma.serpMonitorTask.findMany({ where: { runId, state: "QUEUED", providerTaskId: { not: null },
    ...(options.pollDueBefore ? { OR: [{ lastPolledAt: null }, { lastPolledAt: { lt: options.pollDueBefore } }] } : {}) },
    orderBy: [{ lastPolledAt: { sort: "asc", nulls: "first" } }, { queryKey: "asc" }], take: Math.min(40, options.pollLimit ?? 40) });
  if (tasks.length && !envBool("DISABLE_EXTERNAL_FETCH")) {
    const authorization = basicHeader(await credentials());
    for (let index = 0; index < tasks.length; index += 8) await Promise.all(tasks.slice(index, index + 8).map(task => pollTask(task, config, authorization)));
  }
  return runDto(await finalizeRun(runId));
}
export async function mutateSerpMonitor(input: SerpMonitorMutation) {
  if (input.action === "preview") return previewSerpMonitor();
  if (input.action === "configure") return configureDisabled(input);
  if (input.action === "replay") {
    const run = await prisma.serpMonitorRun.findUnique({ where: { id: input.runId } });
    if (!run) throw new ImportRequestError("未找到SERP采集账本", 404);
    const tasks = await prisma.serpMonitorTask.findMany({ where: { runId: input.runId, state: { in: ["RECEIVED", "INCOMPLETE"] }, rawResponse: { not: null } }, take: 100 });
    for (const task of tasks) await replayTask(task, run.configJson as unknown as SerpMonitorConfiguration);
    return { action: "replay", run: await runDto(await finalizeRun(input.runId)) };
  }
  if (input.action === "resume") return { action: "resume", run: await resumeSerpMonitorRun(input.runId) };
  const reserved = await reserveRun(input.idempotencyKey, input.expectedCohortHash);
  if (!reserved.duplicate) await submitOneBatch(reserved.run.id);
  return { action: "start", duplicate: reserved.duplicate, run: await runDto(await finalizeRun(reserved.run.id)) };
}

export async function runSerpMonitorCron(options: { maxDurationMs?: number } = {}) {
  // Check the environment before even looking up a connection. Deploying this
  // release cannot start a paid run or issue balance/provider probes.
  if (!isSerpPaidEnvironmentEnabled()) return { status: "DISABLED", reason: "PAID_SERP_DISABLED", paidRequests: 0 };
  const row = await prisma.serpMonitorConfig.findUnique({ where: { id: SERP_CONFIG_ID } });
  if (!row?.paidEnabled) return { status: "DISABLED", reason: "PAID_SERP_DISABLED", paidRequests: 0 };
  let run = await prisma.serpMonitorRun.findFirst({ where: { status: { in: OPEN_RUNS } }, orderBy: { createdAt: "asc" } });
  if (!run) {
    // A first run date needs its own authorized activation. A paused setup has
    // no invented first-charge date, even if an environment flag is changed.
    if (!row.nextDueAt) return { status: "NOT_SCHEDULED", paidRequests: 0 };
    if (row.nextDueAt.getTime() > Date.now()) return { status: "NOT_DUE", nextDueAt: row.nextDueAt.toISOString(), paidRequests: 0 };
    const existingPeriod = await prisma.serpMonitorRun.findUnique({ where: { periodKey: serpPeriod(new Date()).key } });
    if (existingPeriod) return { status: "PERIOD_ALREADY_CAPTURED", runId: existingPeriod.id, paidRequests: 0 };
    const cohort = await loadSerpTargetCohort();
    run = (await reserveRun(`serp-${randomUUID()}`, cohort.hash)).run;
  }
  if (run.status === "UNKNOWN") return { status: "NEEDS_REVIEW", runId: run.id, paidRequests: 0 };
  const deadline = Date.now() + Math.min(240_000, Math.max(0, options.maxDurationMs ?? 240_000));
  let paidRequests = 0;
  // Daily coordinator may safely submit the whole cohort in sequential <=100
  // task batches. Each has a separate durable reservation and uncertain POSTs
  // stop immediately. The next daily wake collects queued results for free.
  while (Date.now() + 20_000 < deadline) {
    await expireStaleSubmissions(run.id);
    if ((await prisma.serpMonitorRun.findUnique({ where: { id: run.id }, select: { status: true } }))?.status === "UNKNOWN") break;
    if (!await prisma.serpMonitorTask.findFirst({ where: { runId: run.id, state: "PLANNED" }, select: { id: true } })) break;
    const submitted = await submitOneBatch(run.id);
    if (!submitted) break;
    paidRequests++;
  }
  while (Date.now() + 45_000 < deadline) {
    const waiting = await prisma.serpMonitorTask.findMany({ where: { runId: run.id, state: { in: ["QUEUED", "RECEIVED"] },
      OR: [{ lastPolledAt: null }, { lastPolledAt: { lt: new Date(Date.now() - 10 * 60_000) } }] }, select: { id: true }, take: 1 });
    if (!waiting.length) break;
    await resumeSerpMonitorRun(run.id, { pollLimit: 40, pollDueBefore: new Date(Date.now() - 10 * 60_000) });
  }
  return { status: "ACTIVE", runId: run.id, paidRequests, run: await runDto(await finalizeRun(run.id)) };
}
