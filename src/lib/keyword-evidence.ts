import type { DashboardKeyword, RankingEvidence } from "./types";
import type { SearchRegionCode } from "./seo";

export function keywordEvidence(keyword: DashboardKeyword, region: SearchRegionCode): RankingEvidence[] {
  return keyword.rankingEvidence?.[region] ?? [];
}

export function hasRankingEvidence(evidence: RankingEvidence, limit = 100): boolean {
  const valid = (rank: number | null) => rank != null && rank >= 1 && rank <= limit;
  if (evidence.scope === "query" && valid(evidence.rank) && evidence.url &&
      (evidence.source !== "gsc" || (evidence.impressions ?? 0) > 0)) return true;
  return evidence.pages.some(page => valid(page.rank) && Boolean(page.url) &&
    (evidence.source !== "gsc" || (page.impressions ?? 0) > 0)) ||
    (evidence.daily ?? []).some(day =>
      (valid(day.rank) && Boolean(day.url) && (day.impressions ?? 0) > 0) ||
      day.pages.some(page => valid(page.rank) && Boolean(page.url) && (page.impressions ?? 0) > 0));
}
