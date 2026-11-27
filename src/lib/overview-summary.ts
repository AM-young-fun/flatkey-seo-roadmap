import { defaultGrowthScope, growthMarketLabel, growthRankingEvidence } from "../components/growth-topic-view";
import { currentRankingSummary } from "./current-ranking-summary";
import type { GrowthTarget, GrowthWorkspace } from "./growth-types";
import { growthWordKey } from "./growth-workspace";

export const overviewWorkStates = ["completed", "in_progress", "scheduled", "researching", "planned", "unknown"] as const;
type RankShare = { label: string; count: number; share: number | null };

export type OverviewKeywordSummary = {
  total: number;
  workCounts: Record<GrowthTarget["workState"], number>;
  ranking: { total: number; top50: number; latestCheckedAt: string | null } | null;
  coverage: { total: number; top50: number; markets: RankShare[]; bands: RankShare[] } | null;
  partial: boolean;
  core?: ReturnType<typeof import("./services/seo-closeout-overview").closeoutCoreRead>;
  ordinary?: ReturnType<typeof import("./services/seo-closeout-overview").ordinaryKeywordCoverage>;
};

export type OverviewTrafficGoal = {
  daysRemaining: number;
  mode: "rolling" | "final";
  period: { start: string; end: string };
  sessions: number | null;
  fallback: { start: string; end: string; sessions: number } | null;
  activeMilestoneEnd?: string;
  milestones?: { start: string; end: string; target: number; actual: number | null }[];
};

export function summarizeOverviewKeywords(data: GrowthWorkspace, scope = defaultGrowthScope): OverviewKeywordSummary {
  const words = new Map<string, GrowthTarget["workState"]>();
  for (const target of data.targets) {
    const key = growthWordKey(target.keyword), previous = words.get(key);
    if (key && (!previous || overviewWorkStates.indexOf(target.workState) < overviewWorkStates.indexOf(previous))) words.set(key, target.workState);
  }
  const workCounts = { completed: 0, in_progress: 0, scheduled: 0, researching: 0, planned: 0, unknown: 0 };
  for (const state of words.values()) workCounts[state]++;

  const partial = data.reconciliation.sources.some(source => !source.available);
  if (data.reconciliation.sources.some(source => source.name === "最近14天的已存SERP" && !source.available)) {
    return { total: words.size, workCounts, ranking: null, coverage: null, partial };
  }

  const ranking = currentRankingSummary(data.targets, data.generatedAt);
  const { summary: coverage } = growthRankingEvidence(data, scope, "all");
  return {
    total: words.size, workCounts, partial,
    ranking: {
      total: ranking.total, top50: ranking.top50,
      latestCheckedAt: ranking.selected.flatMap(row => row.checkedAt ? [row.checkedAt] : []).sort().at(-1) ?? null,
    },
    coverage: {
      total: coverage.total, top50: coverage.top50,
      markets: coverage.countries.map(({ country, language, count, share }) => ({ label: growthMarketLabel(data, country, language), count, share })),
      bands: coverage.bands.map(({ label, count, share }) => ({ label: label + " 名", count, share })),
    },
  };
}
