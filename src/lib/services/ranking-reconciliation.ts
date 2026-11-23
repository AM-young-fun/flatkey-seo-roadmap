import { prisma } from "@/lib/prisma";
import { buildApprovedWeeklyKeywordCapture, approvedWeeklyCaptureRunIds } from "@/lib/approved-weekly-keyword-capture";
import { getApprovedKeywordReviewPlan } from "@/lib/approved-keyword-review";
import { getApprovedOtherKeywordReviewPlan } from "@/lib/approved-other-keyword-review";
import { loadApprovedKeywordReview } from "./approved-keyword-review";
import { loadApprovedOtherKeywordReview } from "./approved-other-keyword-review";
import { coverageSelection } from "@/lib/saved-ranking-coverage";
import { loadSavedRankingCoverage } from "./saved-ranking-coverage";
import { reconcileRankings, wordKey, type RankingCheck } from "@/lib/ranking-reconciliation";
import { providerIdIsSafe, SERP_MARKET_CONFIG } from "@/lib/dataforseo-serp";
const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};

/** Saved evidence only. This module has no provider client or mutation. */
export async function loadRankingReconciliation() {
  const now = new Date();
  const [first, other, metadata, discovery, memberships, inventory, records] = await Promise.all([
    loadApprovedKeywordReview(), loadApprovedOtherKeywordReview(),
    prisma.serpMonitorRun.findMany({ where: { id: { in: approvedWeeklyCaptureRunIds() } }, select: {
      id: true, scope: true, periodKey: true, cohortHash: true, targetCount: true, queryCount: true,
      estimatedCostMicros: true, reservedCostMicros: true, configJson: true,
    } }),
    (async () => {
      const latest = await prisma.dataForSeoRun.findFirst({ where: { siteDomain: "flatkey.ai", status: "COMPLETED", requestId: { startsWith: "discovery-" } }, orderBy: [{ collectedAt: "desc" }, { createdAt: "desc" }], select: { requestId: true } });
      const match = /^discovery-(\d{4}-\d{2}-\d{2})-flatkey-ai-(US|JP|ES|BR)$/.exec(latest?.requestId ?? "");
      if (!match) throw Error("SAVED_DISCOVERY_PERIOD_UNAVAILABLE");
      return loadSavedRankingCoverage(coverageSelection(new URLSearchParams({ periodKey: match[1] })));
    })(),
    prisma.siteKeyword.findMany({ where: { siteDomain: "flatkey.ai" }, select: { keywordId: true, active: true, pool: true, targetUrls: true, keyword: { select: { text: true, active: true } } } }),
    prisma.seoPageInventory.findMany({ select: { url: true, lastSeen: true } }),
    prisma.seoWorkflowRecord.findMany({ where: { kind: { in: ["task", "publication"] } }, select: { kind: true, payload: true } }),
  ]);
  const packet = buildApprovedWeeklyKeywordCapture({ start: "2026-11-19", end: "2026-11-25", asOf: now }, { first, other }, metadata);
  const plan = [...getApprovedKeywordReviewPlan().queries, ...getApprovedOtherKeywordReviewPlan().queries, ...getApprovedOtherKeywordReviewPlan().reused];
  const saved = [...first.items, ...other.items].map(object);
  const checks: RankingCheck[] = plan.map(query => {
    const row = saved.find(row => row.country === query.region && wordKey(String(row.keyword)) === wordKey(query.keyword));
    const pages = packet?.pages.filter(page => page.keywordId === query.keywordId && page.country === query.region) ?? [];
    return { keywordId: query.keywordId, keyword: query.keyword, country: query.region, language: query.language,
      targetUrls: query.targetUrls, checkedAt: typeof row?.checkedAt === "string" ? row.checkedAt : null,
      captured: Boolean(row?.captureComplete === true && row?.queryStatus === "EXACT" && row?.rankingVerified === true && ["COMPLETE", "INCOMPLETE"].includes(String(row?.state))),
      pages: pages.map(page => ({ keyword: page.keyword, country: page.country, rank: page.rank, url: page.url, checkedAt: page.checkedAt, collectedAt: page.checkedAt, source: "serp" as const })) };
  });
  // Every approved word already has a newer receipt. Older scheduled payloads
  // cannot win precedence, so do not download their full organic result arrays.
  const earliestCurrentCheck = packet?.complete ? checks.map(row => row.checkedAt).filter((value): value is string => Boolean(value)).sort()[0] : undefined;
  const scheduled = await prisma.serpMonitorTask.findMany({ where: { run: { scope: "SCHEDULED" }, state: "COMPLETE",
    checkedAt: { not: null, ...(earliestCurrentCheck ? { gt: new Date(earliestCurrentCheck) } : {}) }, keyword: { in: plan.map(row => row.keyword) } },
    select: { keyword: true, region: true, providerTaskId: true, checkedAt: true, normalizedJson: true, requestJson: true } });
  // Future normal captures supersede a previous approved result by exact word
  // and country, including checked misses. They never revive older positives.
  for (const task of scheduled) {
    const value = object(task.normalizedJson), request = object(task.requestJson);
    const market = SERP_MARKET_CONFIG[task.region as keyof typeof SERP_MARKET_CONFIG];
    if (!market || !task.checkedAt || !providerIdIsSafe(task.providerTaskId) || value.captureComplete !== true || value.rankingVerified !== true || value.queryStatus !== "EXACT" || wordKey(String(value.keyword)) !== wordKey(task.keyword)
      || request.device !== "desktop" || request.depth !== 100 || value.locationCode !== market.locationCode || value.languageCode !== market.languageCode) continue;
    const checkedAt = task.checkedAt.toISOString(), index = checks.findIndex(row => row.country === task.region && wordKey(row.keyword) === wordKey(task.keyword));
    if (index < 0 || checks[index].checkedAt && checks[index].checkedAt! >= checkedAt) continue;
    const original = checks[index];
    const organic = Array.isArray(value.organicResults) ? value.organicResults.map(object) : [];
    checks[index] = { ...original, checkedAt, captured: true, pages: organic.flatMap(row => {
      if (typeof row.url !== "string" || typeof row.rankGroup !== "number" || row.rankGroup < 1 || row.rankGroup > 100) return [];
      return [{ keyword: original.keyword, country: original.country, rank: row.rankGroup, url: row.url, checkedAt, collectedAt: checkedAt, source: "serp" as const }];
    }) };
  }
  return reconcileRankings({ checks, discovery, memberships, inventory: inventory.map(row => ({ ...row, lastSeen: row.lastSeen.toISOString() })),
    workflow: { tasks: records.filter(row => row.kind === "task").map(row => row.payload), publications: records.filter(row => row.kind === "publication").map(row => row.payload) }, generatedAt: now.toISOString() });
}
