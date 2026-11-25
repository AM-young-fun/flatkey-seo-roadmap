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
      const status = publishedKeywordRank(target, workspace.generatedAt);
      if (!status) return false;
      ranks.set(target.id, status);
      counts[status]++;
      return rank === "all" || rank === status;
    }).sort((first, second) => order[ranks.get(first.id)!] - order[ranks.get(second.id)!]);
  }
  const { rows, ...pagination } = seoTablePage(targets, page);
  return {
    data: { sites: workspace.sites, markets: workspace.markets, topics: [],
      targets: library === "published" ? rows.map(target => ({ ...target, publishedUrls: publishedKeywordUrls(target) })) : rows },
    publishedRanks: Object.fromEntries(rows.flatMap(target => ranks.has(target.id) ? [[target.id, ranks.get(target.id)!]] : [])) as Record<string, PublishedKeywordRank>,
    counts, originalWordCount: new Set(targets.map(target => growthWordKey(target.keyword)).filter(Boolean)).size,
    pagination,
  };
}

export type GrowthKeywordInventoryPage = ReturnType<typeof growthKeywordInventoryPage>;
