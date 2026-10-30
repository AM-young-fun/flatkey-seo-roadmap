import type { OptimizedPageMonitorResponse, OptimizedPageRank } from "./optimized-page-monitor";
import type { DashboardKeyword, RankingEvidence, RankSummary } from "./types";
import { normalizeKeywordText } from "./keyword-relevance";
import { getRankBucket, REGION_CODES } from "./seo";
import { validSitePage } from "./keyword-volume-review";

type Page = OptimizedPageMonitorResponse["pages"][number];
export function optimizedPageCaptureProcessing(page: Page, busyPageId?: string | null): boolean {
  return page.id === busyPageId || page.run?.status === "PLANNED" || page.run?.status === "RUNNING";
}

export function optimizedPagesForKeyword(keyword: Pick<DashboardKeyword, "siteDomain" | "text">, pages: Page[]): Page[] {
  if ((keyword.siteDomain ?? "flatkey.ai") !== "flatkey.ai") return [];
  const word = normalizeKeywordText(keyword.text);
  return pages.filter(page => page.keywords.some(text => normalizeKeywordText(text) === word));
}

function siteCapture(page: Page, result: OptimizedPageRank): { summary: RankSummary; evidence: RankingEvidence } | null {
  if (!result.checkedAt || !["RANKED", "OUTSIDE_TOP100", "NOT_FOUND_CAPTURE"].includes(result.status)) return null;
  const pages = [...result.otherPages, ...(result.rank != null ? [{ url: page.url, rank: result.rank }] : [])]
    .filter(item => validSitePage(item.url, "flatkey.ai") && Number.isInteger(item.rank) && item.rank >= 1 && item.rank <= 100)
    .sort((a, b) => a.rank - b.rank);
  if (result.status === "NOT_FOUND_CAPTURE" && !pages.length) return null;
  const rank = pages[0]?.rank ?? null, url = pages[0]?.url ?? null;
  const summary: RankSummary = { source: "dataforseo_serp", rankStatus: rank == null ? "outside_top100" : "ranked", rank, url,
    bucket: getRankBucket(rank), title: null, searchVolume: null, checkedAt: result.checkedAt, serpVerification: "verified",
    previousRank: null, rankDelta: null, changed: false, googleUrl: result.googleUrl, periodLabel: "最新有效实测" };
  const evidence: RankingEvidence = { source: "dataforseo_serp", scope: "query", rank, rankStatus: rank == null ? "outside_top100" : "ranked",
    url, checkedAt: result.checkedAt, serpVerification: "verified", googleUrl: result.googleUrl,
    clicks: null, impressions: null, ctr: null, periodStart: null, periodEnd: null, dataDate: null, importedAt: null, dataUpdatedAt: null,
    pages: pages.map(item => ({ ...item, checkedAt: result.checkedAt!, serpVerification: "verified", clicks: null, impressions: null, ctr: null,
      periodStart: null, periodEnd: null, dataDate: null, importedAt: null, dataUpdatedAt: null })) };
  return { summary, evidence };
}

// Manual captures remain outside the periodic trend ledger. The detail view
// can still display their newer real results using its usual site-best ranking.
export function withOptimizedKeywordRanks(keyword: DashboardKeyword, pages: Page[]): DashboardKeyword {
  const associated = optimizedPagesForKeyword(keyword, pages);
  if (!associated.length) return keyword;
  const latestRanks = { ...keyword.latestRanks }, rankingEvidence = { US: [], JP: [], ES: [], BR: [], ...keyword.rankingEvidence };
  for (const region of REGION_CODES) {
    const matches = (result: OptimizedPageRank) => result.region === region && normalizeKeywordText(result.keyword) === normalizeKeywordText(keyword.text);
    const captures = associated.flatMap(page => (page.siteResults ?? page.results).filter(matches).flatMap(result => {
      const capture = siteCapture(page, result); return capture ? [{ page, ...capture }] : [];
    })).sort((a, b) => Date.parse(b.summary.checkedAt!) - Date.parse(a.summary.checkedAt!));
    const current = captures[0], stored = latestRanks[region];
    if (!current || stored?.source === "dataforseo_serp" && stored.checkedAt &&
      ["ranked", "outside_top100"].includes(stored.rankStatus ?? "") && Date.parse(stored.checkedAt) >= Date.parse(current.summary.checkedAt!)) continue;
    const previous = associated.flatMap(page => (page.previousSiteResults ?? page.previousResults).filter(matches).flatMap(result => {
      const capture = siteCapture(page, result); return capture ? [capture.summary] : [];
    }));
    if (stored?.source === "dataforseo_serp" && ["ranked", "outside_top100"].includes(stored.rankStatus ?? "")) previous.push(stored);
    const prior = previous.filter(rank => rank.checkedAt && Date.parse(rank.checkedAt) < Date.parse(current.summary.checkedAt!))
      .sort((a, b) => Date.parse(b.checkedAt!) - Date.parse(a.checkedAt!))[0];
    const delta = prior?.rank != null && current.summary.rank != null ? prior.rank - current.summary.rank : null;
    latestRanks[region] = { ...current.summary, searchVolume: keyword.marketVolumes[region], previousRank: prior?.rank ?? null, rankDelta: delta,
      changed: Boolean(prior && prior.rank !== current.summary.rank), previousCheckedAt: prior?.checkedAt ?? null, previousPeriodLabel: prior ? "上次有效实测" : null,
      movement: !prior ? "FIRST_CHECK" : delta != null ? delta > 0 ? "UP" : delta < 0 ? "DOWN" : "UNCHANGED"
        : prior.rank == null && current.summary.rank != null ? "NEW_IN_TOP100" : prior.rank != null ? "DROPPED_OUT" : "UNCHANGED" };
    rankingEvidence[region] = [current.evidence, ...(rankingEvidence[region] ?? [])];
  }
  return { ...keyword, latestRanks, rankingEvidence };
}
