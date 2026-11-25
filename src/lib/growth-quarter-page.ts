import type { GrowthWorkspace } from "./growth-types";
import { seoTablePage } from "./seo-table-page";
import { linkedPublishedKeywordUrls } from "./growth-keyword-inventory";
import { growthCounts, growthRelatedTargets, growthTopicContains, growthTopicTargets, quarterTargetWorkspace, selectGrowthTargets, type GrowthScope } from "../components/growth-topic-view";

type QuarterQuery = { scope: GrowthScope; topicId?: string; page: number; related: boolean; selected?: string; newOnly?: boolean };

export function growthQuarterPage(full: GrowthWorkspace, query: QuarterQuery) {
  const data = quarterTargetWorkspace(full);
  const frozenTotal = data.quarter?.keywordCount ?? null;
  const selectedPublished = query.newOnly && query.selected ? data.targets.find(target => target.id === query.selected && linkedPublishedKeywordUrls(target, data.generatedAt).length) : undefined;
  if (query.newOnly) data.targets = data.targets.filter(target => !linkedPublishedKeywordUrls(target, data.generatedAt).length);
  const topic = query.topicId ? data.topics.find(item => item.topicId === query.topicId
    && (query.scope.site === "all" || item.site === query.scope.site)) : undefined;
  const scope = { ...query.scope, ...(topic ? { site: topic.site } : {}), membership: "formal" as const };
  const candidates = selectGrowthTargets(data, scope);
  const targets = topic ? growthTopicTargets(data.topics, topic, candidates) : candidates;
  const related = topic ? growthRelatedTargets(data.topics, topic, candidates) : [];
  const showRelated = query.related || (Boolean(query.selected) && related.some(target => target.id === query.selected));
  const detailRows = showRelated ? related : targets;
  const detailPage = seoTablePage(topic ? detailRows : [], query.page, detailRows.findIndex(target => target.id === query.selected));
  const marketTargets = topic ? selectGrowthTargets(data, { ...scope, country: "all", language: "all" }, topic) : [];
  const markets = [...new Set(marketTargets.map(target => `${target.country || ""}:${target.language || ""}`))].map(key => {
    const rows = marketTargets.filter(target => `${target.country || ""}:${target.language || ""}` === key);
    return { country: rows[0].country, language: rows[0].language, ...growthCounts(rows) };
  });
  const topics = query.topicId ? [] : data.topics.flatMap(item => {
    const rows = growthTopicTargets(data.topics, item, targets);
    const relatedTotal = growthRelatedTargets(data.topics, item, targets).length;
    return rows.length || relatedTotal ? [{
      topic: item, stats: growthCounts(rows), ownCount: rows.filter(target => growthTopicContains(item, target)).length,
      relatedTotal, marketCount: new Set(rows.map(target => `${target.country}:${target.language}`)).size,
    }] : [];
  });
  const topicPage = seoTablePage(topics, query.page);
  const { rows: currentTargets, ...targetPagination } = detailPage;
  const { rows: currentTopics, ...topicPagination } = topicPage;
  const topicIds = new Set(currentTargets.map(target => `${target.site}:${target.topicId}`));
  return {
    data: {
      sites: data.sites, markets: data.markets, generatedAt: data.generatedAt, targets: currentTargets,
      topics: data.topics.filter(item => topicIds.has(`${item.site}:${item.topicId}`)),
    },
    frozen: Boolean(data.quarter), frozenTotal, selectedPublished: selectedPublished
      ? { keyword: selectedPublished.keyword, site: selectedPublished.site, country: selectedPublished.country, language: selectedPublished.language }
      : null,
    scope, topic: topic ?? null, markets, topicRows: currentTopics,
    stats: growthCounts(targets), relatedTotal: related.length, showRelated,
    rankAvailable: !(data.reconciliation?.sources ?? []).some(source => source.name === "最近14天的已存SERP" && !source.available),
    ownTotal: topic ? targets.filter(target => growthTopicContains(topic, target)).length : 0,
    pagination: query.topicId ? targetPagination : topicPagination,
  };
}

export type GrowthQuarterPage = ReturnType<typeof growthQuarterPage>;
