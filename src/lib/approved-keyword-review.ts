import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import manifest from "./data/approved-keyword-review-20261123.json";
import { buildSerpTask, configForSerpRegion, isSerpRegion, SERP_PRICE_PER_QUERY_MICROS, serpQueryKey, serpTaskId, type SerpQuery } from "./dataforseo-serp";
import { isOwnedBrandKeyword } from "./keyword-market-policy";
import type { SerpRegion } from "./serp-monitor-types";
import type { SerpTarget } from "./serp-targets";

export const APPROVED_KEYWORD_REVIEW_SCOPE = "APPROVED_KEYWORD_REVIEW";
export const RUN_ID = "approved-keyword-review-20261123-v1";
export const PERIOD_KEY = "2026-11-23-approved-keyword-review-v1";
export const MAX_COST_MICROS = 6_186_000;
export const APPROVAL_QUOTE_SHA256 = "593fe62523e30b831e7c6d821f8278ab0c9b345a27f8271c970cdbe4ca025e86";
export const APPROVED_KEYWORD_REVIEW_QUERY_HASH = "b37a0e1195d6f3304eb0525f6f01195cfd211673a405f39d3bdb6731efcb08df";
export const APPROVED_KEYWORD_REVIEW_QUERY_COUNT = 1031;
export const APPROVED_KEYWORD_REVIEW_RUN_ID = RUN_ID;
export const APPROVED_KEYWORD_REVIEW_PERIOD_KEY = PERIOD_KEY;
export const APPROVED_KEYWORD_REVIEW_MAX_COST_MICROS = MAX_COST_MICROS;
export const APPROVED_KEYWORD_REVIEW_APPROVAL_QUOTE_SHA256 = APPROVAL_QUOTE_SHA256;
export const APPROVED_KEYWORD_REVIEW_MARKET_COUNTS = Object.freeze({ US: 1002, JP: 20, ES: 1, BR: 8 });
const languages = { US: "en", JP: "ja", ES: "es-ES", BR: "pt-BR" } as const;

export type ApprovedKeywordReviewQuery = SerpQuery & {
  keywordId: string;
  region: SerpRegion;
  language: "en" | "ja" | "es-ES" | "pt-BR";
  targetUrls: string[];
};
export type ApprovedKeywordReviewPlan = {
  queries: ApprovedKeywordReviewQuery[];
  targets: SerpTarget[];
  queryHash: string;
};
export type ApprovedKeywordReviewHeld = { keywordId: string; keyword: string; reason: string; status: string };

function reject(reason: string): never { throw new Error(`APPROVED_KEYWORD_REVIEW_${reason}`); }
function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => [key, canonical(item)]));
  return value;
}
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const item of Object.values(value)) deepFreeze(item);
    Object.freeze(value);
  }
  return value;
}

function loadApprovedPlan(): ApprovedKeywordReviewPlan {
  if (manifest.schemaVersion !== 1 || manifest.scope !== APPROVED_KEYWORD_REVIEW_SCOPE || manifest.runId !== RUN_ID || manifest.periodKey !== PERIOD_KEY
    || manifest.approvalQuoteSha256 !== APPROVAL_QUOTE_SHA256 || manifest.queryHash !== APPROVED_KEYWORD_REVIEW_QUERY_HASH
    || manifest.queryCount !== APPROVED_KEYWORD_REVIEW_QUERY_COUNT || manifest.maxCostMicros !== MAX_COST_MICROS
    || SERP_PRICE_PER_QUERY_MICROS !== 6000 || manifest.queryCount * SERP_PRICE_PER_QUERY_MICROS !== MAX_COST_MICROS
    || !isDeepStrictEqual(manifest.marketCounts, APPROVED_KEYWORD_REVIEW_MARKET_COUNTS)
    || manifest.ownedBrandExcludedCount !== 26 || manifest.heldCount !== 468 || manifest.held.length !== 468
    || manifest.queries.length !== APPROVED_KEYWORD_REVIEW_QUERY_COUNT) reject("INVALID_FROZEN_MANIFEST");
  if (hash(manifest.queries) !== APPROVED_KEYWORD_REVIEW_QUERY_HASH) reject("QUERY_HASH_MISMATCH");
  const ids = new Set<string>(), words = new Set<string>(), queryKeys = new Set<string>();
  const counts = { US: 0, JP: 0, ES: 0, BR: 0 };
  const queries: ApprovedKeywordReviewQuery[] = [], targets: SerpTarget[] = [];
  for (const row of manifest.queries) {
    if (!isSerpRegion(row.region) || row.language !== languages[row.region] || !row.keywordId || !row.keyword
      || isOwnedBrandKeyword(row.keyword) || !Array.isArray(row.targetUrls) || row.targetUrls.some(url => typeof url !== "string")) reject("INVALID_APPROVED_QUERY");
    const region = row.region, word = serpQueryKey(row.keyword), queryKey = `${region}:${word}`;
    if (!word || row.queryKey !== queryKey || ids.has(row.keywordId) || words.has(word) || queryKeys.has(queryKey)) reject("DUPLICATE_OR_CHANGED_QUERY");
    for (const value of row.targetUrls) {
      const url = new URL(value);
      if (url.protocol !== "https:" || url.hostname !== "flatkey.ai" || url.username || url.password || url.port) reject("CHANGED_TARGET_URL");
    }
    ids.add(row.keywordId); words.add(word); queryKeys.add(queryKey); counts[region]++;
    const target: SerpTarget = { keywordId: row.keywordId, keyword: row.keyword, siteDomain: "flatkey.ai", targetUrls: [...row.targetUrls] };
    const query: ApprovedKeywordReviewQuery = { keywordId: row.keywordId, keyword: row.keyword, region, language: languages[region],
      targetUrls: [...row.targetUrls], queryKey, targets: [structuredClone(target)] };
    // Reuse the production escape, country/language, depth and paid-extra guards.
    buildSerpTask(query, serpTaskId(RUN_ID, queryKey), configForSerpRegion(region));
    targets.push(target); queries.push(query);
  }
  if (!isDeepStrictEqual(counts, APPROVED_KEYWORD_REVIEW_MARKET_COUNTS) || queryKeys.has("BR:nvidia b300")) reject("CHANGED_APPROVED_COUNTS");
  const heldIds = new Set<string>();
  for (const row of manifest.held) {
    if (!row.keywordId || !row.keyword || !row.reason || heldIds.has(row.keywordId) || ids.has(row.keywordId)) reject("INVALID_HELD_INVENTORY");
    heldIds.add(row.keywordId);
  }
  return { queries, targets, queryHash: APPROVED_KEYWORD_REVIEW_QUERY_HASH };
}

