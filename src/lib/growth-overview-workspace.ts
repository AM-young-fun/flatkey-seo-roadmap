import type { GrowthWorkspace } from "./growth-types";

/** The overview needs every frozen member and every row that can display a
 * ranking or background observation. Other inventory belongs to the full read.
 * Retain row order and all copies of a selected ID for the existing de-duplication rules. */
export function growthOverviewWorkspace(workspace: GrowthWorkspace): GrowthWorkspace {
  const visibleIds = new Set(workspace.quarter?.targetIds);
  for (const target of workspace.targets) {
    if (target.rank !== null && target.rankSource) visibleIds.add(target.id);
  }
  return {
    version: workspace.version,
    generatedAt: workspace.generatedAt,
    sites: workspace.sites,
    markets: workspace.markets,
    topics: workspace.topics,
    targets: workspace.targets.filter(target => visibleIds.has(target.id)),
    opportunities: [],
    quarter: workspace.quarter,
    reconciliation: workspace.reconciliation,
    monitoringQuote: workspace.monitoringQuote,
  };
}
