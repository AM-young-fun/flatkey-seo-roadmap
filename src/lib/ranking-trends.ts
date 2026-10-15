export const EARLIEST_TREND_DATE = "2026-10-08";

export function trendToday(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(now);
}

export function trendRange(start = EARLIEST_TREND_DATE, end = trendToday(), now = new Date()) {
  const valid = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
  if (!valid(start) || !valid(end) || start < EARLIEST_TREND_DATE || start > end || end > trendToday(now)) throw new Error("日期范围须从 2026-10-08 开始，结束日期不能早于开始日期或晚于今天");
  return { start, end };
}

export type TrendPoint = { date: string; counts: number[]; sites: string[]; sources: string[] };
export type DailySnapshot = {
  date: string;
  region: import("./seo").SearchRegionCode;
  sites: string[];
  rankings: { siteDomain: string; keyword: string; rank: number; source: "gsc" | "ahrefs"; collectedAt: string }[];
};
export type TrendResult = { points: TrendPoint[]; mode: "daily"; start: string; end: string; snapshot: DailySnapshot | null };
type DailyReport = { date: Date; siteDomain: string; source: string; top10: number; top30: number; top50: number; top100: number };

export function recentTrendRange(now = new Date()) {
  const end = trendToday(now);
  const start = new Date(`${end}T00:00:00Z`);
  start.setUTCDate(start.getUTCDate() - 6);
  return { start: start.toISOString().slice(0, 10) < EARLIEST_TREND_DATE ? EARLIEST_TREND_DATE : start.toISOString().slice(0, 10), end };
}

export function selectDailyReports<T extends DailyReport>(rows: T[], start: string, end: string) {
  const siteSources = new Map<string, string>();
  for (const row of rows) if (!siteSources.has(row.siteDomain) || row.source === "gsc") siteSources.set(row.siteDomain, row.source);
  const dates = new Map<string, Map<string, T>>();
  for (const row of rows) {
    const date = row.date.toISOString().slice(0, 10);
    if (date < start || date > end || row.source !== siteSources.get(row.siteDomain)) continue;
    const day = dates.get(date) ?? new Map<string, T>();
    if (!day.has(row.siteDomain)) day.set(row.siteDomain, row);
    dates.set(date, day);
  }
  return [...dates].filter(([, day]) => day.size === siteSources.size).sort(([a], [b]) => a.localeCompare(b));
}

// Rows arrive newest correction first. A site keeps the same source throughout
// the series; a missing site/day remains a gap rather than an artificial loss.
export function dailyReportPoints(rows: DailyReport[], start: string, end: string): TrendPoint[] {
  return selectDailyReports(rows, start, end).map(([date, day]) => ({
    date, counts: [...day.values()].reduce((sum, row) => sum.map((value, i) => value + [row.top10, row.top30, row.top50, row.top100][i]), [0, 0, 0, 0]),
    sites: [...day.keys()].sort(), sources: [...new Set([...day.values()].map(row => row.source))].sort(),
  })).sort((a, b) => a.date.localeCompare(b.date));
}
