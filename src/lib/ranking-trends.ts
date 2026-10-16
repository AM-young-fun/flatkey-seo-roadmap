import { eligibleSerpTargets } from "./serp-targets";
import { buildRankingEvidence, latestQueryEvidence, type RankingObservationRow } from "./ranking-evidence";
import { REGION_CODES, type SearchRegionCode } from "./seo";
import { aggregateSerpRegionResults, buildSerpKeywordResults, serpTaskPeriod, summarizeSerpMovements, summarizeSerpResults, type SerpKeywordResult, type SerpTaskRead, type SerpTrendCohort, type SerpRunScope } from "./serp-results";
import type { SerpTarget } from "./serp-targets";

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
  snapshotAt?: string;
  dataDates?: string[];
  checked?: number;
  failed?: number;
  incomplete?: number;
  queued?: number;
  periodKey?: string;
  periodLabel?: string;
  captureStartAt?: string;
  captureEndAt?: string;
  captureDates?: string[];
  movementSummary?: ReturnType<typeof summarizeSerpMovements>;
  partialRanked?: number;
  sampleOnly?: boolean;
  sampledTargetCount?: number;
  runScopes?: SerpRunScope[];
  scopeLabel?: string;
  captured?: number;
  notFoundCaptured?: number;
  queryChanged?: number;
};
export type TrendResult = { schemaVersion: 3 | 4; points: TrendPoint[]; mode: "labs-snapshots" | "serp-checks"; start: string; end: string; snapshot: null; asOf: string };
export type MarketTrend = { region: SearchRegionCode; status: "READY" | "ERROR"; points: TrendPoint[] | null };
export type MultiRegionTrendResult = { schemaVersion: 5; mode: "serp-markets"; points: TrendPoint[] | null; markets: MarketTrend[]; start: string; end: string; snapshot: null; asOf: string };
export function multiRegionTrendPeriods(markets: MarketTrend[]) {
  const periods = new Map<string, { key: string; label: string; points: Partial<Record<SearchRegionCode, TrendPoint>> }>();
  for (const market of markets) {
    if (market.status !== "READY") continue;
    for (const point of market.points ?? []) {
      const key = point.periodKey ?? point.date;
      const period = periods.get(key) ?? { key, label: point.periodLabel ?? point.date, points: {} };
      period.points[market.region] = point;
      periods.set(key, period);
    }
  }
  return [...periods.values()].sort((a, b) => a.key.localeCompare(b.key));
}
export function marketTrendCount(point: TrendPoint | undefined): number | null {
  return point && (point.captured ?? point.checked ?? point.ranked + point.outside) > 0 ? point.ranked : null;
}
export function multiRegionTrendResult(markets: MarketTrend[], range: { start: string; end: string }, asOf: string, points: TrendPoint[] = []): MultiRegionTrendResult {
  return { ...range, schemaVersion: 5, mode: "serp-markets", snapshot: null, asOf, points: markets.some(market => market.status === "ERROR") ? null : points,
    markets: REGION_CODES.map(region => markets.find(market => market.region === region) ?? { region, status: "ERROR", points: null }) };
}
export type TrendKeyword = {
  keywordId: string; text: string; siteDomain: string; active: boolean; keywordActive: boolean;
  siteActive: boolean; topicId: string | null; pool: string;
};

export function eligibleTrendKeywords(rows: TrendKeyword[]): TrendKeyword[] {
  return eligibleSerpTargets(rows);
}

export function serpTrendRange(start?: string, end?: string, now = new Date()) {
  const last = end ?? trendToday(now), first = start ?? new Date(Date.parse(`${last}T00:00:00Z`) - 89 * 86400000).toISOString().slice(0, 10);
  const valid = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
  if (!valid(first) || !valid(last) || first < "2020-01-01" || first > last || last > trendToday(now)) throw new Error("实测趋势日期范围无效");
  return { start: first, end: last };
}

