import { analyticsSiteForProperty, safeAnalyticsUrl, type AnalyticsObservation } from "./seo-analytics";
import { CLUSTER_SITES } from "./seo-cluster-sites";
import { shiftDay } from "./seo-date-range";
import { gscDate } from "./seo-page-effects";
import type { WorkflowSnapshot } from "./seo-workflow";

type SearchPoint = { date: string; property: string; clicks: number; impressions: number };
type VisitPoint = { date: string; visits: number };
export type RecentPublishedPage = {
  url: string; title: string; day: string; change: "new" | "optimization"; cohort: "current" | "previous";
  before: SearchPoint | null; latest: SearchPoint | null; beforeVisits: VisitPoint | null; latestVisits: VisitPoint | null;
};

/** Also projects older frozen rows without changing their saved snapshot. */
export function bestMonthlyOptimizations(pages: readonly RecentPublishedPage[] | null | undefined): RecentPublishedPage[] {
  return (pages ?? []).filter(row => row.change === "optimization" && row.before && row.latest && row.before.property === row.latest.property &&
    (row.latest.clicks > row.before.clicks || row.latest.clicks === row.before.clicks && row.latest.impressions > row.before.impressions))
    .sort((a, b) => (b.latest!.clicks - b.before!.clicks) - (a.latest!.clicks - a.before!.clicks)
      || (b.latest!.impressions - b.before!.impressions) - (a.latest!.impressions - a.before!.impressions)
      || b.latest!.date.localeCompare(a.latest!.date) || b.day.localeCompare(a.day) || a.url.localeCompare(b.url))
    .slice(0, 10);
}

type WeeklyPageWindow = { trafficStart: string; trafficEnd: string; workEnd: string; workTimezone: string };
export function monthlyOptimizationChanges(workflow: Pick<WorkflowSnapshot, "approvals" | "publications">, end: string, now: Date, weekly: boolean, weeklyWindow?: WeeklyPageWindow) {
  const periodEnd = weekly && weeklyWindow ? weeklyWindow.trafficEnd : shiftDay(end, -1);
  const periodStart = shiftDay(periodEnd, -29);
  const cutoff = now.getTime();
  // Ranking and the before/after search observations share the GSC calendar.
  const publicationDay = (stamp: string) => gscDate(new Date(stamp));
  type Page = WorkflowSnapshot["publications"][number];
  const approvals = new Map(workflow.approvals.map(approval => [approval.id, approval]));
  const changes: { page: Page; change: "optimization" }[] = [];
  for (const page of workflow.publications) {
    if (page.status !== "verified" || !page.verifiedAt || !page.verificationRecordedAt
      || Date.parse(page.publishedAt) > cutoff || [page.verifiedAt, page.verificationRecordedAt].some(stamp => Date.parse(stamp) > now.getTime())
      || !safeAnalyticsUrl(page.pageUrl) || page.kind === "prompt") continue;
    const operation = page.automaticWrite?.operation ?? approvals.get(page.approvalId ?? "")?.items.find(item => item.id === page.approvalItemId)?.operation;
    if (page.kind === "optimization" || operation === "update") {
      changes.push({ page, change: "optimization" });
    }
  }
  const latestChanges = new Map<string, (typeof changes)[number]>();
  for (const entry of changes) {
    const day = publicationDay(entry.page.publishedAt);
    if (day < periodStart || day > periodEnd) continue;
    const prior = latestChanges.get(entry.page.pageUrl);
    if (!prior || Date.parse(entry.page.publishedAt) > Date.parse(prior.page.publishedAt)) latestChanges.set(entry.page.pageUrl, entry);
  }
  return latestChanges;
}

export function recentPublishedPages(workflow: Pick<WorkflowSnapshot, "approvals" | "publications">, observations: AnalyticsObservation[], end: string, now: Date, weekly: boolean, weeklyWindow?: WeeklyPageWindow, includeAll = false): RecentPublishedPage[] {
  const periodEnd = weekly && weeklyWindow ? weeklyWindow.trafficEnd : shiftDay(end, -1);
  const publicationDay = (stamp: string) => gscDate(new Date(stamp));
  const latestChanges = monthlyOptimizationChanges(workflow, end, now, weekly, weeklyWindow);
  const search = new Map<string, SearchPoint[]>(), visits = new Map<string, VisitPoint[]>();
  const gaPaths = new Map<string, string>();
  const analyticsKey = (site: string, url: string) => site + "|" + url;
  for (const { page } of latestChanges.values()) {
    const target = new URL(page.pageUrl), key = analyticsKey(page.siteDomain, page.pageUrl);
    search.set(key, []);
    visits.set(key, []);
    gaPaths.set(analyticsKey(page.siteDomain, target.hostname + target.pathname + target.search), key);
  }
  for (const row of observations) {
    if (row.country || row.date > periodEnd || Date.parse(row.observedAt) > now.getTime()) continue;
    const site = analyticsSiteForProperty(row.property);
    if (!site) continue;
    if (row.kind === "gsc-pages" && row.complete) {
      for (const item of row.rows) search.get(analyticsKey(site, item.url))?.push({
        date: row.date, property: row.property, clicks: item.clicks, impressions: item.impressions,
      });
    }
    if (row.kind === "ga4-pages" && (row.sessionsComplete || row.complete) && row.hostnameDimension === "hostName") {
      for (const item of row.rows) {
        if (!item.hostname || item.sessions === null) continue;
        const key = gaPaths.get(analyticsKey(site, item.hostname + item.path));
        if (key) visits.get(key)?.push({ date: row.date, visits: item.sessions });
      }
    }
  }
  const pages = [...latestChanges.values()].map(({ page, change }): RecentPublishedPage => {
    const launch = new Date(page.publishedAt), day = publicationDay(page.publishedAt);
    const key = analyticsKey(page.siteDomain, page.pageUrl);
    const gscLaunchDay = gscDate(launch), gsc = search.get(key) ?? [];
    const latest = gsc.filter(row => row.date > gscLaunchDay && (weekly || row.date === periodEnd)).sort((a, b) => b.date.localeCompare(a.date) || Number(b.property.startsWith("sc-domain:")) - Number(a.property.startsWith("sc-domain:")))[0] ?? null;
    const before = gsc.filter(row => (weekly ? row.date < gscLaunchDay : row.date === shiftDay(periodEnd, -1)) && (!latest || row.property === latest.property)).sort((a, b) => b.date.localeCompare(a.date))[0] ?? null;
    const zone = CLUSTER_SITES.find(site => site.domain === page.siteDomain)?.ga4TimeZone ?? "America/Los_Angeles";
    const gaLaunchDay = new Intl.DateTimeFormat("en-CA", { timeZone: zone }).format(launch);
    const ga4 = (visits.get(key) ?? []).sort((a, b) => b.date.localeCompare(a.date));
    const beforeVisits = ga4.find(row => weekly ? row.date < gaLaunchDay : row.date === shiftDay(periodEnd, -1)) ?? null;
    const latestVisits = ga4.find(row => row.date > gaLaunchDay && (weekly || row.date === periodEnd)) ?? null;
    return { url: page.pageUrl, title: page.title, day, change, cohort: "current", before, latest, beforeVisits, latestVisits };
  });
  return includeAll ? pages : bestMonthlyOptimizations(pages);
}
