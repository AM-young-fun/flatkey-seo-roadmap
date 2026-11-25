import { createHash } from "node:crypto";
import { getApprovedKeywordReviewPlan, RUN_ID as FIRST_RUN, PERIOD_KEY as FIRST_PERIOD, MAX_COST_MICROS as FIRST_CAP,
  APPROVED_KEYWORD_REVIEW_SCOPE as FIRST_SCOPE, APPROVAL_QUOTE_SHA256 as FIRST_QUOTE } from "./approved-keyword-review";
import { getApprovedOtherKeywordReviewPlan, RUN_ID as OTHER_RUN, PERIOD_KEY as OTHER_PERIOD, MAX_COST_MICROS as OTHER_CAP,
  APPROVED_OTHER_KEYWORD_REVIEW_SCOPE as OTHER_SCOPE, QUOTE_SHA256 as OTHER_QUOTE } from "./approved-other-keyword-review";
import { providerIdIsSafe, serpQueryKey } from "./dataforseo-serp";

export type ApprovedWeeklyKeywordCaptureInput = { start: string; end: string; asOf?: Date };
export type ApprovedWeeklyKeywordPage = { title: string | null; url: string; rank: number; keywordId: string; keyword: string;
  country: string; checkedAt: string; reused: boolean; sourceRunId: string };
type Counts = { targetCount: number; newQueryCount: number; reusedQueryCount: number; capturedKeywords: number;
  rankedKeywords: number; verifiedOutsideTop100: number; unresolvedKeywords: number };
export type ApprovedWeeklyKeywordCapture = Counts & {
  runIds: string[]; window: { start: string; end: string; timeZone: "America/Los_Angeles"; asOf: string | null };
  sourceHash: string; complete: boolean; comparable: false;
  rankBuckets: { top10: number; rank11to30: number; rank31to50: number; rank51to100: number };
  countries: Array<Counts & { country: string; language: string }>;
  pages: ApprovedWeeklyKeywordPage[]; latestCheckedAt: string; notes: string[];
};
const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const first = getApprovedKeywordReviewPlan(), other = getApprovedOtherKeywordReviewPlan();
const fixed = [
  { id: FIRST_RUN, period: FIRST_PERIOD, scope: FIRST_SCOPE, quoteId: "keyword-fee-review-20261123-v1", quote: FIRST_QUOTE,
    namespace: "approvedKeywordReview", hash: first.queryHash, count: 1031, cap: FIRST_CAP },
  { id: OTHER_RUN, period: OTHER_PERIOD, scope: OTHER_SCOPE, quoteId: "other-country-query-proposal-v2", quote: OTHER_QUOTE,
    namespace: "approvedOtherKeywordReview", hash: other.queryHash, count: 467, cap: OTHER_CAP },
];
type Expected = { keywordId: string; keyword: string; country: string; language: string; sourceRunId: string; reused: boolean };
const expected: Expected[] = [
  ...first.queries.map(query => ({ keywordId: query.keywordId, keyword: query.keyword, country: query.region, language: query.language, sourceRunId: FIRST_RUN, reused: false })),
  ...other.queries.map(query => ({ keywordId: query.keywordId, keyword: query.keyword, country: query.region, language: query.language, sourceRunId: OTHER_RUN, reused: false })),
  ...other.reused.map(query => ({ keywordId: query.keywordId, keyword: query.keyword, country: query.region, language: query.language, sourceRunId: query.sourceRunId, reused: true })),
];
const wordKey = (country: string, keyword: string) => `${country}:${serpQueryKey(keyword)}`;
if (expected.length !== 1499 || new Set(expected.map(row => row.keywordId)).size !== 1499 || new Set(expected.map(row => serpQueryKey(row.keyword))).size !== 1499) {
  throw new Error("APPROVED_WEEKLY_CAPTURE_FROZEN_COHORT_MISMATCH");
}
function reject(reason: string): never { throw new Error(`APPROVED_WEEKLY_CAPTURE_${reason}`); }
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => [key, canonical(item)]));
  return value;
}
const stamp = (value: unknown) => {
  if (!(value instanceof Date || typeof value === "string")) return null;
  const time = new Date(value); return Number.isFinite(+time) ? time.toISOString() : null;
};
const laDate = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" });
const laDay = (value: string) => laDate.format(new Date(value));
function validateWindow(input: ApprovedWeeklyKeywordCaptureInput) {
  const valid = (day: string) => /^\d{4}-\d{2}-\d{2}$/.test(day) && stamp(day)?.slice(0, 10) === day;
  if (!valid(input.start) || !valid(input.end) || input.start > input.end || input.asOf && !stamp(input.asOf)) reject("INVALID_WINDOW");
}
export function approvedWeeklyCaptureRunIds() { return fixed.map(run => run.id); }

