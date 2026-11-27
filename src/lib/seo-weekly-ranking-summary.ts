import type { GrowthTarget } from "./growth-types";
import { growthTargetId, growthWordKey } from "./growth-workspace";

const bands = [[1, 3], [4, 10], [11, 20], [21, 50], [51, 100]] as const;

type RankingCountry = { country: string; target: number; ranked: number };
type RankedWord = { rank: number };

export type WeeklyRankingSummary = {
  scope?: "all-keywords";
  total: number;
  ranked: number;
  verifiedOutside: number;
  unresolved: number;
  countries: RankingCountry[];
  bands: { from: number; to: number; count: number }[];
};

export function summarizeWeeklyRankings(
  countries: RankingCountry[], ranked: RankedWord[], verifiedOutside: number,
): WeeklyRankingSummary {
  const total = countries.reduce((sum, row) => sum + row.target, 0);
  return {
    total,
    ranked: ranked.length,
    verifiedOutside,
    unresolved: total - ranked.length - verifiedOutside,
    countries,
    bands: bands.map(([from, to]) => ({
      from, to, count: ranked.filter(row => row.rank >= from && row.rank <= to).length,
    })),
  };
}


export type WeeklyKeywordObservation = Pick<GrowthTarget, "site" | "keyword" | "country" | "language" | "rank"> & { checkedAt: string };

/** Overall totals count each original word once. Country rows use the catalog's
 * own market assignments, where the same original can belong to several markets. */
export function summarizeWeeklyKeywordCatalog(catalog: ReadonlyMap<string, { countries: string[] }>, targets: GrowthTarget[],
  observations: WeeklyKeywordObservation[]): WeeklyRankingSummary | undefined {
  const latest = new Map<string, WeeklyKeywordObservation>();
  for (const row of observations) {
    const key = growthTargetId(row.site, row.keyword, row.country, row.language);
    const previous = latest.get(key);
    if (!previous || row.checkedAt > previous.checkedAt
      || row.checkedAt === previous.checkedAt && (row.rank ?? 101) < (previous.rank ?? 101)) latest.set(key, row);
  }
  const words = new Map([...catalog.keys()].map(word => [word, { bestRank: null as number | null, checks: new Map<string, WeeklyKeywordObservation | undefined>() }]));
  const countries = new Map<string, { target: Set<string>; ranked: Set<string> }>();
  for (const [word, { countries: markets }] of catalog) {
    for (const country of markets.length ? markets : ["unknown"]) {
      const market = countries.get(country) ?? { target: new Set(), ranked: new Set() };
      market.target.add(word);
      countries.set(country, market);
    }
  }
  let matched = false;
  for (const row of targets) {
    const word = growthWordKey(row.keyword);
    const entry = words.get(word);
    if (!entry) continue;
    const key = growthTargetId(row.site, row.keyword, row.country, row.language);
    const market = row.country ? countries.get(row.country) : undefined;
    const observation = market?.target.has(word) && row.language ? latest.get(key) : undefined;
    entry.checks.set(key, observation);
    if (observation) matched = true;
    if (observation?.rank == null) continue;
    entry.bestRank = Math.min(observation.rank, entry.bestRank ?? Infinity);
    market?.ranked.add(word);
  }
  if (!matched) return undefined;
  const ranked: RankedWord[] = [];
  let verifiedOutside = 0;
  for (const [word, entry] of words) {
    if (entry.bestRank !== null) ranked.push({ rank: entry.bestRank });
    else if (entry.checks.size && [...entry.checks.values()].every(row => row?.rank === null)
      && catalog.get(word)!.countries.every(country => [...entry.checks.values()].some(row => row?.country === country))) verifiedOutside++;
  }
  const countryRows = [...countries].map(([country, rows]) => ({ country, target: rows.target.size, ranked: rows.ranked.size }))
    .sort((a, b) => Number(a.country === "unknown") - Number(b.country === "unknown") || b.target - a.target || a.country.localeCompare(b.country));
  return { ...summarizeWeeklyRankings(countryRows, ranked, verifiedOutside), scope: "all-keywords", total: words.size,
    unresolved: words.size - ranked.length - verifiedOutside };
}

export function weeklyKeywordCatalogLine(summary: WeeklyRankingSummary) {
  return `全部关键词 ${summary.total.toLocaleString("en-US")} 词，本期确认前 100 ${summary.ranked.toLocaleString("en-US")} 词（${(100 * summary.ranked / summary.total).toFixed(1)}%），确认前 100 外 ${summary.verifiedOutside.toLocaleString("en-US")} 词，待确认 ${summary.unresolved.toLocaleString("en-US")} 词。`;
}
