import { createHash } from "node:crypto";
import { z } from "zod";
import { isOwnedBrandKeyword } from "./keyword-market-policy";

export const COVERAGE_COUNTRIES = ["US", "JP", "ES", "BR"] as const;
type Country = typeof COVERAGE_COUNTRIES[number];
const locales = { US: "en", JP: "ja", ES: "es", BR: "pt" } as const;
const locations = { US: 2840, JP: 2392, ES: 2724, BR: 2076 } as const;
export type CoverageSelection = { siteDomain: "flatkey.ai"; periodKey: string; runIds: string[] };
export type SavedRankingRun = { requestId: string; siteDomain: string; status: string; normalized: unknown;
  collectedAt: Date | null; completedAt: Date | null };
const runPattern = /^discovery-(\d{4}-\d{2}-\d{2})-flatkey-ai-(US|JP|ES|BR)$/;
export function coverageSelection(params: URLSearchParams): CoverageSelection {
  if ([...params.keys()].some(key => !["site", "periodKey", "runId"].includes(key)) || params.getAll("site").length > 1
    || params.has("site") && params.get("site") !== "flatkey.ai") throw Error("INVALID_COVERAGE_QUERY");
  const periods = params.getAll("periodKey"), explicit = params.getAll("runId");
  if (periods.length === 1 && !explicit.length && z.iso.date().safeParse(periods[0]).success) {
    return { siteDomain: "flatkey.ai", periodKey: periods[0], runIds: COVERAGE_COUNTRIES.map(country => `discovery-${periods[0]}-flatkey-ai-${country}`) };
  }
  const matches = explicit.map(id => runPattern.exec(id));
  if (periods.length || explicit.length !== 4 || matches.some(match => !match) || new Set(explicit).size !== 4) throw Error("INVALID_COVERAGE_QUERY");
  const periodKey = matches[0]![1];
  if (!z.iso.date().safeParse(periodKey).success || matches.some(match => match![1] !== periodKey)
    || new Set(matches.map(match => match![2])).size !== 4) throw Error("MIXED_COVERAGE_PERIODS");
  return { siteDomain: "flatkey.ai", periodKey, runIds: COVERAGE_COUNTRIES.map(country => `discovery-${periodKey}-flatkey-ai-${country}`) };
}
const snapshotSchema = z.object({ schemaVersion: z.literal(1), source: z.literal("dataforseo_labs"), datasetType: z.literal("provider_ranked_keywords_snapshot"),
  runId: z.string(), targetDomain: z.literal("flatkey.ai"), region: z.enum(COVERAGE_COUNTRIES), languageCode: z.string(),
  collectedAt: z.iso.datetime({ offset: true }), requestedLimit: z.number().int().nonnegative(), returnedItems: z.number().int().nonnegative(),
  totalMatchingCount: z.number().int().nonnegative(), truncated: z.boolean(), rows: z.array(z.unknown()),
  rejectedItems: z.array(z.object({ reason: z.string() }).passthrough()),
});
const observationSchema = z.object({ source: z.literal("dataforseo_labs"), keyword: z.string().min(1), rawKeyword: z.string().min(1),
  region: z.enum(COVERAGE_COUNTRIES), locationCode: z.number().int(), languageCode: z.string(), rank_group: z.number().int().min(1).max(100),
  url: z.url(), title: z.string().nullable(), sourceSerpUpdatedAt: z.string().nullable(), collectedAt: z.iso.datetime({ offset: true }),
});
const normalize = (value: string) => value.normalize("NFKC").replace(/\s+/gu, " ").trim().toLowerCase();
type Observation = { keyword: string; rawKeyword: string; country: Country; requestLocale: string; rank: number; url: string; title: string | null;
  collectedAt: string; sourceSerpUpdatedAt: string | null; indexAgeDaysAtCollection: number | null; hostScope: "public_website" | "other_flatkey_subdomain" };
const rankBands = (ranks: number[]) => ({ top3: ranks.filter(rank => rank <= 3).length, rank4to10: ranks.filter(rank => rank >= 4 && rank <= 10).length,
  rank11to20: ranks.filter(rank => rank >= 11 && rank <= 20).length, rank21to100: ranks.filter(rank => rank >= 21 && rank <= 100).length });
