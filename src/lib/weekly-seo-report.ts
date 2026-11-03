import { weeklyEvidenceSchema } from "./weekly-evidence-schema";
import type { WeeklyTrafficEvidence } from "./weekly-traffic-evidence";
import { projectWeeklySeoTrafficEvidence } from "./weekly-seo-traffic";
import { comparableWeeklyCutoffs, reportingCutoff, type WeeklyReportingCutoff } from "./weekly-cutoff";
import { registrationRate, relativeChange } from "./weekly-traffic";

type TrafficRow = {
  siteDomain: string; periodStart: Date; periodEnd: Date; collectedAt: Date;
  newUsers: number; newRegistrations: number; timezone: string;
  ga4PropertyId: string | null; registrationMetric: string; analysis?: unknown;
};
type Archive = WeeklyTrafficEvidence & {
  siteDomain: string; timezone: string; propertyId: string; collectedAt: string;
};
type Periods = { current: { start: string; end: string }; previous: { start: string; end: string } };
type Metadata = { reportingCutoff?: WeeklyReportingCutoff | null; timezone: string; ga4PropertyId: string | null; registrationMetric: string; collectedAt: string };
export type SeoTrafficWeek = Metadata & {
  trafficScope: "organic_search"; channelDimension: string;
  newUsers: number; newRegistrations: number; registrationRate: number | null;
};
const DOMAINS = ["flatkey.ai", "rackrate.org", "modelfit.cc"];
const matchesTotals = (totals: WeeklyTrafficEvidence["totals"]["current"], row: TrafficRow) =>
  totals.newUsers === row.newUsers && totals.newRegistrations === row.newRegistrations;
const metadata = (row: TrafficRow): Metadata => ({ timezone: row.timezone, ga4PropertyId: row.ga4PropertyId,
  reportingCutoff: reportingCutoff(row.analysis), registrationMetric: row.registrationMetric, collectedAt: row.collectedAt.toISOString() });
const sameIdentity = (a: Metadata, b: Metadata) => a.timezone === b.timezone && a.ga4PropertyId === b.ga4PropertyId && a.registrationMetric === b.registrationMetric;
const samePeriodScope = (a: Metadata, b: Metadata) => sameIdentity(a, b) && comparableWeeklyCutoffs({ reportingCutoff: a.reportingCutoff }, { reportingCutoff: b.reportingCutoff });

