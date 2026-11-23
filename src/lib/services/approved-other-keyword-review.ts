import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { envBool } from "@/lib/env";
import { ImportRequestError } from "@/lib/ranking-import";
import { decryptDataForSeoCredentials } from "@/lib/dataforseo-credentials";
import { SERP_CONFIG_ID, SERP_DEFAULT_CONFIG, serpTaskId } from "@/lib/dataforseo-serp";
import { APPROVED_KEYWORD_REVIEW_RUN_ID, APPROVAL_QUOTE_SHA256, assertApprovedKeywordReviewRun } from "@/lib/approved-keyword-review";
import { APPROVED_OTHER_KEYWORD_REVIEW_SCOPE, RUN_ID, PERIOD_KEY, MAX_COST_MICROS, QUOTE_SHA256,
  getApprovedOtherKeywordReviewPlan, assertApprovedOtherKeywordReviewRun, approvedOtherTask } from "@/lib/approved-other-keyword-review";
import { resumeApprovedOtherKeywordReviewRun } from "@/lib/services/serp-monitor";

export const APPROVED_OTHER_REVIEW_QUOTE_ID = "other-country-query-proposal-v2";
export const APPROVED_OTHER_REVIEW_QUOTE_SHA256 = QUOTE_SHA256;
export const APPROVED_OTHER_REVIEW_MAX_COST_MICROS = MAX_COST_MICROS;
const FIRST_CAP = 6_186_000, COMBINED_CAP = 8_994_000, COMBINED_RESERVED = 8_988_000;
const COUNTRIES = ["US", "JP", "ES", "BR", "CN"] as const;
const LANGUAGES = { US: "en", JP: "ja", ES: "es-ES", BR: "pt-BR", CN: "zh-CN" };
const OPEN_TASKS = ["PLANNED", "SUBMITTING", "QUEUED", "RECEIVED", "UNKNOWN"];
const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const fingerprint = (value: string) => createHash("sha256").update(value).digest("hex");
type FirstBatchGate = { firstRunComplete: boolean; reason: string | null; budget?: {
  originalScheduleMonthLimitMicros: number; effectiveMonthLimitMicros: number; monthReservedBeforeMicros: number;
} };

async function firstBatchGate(tx: Prisma.TransactionClient = prisma): Promise<FirstBatchGate> {
  const first = await tx.serpMonitorRun.findUnique({ where: { id: APPROVED_KEYWORD_REVIEW_RUN_ID } });
  if (!first || !["COMPLETED", "PARTIAL"].includes(first.status) || !first.completedAt) {
    return { firstRunComplete: false, reason: "先完成原1031词批次并核对原回执，再开始补采。" };
  }
  try { assertApprovedKeywordReviewRun(first); }
  catch { return { firstRunComplete: false, reason: "原1031词批次的批准身份或冻结预算不一致，需先核对。" }; }
  const approval = record(record(first.configJson).approvedKeywordReview);
  if (approval.quoteId !== "keyword-fee-review-20261123-v1" || approval.quoteSha256 !== APPROVAL_QUOTE_SHA256 ||
    approval.userApproved !== true || first.estimatedCostMicros !== FIRST_CAP || first.reservedCostMicros !== FIRST_CAP ||
    approval.combinedBudgetApprovedMicros !== COMBINED_CAP ||
    first.estimatedCostMicros + MAX_COST_MICROS !== COMBINED_RESERVED || first.reservedCostMicros + MAX_COST_MICROS > COMBINED_CAP) {
    return { firstRunComplete: false, reason: "两批清单的批准身份或合计费用上限不一致，需先核对。" };
  }
  const originalMonth = approval.originalScheduleMonthLimitMicros, effectiveMonth = approval.effectiveMonthLimitMicros, before = approval.monthReservedBeforeMicros;
  const schedule = await tx.serpMonitorConfig.findUnique({ where: { id: SERP_CONFIG_ID }, select: { maxMonthCostMicros: true } });
  if (!Number.isSafeInteger(originalMonth) || Number(originalMonth) < 0 || !Number.isSafeInteger(effectiveMonth) ||
    !Number.isSafeInteger(before) || Number(before) < 0 || Number(effectiveMonth) !== Number(originalMonth) + COMBINED_CAP ||
    !schedule || schedule.maxMonthCostMicros !== originalMonth || Number(before) + FIRST_CAP > Number(effectiveMonth)) {
    return { firstRunComplete: false, reason: "原月度预算或本次独立批准额度已变化，需先核对；未新增付费。" };
  }
  const [total, open] = await Promise.all([
    tx.serpMonitorTask.count({ where: { runId: first.id } }),
    tx.serpMonitorTask.count({ where: { runId: first.id, state: { in: OPEN_TASKS } } }),
  ]);
  return total === 1031 && open === 0 ? { firstRunComplete: true, reason: null, budget: {
    originalScheduleMonthLimitMicros: Number(originalMonth), effectiveMonthLimitMicros: Number(effectiveMonth), monthReservedBeforeMicros: Number(before),
  } }
    : { firstRunComplete: false, reason: "原1031词批次仍有未完成或结果不明的查询，补采尚未开放。" };
}

