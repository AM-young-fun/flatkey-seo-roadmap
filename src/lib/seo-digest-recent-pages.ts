import { analyticsSiteForProperty, safeAnalyticsUrl, type AnalyticsObservation } from "./seo-analytics";
import { CLUSTER_SITES } from "./seo-cluster-sites";
import { seoToday, shiftDay } from "./seo-date-range";
import { gscDate } from "./seo-page-effects";
import type { WorkflowSnapshot } from "./seo-workflow";

export function recentPublishedPages(workflow: Pick<WorkflowSnapshot, "approvals" | "publications">, observations: AnalyticsObservation[], end: string, now: Date, weekly: boolean) {
  const friday = weekly ? end : shiftDay(end, -((new Date(end + "T00:00:00Z").getUTCDay() + 2) % 7));
  const previousStart = shiftDay(friday, weekly ? -14 : -7);
  const first = new Map<string, WorkflowSnapshot["publications"][number]>();
  for (const page of workflow.publications) {
    if (page.status !== "verified" || !page.verifiedAt || !page.verificationRecordedAt || Date.parse(page.verificationRecordedAt) > now.getTime()
      || !safeAnalyticsUrl(page.pageUrl) || !["source_blog", "translation", "landing", "cluster"].includes(page.kind)) continue;
    const approval = workflow.approvals.find(item => item.id === page.approvalId);
    const operation = approval?.items.find(item => item.id === page.approvalItemId)?.operation;
    if (operation !== "new" && page.automaticWrite?.operation !== "create") continue;
    const previous = first.get(page.pageUrl);
    if (!previous || Date.parse(page.publishedAt) < Date.parse(previous.publishedAt)) first.set(page.pageUrl, page);
  }
  return [...first.values()].flatMap(page => {
    const launch = new Date(page.publishedAt), day = seoToday(launch);
    if (day < previousStart || day > end || weekly && day === end) return [];
    const gscLaunchDay = gscDate(launch);
    const gsc = observations.filter(row => row.kind === "gsc-pages" && !row.country && row.complete && row.date < end
      && analyticsSiteForProperty(row.property) === page.siteDomain && Date.parse(row.observedAt) <= now.getTime())
      .flatMap(row => row.kind === "gsc-pages" ? row.rows.filter(item => item.url === page.pageUrl).map(item => ({
        date: row.date, property: row.property, clicks: item.clicks, impressions: item.impressions,
      })) : []);
    const latest = gsc.filter(row => row.date > gscLaunchDay).sort((a, b) => b.date.localeCompare(a.date) || Number(b.property.startsWith("sc-domain:")) - Number(a.property.startsWith("sc-domain:")))[0] ?? null;
    const before = gsc.filter(row => row.date < gscLaunchDay && (!latest || row.property === latest.property)).sort((a, b) => b.date.localeCompare(a.date))[0] ?? null;
    const target = new URL(page.pageUrl);
    const zone = CLUSTER_SITES.find(site => site.domain === page.siteDomain)?.ga4TimeZone ?? "America/Los_Angeles";
    const gaLaunchDay = new Intl.DateTimeFormat("en-CA", { timeZone: zone }).format(launch);
    const ga4 = observations.flatMap(row => {
      if (row.kind !== "ga4-pages" || row.country || !(row.sessionsComplete || row.complete) ||
        row.hostnameDimension !== "hostName" || row.date >= end || Date.parse(row.observedAt) > now.getTime() ||
        analyticsSiteForProperty(row.property) !== page.siteDomain) return [];
      const item = row.rows.find(item => item.hostname === target.hostname && item.path === target.pathname + target.search);
      return item?.sessions == null ? [] : [{ date: row.date, visits: item.sessions }];
    }).sort((a, b) => b.date.localeCompare(a.date));
    const beforeVisits = ga4.find(row => row.date < gaLaunchDay) ?? null;
    const latestVisits = ga4.find(row => row.date > gaLaunchDay) ?? null;
    return [{ url: page.pageUrl, title: page.title, day, cohort: (weekly ? day >= shiftDay(friday, -7) : day >= friday) ? "current" as const : "previous" as const, before, latest, beforeVisits, latestVisits }];
  }).sort((a, b) => (b.latest?.clicks ?? -1) - (a.latest?.clicks ?? -1) || (b.latest?.impressions ?? -1) - (a.latest?.impressions ?? -1)
    || (b.latestVisits?.visits ?? -1) - (a.latestVisits?.visits ?? -1) || b.day.localeCompare(a.day) || a.url.localeCompare(b.url));
}
