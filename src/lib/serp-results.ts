import type { SearchRegionCode } from "./seo";
import { serpTargetKey, type SerpTarget } from "./serp-targets";
import { validSitePage } from "./keyword-volume-review";
import type { RankingEvidence, RankingPageEvidence, RankSummary } from "./types";
import { serpPeriod, serpPeriodFromKey, type SerpPeriod } from "./serp-periods";

export const SERP_SOURCE = "dataforseo_serp" as const;
export const SERP_MARKET_LANGUAGE: Record<SearchRegionCode, string> = { US: "en", JP: "ja", ES: "es", BR: "pt" };
export type SerpResultStatus = "PENDING" | "QUEUED" | "RANKED" | "OUTSIDE_TOP100" | "FAILED" | "INCOMPLETE";
export type SerpRunScope = "SCHEDULED" | "SAMPLE";
export type SerpMovement = "UP" | "DOWN" | "UNCHANGED" | "NEW_IN_TOP100" | "DROPPED_OUT" | "FIRST_CHECK" | "NOT_COMPARABLE";
export type SerpRankedPage = { url: string; title: string | null; rankGroup: number; rankAbsolute: number | null };
export type SerpTaskRead = {
  id: string; runId: string; keyword: string; targetsJson: unknown; state: string;
  normalizedJson: unknown; checkedAt: Date | string | null; providerTaskId: string | null; errorCode: string | null;
  runCreatedAt: Date | string; updatedAt: Date | string;
  periodKey?: string; periodLabel?: string; periodStart?: Date | string; periodEnd?: Date | string;
  runScope?: SerpRunScope; runTargetCount?: number;
  region?: SearchRegionCode;
};
export type SerpTrendCohort = { runId: string; periodKey: string; targets: SerpTarget[]; runScope?: SerpRunScope; runTargetCount?: number; runCreatedAt?: Date | string };
export type SerpKeywordResult = SerpTarget & {
  status: SerpResultStatus; rank: number | null; url: string | null; pages: SerpRankedPage[];
  checkedAt: string | null; runId: string | null; providerTaskId: string | null;
  errorCode: string | null; googleUrl: string | null; previousRank: number | null;
  previousRankStatus: "ranked" | "outside_top100" | null; previousCheckedAt: string | null;
  periodKey: string | null; periodLabel: string | null; periodStart: string | null; periodEnd: string | null;
  previousPeriodKey: string | null; previousPeriodLabel: string | null; movement: SerpMovement; depthIncomplete: boolean;
  runScope: SerpRunScope | null; runTargetCount: number | null;
};
export type SerpResultsResponse = {
  schemaVersion: 1; source: typeof SERP_SOURCE; site: string; region: SearchRegionCode;
  languageCode: string; device: string; depth: 100; cohortHash: string;
  summary: ReturnType<typeof summarizeSerpResults>; items: SerpKeywordResult[]; latestCompletedAt: string | null;
  currentPeriod: SerpPeriod; movementSummary: ReturnType<typeof summarizeSerpMovements>;
  sampleSummary: ReturnType<typeof summarizeSerpSampleResults>;
};

const record = (value: unknown): Record<string, unknown> | null => value != null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
const string = (value: unknown) => typeof value === "string" && value.length ? value : null;
const positiveInteger = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value) && value >= 1;
const normalizedKeyword = (value: string) => value.normalize("NFKC").toLocaleLowerCase("en-US").trim().replace(/\s+/g, " ");
const date = (value: unknown): string | null => {
  if (!(typeof value === "string" || value instanceof Date)) return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
};
const urlIdentity = (value: string) => {
  const url = new URL(value); url.hash = ""; return url.href;
};
export function serpTaskPeriod(task: SerpTaskRead): SerpPeriod | null {
  try { return task.periodKey ? serpPeriodFromKey(task.periodKey) : serpPeriod(task.runCreatedAt); } catch { return null; }
}

