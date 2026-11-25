import { analyticsSiteForProperty, landingTrafficDays, rangeDays, type AnalyticsObservation } from "./seo-analytics";
import { previousRange, shiftDay, type DateRange } from "./seo-date-range";
import { landingModuleSessions } from "./seo-overview-analytics";
import { TRAFFIC_SUMMARY_SITE_METRICS, trafficSummaryTrendDay, type TrafficSummaryDay, type TrafficSummaryPeriod } from "./seo-traffic-summary";

export function trafficOverview(scan: DateRange, requested: DateRange | null, summaryDays: TrafficSummaryDay[], observations: AnalyticsObservation[]) {
  const source = observations.filter(row => analyticsSiteForProperty(row.property) === "flatkey.ai" && (row.country ?? "all") === "all");
  const byDay = new Map(summaryDays.map(row => [row.date, row]));
  const site = rangeDays(scan).map(date => trafficSummaryTrendDay(date, byDay.get(date) ?? null));
  const landing = landingTrafficDays(scan, source);
  const completeDates = new Set(site.flatMap(({ date, site }, index) =>
    TRAFFIC_SUMMARY_SITE_METRICS.every(metric => site[metric] !== null)
    && landing[index].paths?.every(([, count]) => count !== null) ? [date] : []));
  const completeWeekEnd = requested ? null : [...completeDates].reverse().find(end =>
    Array.from({ length: 7 }, (_, index) => shiftDay(end, -index)).every(date => completeDates.has(date))) ?? null;
  const end = completeWeekEnd ?? scan.end;
  const range = requested ?? { start: shiftDay(end, -6), end };
  const inRange = ({ date }: { date: string }) => date >= range.start && date <= range.end;
  const selectedLanding = landing.filter(inRange);
  const modules = landingModuleSessions(selectedLanding);
  const moduleDays = selectedLanding.map(day => ({ date: day.date, sessions: landingModuleSessions([day]).sessions }));
  return { ...range, automatic: !requested, completeWeekEnd, daily: site.filter(inRange), modules, moduleDays };
}

export function trafficPeriodComparison(range: DateRange, periods: TrafficSummaryPeriod[]) {
  const previous = previousRange(range);
  const exact = (window: DateRange) => periods.find(row => row.start === window.start && row.end === window.end);
  const current = exact(range), prior = exact(previous);
  return { previous, sessions: { current: current?.totalSessions?.value ?? null, previous: prior?.totalSessions?.value ?? null },
    registrations: { current: current?.totalRegistrations?.value ?? null, previous: prior?.totalRegistrations?.value ?? null } };
}

export type TrafficOverview = ReturnType<typeof trafficOverview> & { comparison: ReturnType<typeof trafficPeriodComparison> | null };
