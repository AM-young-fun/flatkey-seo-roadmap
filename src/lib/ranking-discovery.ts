import { keywordRelevance, normalizeKeywordText } from "./keyword-relevance";
import type { DataForSeoNormalized, DataForSeoObservation } from "./dataforseo-labs.cjs";
import type { SearchRegionCode } from "./seo";
import type { RankingDiscoveryPage, RankingDiscoveryResponse, RankingDiscoveryRow } from "./ranking-discovery-types";

export type DiscoveryMembership = {
  keywordId: string; active: boolean; pool: string; keyword: { text: string; active: boolean };
  excludedAt?: string | Date | null; reviewStatus?: string;
};
const iso = (value: unknown): string | null => typeof value === "string" && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
const time = (value: string | null) => value ? Date.parse(value) : 0;
// A homepage match is not evidence that an unrelated-looking phrase is a
// genuine brand alias. Preserve the provider observation for explicit review.
const discoveryIntentReview = new Map([
  ["plan key", "查询未明确指向 Flatkey、AI API 或 GPU；仅返回首页不足以确认它是品牌变体，保留排名证据并待业务意图核实。"],
]);
const targetUrl = (value: unknown): value is string => {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password && !url.port
      && (url.hostname === "flatkey.ai" || url.hostname.endsWith(".flatkey.ai"));
  } catch { return false; }
};
function prefer(row: Pick<RankingDiscoveryPage, "rank" | "url" | "sourceSerpUpdatedAt">, prior: Pick<RankingDiscoveryPage, "rank" | "url" | "sourceSerpUpdatedAt">) {
  return time(row.sourceSerpUpdatedAt) > time(prior.sourceSerpUpdatedAt)
    || (time(row.sourceSerpUpdatedAt) === time(prior.sourceSerpUpdatedAt)
      && (row.rank < prior.rank || (row.rank === prior.rank && row.url.localeCompare(prior.url) < 0)));
}