function targeted(task: SerpTaskRead, target: SerpTarget): boolean {
  if (normalizedKeyword(task.keyword) !== normalizedKeyword(target.keyword) || !Array.isArray(task.targetsJson)) return false;
  return task.targetsJson.some(value => {
    const row = record(value);
    return row?.keywordId === target.keywordId && row?.siteDomain === target.siteDomain;
  });
}

function rankedPages(task: SerpTaskRead, target: SerpTarget): SerpRankedPage[] {
  const result = record(task.normalizedJson), rows = result?.organicResults;
  if (!Array.isArray(rows)) return [];
  const byUrl = new Map<string, SerpRankedPage>();
  for (const value of rows) {
    const row = record(value), url = string(row?.url), rankGroup = row?.rankGroup;
    if (!url || !positiveInteger(rankGroup) || rankGroup > 100 || !validSitePage(url, target.siteDomain)) continue;
    const key = urlIdentity(url), previous = byUrl.get(key);
    const page = { url, title: string(row?.title), rankGroup, rankAbsolute: positiveInteger(row?.rankAbsolute) ? row.rankAbsolute : null };
    if (!previous || page.rankGroup < previous.rankGroup) byUrl.set(key, page);
  }
  return [...byUrl.values()].sort((a, b) => a.rankGroup - b.rankGroup || a.url.localeCompare(b.url));
}

function taskResult(target: SerpTarget, task?: SerpTaskRead): SerpKeywordResult {
  const empty: SerpKeywordResult = { ...target, status: "PENDING", rank: null, url: null, pages: [], checkedAt: null,
    runId: null, providerTaskId: null, errorCode: null, googleUrl: null, previousRank: null,
    previousRankStatus: null, previousCheckedAt: null, previousPeriodKey: null, previousPeriodLabel: null, movement: "NOT_COMPARABLE", depthIncomplete: false,
    periodKey: null, periodLabel: null, periodStart: null, periodEnd: null, runScope: null, runTargetCount: null };
  if (!task) return empty;
  const normalized = record(task.normalizedJson), checkedAt = date(task.checkedAt) ?? date(normalized?.checkedAt);
  const pages = rankedPages(task, target), period = serpTaskPeriod(task);
  const validCapture = checkedAt != null && normalized?.rankingVerified !== false &&
    (task.state === "COMPLETE" || (task.state === "INCOMPLETE" && normalized?.rankingVerified === true));
  const complete = validCapture && task.state === "COMPLETE" && normalized?.completeDepth === true;
  // A verified #1 is real even when Google returned fewer than 100 results.
  // Conversely, an incomplete search without a hit cannot prove absence.
  const matched = validCapture && pages.length > 0;
  const status: SerpResultStatus = matched ? "RANKED" : complete ? "OUTSIDE_TOP100"
    : task.state === "INCOMPLETE" || task.state === "COMPLETE" ? "INCOMPLETE"
    : ["FAILED", "UNKNOWN"].includes(task.state) ? "FAILED"
    : ["SUBMITTING", "QUEUED", "RECEIVED"].includes(task.state) ? "QUEUED" : "PENDING";
  return { ...empty, status, rank: matched ? pages[0].rankGroup : null, url: matched ? pages[0].url : null,
    // Partial results remain evidence, but never prove a full top-100 check.
    pages: normalized?.rankingVerified === false ? [] : pages, checkedAt, runId: task.runId, providerTaskId: task.providerTaskId,
    errorCode: task.errorCode, googleUrl: string(normalized?.googleUrl), depthIncomplete: matched && !complete,
    runScope: task.runScope === "SAMPLE" ? "SAMPLE" : "SCHEDULED", runTargetCount: positiveInteger(task.runTargetCount) ? task.runTargetCount : null,
    periodKey: period?.key ?? null, periodLabel: period?.label ?? null, periodStart: period?.start ?? null, periodEnd: period?.end ?? null };
}