/** Immutable identity only: UNKNOWN does not erase already verified, paid receipts. */
function verifySnapshot(value: unknown, metadata: unknown[], index: number) {
  const snapshot = record(value), definition = fixed[index], run = record(snapshot.run);
  if (snapshot.runId !== definition.id || snapshot.scope !== definition.scope || snapshot.quoteId !== definition.quoteId ||
    snapshot.approved !== true || snapshot.queryCount !== definition.count || snapshot.maxCostMicros !== definition.cap || !Array.isArray(snapshot.items)) reject("SNAPSHOT_IDENTITY_MISMATCH");
  if (index === 1 && (snapshot.quoteSha256 !== definition.quote || snapshot.totalKeywordCount !== 468 || snapshot.reuseCount !== 1)) reject("SNAPSHOT_APPROVAL_MISMATCH");
  if (snapshot.run !== null) {
    const matches = metadata.map(record).filter(row => row.id === definition.id);
    if (matches.length !== 1) reject("RUN_METADATA_MISSING");
    const saved = matches[0], approval = record(record(saved.configJson)[definition.namespace]);
    if (saved.scope !== definition.scope || saved.periodKey !== definition.period || saved.cohortHash !== definition.hash ||
      saved.targetCount !== definition.count || saved.queryCount !== definition.count || saved.estimatedCostMicros !== definition.cap || saved.reservedCostMicros !== definition.cap ||
      approval.quoteSha256 !== definition.quote || approval.queryHash !== definition.hash || approval.userApproved !== true) reject("RUN_METADATA_IDENTITY_MISMATCH");
  }
  const cohort = expected.filter(row => index === 0 ? row.sourceRunId === FIRST_RUN : row.sourceRunId === OTHER_RUN || row.reused);
  const byKey = new Map(cohort.map(row => [wordKey(row.country, row.keyword), row])), rows = new Map<string, Record<string, unknown>>();
  for (const value of snapshot.items) {
    const row = record(value), key = typeof row.country === "string" && typeof row.keyword === "string" ? wordKey(row.country, row.keyword) : "";
    const original = byKey.get(key);
    if (!original || original.keyword !== row.keyword || row.keywordId !== undefined && row.keywordId !== original.keywordId ||
      index === 1 && row.keywordId !== original.keywordId || row.reused !== undefined && row.reused !== original.reused ||
      row.language !== undefined && row.language !== original.language ||
      row.sourceRunId !== undefined && row.sourceRunId !== original.sourceRunId || rows.has(key)) reject("TASK_IDENTITY_MISMATCH");
    // A getter that saw no run cannot borrow a ledger created later during the
    // metadata read. Its explicitly reused original receipt stays independent.
    if (snapshot.run === null && !original.reused) continue;
    rows.set(key, row);
  }
  return { run, exists: snapshot.run !== null, rows };
}

