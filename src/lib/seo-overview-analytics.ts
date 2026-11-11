import { landingTrafficDays, rangeDays, type AnalyticsObservation } from "./seo-analytics";
import type { DateRange } from "./seo-date-range";
import { overviewPageModule, type OverviewPageModule } from "./seo-overview-scope";

export type ModuleDay = { date: string; sessions: number | null; clicks: number | null; impressions: number | null; searchComplete: boolean };
export type ModuleAnalytics = DateRange & {
  scope: "module-organic-search"; module: OverviewPageModule; daily: ModuleDay[];
  ga4Through: string | null; gscThrough: string | null; observedAt: string | null;
};
const matches = (url: string, module: OverviewPageModule) => {
  const value = overviewPageModule(url);
  return module === "all" || (module === "unknown" ? value === null : value === module);
};

/** One GA4 session has one landing page. Never duplicate it for GSC URL fragments. */
export function overviewModuleAnalytics(range: DateRange, module: OverviewPageModule, observations: AnalyticsObservation[]): ModuleAnalytics {
  const dates = rangeDays(range), allowed = new Set(dates);
  const rows = observations.filter(row => allowed.has(row.date));
  const landing = new Map(landingTrafficDays(range, rows).map(day => [day.date, day]));
  const search = new Map(rows.flatMap(row => row.kind === "gsc-pages" ? [[row.date, row] as const] : []));
  const through = (kind: AnalyticsObservation["kind"]) => rows.filter(row => row.kind === kind).map(row => row.date).sort().at(-1) ?? null;
  return {
    ...range, scope: "module-organic-search", module,
    ga4Through: through("ga4-pages"), gscThrough: through("gsc-pages"), observedAt: rows.map(row => row.observedAt).sort().at(-1) ?? null,
    daily: dates.map(date => {
      const paths = landing.get(date)?.paths;
      const selected = paths?.filter(([url]) => matches(url, module));
      const sessions = selected && selected.every(([, count]) => count !== null) ? selected.reduce((sum, [, count]) => sum + count!, 0) : null;
      const report = search.get(date), pages = report?.rows.filter(row => matches(row.url, module));
      // Missing/provisional empty reports cannot establish zero. Each raw GSC row is added once.
      const available = pages && (pages.length > 0 || report?.complete);
      return { date, sessions,
        clicks: available ? pages.reduce((sum, row) => sum + row.clicks, 0) : null,
        impressions: available ? pages.reduce((sum, row) => sum + row.impressions, 0) : null,
        searchComplete: Boolean(report?.complete),
      };
    }),
  };
}

export function overviewMetricSummary(data: ModuleAnalytics | null, metric: "sessions" | "clicks" | "impressions") {
  const daily = data?.daily ?? [], measured = daily.filter(day => day[metric] !== null);
  return { total: measured.length ? measured.reduce((sum, day) => sum + day[metric]!, 0) : null,
    measured: metric === "sessions" ? measured.length : measured.filter(day => day.searchComplete).length, days: daily.length };
}
