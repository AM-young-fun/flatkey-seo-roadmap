import type { DashboardKeyword } from "./types";
import { REGION_CODES, type SearchRegionCode } from "./seo";
import { groupKeywordDetails, scopeKeywordDetails, keywordDetailCountryRanks } from "./keyword-details-group";
import { keywordMarketVolume } from "./keyword-market";

export function keywordGraphVolume(keyword: DashboardKeyword, region: "all" | SearchRegionCode) {
  const regions = region === "all" ? REGION_CODES : [region];
  const values = regions.flatMap(code => {
    const value = keywordMarketVolume([keyword], code);
    return value == null ? [] : [value];
  });
  return { value: values.length ? values.reduce((sum, value) => sum + value, 0) : null, known: values.length, total: regions.length };
}

export function keywordGraphSize(volume: number | null, maximum: number, count: number) {
  const base = Math.max(3, Math.min(18, 560 / Math.sqrt(Math.max(1, count))));
  // Circle area follows actual demand. Keep a small solid dot for values
  // below the visibility floor, including missing volume (identified on hover).
  const minimum = Math.max(5, base * 0.55);
  const maximumSize = Math.max(18, base * 2.4);
  const ratio = volume == null || maximum <= 0 ? 0 : Math.max(0, Math.min(1, volume / maximum));
  return Math.max(minimum, maximumSize * Math.sqrt(ratio));
}

export function keywordGraphKeywords(keywords: DashboardKeyword[], region: "all" | SearchRegionCode, includeCrossLanguage = false): DashboardKeyword[] {
  const groups = scopeKeywordDetails(groupKeywordDetails(keywords), region, includeCrossLanguage);
  const ids = new Map(groups.flatMap(group => group.members.map(member => [member.id, group.id] as const)));
  return groups.map(group => {
    const marketVolumes = Object.fromEntries(REGION_CODES.map(code => [code, keywordMarketVolume(group.members, code)])) as DashboardKeyword["marketVolumes"];
    const keyword: DashboardKeyword = { ...group.members[0], id: group.id, text: group.text, marketVolumes,
      siteName: [...new Set(group.members.map(member => member.siteName ?? member.siteDomain ?? "Flatkey"))].join("、"),
      sourceLanguages: [...new Set(group.members.flatMap(member => member.sourceLanguages ?? []))],
      targetUrls: [...new Set(group.members.flatMap(member => member.targetUrls ?? []))],
      latestRanks: Object.fromEntries(keywordDetailCountryRanks(group, "all").map(value => [value.region, value.rank])) as DashboardKeyword["latestRanks"],
      monitoringEligible: group.members.some(member => member.monitoringEligible === true),
      parentIds: [...new Set(group.members.flatMap(member => (member.parentIds.length ? member.parentIds : member.parentId ? [member.parentId] : [])
        .flatMap(id => ids.get(id) ? [ids.get(id)!] : [])))], parentId: null,
    };
    return { ...keyword, volume: keywordGraphVolume(keyword, region).value ?? 0 };
  });
}
