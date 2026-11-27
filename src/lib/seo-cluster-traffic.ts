import { analyticsStorageKind, rangeDays, type AnalyticsObservation } from "./seo-analytics";
import { CLUSTER_SITES } from "./seo-cluster-sites";
import type { DateRange } from "./seo-date-range";

export const clusterTrafficKind = (site: typeof CLUSTER_SITES[number]["domain"]) =>
  analyticsStorageKind("ga4-site", "all", site);

function periodSessions(days: { sessions: number | null }[]) {
  const observed = days.flatMap(({ sessions }) => sessions === null ? [] : [sessions]);
  return {
    total: observed.length === days.length ? observed.reduce((sum, count) => sum + count, 0) : null,
    recordedDays: observed.length,
  };
}

export function clusterTraffic(range: DateRange, previous: DateRange, observations: AnalyticsObservation[]) {
  const currentDates = rangeDays(range), previousDates = rangeDays(previous);
  const byPropertyAndDate = new Map(observations.flatMap(row =>
    row.kind === "ga4-site" && (row.country ?? "all") === "all"
      ? [[`${row.property}:${row.date}`, row.sessions] as const] : []));
  const sites = CLUSTER_SITES.map(({ domain, name, ga4, ga4TimeZone }) => {
    const readDays = (dates: string[]) => dates.map(date => ({
      date, sessions: byPropertyAndDate.get(`${ga4}:${date}`) ?? null,
    }));
    const daily = readDays(currentDates);
    return {
      domain, name, timezone: ga4TimeZone, daily,
      current: periodSessions(daily), previous: periodSessions(readDays(previousDates)),
    };
  });
  return { ...range, previous, sites };
}

export type ClusterTraffic = ReturnType<typeof clusterTraffic>;
