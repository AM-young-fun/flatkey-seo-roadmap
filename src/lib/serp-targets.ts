import { keywordRelevance } from "./keyword-relevance";

export const SERP_TARGET_SITES = ["flatkey.ai", "rackrate.org", "modelfit.cc"] as const;

export type SerpTargetCandidate = {
  keywordId: string;
  text: string;
  siteDomain: string;
  active: boolean;
  keywordActive: boolean;
  siteActive: boolean;
  topicId: string | null;
  pool: string;
};

export type SerpTarget = {
  keywordId: string;
  keyword: string;
  siteDomain: string;
  targetUrls: string[];
};

// The overview, preview budget and paid runner must select the same inventory.
// Keep the established formal cohort; a provider discovery cannot promote a
// research term or silently remove a target that lacks a page or a ranking.
export function eligibleSerpTargets<T extends SerpTargetCandidate>(rows: T[]): T[] {
  const selected = new Map<string, T>();
  for (const row of rows) {
    if (!SERP_TARGET_SITES.includes(row.siteDomain as typeof SERP_TARGET_SITES[number]) ||
      !row.active || !row.keywordActive || !row.siteActive || !row.topicId) continue;
    if (row.siteDomain === "flatkey.ai" && row.pool !== "FORMAL") continue;
    if (keywordRelevance(row.siteDomain, row.text).status === "unrelated") continue;
    selected.set(`${row.siteDomain}:${row.keywordId}`, row);
  }
  return [...selected.values()];
}

export const serpTargetKey = (target: Pick<SerpTarget, "siteDomain" | "keywordId">) => `${target.siteDomain}:${target.keywordId}`;