/** Pure normalization for two approved manifests. Never compares legacy cohorts. */
export function buildApprovedWeeklyKeywordCapture(input: ApprovedWeeklyKeywordCaptureInput,
  snapshots: { first: unknown; other: unknown }, metadata: unknown[]): ApprovedWeeklyKeywordCapture | null {
  validateWindow(input);
  const sources = [verifySnapshot(snapshots.first, metadata, 0), verifySnapshot(snapshots.other, metadata, 1)];
  const asOf = input.asOf ? stamp(input.asOf)! : null;
  const observations = expected.map(original => {
    const source = sources[original.sourceRunId === FIRST_RUN ? 0 : 1], row = source.rows.get(wordKey(original.country, original.keyword));
    const checkedAt = stamp(row?.checkedAt), inWindow = checkedAt !== null && laDay(checkedAt) >= input.start && laDay(checkedAt) <= input.end && (!asOf || checkedAt <= asOf);
    const captured = Boolean(inWindow && row && ["COMPLETE", "INCOMPLETE"].includes(String(row.state)) && providerIdIsSafe(row.providerTaskId) && row.captureComplete === true);
    const verified = captured && row?.queryStatus === "EXACT" && row.rankingVerified === true;
    const byUrl = new Map<string, ApprovedWeeklyKeywordPage>();
    if (verified) for (const value of Array.isArray(row?.pages) ? row.pages : []) {
      const page = record(value), rank = page.rank;
      try {
        const url = new URL(String(page.url));
        if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.port ||
          !(url.hostname === "flatkey.ai" || url.hostname.endsWith(".flatkey.ai")) || typeof rank !== "number" || !Number.isInteger(rank) || rank < 1 || rank > 100) continue;
        const item = { ...original, title: typeof page.title === "string" && page.title.trim() ? page.title : null, url: url.href, rank, checkedAt: checkedAt! };
        if (!byUrl.has(item.url) || byUrl.get(item.url)!.rank > rank) byUrl.set(item.url, item);
      } catch { /* Invalid saved page evidence stays unresolved. */ }
    }
    const pages = [...byUrl.values()].sort((a, b) => a.rank - b.rank || a.url.localeCompare(b.url));
    const ranked = pages.length > 0, outside = Boolean(verified && row?.completeDepth === true && row.organicCount === 100 && row.coveredThroughRank === 100 && !ranked);
    return { ...original, state: typeof row?.state === "string" ? row.state : null, checkedAt: inWindow ? checkedAt : null,
      providerTaskId: inWindow && typeof row?.providerTaskId === "string" ? row.providerTaskId : null,
      captured, ranked, outside, pages, queryStatus: inWindow ? row?.queryStatus ?? null : null,
      captureComplete: inWindow ? row?.captureComplete ?? null : null, rankingVerified: inWindow ? row?.rankingVerified ?? null : null,
      completeDepth: inWindow ? row?.completeDepth ?? null : null, organicCount: inWindow ? row?.organicCount ?? null : null,
      coveredThroughRank: inWindow ? row?.coveredThroughRank ?? null : null };
  });
  if (!observations.some(row => row.captured)) return null;
  const counts = (rows: typeof observations): Counts => ({ targetCount: rows.length, newQueryCount: rows.filter(row => !row.reused).length,
    reusedQueryCount: rows.filter(row => row.reused).length, capturedKeywords: rows.filter(row => row.captured).length,
    rankedKeywords: rows.filter(row => row.ranked).length, verifiedOutsideTop100: rows.filter(row => row.outside).length,
    unresolvedKeywords: rows.filter(row => !row.ranked && !row.outside).length });
  const totals = counts(observations), countries = ["US", "JP", "ES", "BR", "CN"].map(country => {
    const rows = observations.filter(row => row.country === country); return { country, language: rows[0].language, ...counts(rows) };
  });
  const pages = observations.flatMap(row => row.pages).sort((a, b) => a.rank - b.rank || a.country.localeCompare(b.country) || a.keywordId.localeCompare(b.keywordId) || a.url.localeCompare(b.url));
  const bestRanks = new Map<string, number>();
  for (const page of pages) bestRanks.set(page.keywordId, Math.min(bestRanks.get(page.keywordId) ?? Infinity, page.rank));
  const ranks = [...bestRanks.values()], rankBuckets = { top10: ranks.filter(rank => rank <= 10).length,
    rank11to30: ranks.filter(rank => rank >= 11 && rank <= 30).length,
    rank31to50: ranks.filter(rank => rank >= 31 && rank <= 50).length,
    rank51to100: ranks.filter(rank => rank >= 51 && rank <= 100).length };
  const dates = observations.filter(row => row.captured).map(row => row.checkedAt!).sort();
  const complete = sources.every((source, index) => source.exists && source.run.status === "COMPLETED" && stamp(source.run.completedAt) &&
    (!asOf || stamp(source.run.completedAt)! <= asOf) && record(source.run.taskCounts).COMPLETE === fixed[index].count) && totals.capturedKeywords === 1499;
  const window = { start: input.start, end: input.end, timeZone: "America/Los_Angeles" as const, asOf };
  const evidence = { version: 1, window, definitions: fixed.map(({ id, scope, quote, hash }) => ({ id, scope, quoteSha256: quote, queryHash: hash })),
    runs: sources.map((source, index) => ({ runId: fixed[index].id, exists: source.exists,
      status: source.run.status ?? null, completedAt: stamp(source.run.completedAt), taskCounts: source.run.taskCounts ?? null })), observations };
  const sourceHash = createHash("sha256").update(JSON.stringify(canonical(evidence))).digest("hex");
  const notes = [
    `本周DataForSEO固定目标词核查：清单1499个非品牌原词，1498次新查询＋1个明确复用；已取得本期真实采集回执${totals.capturedKeywords}词，查到前100排名${totals.rankedKeywords}词，完整Top100核实未命中${totals.verifiedOutsideTop100}词，未确认${totals.unresolvedKeywords}词。`,
    `实际采集日期${[...new Set(dates.map(laDay))].join("、")}（America/Los_Angeles）；${complete ? "两批查询回执已齐，采集完成不等于所有词都能确认排名。" : "两批或本周覆盖尚未全部齐，当前只计已核验回执。"}`,
    ...countries.map(row => `${row.country} · 本批目标${row.targetCount}词（新查${row.newQueryCount}、复用${row.reusedQueryCount}）；本期回执${row.capturedKeywords}，有排名${row.rankedKeywords}，完整Top100核实未命中${row.verifiedOutsideTop100}，未确认${row.unresolvedKeywords}。`),
    "CN16词仅为本次已批准的中文查询环境；467词补采含中性词的一次性查询环境例外，不认定中性词为当地语言，不更改原主国家或原四国流量主表。",
    "短结果未命中、搜索词被改写、在途或缺失回执均未计作无排名；本期固定词库结果不等于全站全部排名词数，不与旧四国广播词池计算环比或把首次查到记为排名增长。",
  ];
  const used = new Set<string>();
  for (const page of pages.filter(page => page.url.startsWith("https://"))) {
    if (used.has(page.keywordId)) continue;
    used.add(page.keywordId);
    notes.push(`排名例证：${page.title ?? page.keyword} · 原词${page.keyword} · ${page.country}第${page.rank}名 · ${page.url} · LA ${laDay(page.checkedAt)}。`);
    if (used.size === 5) break;
  }
  for (const row of observations.filter(row => row.reused && row.captured)) {
    notes.push(`明确复用：${row.keyword} · ${row.country}${row.ranked ? `第${row.pages[0].rank}名` : "排名尚未确认"} · 原回执${row.checkedAt} · 来源${row.sourceRunId}${row.pages[0] ? ` · ${row.pages[0].url}` : ""}；本次未重复付费。`);
  }
  return { ...totals, runIds: fixed.map(run => run.id), window, sourceHash, complete, comparable: false,
    countries, pages, rankBuckets, latestCheckedAt: dates.at(-1)!, notes };
}


export function approvedCaptureRankedWords(capture: ApprovedWeeklyKeywordCapture) {
  const languages = new Map(capture.countries.map(country => [country.country, country.language]));
  const words = new Map<string, { keywordId: string; keyword: string; country: string; language: string | null; checkedAt: string;
    bestRank: number; reused: boolean; pages: { url: string; title: string | null; rank: number }[] }>();
  // The source sorts pages by rank and validates each keyword against the fixed manifest.
  for (const page of capture.pages) {
    const { keywordId, keyword, country, checkedAt, reused, url, title, rank } = page;
    const word = words.get(keywordId) ?? { keywordId, keyword, country, checkedAt, reused,
      language: languages.get(country) ?? null, bestRank: rank, pages: [] };
    word.pages.push({ url, title, rank });
    words.set(keywordId, word);
  }
  return [...words.values()];
}

export type ApprovedCaptureRankedWord = ReturnType<typeof approvedCaptureRankedWords>[number];
