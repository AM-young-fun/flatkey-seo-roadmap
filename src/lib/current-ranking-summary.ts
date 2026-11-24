import type { GrowthTarget } from "./growth-types";
import { GROWTH_MARKETS, growthWordKey, reviewGrowthLanguage } from "./growth-workspace";
import { isOwnedBrandKeyword } from "./keyword-market-policy";

const time = (value: string | null) => value ? Date.parse(value) : NaN;
const compare = (a: GrowthTarget, b: GrowthTarget) => a.rank! - b.rank!
  || time(b.checkedAt) - time(a.checkedAt)
  || (a.country ?? "").localeCompare(b.country ?? "")
  || a.site.localeCompare(b.site) || a.id.localeCompare(b.id);

/** The server's exact/native eligibility is necessary but not a substitute for
 * freshness, original-language and URL checks in a saved/read-only projection. */
export function isCurrentNativeRanking(target: GrowthTarget, asOf: string): boolean {
  const now = Date.parse(asOf), sampled = time(target.checkedAt);
  if (!Number.isFinite(now) || !Number.isFinite(sampled) || sampled > now || now - sampled > 14 * 86400000
    || !target.rankEligible || target.rankSource !== "serp" || target.captureState !== "ranked"
    || target.languageStatus !== "match" || !target.country || !target.language
    || !Number.isInteger(target.rank) || target.rank! < 1 || target.rank! > 100
    || isOwnedBrandKeyword(target.keyword) || !growthWordKey(target.keyword)) return false;
  const market = GROWTH_MARKETS.find(market => market.country === target.country && market.language === target.language);
  if (!market) return false;
  // A saved explicit word-language proof wins over locale inference. Without
  // one, reuse the existing lexical/per-word classifier; neutral terms stay out.
  if (target.wordLanguage ? target.wordLanguage !== target.language
    : reviewGrowthLanguage(target.keyword, target.country, target.language).status !== "match") return false;
  try {
    const page = new URL(target.rankUrl ?? "");
    return page.protocol === "https:" && !page.username && !page.password && !page.port
      && [target.site, `www.${target.site}`].includes(page.hostname);
  } catch { return false; }
}

/** Count each normalized original word once globally, including cross-site
 * duplicates. Keep the best eligible observation's real country/URL/time;
 * never relabel a Japanese English capture as an American rank. */
export function currentRankingSummary(targets: GrowthTarget[], asOf: string) {
  const latestById = new Map<string, GrowthTarget>();
  for (const target of targets) {
    if (!isCurrentNativeRanking(target, asOf)) continue;
    const previous = latestById.get(target.id);
    if (!previous || time(target.checkedAt) > time(previous.checkedAt)
      || time(target.checkedAt) === time(previous.checkedAt) && compare(target, previous) < 0) latestById.set(target.id, target);
  }
  const combinations = [...latestById.values()];
  const grouped = new Map<string, GrowthTarget[]>();
  for (const target of combinations) {
    const key = growthWordKey(target.keyword);
    grouped.set(key, [...(grouped.get(key) ?? []), target]);
  }
  const words = [...grouped].sort(([a], [b]) => a.localeCompare(b)).map(([wordKey, rows]) => {
    const observations = [...rows].sort(compare);
    return { wordKey, keyword: observations[0].keyword, selected: observations[0], observations };
  });
  const selected = words.map(word => word.selected), total = words.length;
  const countries = [...new Set(selected.map(row => `${row.country}:${row.language}`))].map(key => {
    const rows = selected.filter(row => `${row.country}:${row.language}` === key);
    return { key, country: rows[0].country!, language: rows[0].language!, count: rows.length, share: total ? rows.length / total : null };
  }).sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
  const bands = [["1–10", 1, 10], ["11–30", 11, 30], ["31–50", 31, 50], ["51–100", 51, 100]].map(([label, min, max]) => {
    const count = selected.filter(row => row.rank! >= Number(min) && row.rank! <= Number(max)).length;
    return { label: String(label), min: Number(min), max: Number(max), count, share: total ? count / total : null };
  });
  return { total, words, selected, combinations, combinationCount: combinations.length,
    top50: selected.filter(row => row.rank! <= 50).length,
    formalWords: words.filter(word => word.observations.some(row => row.membership === "formal")).length,
    countries, bands, asOf, unit: "normalized_original_word" as const };
}
