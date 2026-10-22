import type { DashboardKeyword, DashboardResponse } from "./types";
import type { KeywordOkrResponse } from "./keyword-okr";
import { keywordRelevance, normalizeKeywordText } from "./keyword-relevance";
import { keywordPageTag } from "./keyword-status-tags";
import type { OptimizedPageMonitorResponse } from "./optimized-page-monitor";
import { optimizedPagesForKeyword, withOptimizedKeywordRanks } from "./optimized-keyword-details";
import { keywordMatchesCountry } from "./keyword-market";
import { REGION_CODES } from "./seo";
import { groupKeywordDetails } from "./keyword-details-group";

/** The exact same formal membership and page tags as the detail UI. */
export function keywordDisplayRows(data: DashboardResponse, okr: KeywordOkrResponse, research = false, optimizedPages: OptimizedPageMonitorResponse["pages"] = []) {
  const pool = research ? "RESEARCH" : "FORMAL";
  const targets = new Map(okr.keywords.map(item => [item.id, item]));
  const originalId = (id: string) => id.replace(/^flatkey\.ai:/, "");
  const loaded = data.keywords.filter(member => !data.usingDemoData || member.siteDomain !== "flatkey.ai");
  const loadedIds = new Set(loaded.filter(member => member.siteDomain === "flatkey.ai").map(member => originalId(member.id)));
  const targetOnly: DashboardKeyword[] = okr.initialized ? [...targets.values()].filter(item => !loadedIds.has(item.id)).map(item => ({
    id:item.id, text:item.text, type:"MAIN", topicId:null, topicText:null, siteDomain:item.siteDomain, siteName:"Flatkey", targetUrls:item.targetUrls, businessCategory:item.businessCategory,
    parentId:null, parentIds:[], active:item.active, lastSyncedAt:null, volume:0,
    marketVolumes:{US:null,JP:null,ES:null,BR:null}, latestRanks:{US:null,JP:null,ES:null,BR:null},
  })) : [];
  const members = [...loaded, ...targetOnly].filter(member => (member.siteDomain ?? "flatkey.ai") === "flatkey.ai"
    ? okr.initialized && targets.get(originalId(member.id))?.pool === pool
    : !research && keywordRelevance(member.siteDomain ?? "flatkey.ai", member.text).status !== "unrelated").map(member => {
    const target = member.siteDomain === "flatkey.ai" ? targets.get(originalId(member.id)) : undefined;
    const review = member.monitoringHoldCode === "NO_VERIFIED_PAGE" || member.monitoringHoldCode === "PAGE_REVIEW_REQUIRED";
    const tag = keywordPageTag({siteDomain:member.siteDomain ?? "flatkey.ai",mappingStatus:target?.mappingStatus ?? (member.monitoringEligible === true ? "READY" : undefined),targetUrls:target?.targetUrls ?? member.targetUrls,candidateUrls:target?.candidateUrls,
      latestPageAuditVerdict:member.monitoringHoldCode === "PAGE_NOT_BUILT" ? "NO_MATCH" : review ? "REVIEW" : target?.latestPageAuditVerdict});
    const ranked = withOptimizedKeywordRanks(member, optimizedPages);
    return {...ranked, _countryScopes: REGION_CODES.filter(region => keywordMatchesCountry(ranked, region)), _crossCountryScopes: REGION_CODES.filter(region => keywordMatchesCountry(ranked, region, true)), businessCategory:target?.businessCategory ?? member.businessCategory, _optimized:optimizedPagesForKeyword(member, optimizedPages).length > 0, _okr:target, _pageKey:tag.key, _search:normalizeKeywordText(`${member.text} ${member.topicText ?? ""} ${target?.reason ?? ""}`)};
  });
  return groupKeywordDetails(members);
}