export async function prepareApprovedOtherKeywordReview() {
  if (envBool("DISABLE_EXTERNAL_FETCH")) throw new ImportRequestError("外部采集已紧急停止，未提交查询", 409);
  const plan = getApprovedOtherKeywordReviewPlan();
  return prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"serp-monitor:budget"}))`;
    const existing = await tx.serpMonitorRun.findUnique({ where: { id: RUN_ID } });
    if (existing) {
      const approval = record(record(existing.configJson).approvedOtherKeywordReview);
      if (existing.scope !== APPROVED_OTHER_KEYWORD_REVIEW_SCOPE || existing.periodKey !== PERIOD_KEY ||
        existing.cohortHash !== plan.queryHash || existing.queryCount !== 467 || existing.reservedCostMicros !== MAX_COST_MICROS ||
        approval.quoteSha256 !== QUOTE_SHA256 || approval.queryHash !== plan.queryHash || approval.userApproved !== true) {
        throw new ImportRequestError("补采账本身份已变化，请核对原记录；不会新建替代批次", 409);
      }
      return existing;
    }
    const gate = await firstBatchGate(tx);
    if (!gate.firstRunComplete || !gate.budget) throw new ImportRequestError(gate.reason!, 409);
    if (await tx.serpMonitorRun.findFirst({ where: { status: { in: ["PLANNED", "RUNNING", "UNKNOWN"] } }, select: { id: true } })) {
      throw new ImportRequestError("已有未完成或结果不明的采集账本，请先核对原记录；未新增付费", 409);
    }
    const [config, connection] = await Promise.all([
      tx.serpMonitorConfig.findUnique({ where: { id: SERP_CONFIG_ID } }),
      tx.dataForSeoConnection.findUnique({ where: { siteDomain: "flatkey.ai" } }),
    ]);
    if (!config || !connection) throw new ImportRequestError("采集连接或预算配置尚未就绪", 409);
    if (config.paidEnabled) throw new ImportRequestError("常设付费计划须保持原暂停状态，本次不更改配置", 409);
    decryptDataForSeoCredentials(connection.encryptedCredentials);
    const monthStart = new Date(new Date().toISOString().slice(0, 7) + "-01T00:00:00Z");
    const reserved = (await tx.serpMonitorRun.aggregate({ where: { OR: [{ createdAt: { gte: monthStart } },
      { completedAt: { gte: monthStart } }, { status: { in: ["PLANNED", "RUNNING", "UNKNOWN"] } }] }, _sum: { reservedCostMicros: true } }))._sum.reservedCostMicros ?? 0;
    // This exact two-run approval adds a separate one-off envelope. The normal
    // monthly configuration is preserved, and its unchanged value was checked
    // against the first run's immutable approval above.
    if (reserved + MAX_COST_MICROS > gate.budget.effectiveMonthLimitMicros) throw new ImportRequestError("本月已预留费用超出本次独立批准后的上限，未提交查询", 409);
    const startedAt = new Date();
    const run = await tx.serpMonitorRun.create({ data: {
      id: RUN_ID, scope: APPROVED_OTHER_KEYWORD_REVIEW_SCOPE, periodKey: PERIOD_KEY,
      periodLabel: "2026-11-23 · 已批准其他国家关键词补采", periodStart: startedAt, periodEnd: startedAt,
      status: "PLANNED", cohortHash: plan.queryHash, cohortJson: json(plan.targets),
      configJson: json({ ...SERP_DEFAULT_CONFIG, regions: [...COUNTRIES], collectionTimezone: "America/Los_Angeles",
        connectionHash: fingerprint(connection.encryptedCredentials), approvedOtherKeywordReview: {
          quoteId: APPROVED_OTHER_REVIEW_QUOTE_ID, quoteSha256: QUOTE_SHA256, queryHash: plan.queryHash, userApproved: true,
          approvalRecordedAt: startedAt.toISOString(), firstRunId: APPROVED_KEYWORD_REVIEW_RUN_ID,
          firstQuoteSha256: APPROVAL_QUOTE_SHA256, combinedMaxCostMicros: COMBINED_RESERVED, combinedApprovedCapMicros: COMBINED_CAP,
          combinedBudgetApprovedMicros: COMBINED_CAP, originalScheduleMonthLimitMicros: gate.budget.originalScheduleMonthLimitMicros,
          effectiveMonthLimitMicros: gate.budget.effectiveMonthLimitMicros, monthReservedBeforeMicros: reserved,
          firstMonthReservedBeforeMicros: gate.budget.monthReservedBeforeMicros,
          newQueryCount: 467, reuseCount: 1, permanentMarketAssignmentsChanged: false,
        } }),
      queryCount: plan.queries.length, targetCount: plan.targets.length,
      estimatedCostMicros: MAX_COST_MICROS, reservedCostMicros: MAX_COST_MICROS, connectionVersion: connection.connectionVersion,
    } });
    await tx.serpMonitorTask.createMany({ data: plan.queries.map(query => {
      const id = serpTaskId(run.id, query.queryKey);
      return { id, runId: run.id, queryKey: query.queryKey, region: query.region, keyword: query.keyword,
        targetsJson: json(query.targets), state: "PLANNED", requestJson: json(approvedOtherTask(query, id)) };
    }) });
    assertApprovedOtherKeywordReviewRun(run);
    return run;
  }, { maxWait: 10_000, timeout: 45_000 });
}

export async function advanceApprovedOtherKeywordReview(allowSubmit: boolean) {
  const run = await prisma.serpMonitorRun.findUnique({ where: { id: RUN_ID } });
  if (!run) throw new ImportRequestError("尚未建立本次补采账本", 409);
  if (allowSubmit) {
    const gate = await firstBatchGate();
    if (!gate.firstRunComplete) throw new ImportRequestError(gate.reason!, 409);
  }
  await resumeApprovedOtherKeywordReviewRun(allowSubmit, Date.now() + 225_000);
  return loadApprovedOtherKeywordReview();
}

type SavedTask = { id: string; runId: string; queryKey: string; keyword: string; region: string; state: string;
  targetsJson: unknown; costMicros: number | null; checkedAt: Date | null; providerTaskId: string | null; normalizedJson: unknown; errorCode: string | null };
function rankedPages(task: SavedTask | undefined) {
  const data = record(task?.normalizedJson);
  if (!task?.checkedAt || !["COMPLETE", "INCOMPLETE"].includes(task.state) || data.captureComplete !== true || data.queryStatus !== "EXACT" || data.rankingVerified !== true) return [];
  const pages = new Map<string, { url: string; rank: number; title: string | null }>();
  for (const value of Array.isArray(data.organicResults) ? data.organicResults : []) {
    const row = record(value), rank = row.rankGroup;
    try {
      const url = new URL(String(row.url));
      if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.port ||
        !(url.hostname === "flatkey.ai" || url.hostname.endsWith(".flatkey.ai")) || typeof rank !== "number" || !Number.isInteger(rank) || rank < 1 || rank > 100) continue;
      if (!pages.has(url.href) || pages.get(url.href)!.rank > rank) pages.set(url.href, { url: url.href, rank, title: typeof row.title === "string" ? row.title : null });
    } catch { /* Invalid saved URLs cannot become ranking evidence. */ }
  }
  return [...pages.values()].sort((a, b) => a.rank - b.rank || a.url.localeCompare(b.url));
}

export async function loadApprovedOtherKeywordReview() {
  const plan = getApprovedOtherKeywordReviewPlan(), reuse = plan.reused[0];
  const [run, tasks, config, gate] = await Promise.all([
    prisma.serpMonitorRun.findUnique({ where: { id: RUN_ID } }),
    prisma.$queryRaw<SavedTask[]>(Prisma.sql`
      SELECT id, "runId", "queryKey", keyword, region, state, "targetsJson", "costMicros", "checkedAt", "providerTaskId", "errorCode",
        jsonb_build_object('queryStatus', "normalizedJson"->'queryStatus', 'rankingVerified', "normalizedJson"->'rankingVerified',
          'completeDepth', "normalizedJson"->'completeDepth', 'captureComplete', "normalizedJson"->'captureComplete',
          'organicCount', "normalizedJson"->'organicCount', 'coveredThroughRank', "normalizedJson"->'coveredThroughRank',
          'organicResults', COALESCE((SELECT jsonb_agg(item) FROM jsonb_array_elements(
            CASE WHEN jsonb_typeof("normalizedJson"->'organicResults') = 'array' THEN "normalizedJson"->'organicResults' ELSE '[]'::jsonb END
          ) item WHERE item->>'domain' = 'flatkey.ai' OR item->>'domain' LIKE '%.flatkey.ai'), '[]'::jsonb)) AS "normalizedJson"
      FROM "SerpMonitorTask" WHERE "runId" = ${RUN_ID} OR ("runId" = ${reuse.sourceRunId} AND "queryKey" = ${reuse.sourceQueryKey})
      ORDER BY "runId", region, keyword
    `),
    prisma.serpMonitorConfig.findUnique({ where: { id: SERP_CONFIG_ID }, select: { paidEnabled: true, revision: true, nextDueAt: true } }),
    firstBatchGate(),
  ]);
  const taskCounts: Record<string, number> = {};
  for (const task of tasks.filter(task => task.runId === RUN_ID)) taskCounts[task.state] = (taskCounts[task.state] ?? 0) + 1;
  const describe = (query: { keywordId: string; keyword: string; region: string; language: string; targetUrls: string[]; queryKey: string }, reused: boolean, sourceRunId: string) => {
    const matches = tasks.filter(task => task.runId === sourceRunId && task.queryKey === query.queryKey);
    const saved = matches.length === 1 ? matches[0] : undefined;
    const targets = Array.isArray(saved?.targetsJson) ? saved.targetsJson.map(record) : [];
    const identityValid = saved && saved.keyword === query.keyword && saved.region === query.region &&
      saved.id === serpTaskId(sourceRunId, query.queryKey) && targets.some(target => target.siteDomain === "flatkey.ai" && target.keywordId === query.keywordId);
    const task = identityValid ? saved : undefined, pages = rankedPages(task), normalized = record(task?.normalizedJson);
    const verified = Boolean(task?.checkedAt && ["COMPLETE", "INCOMPLETE"].includes(task.state) && normalized.captureComplete === true && normalized.queryStatus === "EXACT" && normalized.rankingVerified === true);
    const ranked = verified && (pages.length > 0 || normalized.completeDepth === true) ? pages.length > 0 : null;
    const gap = !task ? saved ? "保存任务身份与本次批准清单不符，需核对原记录。" : reused ? "未读到原复用查询回执，本次不重复付费。" : run ? "本批查询任务缺失，需核对原账本。" : "本批尚未建立查询账本。"
      : !verified ? normalized.queryStatus === "AUTOCORRECTED" ? "搜索词被改写，不能作为原词排名。" : "尚无有效原词排名回执。"
      : ranked === null ? "本次结果未覆盖完整Top100，不能据此判断无排名。" : ranked ? null : "已核实未进入Top100。";
    return { keywordId: query.keywordId, keyword: query.keyword, country: query.region, language: query.language,
      state: task?.state ?? (saved ? "INVALID_SAVED_IDENTITY" : reused ? "REUSE_UNAVAILABLE" : run ? "MISSING_TASK" : "NOT_STARTED"),
      checkedAt: task?.checkedAt?.toISOString() ?? null, providerTaskId: task?.providerTaskId ?? null,
      errorCode: task?.errorCode ?? null,
      queryStatus: normalized.queryStatus ?? null, captureComplete: normalized.captureComplete ?? null,
      rankingVerified: normalized.rankingVerified ?? null, completeDepth: normalized.completeDepth ?? null,
      organicCount: normalized.organicCount ?? null, coveredThroughRank: normalized.coveredThroughRank ?? null,
      costMicros: reused ? 0 : task?.costMicros ?? null, previousCostMicros: reused ? task?.costMicros ?? null : null,
      ranked, rank: pages[0]?.rank ?? null, pages, originalTargetUrls: [...query.targetUrls], reused, gap, sourceRunId };
  };
  const items = [...plan.queries.map(query => describe(query, false, RUN_ID)), ...plan.reused.map(query => describe(query, true, query.sourceRunId))];
  return {
    quoteId: APPROVED_OTHER_REVIEW_QUOTE_ID, quoteSha256: QUOTE_SHA256, runId: RUN_ID, scope: APPROVED_OTHER_KEYWORD_REVIEW_SCOPE,
    approved: true, queryCount: 467, totalKeywordCount: 468, reuseCount: 1, maxCostMicros: MAX_COST_MICROS,
    combinedMaxCostMicros: COMBINED_RESERVED, combinedApprovedCapMicros: COMBINED_CAP,
    siteScope: "flatkey.ai_and_subdomains_as_saved_serp_results_only", gate: { firstRunComplete: gate.firstRunComplete, reason: gate.reason },
    run: run ? { status: run.status, startedAt: run.startedAt.toISOString(), completedAt: run.completedAt?.toISOString() ?? null,
      actualCostMicros: run.actualCostMicros, taskCounts, errorCode: run.errorCode } : null,
    countries: COUNTRIES.map(country => {
      const rows = items.filter(item => item.country === country), current = rows.filter(item => !item.reused);
      return { country, language: LANGUAGES[country], queryCount: current.length, reuseCount: rows.filter(item => item.reused).length,
        completeCount: current.filter(item => item.state === "COMPLETE").length,
        rankedCount: rows.some(item => item.ranked !== null) ? rows.filter(item => item.ranked === true).length : null,
        actualCostMicros: current.some(item => item.costMicros !== null) ? current.reduce((sum, item) => sum + (item.costMicros ?? 0), 0) : null };
    }),
    scheduledPlan: { paidEnabled: config?.paidEnabled ?? false, revision: config?.revision ?? null, nextDueAt: config?.nextDueAt?.toISOString() ?? null },
    items,
  };
}
