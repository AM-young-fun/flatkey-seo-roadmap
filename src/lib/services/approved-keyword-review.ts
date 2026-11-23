import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { envBool } from "@/lib/env";
import { ImportRequestError } from "@/lib/ranking-import";
import { decryptDataForSeoCredentials } from "@/lib/dataforseo-credentials";
import { buildSerpTask, configForSerpRegion, SERP_CONFIG_ID, SERP_DEFAULT_CONFIG, SERP_MARKETS, serpTaskId } from "@/lib/dataforseo-serp";
import { APPROVED_KEYWORD_REVIEW_SCOPE, APPROVED_KEYWORD_REVIEW_RUN_ID, APPROVED_KEYWORD_REVIEW_PERIOD_KEY,
  APPROVED_KEYWORD_REVIEW_MAX_COST_MICROS, APPROVAL_QUOTE_SHA256, getApprovedKeywordReviewPlan, assertApprovedKeywordReviewRun } from "@/lib/approved-keyword-review";
import otherCountries from "@/lib/data/approved-keyword-review-other-countries-20261123.json";
import { resumeApprovedKeywordReviewRun } from "@/lib/services/serp-monitor";

const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const fingerprint = (value: string) => createHash("sha256").update(value).digest("hex");
const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
// A fresh, explicit $8.994 one-off approval is additional to the original
// recurring envelope. Only the two frozen batches can consume it; the stored
// schedule limits and paid switch are never enlarged.
const combinedBudgetApprovedMicros = 8_994_000;
export async function prepareApprovedKeywordReview() {
  if (envBool("DISABLE_EXTERNAL_FETCH")) throw new ImportRequestError("外部采集已紧急停止，未提交查询", 409);
  const plan = getApprovedKeywordReviewPlan();
  return prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"serp-monitor:budget"}))`;
    const existing = await tx.serpMonitorRun.findUnique({ where: { id: APPROVED_KEYWORD_REVIEW_RUN_ID } });
    if (existing) {
      // An unknown result is retained, never converted into an unsubmitted run.
      if (existing.scope !== APPROVED_KEYWORD_REVIEW_SCOPE || existing.cohortHash !== plan.queryHash) throw new ImportRequestError("一次性账本身份已变化，请核对原记录", 409);
      return existing;
    }
    if (await tx.serpMonitorRun.findFirst({ where: { status: { in: ["PLANNED", "RUNNING", "UNKNOWN"] } }, select: { id: true } })) {
      throw new ImportRequestError("已有未完成或结果不明的采集账本，请先核对原记录；未新增付费", 409);
    }
    const [config, connection] = await Promise.all([
      tx.serpMonitorConfig.findUnique({ where: { id: SERP_CONFIG_ID } }),
      tx.dataForSeoConnection.findUnique({ where: { siteDomain: "flatkey.ai" } }),
    ]);
    if (config?.paidEnabled) throw new ImportRequestError("常设付费计划须保持原暂停状态，本次不更改配置", 409);
    if (!config || !connection) throw new ImportRequestError("采集连接或预算配置尚未就绪", 409);
    decryptDataForSeoCredentials(connection.encryptedCredentials);
    const monthStart = new Date(new Date().toISOString().slice(0, 7) + "-01T00:00:00Z");
    const reserved = (await tx.serpMonitorRun.aggregate({ where: { OR: [{ createdAt: { gte: monthStart } },
      { completedAt: { gte: monthStart } }, { status: { in: ["PLANNED", "RUNNING", "UNKNOWN"] } }] }, _sum: { reservedCostMicros: true } }))._sum.reservedCostMicros ?? 0;
    const effectiveMonthLimitMicros = config.maxMonthCostMicros + combinedBudgetApprovedMicros;
    if (reserved + APPROVED_KEYWORD_REVIEW_MAX_COST_MICROS > effectiveMonthLimitMicros) throw new ImportRequestError("本月原预算与本次独立批准额度不足以预留，未提交查询", 409);
    const startedAt = new Date();
    const run = await tx.serpMonitorRun.create({ data: {
      id: APPROVED_KEYWORD_REVIEW_RUN_ID, scope: APPROVED_KEYWORD_REVIEW_SCOPE, periodKey: APPROVED_KEYWORD_REVIEW_PERIOD_KEY,
      periodLabel: "2026-11-23 · 已批准目标词一次性复核", periodStart: startedAt, periodEnd: startedAt,
      status: "PLANNED", cohortHash: plan.queryHash, cohortJson: json(plan.targets),
      configJson: json({ ...SERP_DEFAULT_CONFIG, regions: [...SERP_MARKETS], connectionHash: fingerprint(connection.encryptedCredentials),
        collectionTimezone: "America/Los_Angeles", approvedKeywordReview: {
          userApproved: true, quoteId: "keyword-fee-review-20261123-v1", quoteSha256: APPROVAL_QUOTE_SHA256, queryHash: plan.queryHash,
          approvalRecordedAt: startedAt.toISOString(),
          approvalText: "可以，就按这份清单一次性跑完，费用不超过6.186美元",
          combinedBudgetApprovedMicros, originalScheduleMonthLimitMicros: config.maxMonthCostMicros,
          effectiveMonthLimitMicros, monthReservedBeforeMicros: reserved, otherCountryQueriesIncludedInThisRun: false,
        } }),
      queryCount: plan.queries.length, targetCount: plan.targets.length,
      estimatedCostMicros: APPROVED_KEYWORD_REVIEW_MAX_COST_MICROS, reservedCostMicros: APPROVED_KEYWORD_REVIEW_MAX_COST_MICROS,
      connectionVersion: connection.connectionVersion,
    } });
    await tx.serpMonitorTask.createMany({ data: plan.queries.map(query => {
      const id = serpTaskId(run.id, query.queryKey);
      return { id, runId: run.id, queryKey: query.queryKey, region: query.region, keyword: query.keyword,
        targetsJson: json(query.targets), state: "PLANNED", requestJson: json(buildSerpTask(query, id, configForSerpRegion(query.region))) };
    }) });
    assertApprovedKeywordReviewRun(run);
    return run;
  }, { maxWait: 10_000, timeout: 45_000 });
}

export async function advanceApprovedKeywordReview(allowSubmit: boolean) {
  const run = await prisma.serpMonitorRun.findUnique({ where: { id: APPROVED_KEYWORD_REVIEW_RUN_ID } });
  if (!run) throw new ImportRequestError("尚未建立本次一次性采集账本", 409);
  await resumeApprovedKeywordReviewRun(allowSubmit, Date.now() + 225_000);
  return loadApprovedKeywordReview();
}

export async function loadApprovedKeywordReview() {
  const plan = getApprovedKeywordReviewPlan();
  type SavedTask = { keyword: string; region: string; state: string; costMicros: number | null; checkedAt: Date | null;
    providerTaskId: string | null; normalizedJson: unknown; errorCode: string | null };
  const [run, tasks, config] = await Promise.all([
    prisma.serpMonitorRun.findUnique({ where: { id: APPROVED_KEYWORD_REVIEW_RUN_ID } }),
    prisma.$queryRaw<SavedTask[]>(Prisma.sql`
      SELECT keyword, region, state, "costMicros", "checkedAt", "providerTaskId", "errorCode",
        jsonb_build_object('queryStatus', "normalizedJson"->'queryStatus', 'rankingVerified', "normalizedJson"->'rankingVerified',
          'completeDepth', "normalizedJson"->'completeDepth', 'captureComplete', "normalizedJson"->'captureComplete',
          'organicResults', COALESCE((SELECT jsonb_agg(item) FROM jsonb_array_elements(
            CASE WHEN jsonb_typeof("normalizedJson"->'organicResults') = 'array' THEN "normalizedJson"->'organicResults' ELSE '[]'::jsonb END
          ) item WHERE item->>'domain' = 'flatkey.ai' OR item->>'domain' LIKE '%.flatkey.ai'), '[]'::jsonb)) AS "normalizedJson"
      FROM "SerpMonitorTask" WHERE "runId" = ${APPROVED_KEYWORD_REVIEW_RUN_ID} ORDER BY region, keyword
    `),
    prisma.serpMonitorConfig.findUnique({ where: { id: SERP_CONFIG_ID }, select: { paidEnabled: true, revision: true, nextDueAt: true } }),
  ]);
  const taskCounts: Record<string, number> = {};
  for (const task of tasks) taskCounts[task.state] = (taskCounts[task.state] ?? 0) + 1;
  const rankedPages = (task: typeof tasks[number]) => {
    const data = record(task.normalizedJson);
    if (!task.checkedAt || !["COMPLETE", "INCOMPLETE"].includes(task.state) || data.queryStatus !== "EXACT" || data.rankingVerified !== true) return [];
    return Array.isArray(data.organicResults) ? data.organicResults.flatMap(value => {
      const row = record(value);
      try {
        const url = new URL(String(row.url)), rank = Number(row.rankGroup);
        return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password && !url.port &&
          (url.hostname === "flatkey.ai" || url.hostname.endsWith(".flatkey.ai")) && Number.isInteger(rank) && rank >= 1 && rank <= 100
          ? [{ url: url.href, rank }] : [];
      } catch { return []; }
    }) : [];
  };
  const ranked = (task: typeof tasks[number]) => rankedPages(task).length > 0;
  return {
    quoteId: "keyword-fee-review-20261123-v1", runId: APPROVED_KEYWORD_REVIEW_RUN_ID, scope: APPROVED_KEYWORD_REVIEW_SCOPE,
    approved: true, queryCount: plan.queries.length, maxCostMicros: APPROVED_KEYWORD_REVIEW_MAX_COST_MICROS,
    siteScope: "flatkey.ai_and_subdomains_as_saved_serp_results_only",
    run: run ? { status: run.status, startedAt: run.startedAt.toISOString(), completedAt: run.completedAt?.toISOString() ?? null,
      actualCostMicros: run.actualCostMicros, taskCounts, errorCode: run.errorCode } : null,
    countries: SERP_MARKETS.map(country => {
      const rows = tasks.filter(task => task.region === country);
      return { country, language: { US: "en", JP: "ja", ES: "es-ES", BR: "pt-BR" }[country],
        queryCount: plan.queries.filter(query => query.region === country).length,
        completeCount: rows.filter(row => row.state === "COMPLETE").length,
        rankedCount: rows.some(row => row.checkedAt) ? rows.filter(ranked).length : null,
        actualCostMicros: rows.some(row => row.costMicros !== null) ? rows.reduce((sum, row) => sum + (row.costMicros ?? 0), 0) : null };
    }),
    otherCountries: { label: "其他国家／待归属", count: otherCountries.rows.length, paidQueries: 0, rows: otherCountries.rows },
    scheduledPlan: { paidEnabled: config?.paidEnabled ?? false, revision: config?.revision ?? null, nextDueAt: config?.nextDueAt?.toISOString() ?? null },
    // Detailed rows retain pending/incomplete states instead of manufacturing zero ranks.
    items: tasks.map(task => {
      const pages = rankedPages(task), normalized = record(task.normalizedJson);
      const verified = task.checkedAt && ["COMPLETE", "INCOMPLETE"].includes(task.state) && normalized.queryStatus === "EXACT" && normalized.rankingVerified === true;
      return { keyword: task.keyword, country: task.region, state: task.state, checkedAt: task.checkedAt?.toISOString() ?? null,
        providerTaskId: task.providerTaskId, costMicros: task.costMicros, errorCode: task.errorCode,
        ranked: verified && (pages.length > 0 || normalized.completeDepth === true) ? pages.length > 0 : null,
        rank: pages.length ? Math.min(...pages.map(page => page.rank)) : null, pages };
    }),
  };
}