// Only real captures create a reporting-period point. Actual Google capture
// times stay separate from the monthly 1st/16th reporting boundaries.
export function serpCheckTrendPoints(targets: SerpTarget[], tasks: SerpTaskRead[], start: string, end: string,
  options: { cohorts?: SerpTrendCohort[]; site?: string } = {}): TrendPoint[] {
  return serpCheckTrendFrames(targets, tasks, start, end, options).map(frame => frame.point);
}
export type SerpTrendFrame = { point: TrendPoint; items: SerpKeywordResult[]; targets: SerpTarget[] };
export function serpCheckTrendFrames(targets: SerpTarget[], tasks: SerpTaskRead[], start: string, end: string,
  options: { cohorts?: SerpTrendCohort[]; site?: string } = {}): SerpTrendFrame[] {
  const periods = new Map<string, NonNullable<ReturnType<typeof serpTaskPeriod>>>();
  const frozen = options.cohorts ? new Map<string, SerpTrendCohort[]>() : null;
  for (const cohort of options.cohorts ?? []) frozen!.set(cohort.periodKey, [...(frozen!.get(cohort.periodKey) ?? []), cohort]);
  for (const task of tasks) {
    if (!task.checkedAt) continue;
    const checkedAt = new Date(task.checkedAt);
    if (!Number.isFinite(checkedAt.getTime())) continue;
    const date = trendToday(checkedAt);
    if (date < start || date > end) continue;
    const period = serpTaskPeriod(task);
    if (period && (!frozen || frozen.has(period.key))) periods.set(period.key, period);
  }
  return [...periods].sort(([a], [b]) => a.localeCompare(b)).flatMap(([key, period]) => {
    const cohorts = frozen?.get(key);
    // A sample freezes the whole target inventory too. If a scheduled run also
    // exists, its inventory defines the reporting-period denominator; both
    // ledgers may contribute real observations without counting a word twice.
    const canonical = cohorts ? [...cohorts].sort((a, b) =>
      Number(b.runScope !== "SAMPLE") - Number(a.runScope !== "SAMPLE") ||
      (new Date(b.runCreatedAt ?? 0).getTime() || 0) - (new Date(a.runCreatedAt ?? 0).getTime() || 0))[0] : null;
    const periodTargets = (canonical?.targets ?? targets).filter(target => !options.site || options.site === "all" || target.siteDomain === options.site);
    const empty = new Map(buildSerpKeywordResults(periodTargets, []).map(item => [`${item.siteDomain}:${item.keywordId}`, item]));
    const observations = tasks.filter(task => {
      const taskPeriod = serpTaskPeriod(task);
      return taskPeriod != null && taskPeriod.key <= key && (!frozen?.has(taskPeriod.key) || frozen.get(taskPeriod.key)!.some(cohort => cohort.runId === task.runId));
    });
    const items = buildSerpKeywordResults(periodTargets, observations).map(item => item.periodKey === key ? item : empty.get(`${item.siteDomain}:${item.keywordId}`)!);
    const touched = items.filter(item => item.runId != null);
    if (!touched.length) return [];
    const summary = summarizeSerpResults(items);
    const timestamps = touched.flatMap(item => item.checkedAt ? [item.checkedAt] : []).sort();
    if (!timestamps.length) return [];
    const captureStartAt = timestamps[0], captureEndAt = timestamps.at(-1)!;
    const runScopes = [...new Set(touched.map(item => item.runScope ?? "SCHEDULED"))].sort();
    const sampledTargetCount = touched.filter(item => item.runScope === "SAMPLE").length;
    const sampleOnly = runScopes.length === 1 && runScopes[0] === "SAMPLE";
    return [{ items, targets: periodTargets, point: { date: trendToday(new Date(captureEndAt)), periodKey: key, periodLabel: period.label,
      counts: summary.buckets.map(bucket => bucket.count), sites: [...new Set(periodTargets.map(target => target.siteDomain))].sort(),
      sources: ["dataforseo_serp"], total: summary.total, ranked: summary.ranked, pending: summary.pending,
      outside: summary.outside, checked: summary.checked, failed: summary.failed, incomplete: summary.incomplete, queued: summary.queued,
      captured: summary.captured, notFoundCaptured: summary.notFoundCaptured, queryChanged: summary.queryChanged,
      periodStart: period.start, periodEnd: period.end, snapshotAt: captureEndAt, captureStartAt, captureEndAt,
      captureDates: [...new Set(timestamps.map(timestamp => trendToday(new Date(timestamp))))].sort(),
      dataDates: [...new Set(timestamps)], movementSummary: summarizeSerpMovements(items), partialRanked: summary.partialRanked,
      sampleOnly, sampledTargetCount, runScopes, scopeLabel: sampleOnly ? "抽样实测" : sampledTargetCount ? "正式监控（含抽样）" : "正式监控" } }];
  });
}
function uniqueTrendPoint(point: TrendPoint, summary: ReturnType<typeof summarizeSerpResults>): TrendPoint {
  return { ...point, total: summary.total, ranked: summary.ranked, counts: summary.buckets.map(bucket => bucket.count),
    pending: summary.pending, outside: summary.outside, checked: summary.checked, captured: summary.captured,
    failed: summary.failed, incomplete: summary.incomplete, queued: summary.queued,
    notFoundCaptured: summary.notFoundCaptured, queryChanged: summary.queryChanged, movementSummary: undefined };
}
export function uniqueMarketTrendPoints(region: SearchRegionCode, frames: SerpTrendFrame[]): TrendPoint[] {
  return frames.map(frame => uniqueTrendPoint(frame.point, aggregateSerpRegionResults([{ region, items: frame.items }], frame.targets).countries.find(country => country.region === region)!.summary));
}
export function combinedSerpTrendPoints(markets: { region: SearchRegionCode; frames: SerpTrendFrame[] }[], cohorts: SerpTrendCohort[], site = "all"): TrendPoint[] {
  const keys = [...new Set(markets.flatMap(market => market.frames.map(frame => frame.point.periodKey ?? frame.point.date)))].sort();
  return keys.flatMap(key => {
    const current = markets.flatMap(market => {
      const frame = market.frames.find(frame => (frame.point.periodKey ?? frame.point.date) === key);
      return frame ? [{ region: market.region, frame }] : [];
    });
    if (!current.length || !cohorts.some(cohort => cohort.periodKey === key)) return [];
    // Each country has already selected its own immutable period snapshot.
    // Union those saved members before display-word deduplication; a newer
    // US-only run must not discard another country's different frozen goals.
    const targets = [...new Map(current.flatMap(market => market.frame.targets)
      .filter(target => site === "all" || target.siteDomain === site)
      .map(target => [`${target.siteDomain}:${target.keywordId}`, target] as const)).values()];
    const summary = aggregateSerpRegionResults(current.map(market => ({ region: market.region, items: market.frame.items })), targets).summary;
    const times = current.flatMap(market => market.frame.point.dataDates ?? []).sort();
    if (!times.length) return [];
    const point = uniqueTrendPoint(current[0].frame.point, summary);
    const start = times[0], end = times.at(-1)!;
    return [{ ...point, date: trendToday(new Date(end)), captureStartAt: start, captureEndAt: end, snapshotAt: end,
      dataDates: [...new Set(times)], captureDates: [...new Set(times.map(time => trendToday(new Date(time))))].sort() }];
  });
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

// Emit actual Labs collection days only. Earlier dates and uncollected regions
// are gaps, not zero rankings or a copy of a different provider's report.
export function labsSnapshotTrendPoints(keywords: TrendKeyword[], observations: RankingObservationRow[], region: SearchRegionCode, start: string, end: string): TrendPoint[] {
  const eligible = eligibleTrendKeywords(keywords);
  const wanted = new Set(eligible.map(row => `${row.siteDomain}:${row.keywordId}`));
  const days = new Map<string, RankingObservationRow[]>();
  for (const row of observations) {
    if (row.source !== "dataforseo_labs" || row.captureStatus !== "COMPLETE" || row.region !== region || row.rankReported === false || !wanted.has(`${row.siteDomain}:${row.keywordId}`)) continue;
    const date = trendToday(row.collectedAt);
    if (date < start || date > end) continue;
    days.set(date, [...(days.get(date) ?? []), row]);
  }
  const sites = [...new Set(eligible.map(row => row.siteDomain))].sort();
  return [...days].sort(([a], [b]) => a.localeCompare(b)).map(([date, rows]) => {
    const period = { start: date, end: date, label: date };
    const point: TrendPoint = { date, counts: [0, 0, 0, 0], sites, sources: ["dataforseo_labs"], total: eligible.length,
      ranked: 0, pending: 0, outside: 0, periodStart: date, periodEnd: date,
      snapshotAt: rows.map(row => row.collectedAt.toISOString()).sort().at(-1),
      dataDates: [...new Set(rows.flatMap(row => row.dataUpdatedAt ? [row.dataUpdatedAt.toISOString()] : []))].sort() };
    const byKeyword = new Map<string, RankingObservationRow[]>();
    for (const row of rows) {
      const key = `${row.siteDomain}:${row.keywordId}`;
      byKeyword.set(key, [...(byKeyword.get(key) ?? []), row]);
    }
    for (const keyword of eligible) {
      const evidence = latestQueryEvidence(buildRankingEvidence(byKeyword.get(`${keyword.siteDomain}:${keyword.keywordId}`) ?? [], [], period));
      if (evidence?.rankStatus === "outside_top100") point.outside++;
      else if (evidence?.rank != null && evidence.rank >= 1 && evidence.rank <= 100) {
        point.counts[evidence.rank <= 10 ? 0 : evidence.rank <= 30 ? 1 : evidence.rank <= 50 ? 2 : 3]++;
        point.ranked++;
      } else point.pending++;
    }
    return point;
  });
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
  const end = reportEnd ?? trendToday(now);
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