export function buildSerpKeywordResults(targets: SerpTarget[], tasks: SerpTaskRead[]): SerpKeywordResult[] {
  const sorted = [...tasks].sort((a, b) => (Date.parse(date(b.runCreatedAt) ?? "") || 0) - (Date.parse(date(a.runCreatedAt) ?? "") || 0) ||
    (Date.parse(date(b.updatedAt) ?? "") || 0) - (Date.parse(date(a.updatedAt) ?? "") || 0) || b.id.localeCompare(a.id));
  const byTarget = new Map<string, SerpTaskRead[]>();
  const targetMap = new Map(targets.map(target => [serpTargetKey(target), target]));
  for (const task of sorted) {
    if (!Array.isArray(task.targetsJson)) continue;
    for (const value of task.targetsJson) {
      const row = record(value);
      if (!row || typeof row.siteDomain !== "string" || typeof row.keywordId !== "string") continue;
      const key = `${row.siteDomain}:${row.keywordId}`, target = targetMap.get(key);
      if (target && targeted(task, target)) byTarget.set(key, [...(byTarget.get(key) ?? []), task]);
    }
  }
  return targets.map(target => {
    const history = byTarget.get(serpTargetKey(target)) ?? [], result = taskResult(target, history[0]);
    // A correction/retry within one period is not a new comparison baseline.
    const previous = history.slice(1).map(task => taskResult(target, task)).find(row => row.periodKey && row.periodKey !== result.periodKey &&
      (row.status === "RANKED" || row.status === "OUTSIDE_TOP100"));
    const comparable = result.status === "RANKED" || result.status === "OUTSIDE_TOP100";
    const movement: SerpMovement = !comparable ? "NOT_COMPARABLE" : !previous ? "FIRST_CHECK"
      : result.status === "RANKED" && previous.status === "OUTSIDE_TOP100" ? "NEW_IN_TOP100"
      : result.status === "OUTSIDE_TOP100" && previous.status === "RANKED" ? "DROPPED_OUT"
      : result.rank != null && previous.rank != null && result.rank < previous.rank ? "UP"
      : result.rank != null && previous.rank != null && result.rank > previous.rank ? "DOWN" : "UNCHANGED";
    return { ...result, previousRank: previous?.rank ?? null,
      previousRankStatus: previous?.status === "RANKED" ? "ranked" : previous?.status === "OUTSIDE_TOP100" ? "outside_top100" : null,
      previousCheckedAt: previous?.checkedAt ?? null, previousPeriodKey: previous?.periodKey ?? null, previousPeriodLabel: previous?.periodLabel ?? null, movement };
  });
}

export function summarizeSerpMovements(items: SerpKeywordResult[]) {
  const count = (movement: SerpMovement) => items.filter(item => item.movement === movement).length;
  return { up: count("UP"), down: count("DOWN"), unchanged: count("UNCHANGED"), newInTop100: count("NEW_IN_TOP100"),
    droppedOut: count("DROPPED_OUT"), firstCheck: count("FIRST_CHECK"), notComparable: count("NOT_COMPARABLE") };
}

export function summarizeSerpSampleResults(items: SerpKeywordResult[]) {
  const samples = items.filter(item => item.runScope === "SAMPLE");
  const summary = summarizeSerpResults(samples);
  return { sampledTargetCount: samples.length, checked: summary.checked, pending: summary.pending, queued: summary.queued,
    failed: summary.failed, incomplete: summary.incomplete,
    latestCheckedAt: samples.flatMap(item => item.checkedAt ? [item.checkedAt] : []).sort().at(-1) ?? null };
}

export function summarizeSerpResults(items: SerpKeywordResult[]) {
  const count = (status: SerpResultStatus) => items.filter(item => item.status === status).length;
  const ranked = count("RANKED"), outside = count("OUTSIDE_TOP100"), queued = count("QUEUED"), incomplete = count("INCOMPLETE"), failed = count("FAILED");
  return { total: items.length, checked: ranked + outside, ranked, outside, pending: count("PENDING"), queued, incomplete, failed,
    fullDepth: items.filter(item => (item.status === "RANKED" || item.status === "OUTSIDE_TOP100") && !item.depthIncomplete).length,
    partialRanked: items.filter(item => item.status === "RANKED" && item.depthIncomplete).length,
    buckets: [
      { key: "TOP_10", label: "前10", range: "1–10", color: "#10b981", min: 1, max: 10 },
      { key: "TOP_30", label: "前30", range: "11–30", color: "#3b82f6", min: 11, max: 30 },
      { key: "TOP_50", label: "前50", range: "31–50", color: "#f59e0b", min: 31, max: 50 },
      { key: "TOP_100", label: "前100", range: "51–100", color: "#f97316", min: 51, max: 100 },
    ].map(bucket => ({ ...bucket, count: items.filter(item => item.status === "RANKED" && item.rank != null && item.rank >= bucket.min && item.rank <= bucket.max).length })) };
}

