import type { ApprovedCaptureRankedWord } from "./approved-weekly-keyword-capture";
import { publishedRankFilters, type PublishedRankFilter } from "./published-keyword-rank";
import { selectGrowthTargets, type GrowthScope } from "../components/growth-topic-view";
import { isCurrentNativeRanking } from "./current-ranking-summary";
import type { PublishedKeywordRank } from "./published-keyword-rank";
import type { GrowthTarget, GrowthWorkspace } from "./growth-types";
import { growthPublicUrl, growthWordKey } from "./growth-workspace";
import { seoTablePage } from "./seo-table-page";

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


export function publishedKeywordWords(workspace: GrowthWorkspace, capture: ApprovedCaptureRankedWord[], scope: GrowthScope, page: number, filter: PublishedRankFilter) {
  type Rank = { position: number; country: string | null; language: string | null; checkedAt: string | null; historical: boolean };
  type Word = { keyword: string; urls: Set<string>; best: Rank | null; outsideOnly: boolean };
  const words = new Map<string, Word>();
  const add = (keyword: string, urls: string[], rank: Rank | null, outside: boolean) => {
    const key = growthWordKey(keyword);
    if (!key || !urls.length) return;
    const row = words.get(key) ?? { keyword, urls: new Set<string>(), best: null, outsideOnly: true };
    for (const url of urls) row.urls.add(url);
    row.outsideOnly &&= outside;
    if (rank && (!row.best || Number(rank.historical) < Number(row.best.historical)
      || rank.historical === row.best.historical && (rank.position < row.best.position
      || rank.position === row.best.position && (rank.checkedAt ?? "") > (row.best.checkedAt ?? "")))) row.best = rank;
    words.set(key, row);
  };
  const candidates = selectGrowthTargets(workspace, scope, undefined, true);
  for (const row of candidates) {
    const current = isCurrentNativeRanking(row, workspace.generatedAt);
    add(row.keyword, linkedPublishedKeywordUrls(row, workspace.generatedAt), current ? {
      position: row.rank!, country: row.country, language: row.language, checkedAt: row.checkedAt, historical: false,
    } : null, publishedKeywordRank(row, workspace.generatedAt) === "outside100");
  }
  if (scope.site === "all" || scope.site === "flatkey.ai") {
    const query = growthWordKey(scope.search);
    const matches = new Set(candidates.filter(row => row.site === "flatkey.ai").map(row => growthWordKey(row.keyword)));
    for (const row of capture) {
      const key = growthWordKey(row.keyword);
      if (scope.country !== "all" && scope.country !== row.country || scope.language !== "all" && scope.language !== row.language
        || query && !key.includes(query) && !matches.has(key)) continue;
      add(row.keyword, row.pages.map(result => result.url).filter(url => publishedPageKey(url, "flatkey.ai") !== null), {
        position: row.bestRank, country: row.country, language: row.language, checkedAt: row.checkedAt, historical: true,
      }, false);
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
    .sort((a, b) => a.keyword.localeCompare(b.keyword, "zh-CN")), page);
  return { rows: visible, pagination, counts, markets: workspace.markets, sites: workspace.sites };
}
export type PublishedKeywordWords = ReturnType<typeof publishedKeywordWords>;