function distinctItems(rows: Observation[]) {
  const byWord = new Map<string, Observation[]>();
  for (const row of rows) byWord.set(row.keyword, [...(byWord.get(row.keyword) ?? []), row]);
  return [...byWord].map(([keyword, observations]) => {
    const ordered = observations.sort((a, b) => a.rank - b.rank || COVERAGE_COUNTRIES.indexOf(a.country) - COVERAGE_COUNTRIES.indexOf(b.country) || a.url.localeCompare(b.url));
    const best = ordered[0];
    return { keyword, rawKeywords: [...new Set(ordered.map(row => row.rawKeyword))], bestRank: best.rank, bestObservedCountry: best.country, bestUrl: best.url,
      bestCountries: [...new Set(ordered.filter(row => row.rank === best.rank).map(row => row.country))],
      countries: COVERAGE_COUNTRIES.filter(country => ordered.some(row => row.country === country)), observations: ordered,
      wordLanguageStatus: "not_reviewed" as const, primaryCountryAssigned: false as const };
  }).sort((a, b) => a.bestRank - b.bestRank || a.keyword.localeCompare(b.keyword));
}

/** Saved normalized rows only: no formal-pool filters, writes or provider calls. */
export function summarizeSavedRankings(selection: CoverageSelection, runs: SavedRankingRun[], now = new Date()) {
  const all: Observation[] = [], countries = COVERAGE_COUNTRIES.map(country => {
    const requestId = `discovery-${selection.periodKey}-flatkey-ai-${country}`, candidates = runs.filter(run => run.requestId === requestId);
    const run = candidates.length === 1 ? candidates[0] : undefined, parsed = snapshotSchema.safeParse(run?.normalized), issues: string[] = [];
    if (!run) issues.push(candidates.length ? "DUPLICATE_RUN_ID" : "RUN_MISSING");
    if (run?.status !== "COMPLETED") issues.push("RUN_NOT_COMPLETED");
    if (run && run.siteDomain !== "flatkey.ai") issues.push("RUN_DOMAIN_MISMATCH");
    if (!parsed.success) issues.push("NORMALIZED_SNAPSHOT_MISSING_OR_INVALID");
    const snapshot = parsed.success ? parsed.data : null;
    if (snapshot && (snapshot.runId !== requestId || snapshot.region !== country || snapshot.languageCode !== locales[country])) issues.push("SNAPSHOT_SCOPE_MISMATCH");
    if (snapshot && Date.parse(snapshot.collectedAt) > now.getTime() + 300000) issues.push("COLLECTION_DATE_IN_FUTURE");
    const scopeValid = run?.status === "COMPLETED" && run.siteDomain === "flatkey.ai" && snapshot && !issues.length;
    const rows: Observation[] = []; let invalidRows = 0;
    if (scopeValid && snapshot) for (const raw of snapshot.rows) {
      const parsedRow = observationSchema.safeParse(raw);
      if (!parsedRow.success) { invalidRows++; continue; }
      const row = parsedRow.data, url = new URL(row.url), word = normalize(row.rawKeyword);
      if (!word || word !== normalize(row.keyword) || row.region !== country || row.languageCode !== locales[country] || row.locationCode !== locations[country]
        || Date.parse(row.collectedAt) !== Date.parse(snapshot.collectedAt)
        || !["http:", "https:"].includes(url.protocol) || url.username || url.password || url.port || !(url.hostname === "flatkey.ai" || url.hostname.endsWith(".flatkey.ai"))) { invalidRows++; continue; }
      const indexAt = row.sourceSerpUpdatedAt && Number.isFinite(Date.parse(row.sourceSerpUpdatedAt)) ? new Date(row.sourceSerpUpdatedAt).toISOString() : null;
      rows.push({ keyword: word, rawKeyword: row.rawKeyword, country, requestLocale: row.languageCode, rank: row.rank_group, url: row.url, title: row.title,
        collectedAt: row.collectedAt, sourceSerpUpdatedAt: indexAt, indexAgeDaysAtCollection: indexAt ? Math.floor((Date.parse(row.collectedAt) - Date.parse(indexAt)) / 86400000) : null,
        hostScope: ["flatkey.ai", "www.flatkey.ai"].includes(url.hostname) ? "public_website" : "other_flatkey_subdomain" });
    }
    const nonbrand = rows.filter(row => !isOwnedBrandKeyword(row.keyword)), countryItems = distinctItems(nonbrand);
    const countsConsistent = snapshot !== null && snapshot.returnedItems <= snapshot.requestedLimit && snapshot.totalMatchingCount >= snapshot.returnedItems
      && snapshot.rows.length + snapshot.rejectedItems.length === snapshot.returnedItems;
    const pageComplete = Boolean(scopeValid && snapshot && countsConsistent && !snapshot.truncated && snapshot.totalMatchingCount === snapshot.returnedItems);
    if (snapshot && !countsConsistent) issues.push("ITEM_COUNTS_INCONSISTENT");
    if (snapshot && (snapshot.truncated || snapshot.totalMatchingCount > snapshot.returnedItems)) issues.push("PROVIDER_RESULTS_TRUNCATED");
    if (invalidRows) issues.push("INVALID_NORMALIZED_ROWS");
    if (snapshot?.rejectedItems.some(row => row.reason !== "duplicate_observation")) issues.push("REJECTED_PROVIDER_ITEMS");
    all.push(...rows);
    return { country, requestId, status: run?.status ?? null, requestLocale: locales[country], originalWordLanguageVerified: false,
      collectedAt: snapshot?.collectedAt ?? null, databaseCollectedAt: run?.collectedAt?.toISOString() ?? null, completedAt: run?.completedAt?.toISOString() ?? null,
      returnedItems: snapshot?.returnedItems ?? null, totalMatchingCount: snapshot?.totalMatchingCount ?? null, truncated: snapshot?.truncated ?? null,
      storedNormalizedRows: snapshot?.rows.length ?? null, validNormalizedRows: rows.length, invalidNormalizedRows: invalidRows,
      rejectedProviderItems: snapshot?.rejectedItems.length ?? null, rawDistinctKeywords: scopeValid ? new Set(rows.map(row => row.keyword)).size : null,
      nonBrandDistinctKeywords: scopeValid ? countryItems.length : null, ownBrandObservationsExcluded: rows.length - nonbrand.length,
      rankBandsExclusive: scopeValid ? rankBands(countryItems.map(row => row.bestRank)) : null, providerPageComplete: pageComplete,
      complete: pageComplete && !issues.length, issues, snapshotHash: snapshot ? createHash("sha256").update(JSON.stringify(run!.normalized)).digest("hex") : null };
  });
  const nonbrand = all.filter(row => !isOwnedBrandKeyword(row.keyword)), items = distinctItems(nonbrand), brand = distinctItems(all.filter(row => isOwnedBrandKeyword(row.keyword)));
  const dates = all.flatMap(row => row.sourceSerpUpdatedAt ? [row.sourceSerpUpdatedAt] : []).sort();
  const availableCountries = countries.filter(country => country.rawDistinctKeywords !== null);
  return { schemaVersion: 1, source: "saved_dataforseo_labs_normalized", siteDomain: "flatkey.ai", periodKey: selection.periodKey,
    readOnly: true, newPaidRequests: 0, newCostMicros: 0, generatedAt: now.toISOString(), complete: countries.every(row => row.complete), countries,
    availableCountryCount: availableCountries.length, unavailableCountries: countries.filter(country => country.rawDistinctKeywords === null).map(country => country.country),
    scope: { savedDomainScope: "flatkey.ai_and_all_subdomains", publicWebsiteHosts: ["flatkey.ai", "www.flatkey.ai"], realTimeSerpFetch: false,
      formalInventoryFilterApplied: false, originalWordLanguageFilterApplied: false, originalWordLanguageReviewComplete: false,
      strictNativeLanguageMatchedDistinctKeywordCount: null, note: "原始数据库非自有品牌去重，未按原词语种筛选；请求locale不是原词语言；最佳国家只供展示，不写主国分配。" },
    totals: { returnedItems: countries.reduce((sum, row) => sum + (row.returnedItems ?? 0), 0), validNormalizedRows: all.length,
      rawDistinctKeywords: availableCountries.length ? new Set(all.map(row => row.keyword)).size : null, rawNonBrandDistinctKeywords: availableCountries.length ? items.length : null,
      sumOfCountryNonBrandDistinctKeywords: countries.reduce((sum, row) => sum + (row.nonBrandDistinctKeywords ?? 0), 0),
      ownBrandObservationsExcluded: all.length - nonbrand.length, ownBrandDistinctKeywordsExcluded: brand.length,
      publicWebsiteNonBrandDistinctKeywords: new Set(nonbrand.filter(row => row.hostScope === "public_website").map(row => row.keyword)).size,
      otherSubdomainObservations: nonbrand.filter(row => row.hostScope === "other_flatkey_subdomain").length },
    rankBandsExclusive: rankBands(items.map(row => row.bestRank)), top10Inclusive: items.filter(row => row.bestRank <= 10).length,
    indexFreshness: { realTime: false, oldestSourceSerpUpdatedAt: dates[0] ?? null, newestSourceSerpUpdatedAt: dates.at(-1) ?? null,
      observationsWithoutIndexDate: all.filter(row => !row.sourceSerpUpdatedAt).length },
    bestCountryTieBreak: "US,JP,ES,BR (display only)", items, excludedOwnBrandItems: brand };
}
