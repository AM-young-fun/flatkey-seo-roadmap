import type { DashboardKeyword, RankSummary } from "./types";
import { REGION_CODES, type SearchRegionCode } from "./seo";
import { normalizeKeywordText } from "./keyword-relevance";

export type KeywordCountryScope = "all" | SearchRegionCode;
export type KeywordDetailGroup = { id: string; text: string; members: DashboardKeyword[] };
export type KeywordCountryRank = { region: SearchRegionCode; member: DashboardKeyword; rank: RankSummary | null };

export function groupKeywordDetails(keywords: DashboardKeyword[], site = "all"): KeywordDetailGroup[] {
  const grouped = new Map<string, KeywordDetailGroup>();
  for (const keyword of keywords) {
    if (site !== "all" && (keyword.siteDomain ?? "flatkey.ai") !== site) continue;
    const key = normalizeKeywordText(keyword.text);
    if (!key) continue;
    const group = grouped.get(key) ?? { id: key, text: keyword.text, members: [] };
    if (!group.members.some(member => member.id === keyword.id && member.siteDomain === keyword.siteDomain)) group.members.push(keyword);
    grouped.set(key, group);
  }
  return [...grouped.values()];
}

export function detailRegions(scope: KeywordCountryScope): SearchRegionCode[] {
  return scope === "all" ? REGION_CODES : [scope];
}

export function validKeywordDetailRank(rank: RankSummary | null | undefined): rank is RankSummary & { rank: number } {
  return rank?.source === "dataforseo_serp" && rank.rankStatus === "ranked" && rank.rank != null &&
    Number.isInteger(rank.rank) && rank.rank >= 1 && rank.rank <= 100;
}

function selectRank(values: KeywordCountryRank[]): KeywordCountryRank | null {
  const matched = values.filter(value => validKeywordDetailRank(value.rank));
  if (matched.length) return matched.sort((a, b) => a.rank!.rank! - b.rank!.rank! || a.region.localeCompare(b.region) || a.member.id.localeCompare(b.member.id))[0];
  // An unqueried country/site prevents a site-specific negative receipt from
  // becoming a false all-country or all-site top-100 absence.
  if (values.length && values.every(value => value.rank?.rankStatus === "outside_top100")) return values[0];
  const states = ["queued", "failed", "incomplete", "query_changed", "pending", "not_found_capture"];
  const available = values.filter(value => value.rank?.rankStatus !== "outside_top100");
  return available.sort((a, b) => {
    const state = (value: KeywordCountryRank) => {
      const index = states.indexOf(value.rank?.rankStatus ?? "pending");
      return index < 0 ? states.indexOf("pending") : index;
    };
    return state(a) - state(b);
  })[0] ?? null;
}

export function keywordDetailCountryRanks(group: KeywordDetailGroup, scope: KeywordCountryScope): KeywordCountryRank[] {
  return detailRegions(scope).flatMap(region => {
    const value = selectRank(group.members.map(member => {
      const rank = member.latestRanks[region];
      return { region, member, rank: rank?.source === "dataforseo_serp" && !(rank.rankStatus === "ranked" && !validKeywordDetailRank(rank)) ? rank : null };
    }));
    return value ? [value] : [];
  });
}

export function bestKeywordDetailRank(group: KeywordDetailGroup, scope: KeywordCountryScope): KeywordCountryRank | null {
  return selectRank(keywordDetailCountryRanks(group, scope));
}

export function keywordDetailBestPosition(group: KeywordDetailGroup, scope: KeywordCountryScope): number | null {
  const rank = bestKeywordDetailRank(group, scope)?.rank;
  return validKeywordDetailRank(rank) ? rank.rank : null;
}
