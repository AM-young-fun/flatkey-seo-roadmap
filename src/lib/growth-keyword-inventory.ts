import type { ApprovedCaptureRankedWord } from "./approved-weekly-keyword-capture";
import { publishedRankFilters, type PublishedRankFilter } from "./published-keyword-rank";
import { selectGrowthTargets, type GrowthScope } from "../components/growth-topic-view";
import { isCurrentNativeRanking } from "./current-ranking-summary";
import type { PublishedKeywordRank } from "./published-keyword-rank";
import type { GrowthTarget, GrowthWorkspace } from "./growth-types";
import { growthPublicUrl, growthTargetId, growthWordKey } from "./growth-workspace";
import { seoTablePage } from "./seo-table-page";
import type { GrowthHotspotItem } from "./growth-hotspots";
import { addKeywordTopic, createKeywordLookup, keywordTopic, keywordTopicIndex, numericKeywordOrder,
  type KeywordCategory, type KeywordTopic, type NumericSort } from "./growth-keyword-lookup";

type PublishedKeywordTarget = GrowthTarget & { maintenancePublishedUrls?: string[] };

export function publishedPageKey(value: string, site: string) {
  const own = growthPublicUrl(value, site);
  if (!own) return null;
  const url = new URL(own);
  return (url.pathname.replace(/\/+$/u, "") || "/") + url.search;
}

function publishedKeywordUrls(target: PublishedKeywordTarget) {
  return (target.maintenancePublishedUrls ?? target.publishedUrls).filter(url => publishedPageKey(url, target.site) !== null);
}

export function linkedPublishedKeywordUrls(target: PublishedKeywordTarget, asOf?: string) {
  const actual = target.pageState === "published" ? target.publishedUrls : [];
  const observed = asOf && target.rankUrl && isCurrentNativeRanking(target, asOf) ? [target.rankUrl] : [];
  return [...new Set([...actual, ...publishedKeywordUrls(target), ...observed])].filter(url => publishedPageKey(url, target.site) !== null);
}

export function publishedKeywordRank(target: PublishedKeywordTarget, asOf: string, pageUrl?: string): PublishedKeywordRank | null {
  const pages = publishedKeywordUrls(target).map(url => publishedPageKey(url, target.site));
  if (!pages.length) return null;
  const selected = pageUrl ? publishedPageKey(pageUrl, target.site) : null;
  if (pageUrl && (!selected || !pages.includes(selected))) return null;
  const rankingPage = publishedPageKey(target.rankUrl ?? "", target.site);
  if (rankingPage && (selected ? selected === rankingPage : pages.includes(rankingPage)) && isCurrentNativeRanking(target, asOf)) return "ranked";
  const age = Date.parse(asOf) - Date.parse(target.checkedAt ?? "");
  if (target.country && target.language && target.languageStatus === "match" && target.observationEligible
    && target.rankSource === "serp" && target.captureState === "outside100" && target.rank === null
    && age >= 0 && age <= 14 * 86400000) return "outside100";
  return "pending";
}

const order = { outside100: 0, ranked: 1, pending: 2 } satisfies Record<PublishedKeywordRank, number>;

export function growthKeywordInventoryPage(workspace: GrowthWorkspace, scope: GrowthScope, page: number, library: "keywords" | "published", rank: PublishedKeywordRank | "all" = "all") {
  const candidates = selectGrowthTargets(workspace, scope, undefined, true);
  const ranks = new Map<string, PublishedKeywordRank>();
  const counts = { outside100: 0, ranked: 0, pending: 0 };
  let targets = candidates;
  if (library === "published") {
    targets = candidates.filter(target => {
      if (!linkedPublishedKeywordUrls(target, workspace.generatedAt).length) return false;
      const status = publishedKeywordRank(target, workspace.generatedAt) ?? (isCurrentNativeRanking(target, workspace.generatedAt) && linkedPublishedKeywordUrls(target, workspace.generatedAt).includes(target.rankUrl ?? "") ? "ranked" : "pending");
      ranks.set(target.id, status);
      counts[status]++;
      return rank === "all" || rank === status;
    }).sort((first, second) => order[ranks.get(first.id)!] - order[ranks.get(second.id)!]);
  }
  const { rows, ...pagination } = seoTablePage(targets, page);
  return {
    data: { sites: workspace.sites, markets: workspace.markets, topics: [],
      targets: library === "published" ? rows.map(target => ({ ...target, pageState: "published" as const, publishedUrls: linkedPublishedKeywordUrls(target, workspace.generatedAt) })) : rows },
    publishedRanks: Object.fromEntries(rows.flatMap(target => ranks.has(target.id) ? [[target.id, ranks.get(target.id)!]] : [])) as Record<string, PublishedKeywordRank>,
    counts, originalWordCount: new Set(targets.map(target => growthWordKey(target.keyword)).filter(Boolean)).size,
    pagination,
  };
}

export type GrowthKeywordInventoryPage = ReturnType<typeof growthKeywordInventoryPage>;