export function serpRankSummary(result: SerpKeywordResult, searchVolume: number | null = null): RankSummary | null {
  if (result.status === "PENDING" && !result.runId) return null;
  const rankStatus = result.status === "RANKED" ? "ranked" : result.status === "OUTSIDE_TOP100" ? "outside_top100"
    : result.status === "FAILED" ? "failed" : result.status === "INCOMPLETE" ? "incomplete" : result.status === "QUEUED" ? "queued" : "pending";
  const bucket = result.rank == null ? "NOT_FOUND" : result.rank <= 10 ? "TOP_10" : result.rank <= 30 ? "TOP_30" : result.rank <= 50 ? "TOP_50" : "TOP_100";
  const comparable = result.status === "RANKED" || result.status === "OUTSIDE_TOP100";
  return { source: SERP_SOURCE, rank: result.rank, bucket, url: result.url, title: result.pages[0]?.title ?? null,
    rankStatus, checkedAt: result.checkedAt, dataDate: result.checkedAt, dataUpdatedAt: result.checkedAt,
    serpVerification: comparable ? "verified" : "unverified", searchVolume, previousRank: result.previousRank,
    rankDelta: comparable && result.rank != null && result.previousRank != null ? result.previousRank - result.rank : null,
    changed: ["UP", "DOWN", "NEW_IN_TOP100", "DROPPED_OUT"].includes(result.movement),
    runId: result.runId, providerTaskId: result.providerTaskId, googleUrl: result.googleUrl, errorCode: result.errorCode,
    periodKey: result.periodKey, periodLabel: result.periodLabel, previousPeriodKey: result.previousPeriodKey, previousPeriodLabel: result.previousPeriodLabel,
    previousRankStatus: result.previousRankStatus, previousCheckedAt: result.previousCheckedAt, movement: result.movement, depthIncomplete: result.depthIncomplete,
    runScope: result.runScope, runTargetCount: result.runTargetCount };
}

export function serpRankingEvidence(result: SerpKeywordResult): RankingEvidence | null {
  if (!result.checkedAt) return null;
  const checkedAt = result.checkedAt;
  const verified = result.status === "RANKED" || result.status === "OUTSIDE_TOP100";
  const context = { checkedAt, importedAt: null, dataDate: checkedAt, dataUpdatedAt: checkedAt,
    periodStart: null, periodEnd: null, serpVerification: verified ? "verified" as const : "unverified" as const };
  const pages: RankingPageEvidence[] = result.pages.map(page => ({ ...context, url: page.url, rank: page.rankGroup,
    rankGroup: page.rankGroup, rankAbsolute: page.rankAbsolute, clicks: null, impressions: null, ctr: null }));
  return { ...context, source: SERP_SOURCE, scope: "query", rank: result.rank,
    rankStatus: result.status === "RANKED" ? "ranked" : result.status === "OUTSIDE_TOP100" ? "outside_top100"
      : result.status === "FAILED" ? "failed" : result.status === "INCOMPLETE" ? "incomplete" : "no_data",
    url: result.url, pages, clicks: null, impressions: null, ctr: null,
    runId: result.runId, providerTaskId: result.providerTaskId, googleUrl: result.googleUrl,
    periodKey: result.periodKey, periodLabel: result.periodLabel, depthIncomplete: result.depthIncomplete,
    runScope: result.runScope, runTargetCount: result.runTargetCount };
}
