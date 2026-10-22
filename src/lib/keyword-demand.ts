import { groupKeywordDetails, scopeKeywordDetails, bestKeywordDetailRank, validKeywordDetailRank } from "./keyword-details-group";
import { keywordMarketVolume } from "./keyword-market";
import type { DashboardKeyword } from "./types";
import type { SearchRegionCode } from "./seo";
import type { KeywordBusiness } from "./keyword-business";

export function keywordDemandRows(keywords: DashboardKeyword[], region: SearchRegionCode, business: KeywordBusiness, includeCrossLanguage = false, search = "") {
  const query = search.normalize("NFKC").trim().toLowerCase();
  return scopeKeywordDetails(groupKeywordDetails(keywords, "all", business), region, includeCrossLanguage)
    .filter(group => !query || `${group.text} ${group.members.map(member => `${member.topicText ?? ""} ${member.siteName ?? ""}`).join(" ")}`.normalize("NFKC").toLowerCase().includes(query))
    .map(group => {
      const best = bestKeywordDetailRank(group, region);
      return { id: group.id, text: group.text, volume: keywordMarketVolume(group.members, region),
        rank: best?.rank ?? null, position: validKeywordDetailRank(best?.rank) ? best.rank.rank : null,
        sites: [...new Set(group.members.map(member => member.siteName ?? member.siteDomain ?? "Flatkey"))].join(" / ") };
    }).sort((a, b) => (b.volume ?? -1) - (a.volume ?? -1) || a.text.localeCompare(b.text));
}