export function publishedKeywordWords(workspace: GrowthWorkspace, capture: ApprovedCaptureRankedWord[], scope: GrowthScope, page: number,
  filter: PublishedRankFilter, sort: NumericSort | null = null, hotspots: GrowthHotspotItem[] = []) {
  type Rank = { position: number; country: string | null; language: string | null; checkedAt: string | null; historical: boolean };
  type Market = Pick<GrowthTarget, "country" | "language">;
  type Word = { keyword: string; urls: Set<string>; best: Rank | null; outsideOnly: boolean; categories: KeywordCategory[]; topics: KeywordTopic[]; markets: Market[] };
  const words = new Map<string, Word>();
  const topics = keywordTopicIndex(workspace.topics);
  const lookup = createKeywordLookup(scope.search);
  const candidates = selectGrowthTargets(workspace, { ...scope, search: "" }, undefined, true);
  const originalMatches = new Set(selectGrowthTargets(workspace, scope, undefined, true).map(target => target.id));
  const byIdentity = new Map(candidates.map(row => [growthTargetId(row.site, row.keyword, row.country, row.language), row]));
  const quarter = new Set(workspace.quarter?.targetIds);
  const satellite = new Set(workspace.satelliteQuarter?.targetIds);
  const hotspot = new Set([...workspace.hotspotTargetIds ?? [], ...hotspots.map(row => growthTargetId(row.site, row.keyword, row.country, row.language))]);
  const add = (keyword: string, urls: string[], rank: Rank | null, outside: boolean, market: Market, target?: GrowthTarget) => {
    const key = growthWordKey(keyword);
    if (!key || !urls.length) return;
    const row: Word = words.get(key) ?? { keyword, urls: new Set<string>(), best: null, outsideOnly: true, categories: ["published"], topics: [], markets: [] };
    for (const url of urls) row.urls.add(url);
    if ((market.country || market.language) && !row.markets.some(item => item.country === market.country && item.language === market.language)) {
      row.markets.push({ country: market.country, language: market.language });
    }
    if (target) {
      addKeywordTopic(row.topics, keywordTopic(target, topics));
      for (const [category, ids] of [["quarter", quarter], ["satellite", satellite], ["hotspot", hotspot]] as const) {
        if (ids.has(target.id) && !row.categories.includes(category)) row.categories.push(category);
      }
    }
    row.outsideOnly &&= outside;
    if (rank && (!row.best || Number(rank.historical) < Number(row.best.historical)
      || rank.historical === row.best.historical && (rank.position < row.best.position
      || rank.position === row.best.position && (rank.checkedAt ?? "") > (row.best.checkedAt ?? "")))) row.best = rank;
    words.set(key, row);
  };
  for (const row of candidates) {
    const urls = linkedPublishedKeywordUrls(row, workspace.generatedAt);
    const topic = keywordTopic(row, topics);
    const matchesWord = originalMatches.has(row.id) || lookup.matchText(row.keyword, topic?.name ?? "");
    const displayed = matchesWord ? urls : urls.filter(lookup.matchPage);
    const rankMatched = matchesWord || displayed.some(url => publishedPageKey(url, row.site) === publishedPageKey(row.rankUrl ?? "", row.site));
    const current = rankMatched && isCurrentNativeRanking(row, workspace.generatedAt);
    const outside = displayed.some(url => publishedKeywordRank(row, workspace.generatedAt, url) === "outside100");
    add(row.keyword, displayed, current ? { position: row.rank!, country: row.country, language: row.language, checkedAt: row.checkedAt, historical: false } : null,
      outside, row, row);
  }
  if (scope.site === "all" || scope.site === "flatkey.ai") {
    for (const row of capture) {
      if (scope.country !== "all" && scope.country !== row.country || scope.language !== "all" && scope.language !== row.language) continue;
      const target = byIdentity.get(growthTargetId("flatkey.ai", row.keyword, row.country, row.language));
      const topic = target && keywordTopic(target, topics);
      const matchesWord = lookup.matchText(row.keyword, topic?.name ?? "") || Boolean(target && originalMatches.has(target.id));
      const pages = row.pages.filter(result => publishedPageKey(result.url, "flatkey.ai") !== null && (matchesWord || lookup.matchPage(result.url)));
      if (!pages.length) continue;
      add(row.keyword, pages.map(result => result.url), {
        position: matchesWord ? row.bestRank : Math.min(...pages.map(result => result.rank)), country: row.country, language: row.language,
        checkedAt: row.checkedAt, historical: true,
      }, false, row, target);
    }
  }
  const rows = [...words.values()].map(({ urls, outsideOnly, ...word }) => ({ ...word, urls: [...urls].sort(),
    status: (word.best ? "ranked" : outsideOnly ? "outside100" : "pending") as PublishedKeywordRank }));
  const matchesFilter = (row: typeof rows[number], key: PublishedRankFilter) => {
    if (key === "all") return true;
    const definition = publishedRankFilters.find(option => option.value === key);
    if (definition && "min" in definition) return Boolean(row.best && row.best.position >= definition.min && row.best.position <= definition.max);
    return row.status === key;
  };
  const counts = Object.fromEntries(publishedRankFilters.map(({ value }) => [value, rows.filter(row => matchesFilter(row, value)).length]));
  const { rows: visible, ...pagination } = seoTablePage(rows.filter(row => matchesFilter(row, filter))
    .sort((a, b) => numericKeywordOrder(a.best?.position, b.best?.position, sort) || a.keyword.localeCompare(b.keyword, "zh-CN")), page);
  return { rows: visible, pagination, counts, markets: workspace.markets, sites: workspace.sites };
}
export type PublishedKeywordWords = ReturnType<typeof publishedKeywordWords>;