/** Read the cached discovery dataset independently of the formal OKR cohort. No inventory writes. */
export function buildRankingDiscovery(snapshot: DataForSeoNormalized | null, memberships: DiscoveryMembership[], site: string, region: SearchRegionCode): RankingDiscoveryResponse {
  const result: RankingDiscoveryResponse = {
    available: false, reason: "NO_SNAPSHOT", requested: { site, region }, snapshot: null, rows: [],
    stats: { uniqueDiscoveredKeywords: 0, uniqueBusinessKeywords: 0, intentReview: 0,
      returnedItems: 0, filteredUnrelated: 0, policyExcluded: 0,
      formal: 0, research: 0, newCandidates: 0, ambiguous: 0, buckets: [0, 0, 0, 0] },
    brandCoverage: { formalTerms: 0, returnedTerms: 0, unobservedTerms: [] },
  };
  // The approved collector is Flatkey US/en only. Never reuse this snapshot for
  // another site or region, or turn their unobserved status into a zero rank.
  if ((site !== "all" && site !== "flatkey.ai") || region !== "US") {
    result.reason = "OUT_OF_SCOPE"; return result;
  }
  if (!snapshot) return result;
  const collectedAt = iso(snapshot.collectedAt);
  if (snapshot.source !== "dataforseo_labs" || snapshot.targetDomain !== "flatkey.ai" || snapshot.region !== "US"
    || snapshot.languageCode !== "en" || !collectedAt || !Array.isArray(snapshot.rows) || snapshot.realTimeSerpFetch !== false) {
    result.reason = "INVALID_SNAPSHOT"; return result;
  }
  const eligible = memberships.filter(row => row.active && row.keyword.active && !row.excludedAt
    && !["EXCLUDED", "MANUALLY_ARCHIVED", "MERGED"].includes(row.reviewStatus ?? "") && ["FORMAL", "RESEARCH"].includes(row.pool)
    && keywordRelevance("flatkey.ai", row.keyword.text).status !== "unrelated");
  const knownTexts = new Set(memberships.map(row => normalizeKeywordText(row.keyword.text)));
  const groups = new Map<string, DiscoveryMembership[]>();
  for (const row of eligible) {
    const key = normalizeKeywordText(row.keyword.text);
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  const words = new Map<string, { pages: Map<string, RankingDiscoveryPage>; best: DataForSeoObservation }>();
  const policyExcluded = new Set<string>();
  for (const observation of snapshot.rows) {
    if (!observation || typeof observation.keyword !== "string" || !normalizeKeywordText(observation.keyword)
      || observation.region !== "US" || observation.languageCode !== "en" || !targetUrl(observation.url)
      || !Number.isInteger(observation.rank_group) || observation.rank_group < 1 || observation.rank_group > 100) {
      // A malformed cached result must not silently produce a lower coverage.
      result.reason = "INVALID_SNAPSHOT"; return result;
    }
    if (keywordRelevance("flatkey.ai", observation.keyword).status === "unrelated") {
      result.stats.filteredUnrelated++; continue;
    }
    const key = normalizeKeywordText(observation.keyword);
    // Existing archived, merged, inactive or manually excluded words stay out.
    // A valid canonical identity can still represent its inactive merged alias.
    if (knownTexts.has(key) && !groups.has(key)) { policyExcluded.add(key); continue; }
    const page: RankingDiscoveryPage = { url: observation.url, rank: observation.rank_group,
      rankAbsolute: observation.rank_absolute, title: observation.title, sourceSerpUpdatedAt: iso(observation.sourceSerpUpdatedAt),
      collectedAt, checkUrl: observation.checkUrl };
    const current = words.get(key);
    if (!current) words.set(key, { pages: new Map([[page.url, page]]), best: observation });
    else {
      const priorPage = current.pages.get(page.url);
      if (!priorPage || prefer(page, priorPage)) current.pages.set(page.url, page);
      const prior = { rank: current.best.rank_group, url: current.best.url, sourceSerpUpdatedAt: iso(current.best.sourceSerpUpdatedAt) };
      if (prefer(page, prior)) current.best = observation;
    }
  }
  const rows: RankingDiscoveryRow[] = [...words].map(([keyword, value]): RankingDiscoveryRow => {
    const links = groups.get(keyword) ?? [], only = links.length === 1 ? links[0] : null;
    const policy = keywordRelevance("flatkey.ai", keyword), reviewReason = discoveryIntentReview.get(keyword)
      ?? (policy.status === "review" ? policy.reason : null);
    const relevance = reviewReason ? "review" : "relevant";
    const pool = reviewReason || links.length > 1 ? "AMBIGUOUS" : only ? only.pool as "FORMAL" | "RESEARCH" : "NEW_CANDIDATE";
    const pages = [...value.pages.values()].sort((a, b) => time(b.sourceSerpUpdatedAt) - time(a.sourceSerpUpdatedAt) || a.rank - b.rank || a.url.localeCompare(b.url));
    return { keyword, keywordId: only?.keywordId ?? null, pool, relevance, reviewReason,
      rank: value.best.rank_group, url: value.best.url,
      title: value.best.title, sourceSerpUpdatedAt: iso(value.best.sourceSerpUpdatedAt), collectedAt,
      volume: value.best.volume, pages };
  }).sort((a, b) => a.rank - b.rank || a.keyword.localeCompare(b.keyword));
  const sourceDates = snapshot.rows.map(row => iso(row.sourceSerpUpdatedAt)).filter((value): value is string => value !== null).sort();
  result.snapshot = { runId: snapshot.runId, siteDomain: "flatkey.ai", region: "US", languageCode: "en", collectedAt,
    sourceSerpDateMin: sourceDates[0] ?? null, sourceSerpDateMax: sourceDates.at(-1) ?? null,
    requestedLimit: snapshot.requestedLimit, returnedItems: snapshot.returnedItems, totalMatchingCount: snapshot.totalMatchingCount,
    truncated: snapshot.truncated, realTimeSerpFetch: false };
  result.rows = rows;
  result.stats.returnedItems = snapshot.returnedItems;
  result.stats.policyExcluded = policyExcluded.size;
  result.stats.uniqueDiscoveredKeywords = rows.length;
  for (const row of rows) {
    result.stats[row.pool === "FORMAL" ? "formal" : row.pool === "RESEARCH" ? "research" : row.pool === "NEW_CANDIDATE" ? "newCandidates" : "ambiguous"]++;
    if (row.relevance === "review") { result.stats.intentReview++; continue; }
    result.stats.uniqueBusinessKeywords++;
    result.stats.buckets[row.rank <= 10 ? 0 : row.rank <= 30 ? 1 : row.rank <= 50 ? 2 : 3]++;
  }
  const formalBrands = new Set(eligible.filter(row => row.pool === "FORMAL" && /flat\s?key/u.test(normalizeKeywordText(row.keyword.text))).map(row => normalizeKeywordText(row.keyword.text)));
  result.brandCoverage = { formalTerms: formalBrands.size, returnedTerms: [...formalBrands].filter(word => words.has(word)).length,
    unobservedTerms: [...formalBrands].filter(word => !words.has(word)).sort() };
  result.available = true; result.reason = null;
  return result;
}
