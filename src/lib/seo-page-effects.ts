import { analyticsSiteForProperty, rangeDays, type AnalyticsObservation } from "./seo-analytics";
import { shiftDay, type DateRange } from "./seo-date-range";
import type { SeoCountry } from "./seo";
import type { WorkflowPublication, WorkflowSnapshot } from "./seo-workflow";

export const GSC_TIMEZONE = "America/Los_Angeles";
export const OPTIMIZATION_HISTORY_DAYS = 90;
export const OPTIMIZATION_BASELINE_DAYS = 30;
export const gscDate = (date: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: GSC_TIMEZONE }).format(date);
export const gscPeriodEnd = (now: Date) => shiftDay(gscDate(now), -1);

type GscPages = Extract<AnalyticsObservation, { kind: "gsc-pages" }>;
export type GscPoint = { date: string; clicks: number; impressions: number; ctr: number | null; position: number | null };
export type GscSeries = { date: string; clicks: number | null; impressions: number | null; ctr: number | null; position: number | null }[];

export function optimizationTrendDays(series: GscSeries, gaDays: { date: string; sessions: number | null; registrations: number | null }[], launchDay: string) {
  const search = new Map(series.map(day => [day.date, day]));
  const analytics = new Map(gaDays.map(day => [day.date, day]));
  const dates = [...new Set([...search.keys(), ...analytics.keys(), launchDay])].sort();
  const first = dates.findIndex(date => {
    const gsc = search.get(date), ga4 = analytics.get(date);
    return [gsc?.clicks, gsc?.impressions, gsc?.ctr, gsc?.position, ga4?.sessions, ga4?.registrations].some(value => value != null);
  });
  return first < 0 ? [] : dates.slice(first).map(date => ({
    date,
    clicks: search.get(date)?.clicks ?? null,
    impressions: search.get(date)?.impressions ?? null,
    ctr: search.get(date)?.ctr ?? null,
    position: search.get(date)?.position ?? null,
    sessions: analytics.get(date)?.sessions ?? null,
    registrations: analytics.get(date)?.registrations ?? null,
  }));
}


export type OptimizedEffectVersion = { id: string; date: string | null };
export type OptimizedEffectPage = {
  url: string; title: string; site: string; versions: OptimizedEffectVersion[];
};

type MetricDay = { date: string; value: number | null; weight?: number | null };
export function optimizationWeekComparison(days: MetricDay[], optimizedDay: string) {
  const observations = days.filter(day => day.value != null && day.weight !== null);
  const start = shiftDay(optimizedDay, -7), end = shiftDay(optimizedDay, 7);
  const before = observations.filter(day => day.date >= start && day.date < optimizedDay);
  const after = observations.filter(day => day.date > optimizedDay && day.date <= end);
  const weekday = (day: MetricDay) => new Date(day.date + "T00:00:00Z").getUTCDay();
  const pairedBefore = before.filter(day => after.some(other => weekday(day) === weekday(other)));
  const pairedAfter = after.filter(day => pairedBefore.some(other => weekday(day) === weekday(other)));
  const total = (entries: MetricDay[]) => {
    const weight = entries.reduce((sum, day) => sum + (day.weight ?? 0), 0);
    const values = entries.reduce((sum, day) => sum + (day.value ?? 0) * (day.weight ?? 1), 0);
    return !entries.length ? null : entries[0].weight === undefined ? values : weight ? values / weight : null;
  };
  const beforeValue = total(pairedBefore.length ? pairedBefore : before);
  const afterValue = total(pairedAfter.length ? pairedAfter : after);
  return { beforeValue, afterValue, paired: pairedBefore.length,
    beforeDays: pairedBefore.length || before.length, afterDays: pairedAfter.length || after.length };
}

export function completeGscReports(observations: AnalyticsObservation[], site: string, country: SeoCountry, range: DateRange, now: Date) {
  const reports = new Map<string, GscPages>();
  const today = gscDate(now);
  for (const row of observations) {
    if (row.kind !== "gsc-pages" || !row.complete || analyticsSiteForProperty(row.property) !== site
      || (row.country ?? "all") !== country || row.date < range.start || row.date > range.end
      || row.date >= today || Date.parse(row.observedAt) > now.getTime()) continue;
    const key = JSON.stringify([row.property, row.date]);
    const previous = reports.get(key);
    if (!previous || Date.parse(row.observedAt) > Date.parse(previous.observedAt)) reports.set(key, row);
  }
  return [...reports.values()].sort((a, b) => a.date.localeCompare(b.date) || Number(a.property.startsWith("sc-domain:")) - Number(b.property.startsWith("sc-domain:")) || a.property.localeCompare(b.property));
}