/** Read-only projection: raw imports remain intact; unsegmented totals never become SEO totals. */
export function buildWeeklySeoTrafficReport(rows: TrafficRow[], periods: Periods, archive: Archive | null = null, domains = DOMAINS) {
  const newest = [...rows].sort((a, b) => b.collectedAt.getTime() - a.collectedAt.getTime());
  const rowFor = (domain: string, period: "current" | "previous") => newest.find(row => row.siteDomain === domain &&
    row.periodStart.toISOString().slice(0, 10) === periods[period].start && row.periodEnd.toISOString().slice(0, 10) === periods[period].end);
  const validated = (row: TrafficRow | undefined) => {
    const parsed = weeklyEvidenceSchema.safeParse(row?.analysis);
    return row && parsed.success && matchesTotals(parsed.data.totals.current, row) ? parsed.data : null;
  };
  const pack = (evidence: WeeklyTrafficEvidence | null, period: "current" | "previous", meta: Metadata): SeoTrafficWeek | null => {
    const seo = projectWeeklySeoTrafficEvidence(evidence);
    if (!seo?.complete) return null;
    const totals = seo.totals[period];
    return { ...meta, ...totals, trafficScope: "organic_search", channelDimension: seo.channelDimension,
      registrationRate: registrationRate(totals.newUsers, totals.newRegistrations) };
  };
  const evidenceBySite = new Map<string, ReturnType<typeof projectWeeklySeoTrafficEvidence>>();
  const siteTraffic = domains.map(siteDomain => {
    const currentRow = rowFor(siteDomain, "current"), previousRow = rowFor(siteDomain, "previous");
    let currentEvidence: WeeklyTrafficEvidence | null = validated(currentRow);
    // A dated supplement may fill a missing import, but must not replace a newer correction.
    const archived = archive?.siteDomain === siteDomain ? archive : null;
    const archiveMeta: Metadata | null = archived ? { timezone: archived.timezone, ga4PropertyId: archived.propertyId,
      registrationMetric: "sign_up_success_distinct_users", reportingCutoff: archived.reportingCutoff, collectedAt: archived.collectedAt } : null;
    let usingArchive = false;
    if (!currentEvidence && archived && archiveMeta && (!currentRow ||
      currentRow.collectedAt.getTime() <= Date.parse(archived.collectedAt) &&
      sameIdentity(metadata(currentRow), archiveMeta) && matchesTotals(archived.totals.current, currentRow))) {
      currentEvidence = archived; usingArchive = true;
    }
    const currentMeta = usingArchive ? archiveMeta : currentRow ? metadata(currentRow) : null;
    const current = currentMeta ? pack(currentEvidence, "current", currentMeta) : null;
    const previousEvidence = validated(previousRow);
    let previous = previousRow ? pack(previousEvidence, "current", metadata(previousRow)) : null;
    // The current analysis already contains a complete, same-scope preceding week.
    // Reuse it only while it agrees with any separately saved preceding-week record.
    const sameRawScope = (currentEvidence?.trafficScope ?? "all_users") === (previousEvidence?.trafficScope ?? "all_users");
    if (!previous && currentEvidence && currentMeta && (!previousRow ||
      sameIdentity(currentMeta, metadata(previousRow)) && previousRow.collectedAt.getTime() <= Date.parse(currentMeta.collectedAt) &&
      (!sameRawScope || matchesTotals(currentEvidence.totals.previous, previousRow)))) {
      previous = pack(currentEvidence, "previous", previousRow ? metadata(previousRow) : currentMeta);
    }
    const seo = projectWeeklySeoTrafficEvidence(currentEvidence);
    if (seo && current && previous && samePeriodScope(current, previous) && current.channelDimension === previous.channelDimension &&
      seo.totals.previous.newUsers === previous.newUsers && seo.totals.previous.newRegistrations === previous.newRegistrations) {
      evidenceBySite.set(siteDomain, seo);
    }
    return { siteDomain, current, previous };
  });
  const total = (period: "current" | "previous") => {
    const values = siteTraffic.flatMap(site => site[period] ? [site[period]!] : []);
    if (!values.length) return null;
    const newUsers = values.reduce((sum, row) => sum + row.newUsers, 0);
    const newRegistrations = values.reduce((sum, row) => sum + row.newRegistrations, 0);
    return { newUsers, newRegistrations, trafficScope: "organic_search" as const,
      registrationRate: registrationRate(newUsers, newRegistrations), collectedAt: values.map(row => row.collectedAt).sort().at(-1),
      sites: values.length, timezones: [...new Set(values.map(row => row.timezone))],
      registrationMetrics: [...new Set(values.map(row => row.registrationMetric))] };
  };
  const current = total("current"), previous = total("previous");
  const currentSites = siteTraffic.filter(site => site.current).map(site => site.siteDomain);
  const previousSites = siteTraffic.filter(site => site.previous).map(site => site.siteDomain);
  const comparable = Boolean(current && previous && currentSites.join() === previousSites.join() && siteTraffic.every(site =>
    !site.current || site.previous && samePeriodScope(site.current, site.previous) && site.current.channelDimension === site.previous.channelDimension));
  const flatkey = siteTraffic.find(site => site.siteDomain === "flatkey.ai");
  const flatkeyEvidence = evidenceBySite.get("flatkey.ai");
  return {
    evidence: flatkeyEvidence && flatkey?.current ? { ...flatkeyEvidence, siteDomain: "flatkey.ai", timezone: flatkey.current.timezone,
      propertyId: flatkey.current.ga4PropertyId ?? "", collectedAt: flatkey.current.collectedAt } : null,
    traffic: { trafficScope: "organic_search" as const, current, previous, currentSites, previousSites, siteTraffic,
      complete: Boolean(current), comparable, changes: {
        newUsers: comparable ? relativeChange(current!.newUsers, previous!.newUsers) : null,
        newRegistrations: comparable ? relativeChange(current!.newRegistrations, previous!.newRegistrations) : null,
        registrationRate: comparable ? relativeChange(current!.registrationRate, previous!.registrationRate) : null,
        ratePoints: comparable && current!.registrationRate !== null && previous!.registrationRate !== null
          ? (current!.registrationRate - previous!.registrationRate) * 100 : null,
      } },
  };
}