// Import is pure: a fixed approved artifact, no provider/DB calls or assignments.
const frozenPlan = deepFreeze(loadApprovedPlan());
export const APPROVED_KEYWORD_REVIEW_QUERIES: ReadonlyArray<ApprovedKeywordReviewQuery> = frozenPlan.queries;
export const APPROVED_KEYWORD_REVIEW_HELD: ReadonlyArray<ApprovedKeywordReviewHeld> = deepFreeze(structuredClone(manifest.held));
export function getApprovedKeywordReviewPlan(): ApprovedKeywordReviewPlan { return structuredClone(frozenPlan); }

/** Paid-submission guard only. Free retrieval must not depend on this assertion. */
export function assertApprovedKeywordReviewRun(runValue: unknown, tasksValue?: unknown): ApprovedKeywordReviewPlan {
  const run = record(runValue), config = record(run.configJson), approval = record(config.approvedKeywordReview);
  if (run.scope !== APPROVED_KEYWORD_REVIEW_SCOPE || run.id !== RUN_ID || run.periodKey !== PERIOD_KEY
    || run.targetCount !== APPROVED_KEYWORD_REVIEW_QUERY_COUNT || run.queryCount !== APPROVED_KEYWORD_REVIEW_QUERY_COUNT
    || run.estimatedCostMicros !== MAX_COST_MICROS || run.reservedCostMicros !== MAX_COST_MICROS) reject("RUN_OR_BUDGET_MISMATCH");
  if (run.status === "UNKNOWN") reject("OUTCOME_UNKNOWN_PAID_STOPPED");
  if (run.actualCostMicros !== undefined && run.actualCostMicros !== null
    && (!Number.isSafeInteger(run.actualCostMicros) || Number(run.actualCostMicros) < 0 || Number(run.actualCostMicros) > MAX_COST_MICROS)) reject("ACTUAL_COST_OUT_OF_BOUNDS");
  if (approval.quoteSha256 !== APPROVAL_QUOTE_SHA256 || approval.queryHash !== APPROVED_KEYWORD_REVIEW_QUERY_HASH || approval.userApproved !== true) reject("APPROVAL_MISMATCH");
  if (run.cohortHash !== APPROVED_KEYWORD_REVIEW_QUERY_HASH || !isDeepStrictEqual(run.cohortJson, frozenPlan.targets)) reject("FROZEN_COHORT_MISMATCH");
  if (tasksValue !== undefined) {
    if (!Array.isArray(tasksValue) || tasksValue.length !== APPROVED_KEYWORD_REVIEW_QUERY_COUNT) reject("WHOLE_TASK_SET_REQUIRED");
    const expected = new Map(frozenPlan.queries.map(query => [query.queryKey, query])), seen = new Set<string>();
    for (const raw of tasksValue) {
      const task = record(raw), query = typeof task.queryKey === "string" ? expected.get(task.queryKey) : undefined;
      if (!query || seen.has(query.queryKey) || task.runId !== RUN_ID || task.id !== serpTaskId(RUN_ID, query.queryKey)
        || task.keyword !== query.keyword || task.region !== query.region || !isDeepStrictEqual(task.targetsJson, query.targets)) reject("TASK_IDENTITY_MISMATCH");
      seen.add(query.queryKey);
      if (!isDeepStrictEqual(task.requestJson, buildSerpTask(query, serpTaskId(RUN_ID, query.queryKey), configForSerpRegion(query.region)))) reject("TASK_REQUEST_MISMATCH");
      if (task.state === "UNKNOWN") reject("TASK_OUTCOME_UNKNOWN_PAID_STOPPED");
      if (task.costMicros !== undefined && task.costMicros !== null
        && (!Number.isSafeInteger(task.costMicros) || Number(task.costMicros) < 0 || Number(task.costMicros) > SERP_PRICE_PER_QUERY_MICROS)) reject("TASK_COST_OUT_OF_BOUNDS");
    }
  }
  return getApprovedKeywordReviewPlan();
}
