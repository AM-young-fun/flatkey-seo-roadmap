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

/** Detail evidence stays on the keyword page. Keep the market/rank identity,
 * topic edges, and overview progress in the visual read. */
export function growthDashboardProjection(workspace: GrowthWorkspace, includeCatalog = false): GrowthWorkspace {
  const overview = includeCatalog ? workspace : growthOverviewWorkspace(workspace);
  return { ...overview, targets: overview.targets.map(target => ({
    id: target.id, keywordId: target.keywordId, site: target.site, topicId: target.topicId, topicName: target.topicName,
    keyword: target.keyword, country: target.country, language: target.language, wordLanguage: target.wordLanguage,
    relatedTopicIds: target.relatedTopicIds, membership: target.membership, pageState: target.pageState,
    publishedUrls: target.publishedUrls, plannedUrls: target.plannedUrls, workState: target.workState,
    rank: target.rank, rankUrl: target.rankUrl, rankSource: target.rankSource, checkedAt: target.checkedAt,
    languageStatus: target.languageStatus, languageReason: target.languageReason, captureState: target.captureState,
    rankEligible: target.rankEligible, observationEligible: target.observationEligible,
    monitoringEligible: target.monitoringEligible, taskIds: target.taskIds, reason: target.reason,
  })) };
}
