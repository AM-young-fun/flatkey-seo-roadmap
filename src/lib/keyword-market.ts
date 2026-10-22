import type { DashboardKeyword } from "./types";
import type { SearchRegionCode } from "./seo";

const LANGUAGE_MARKETS: Record<string, SearchRegionCode> = {
  en: "US", english: "US", 英语: "US", 英文: "US",
  ja: "JP", japanese: "JP", 日本語: "JP", 日语: "JP", 日文: "JP",
  es: "ES", spanish: "ES", español: "ES", 西班牙语: "ES",
  pt: "BR", portuguese: "BR", português: "BR", 葡萄牙语: "BR", 葡语: "BR",
};

export function keywordTargetMarkets(keyword: Pick<DashboardKeyword, "text" | "sourceLanguages">): SearchRegionCode[] {
  // Kana is a strong Japanese signal, including half-width text after NFKC.
  // Latin brand/model names alone do not establish a target language.
  if (/[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(keyword.text.normalize("NFKC"))) return ["JP"];
  return [...new Set((keyword.sourceLanguages ?? []).flatMap(language => {
    const normalized = language.trim().toLowerCase().replace(/_/g, "-");
    const region = LANGUAGE_MARKETS[normalized] ?? LANGUAGE_MARKETS[normalized.split("-")[0]];
    return region ? [region] : [];
  }))];
}

export function hasKeywordMarketData(keyword: DashboardKeyword, region: SearchRegionCode): boolean {
  const volume = keyword.marketVolumes?.[region];
  return (volume != null && Number.isFinite(volume) && volume >= 0) ||
    Boolean(keyword.latestRanks[region]?.checkedAt || ["ranked", "outside_top100"].includes(keyword.latestRanks[region]?.rankStatus ?? "")) || Boolean(keyword.rankingEvidence?.[region]?.length);
}

export function keywordMatchesCountry(keyword: DashboardKeyword, country: "all" | SearchRegionCode, includeCrossLanguage = false): boolean {
  if (country === "all") return true;
  const targets = keywordTargetMarkets(keyword);
  if (!includeCrossLanguage && country !== "JP" && /[\p{Script=Han}\p{Script=Hangul}]/u.test(keyword.text)) return false;
  if (targets.includes(country)) return true;
  if (targets.length && !includeCrossLanguage) return false;
  // An unassigned global inventory item is not evidence of a US (or any other
  // country's) keyword. Keep it in the all-country inventory until measured.
  return hasKeywordMarketData(keyword, country);
}

export function keywordMarketVolume(members: DashboardKeyword[], region: SearchRegionCode): number | null {
  const values = members.flatMap(member => {
    const value = member.marketVolumes?.[region];
    return value != null && Number.isFinite(value) && value >= 0 ? [value] : [];
  });
  // The same query across websites has the same market demand; never sum it.
  return values.length ? Math.max(...values) : null;
}
