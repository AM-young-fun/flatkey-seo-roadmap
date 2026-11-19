import { analyticsObservationSchema, analyticsStorageKind, type AnalyticsObservation } from "./seo-analytics";
import { CLUSTER_SITES, clusterDomainForProperty, type ClusterDomain } from "./seo-cluster-sites";
import { collectionDateRange, shiftDay, validRange, type DateRange } from "./seo-date-range";
import type { SeoCountry } from "./seo";
type Saved = { kind: string; date: string; payload: unknown };
export function archiveMetricHealth(dates: string[], rows: Saved[], kind: string, measured: (row: AnalyticsObservation) => boolean) {
  const byDate = new Map(rows.filter(row => row.kind === kind).map(row => [row.date, row]));
  const missingDates: string[] = [], unknownDates: string[] = [], measuredDates: string[] = [];
  const observed: string[] = [];
  for (const date of dates) {
    const raw = byDate.get(date);
    if (!raw) { missingDates.push(date); continue; }
    const parsed = analyticsObservationSchema.safeParse(raw.payload);
    if (!parsed.success || parsed.data.date !== date || analyticsStorageKind(parsed.data.kind, parsed.data.country, clusterDomainForProperty(parsed.data.property)) !== kind || !measured(parsed.data)) { unknownDates.push(date); continue; }
    measuredDates.push(date); observed.push(parsed.data.observedAt);
  }
  return { status: measuredDates.length === dates.length && dates.length > 0 ? "ready" : measuredDates.length ? "partial" : "missing", expectedDays: dates.length, measuredDays: measuredDates.length, missingDates, unknownDates,
    through: measuredDates.at(-1) ?? null, observedAt: observed.sort().at(-1) ?? null };
}
export function basicAnalyticsHealth(range: DateRange, country: SeoCountry, rows: Saved[], now = new Date()) {
  if (!validRange(range) || Date.parse(range.end) - Date.parse(range.start) > 89 * 86400000) throw new Error("Invalid health range");
  const datesFor = (timezone: string) => {
    const ended = collectionDateRange(1, now, timezone).end;
    const end = range.end < ended ? range.end : ended;
    const dates: string[] = [];
    for (let date = range.start; date <= end; date = shiftDay(date, 1)) dates.push(date);
    return dates;
  };
  return { ...range, country, checkedAt: now.toISOString(), sites: [{ domain: "flatkey.ai", name: "Flatkey", ga4TimeZone: "America/Los_Angeles" }, ...CLUSTER_SITES].map(site => {
    const domain = site.domain === "flatkey.ai" ? undefined : site.domain as ClusterDomain;
    const kind = (name: "ga4-site" | "gsc-site" | "ga4-pages" | "gsc-pages") => analyticsStorageKind(name, country, domain);
    const gaDates = datesFor(site.ga4TimeZone), gscDates = datesFor("America/Los_Angeles");
    const sessions = archiveMetricHealth(gaDates, rows, kind("ga4-site"), r => r.kind === "ga4-site" && r.sessions !== null && (r.property !== "541304395" || r.hostScope === "production-hosts-v1"));
    const registrations = archiveMetricHealth(gaDates, rows, kind("ga4-site"), r => r.kind === "ga4-site" && r.registrations !== null && r.complete);
    const search = archiveMetricHealth(gscDates, rows, kind("gsc-site"), r => r.kind === "gsc-site" && r.complete);
    const pages = ["flatkey.ai", "rackrate.org", "modelfit.cc"].includes(site.domain) ? {
      sessions: archiveMetricHealth(gaDates, rows, kind("ga4-pages"), r => r.kind === "ga4-pages" && Boolean(r.sessionsComplete || r.complete) && r.rows.every(p => p.sessions !== null && Boolean(p.hostname))),
      search: archiveMetricHealth(gscDates, rows, kind("gsc-pages"), r => r.kind === "gsc-pages" && r.complete),
    } : null;
    return { site: site.domain, name: site.name, ga4Timezone: site.ga4TimeZone, gscTimezone: "America/Los_Angeles", sessions, registrations, search, pages, basicReady: sessions.status === "ready" && search.status === "ready" };
  }) };
}
export type BasicAnalyticsHealth = ReturnType<typeof basicAnalyticsHealth>;