export function gscPoint(report: GscPages, url: string): GscPoint | null {
  const row = report.rows.find(row => row.url === url);
  if (!row || row.clicks > row.impressions) return null;
  return { date: report.date, clicks: row.clicks, impressions: row.impressions,
    ctr: row.impressions ? row.clicks / row.impressions : null, position: row.position };
}

export function optimizationRange(publishedAt: string, end: string): DateRange {
  return { start: shiftDay(gscDate(new Date(publishedAt)), -OPTIMIZATION_BASELINE_DAYS), end };
}

export function optimizationEffect(input: {
  url: string; site: string; country: SeoCountry; publishedAt: string; end: string; now: Date; observations: AnalyticsObservation[];
}) {
  const launchDay = gscDate(new Date(input.publishedAt));
  const range = optimizationRange(input.publishedAt, input.end);
  const reports = completeGscReports(input.observations, input.site, input.country, range, input.now);
  const available = reports.flatMap(report => {
    const point = gscPoint(report, input.url);
    return point ? [{ point, property: report.property }] : [];
  });
  // Keep both points on the same property. Preserve the actual last complete pre-release row.
  const beforeRow = available.filter(row => row.point.date < launchDay).at(-1);
  const property = beforeRow?.property ?? available.at(-1)?.property ?? null;
  const byDate = new Map(available.filter(row => row.property === property).map(row => [row.point.date, row.point]));
  const before = beforeRow?.point ?? null;
  const afterRelease = [...byDate.values()].filter(row => row.date > launchDay);
  const first = afterRelease[0] ?? null;
  const latest = afterRelease.at(-1) ?? null;
  const series: GscSeries = rangeDays({ ...range, end: range.end > launchDay ? range.end : launchDay }).map(date => {
    const row = byDate.get(date);
    return { date, clicks: row?.clicks ?? null, impressions: row?.impressions ?? null, ctr: row?.ctr ?? null, position: row?.position ?? null };
  });
  const status = !before || !latest ? "waiting" : before.impressions < 20 || latest.impressions < 20 ? "observing" : "updated";
  return { launchDay, property, before, first, latest, status, series,
    reason: !before ? "缺少上线前同口径的完整页面数据" : !latest ? "尚无上线后的完整页面数据"
      : status === "observing" ? "单日曝光较少，结合折线继续观察" : "已取得两日数据，结合折线复核变化" } as const;
}

export type OptimizationEffect = ReturnType<typeof optimizationEffect>;
export type OptimizationReportRow = Omit<OptimizationEffect, "series"> & {
  id: string; url: string; title: string; country: SeoCountry; publishedAt: string; change: string;
};

export function verifiedPagePublications(rows: WorkflowPublication[], cutoff: Date) {
  const latest = new Map<string, WorkflowPublication>();
  for (const row of rows) {
    if (row.status !== "verified" || !row.verifiedAt || !row.verificationRecordedAt
      || [row.publishedAt, row.verifiedAt, row.verificationRecordedAt].some(value => Date.parse(value) > cutoff.getTime())) continue;
    const key = JSON.stringify([row.siteDomain, row.pageUrl, row.country ?? "all"]);
    const previous = latest.get(key);
    if (!previous || Date.parse(row.publishedAt) > Date.parse(previous.publishedAt)) latest.set(key, row);
  }
  return [...latest.values()].sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
}

export function optimizationReportRows(workflow: Pick<WorkflowSnapshot, "publications" | "optimizations">, observations: AnalyticsObservation[], now: Date, end: string, versionCutoff = now): OptimizationReportRow[] {
  const since = shiftDay(gscDate(now), -OPTIMIZATION_HISTORY_DAYS);
  const changes = new Map(workflow.optimizations.flatMap(row => row.changes.map(change => [change.publicationId, change.description] as const)));
  return verifiedPagePublications(workflow.publications, versionCutoff).flatMap(row => {
    if (row.kind !== "optimization" || gscDate(new Date(row.publishedAt)) < since) return [];
    const country = row.country ?? "all";
    const { series: _series, ...effect } = optimizationEffect({
      url: row.pageUrl, site: row.siteDomain, country, publishedAt: row.publishedAt, observations, end, now,
    });
    return [{ ...effect, id: row.id, url: row.pageUrl, title: row.title, country, publishedAt: row.publishedAt, change: changes.get(row.id) ?? "改动摘要待补" }];
  });
}

export const effectStatusLabel = { waiting: "待数据", observing: "观察中", updated: "数据已更新" } as const;

export const formatCtr = (value: number | null | undefined) => value == null ? "—" : (value * 100).toFixed(2) + "%";
export const formatDelta = (value: number) => (value > 0 ? "+" : "") + value.toLocaleString("zh-CN", { maximumFractionDigits: 2 });
