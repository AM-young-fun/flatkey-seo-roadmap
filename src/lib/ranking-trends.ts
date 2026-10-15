export const EARLIEST_TREND_DATE = "2026-10-08";

export function trendToday(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(now);
}

export function trendRange(start = EARLIEST_TREND_DATE, end = trendToday(), now = new Date()) {
  const valid = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
  if (!valid(start) || !valid(end) || start < EARLIEST_TREND_DATE || start > end || end > trendToday(now)) throw new Error("日期范围须从 2026-10-08 开始，结束日期不能早于开始日期或晚于今天");
  return { start, end };
}

export type TrendPoint = { date: string; counts: number[]; sites: string[]; sources: string[]; asOf?: string };
export type TrendResult = { points: TrendPoint[]; mode: "capture"; start: string; end: string; snapshot: null };

// A point is the known inventory at the end of a date, not that date's intake.
// Carry the last known state forward while retaining its actual update date.
export function inventoryTrendByDay(updates: TrendPoint[], start: string, end: string): TrendPoint[] {
  const sorted = [...updates].sort((a,b)=>a.date.localeCompare(b.date));
  let index = 0;
  let known: TrendPoint | undefined;
  const result: TrendPoint[] = [];
  for (const day = new Date(`${start}T00:00:00Z`); day <= new Date(`${end}T00:00:00Z`); day.setUTCDate(day.getUTCDate()+1)) {
    const date = day.toISOString().slice(0,10);
    while (index < sorted.length && sorted[index].date <= date) known = sorted[index++];
    if (known) result.push({...known,date,asOf:known.asOf ?? known.date,counts:[...known.counts]});
  }
  return result;
}

export function snapshotTrendPoints(rows: {date:string;rank:number|null;siteDomain:string;source:string}[]): TrendPoint[] {
  const points = new Map<string, TrendPoint>();
  for (const row of rows) {
    const point = points.get(row.date) ?? {date:row.date,counts:[0,0,0,0],sites:[],sources:[]};
    const rank = row.rank;
    if (rank != null && rank >= 1 && rank <= 100) point.counts[rank <= 10 ? 0 : rank <= 30 ? 1 : rank <= 50 ? 2 : 3]++;
    if (row.siteDomain && !point.sites.includes(row.siteDomain)) point.sites.push(row.siteDomain);
    if (row.source && !point.sources.includes(row.source)) point.sources.push(row.source);
    points.set(row.date, point);
  }
  return [...points.values()].sort((a,b)=>a.date.localeCompare(b.date));
}

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
