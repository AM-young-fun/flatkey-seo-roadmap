import { keywordRelevance } from "./keyword-relevance";
import { buildRankingEvidence, latestQueryEvidence, type RankingObservationRow } from "./ranking-evidence";
import type { SearchRegionCode } from "./seo";

export const EARLIEST_TREND_DATE = "2026-10-08";

export function trendToday(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(now);
}

export function trendRange(start = EARLIEST_TREND_DATE, end = trendToday(), now = new Date()) {
  const valid = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
  if (!valid(start) || !valid(end) || start < EARLIEST_TREND_DATE || start > end || end > trendToday(now)) throw new Error("日期范围须从 2026-10-08 开始，结束日期不能早于开始日期或晚于今天");
  return { start, end };
}

export type LegacyTrendPoint = { date: string; counts: number[]; sites: string[]; sources: string[]; asOf?: string };
export type TrendPoint = {
  date: string; counts: number[]; sites: string[]; sources: string[];
  total: number; ranked: number; pending: number; outside: number;
  periodStart: string; periodEnd: string;
};
export type TrendResult = { schemaVersion: 2; points: TrendPoint[]; mode: "weekly-evidence"; start: string; end: string; snapshot: null; asOf: string };
export type TrendKeyword = {
  keywordId: string; text: string; siteDomain: string; active: boolean; keywordActive: boolean;
  siteActive: boolean; topicId: string | null; pool: string;
};

export function eligibleTrendKeywords(rows: TrendKeyword[]): TrendKeyword[] {
  const eligible = new Map<string, TrendKeyword>();
  for (const row of rows) {
    if (!["flatkey.ai", "rackrate.org", "modelfit.cc"].includes(row.siteDomain) || !row.active || !row.keywordActive || !row.siteActive || !row.topicId) continue;
    if (row.siteDomain === "flatkey.ai" && row.pool !== "FORMAL") continue;
    if (keywordRelevance(row.siteDomain, row.text).status === "unrelated") continue;
    eligible.set(`${row.siteDomain}:${row.keywordId}`, row);
  }
  return [...eligible.values()];
}

export function trendPeriod(date: string) {
  const end = new Date(`${date}T00:00:00Z`);
  return { start: new Date(end.getTime() - 6 * 86400000).toISOString().slice(0, 10), end: date, label: `连续7个完整自然日 · ${date}` };
}

// Every point represents its report period, recalculated from evidence currently
// imported. GSC publication lag never becomes a fictitious collection history.
export function weeklyEvidenceTrendPoints(keywords: TrendKeyword[], observations: RankingObservationRow[], region: SearchRegionCode, start: string, end: string): TrendPoint[] {
  const eligible = eligibleTrendKeywords(keywords);
  const wanted = new Set(eligible.map(row => `${row.siteDomain}:${row.keywordId}`));
  const byKeyword = new Map<string, RankingObservationRow[]>();
  for (const row of observations) {
    const key = `${row.siteDomain}:${row.keywordId}`;
    if (row.region !== region || !wanted.has(key)) continue;
    byKeyword.set(key, [...(byKeyword.get(key) ?? []), row]);
  }
  const sites = [...new Set(eligible.map(row => row.siteDomain))].sort();
  const points: TrendPoint[] = [];
  for (const day = new Date(`${start}T00:00:00Z`); day <= new Date(`${end}T00:00:00Z`); day.setUTCDate(day.getUTCDate() + 1)) {
    const date = day.toISOString().slice(0, 10), period = trendPeriod(date);
    const point: TrendPoint = { date, counts: [0, 0, 0, 0], sites, sources: [], total: eligible.length, ranked: 0, pending: 0, outside: 0, periodStart: period.start, periodEnd: period.end };
    for (const keyword of eligible) {
      const rows = byKeyword.get(`${keyword.siteDomain}:${keyword.keywordId}`) ?? [];
      const evidence = latestQueryEvidence(buildRankingEvidence(rows, [], period));
      if (!evidence) { point.pending++; continue; }
      if (!point.sources.includes(evidence.source)) point.sources.push(evidence.source);
      if (evidence.rankStatus === "outside_top100") point.outside++;
      else if (evidence.rank != null && evidence.rank >= 1 && evidence.rank <= 100) {
        point.counts[evidence.rank <= 10 ? 0 : evidence.rank <= 30 ? 1 : evidence.rank <= 50 ? 2 : 3]++;
        point.ranked++;
      } else point.pending++;
    }
    point.sources.sort();
    points.push(point);
  }
  return points;
}

// A point is the known inventory at the end of a date, not that date's intake.
// Carry the last known state forward while retaining its actual update date.
export function inventoryTrendByDay(updates: LegacyTrendPoint[], start: string, end: string): LegacyTrendPoint[] {
  const sorted = [...updates].sort((a,b)=>a.date.localeCompare(b.date));
  let index = 0;
  let known: LegacyTrendPoint | undefined;
  const result: LegacyTrendPoint[] = [];
  for (const day = new Date(`${start}T00:00:00Z`); day <= new Date(`${end}T00:00:00Z`); day.setUTCDate(day.getUTCDate()+1)) {
    const date = day.toISOString().slice(0,10);
    while (index < sorted.length && sorted[index].date <= date) known = sorted[index++];
    if (known) result.push({...known,date,asOf:known.asOf ?? known.date,counts:[...known.counts]});
  }
  return result;
}

export function snapshotTrendPoints(rows: {date:string;rank:number|null;siteDomain:string;source:string}[]): LegacyTrendPoint[] {
  const points = new Map<string, LegacyTrendPoint>();
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

export function recentTrendRange(now = new Date(), reportEnd?: string) {
  const end = reportEnd ?? new Date(Date.parse(`${trendToday(now)}T00:00:00Z`) - 86400000).toISOString().slice(0, 10);
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
export function dailyReportPoints(rows: DailyReport[], start: string, end: string): LegacyTrendPoint[] {
  return selectDailyReports(rows, start, end).map(([date, day]) => ({
    date, counts: [...day.values()].reduce((sum, row) => sum.map((value, i) => value + [row.top10, row.top30, row.top50, row.top100][i]), [0, 0, 0, 0]),
    sites: [...day.keys()].sort(), sources: [...new Set([...day.values()].map(row => row.source))].sort(),
  })).sort((a, b) => a.date.localeCompare(b.date));
}
