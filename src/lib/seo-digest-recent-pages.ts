import { analyticsSiteForProperty, safeAnalyticsUrl, type AnalyticsObservation } from "./seo-analytics";
import { CLUSTER_SITES } from "./seo-cluster-sites";
import { seoToday, shiftDay } from "./seo-date-range";
import { gscDate } from "./seo-page-effects";
import type { WorkflowSnapshot } from "./seo-workflow";

export function recentPublishedPages(workflow: Pick<WorkflowSnapshot, "approvals" | "publications">, observations: AnalyticsObservation[], end: string, now: Date, weekly: boolean) {
  const cutoff = Math.min(now.getTime(), Date.parse(shiftDay(end, weekly ? 0 : 1) + "T00:00:00+08:00") - 1);
  const friday = weekly ? shiftDay(end, -7) : shiftDay(end, -((new Date(end + "T00:00:00Z").getUTCDay() + 2) % 7));
  const previousStart = shiftDay(friday, -7);
  type Page = WorkflowSnapshot["publications"][number];
  type Change = "new" | "optimization";
  const approvals = new Map(workflow.approvals.map(approval => [approval.id, approval]));
  const firstNew = new Map<string, Page>();
  const changes: { page: Page; change: Change }[] = [];
  for (const page of workflow.publications) {
    if (page.status !== "verified" || !page.verifiedAt || !page.verificationRecordedAt
      || Date.parse(page.publishedAt) > cutoff || [page.verifiedAt, page.verificationRecordedAt].some(stamp => Date.parse(stamp) > now.getTime())
      || !safeAnalyticsUrl(page.pageUrl) || page.kind === "prompt") continue;
    const operation = page.automaticWrite?.operation ?? approvals.get(page.approvalId ?? "")?.items.find(item => item.id === page.approvalItemId)?.operation;
    if (page.kind === "optimization" || operation === "update") {
      changes.push({ page, change: "optimization" });
    } else if (operation === "new" || operation === "create") {
      const prior = firstNew.get(page.pageUrl);
      if (!prior || Date.parse(page.publishedAt) < Date.parse(prior.publishedAt)) firstNew.set(page.pageUrl, page);
    }
  }
  for (const page of firstNew.values()) changes.push({ page, change: "new" });
  const latestChanges = new Map<string, (typeof changes)[number]>();
  for (const entry of changes) {
    const day = seoToday(new Date(entry.page.publishedAt));
    if (day < previousStart) continue;
    const prior = latestChanges.get(entry.page.pageUrl);
    if (!prior || Date.parse(entry.page.publishedAt) > Date.parse(prior.page.publishedAt)) latestChanges.set(entry.page.pageUrl, entry);
  }
  type SearchPoint = { date: string; property: string; clicks: number; impressions: number };
  type VisitPoint = { date: string; visits: number };
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
    if (row.country || row.date >= end || Date.parse(row.observedAt) > now.getTime()) continue;
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
  return [...latestChanges.values()].map(({ page, change }) => {
    const launch = new Date(page.publishedAt), day = seoToday(launch);
    const key = analyticsKey(page.siteDomain, page.pageUrl);
    const gscLaunchDay = gscDate(launch), gsc = search.get(key) ?? [];
    const latest = gsc.filter(row => row.date > gscLaunchDay).sort((a, b) => b.date.localeCompare(a.date) || Number(b.property.startsWith("sc-domain:")) - Number(a.property.startsWith("sc-domain:")))[0] ?? null;
    const before = gsc.filter(row => row.date < gscLaunchDay && (!latest || row.property === latest.property)).sort((a, b) => b.date.localeCompare(a.date))[0] ?? null;
    const zone = CLUSTER_SITES.find(site => site.domain === page.siteDomain)?.ga4TimeZone ?? "America/Los_Angeles";
    const gaLaunchDay = new Intl.DateTimeFormat("en-CA", { timeZone: zone }).format(launch);
    const ga4 = (visits.get(key) ?? []).sort((a, b) => b.date.localeCompare(a.date));
    const beforeVisits = ga4.find(row => row.date < gaLaunchDay) ?? null;
    const latestVisits = ga4.find(row => row.date > gaLaunchDay) ?? null;
    return { url: page.pageUrl, title: page.title, day, change, cohort: day >= friday ? "current" as const : "previous" as const, before, latest, beforeVisits, latestVisits };
  }).sort((a, b) => (b.latest?.date ?? b.latestVisits?.date ?? "").localeCompare(a.latest?.date ?? a.latestVisits?.date ?? "")
    || (b.latest?.clicks ?? -1) - (a.latest?.clicks ?? -1) || (b.latest?.impressions ?? -1) - (a.latest?.impressions ?? -1)
    || (b.latestVisits?.visits ?? -1) - (a.latestVisits?.visits ?? -1) || b.day.localeCompare(a.day) || a.url.localeCompare(b.url));
}
