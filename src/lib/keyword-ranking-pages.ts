import type { RankingEvidence, RankingPageEvidence, RankSummary } from "./types";
import { validSitePage } from "./keyword-volume-review";

const timestamp = (value: string | null | undefined) => value ? Date.parse(value) : -Infinity;
const sameTime = (a: string | null | undefined, b: string | null | undefined) => Boolean(a && b && timestamp(a) === timestamp(b));
const validRank = (rank: number | null | undefined): rank is number => rank != null && Number.isInteger(rank) && rank >= 1;
const urlIdentity = (value: string) => {
  const url = new URL(value); url.hash = ""; url.pathname = url.pathname.replace(/\/$/, "") || "/"; return url.href;
};

// Show page-level records only from the keyword's current capture. Each page
// keeps its own source date and rank, even when they differ within that capture.
export function keywordRankingPages(summary: RankSummary | null | undefined, evidence: RankingEvidence[], siteDomain: string): RankingPageEvidence[] {
  if (!["dataforseo_labs", "dataforseo_serp"].includes(summary?.source ?? "") || !summary?.checkedAt) return [];
  const byUrl = new Map<string, RankingPageEvidence>();
  for (const report of evidence) {
    if (report.source !== summary.source || !sameTime(report.checkedAt, summary.checkedAt)) continue;
    for (const page of report.pages) {
      if (!sameTime(page.checkedAt, summary.checkedAt) || !validRank(page.rank) || !validSitePage(page.url, siteDomain)) continue;
      const key = urlIdentity(page.url), prior = byUrl.get(key);
      const date = timestamp(page.dataUpdatedAt ?? page.dataDate), priorDate = timestamp(prior?.dataUpdatedAt ?? prior?.dataDate);
      if (!prior || date > priorDate || (date === priorDate && page.rank < prior.rank!)) byUrl.set(key, page);
    }
  }
  // A query observation can explicitly identify its own ranked URL. It never
  // supplies a rank or timestamp for any other target page.
  if (validRank(summary.rank) && validSitePage(summary.url, siteDomain) && !byUrl.has(urlIdentity(summary.url!))) {
    byUrl.set(urlIdentity(summary.url!), { url: summary.url!, rank: summary.rank, clicks: null, impressions: null, ctr: null,
      periodStart: null, periodEnd: null, dataDate: summary.dataDate ?? null, dataUpdatedAt: summary.dataUpdatedAt ?? null,
      checkedAt: summary.checkedAt, importedAt: null, serpVerification: summary.serpVerification ?? "unverified" });
  }
  return [...byUrl.values()].sort((a, b) => (a.rank ?? Infinity) - (b.rank ?? Infinity) || a.url.localeCompare(b.url));
}
