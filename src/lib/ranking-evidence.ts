import type { SearchRegionCode } from "./seo";
import type { RankingDailyEvidence, RankingEvidence, RankingPageEvidence, RankingReportingPeriod, RankingSource, RankingStatus } from "./types";

export type RankingObservationRow = {
  id?: string;
  siteDomain: string | null;
  keywordId: string;
  region: SearchRegionCode;
  source: string;
  rank: number | null;
  rankStatus?: string;
  rankReported?: boolean;
  url?: string | null;
  clicks?: number | null;
  impressions?: number | null;
  ctr?: number | null;
  periodStart: Date | null;
  periodEnd: Date | null;
  dataUpdatedAt?: Date | null;
  collectedAt: Date;
  importedAt?: Date | null;
};
export type RankingPageRow = RankingObservationRow & { url: string };

const sources: RankingSource[] = ["gsc", "ahrefs"];
const iso = (date: Date | null | undefined) => date?.toISOString() ?? null;
const day = (date: Date | null | undefined) => iso(date)?.slice(0, 10) ?? null;
const timestamp = (date: Date | null | undefined) => date?.getTime() ?? -Infinity;
const shanghaiDay = (date: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(date);

export function rankingReportingPeriod(now = new Date()): RankingReportingPeriod {
  const today = new Date(`${shanghaiDay(now)}T00:00:00Z`);
  const start = new Date(today.getTime() - 7 * 86400000).toISOString().slice(0, 10);
  const end = new Date(today.getTime() - 86400000).toISOString().slice(0, 10);
  return { start, end, label: `最近一周 · ${start} 至 ${end}` };
}

export function matchesWeeklyRanking(row: RankingObservationRow, period: RankingReportingPeriod): boolean {
  if (row.source === "gsc") return day(row.periodStart) === period.start && day(row.periodEnd) === period.end;
  if (row.source !== "ahrefs" || !row.dataUpdatedAt) return false;
  const date = shanghaiDay(row.dataUpdatedAt);
  return date >= period.start && date <= period.end;
}

export function isDailyRanking(row: RankingObservationRow, period: RankingReportingPeriod): boolean {
  const date = day(row.periodStart);
  return row.source === "gsc" && date != null && date === day(row.periodEnd) && date >= period.start && date <= period.end;
}

// Reading an old report today does not make its data newer. The report's end
// date wins; upstream update time is used for snapshots without a period.
export function rankingDataDate(row: RankingObservationRow): string {
  if (row.source === "ahrefs" && row.dataUpdatedAt) return row.dataUpdatedAt.toISOString();
  return day(row.periodEnd) ?? iso(row.dataUpdatedAt) ?? row.collectedAt.toISOString();
}

export function compareRankingObservations(a: RankingObservationRow, b: RankingObservationRow): number {
  const effective = (row: RankingObservationRow) => timestamp(row.source === "ahrefs"
    ? row.dataUpdatedAt ?? row.periodEnd ?? row.collectedAt : row.periodEnd ?? row.dataUpdatedAt ?? row.collectedAt);
  return effective(a) - effective(b) || timestamp(a.dataUpdatedAt) - timestamp(b.dataUpdatedAt) ||
    timestamp(a.collectedAt) - timestamp(b.collectedAt) || timestamp(a.importedAt) - timestamp(b.importedAt) ||
    (a.id ?? "").localeCompare(b.id ?? "");
}

function latest<T extends RankingObservationRow>(rows: T[]): T | undefined {
  return rows.reduce<T | undefined>((selected, row) => !selected || compareRankingObservations(row, selected) > 0 ? row : selected, undefined);
}

function samePeriod(a: RankingObservationRow, b: RankingObservationRow) {
  return day(a.periodStart) === day(b.periodStart) && day(a.periodEnd) === day(b.periodEnd);
}

function context(row: RankingObservationRow) {
  return {
    periodStart: day(row.periodStart), periodEnd: day(row.periodEnd), dataDate: rankingDataDate(row),
    checkedAt: row.collectedAt.toISOString(), importedAt: iso(row.importedAt), dataUpdatedAt: iso(row.dataUpdatedAt),
    serpVerification: "unverified" as const,
  };
}

function status(row: RankingObservationRow): RankingStatus {
  if (row.rankStatus === "outside_top100") return "outside_top100";
  return row.rank == null ? "no_data" : row.rank <= 100 ? "ranked" : "outside_top100";
}

function pageEvidence(row: RankingPageRow): RankingPageEvidence {
  return { ...context(row), url: row.url, rank: row.rank, clicks: row.clicks ?? null,
    impressions: row.impressions ?? null, ctr: row.ctr ?? null };
}

function matchedPages(rows: RankingPageRow[], report: RankingObservationRow) {
  const byUrl = new Map<string, RankingPageRow>();
  for (const row of rows) {
    if (!samePeriod(row, report)) continue;
    // Without a period (Ahrefs snapshots), also require the same data date.
    if ((row.source === "ahrefs" || (!row.periodStart && !row.periodEnd)) &&
        rankingDataDate(row).slice(0, 10) !== rankingDataDate(report).slice(0, 10)) continue;
    const prior = byUrl.get(row.url);
    if (!prior || compareRankingObservations(row, prior) > 0) byUrl.set(row.url, row);
  }
  return [...byUrl.values()].sort((a, b) => a.url.localeCompare(b.url)).map(pageEvidence);
}

// Call with rows for one site + keyword + region. Source-local selection keeps
// a newer no_data report instead of silently resurrecting an older rank.
export function buildRankingEvidence(queries: RankingObservationRow[], pages: RankingPageRow[], period: RankingReportingPeriod | null = null): RankingEvidence[] {
  const result: RankingEvidence[] = [];
  for (const source of sources) {
    const query = latest(queries.filter(row => row.source === source && row.rankReported !== false && (!period || matchesWeeklyRanking(row, period))));
    const sourcePages = pages.filter(row => row.source === source && typeof row.url === "string" && row.url.length > 0 && (!period || matchesWeeklyRanking(row, period)));
    const page = latest(sourcePages);
    if (query) result.push({ ...context(query), source, scope: "query", rank: query.rank,
      rankStatus: status(query), clicks: query.clicks ?? null, impressions: query.impressions ?? null,
      ctr: query.ctr ?? null, url: query.url ?? null, pages: matchedPages(sourcePages, query) });
    const pageIsAttached = Boolean(query && page && samePeriod(page, query) &&
      ((source !== "ahrefs" && query.periodEnd) || rankingDataDate(page).slice(0, 10) === rankingDataDate(query).slice(0, 10)));
    if (page && !pageIsAttached && (!query || compareRankingObservations(page, query) > 0)) {
      result.push({ ...context(page), source, scope: "pages", rank: null, rankStatus: "no_data",
        clicks: null, impressions: null, ctr: null, url: null, pages: matchedPages(sourcePages, page) });
    }
    if (period && source === "gsc") {
      const byDate = new Map<string, RankingObservationRow>();
      for (const row of queries.filter(row => row.rankReported !== false && isDailyRanking(row, period))) {
        const date = day(row.periodEnd)!;
        const prior = byDate.get(date);
        if (!prior || compareRankingObservations(row, prior) > 0) byDate.set(date, row);
      }
      const daily: RankingDailyEvidence[] = [...byDate].sort(([a], [b]) => a.localeCompare(b)).map(([date, row]) => ({
        ...context(row), date, source: "gsc", rank: row.rank, rankStatus: status(row), url: row.url ?? null,
        clicks: row.clicks ?? null, impressions: row.impressions ?? null, ctr: row.ctr ?? null,
        pages: matchedPages(pages.filter(page => page.source === "gsc"), row),
      }));
      if (daily.length) {
        const report = result.find(row => row.source === source && row.scope === "query") ?? result.find(row => row.source === source);
        if (report) report.daily = daily;
        else {
          const last = daily[daily.length - 1];
          result.push({ source, scope: "daily", rank: null, rankStatus: "no_data", url: null,
            clicks: null, impressions: null, ctr: null, periodStart: period.start, periodEnd: period.end,
            dataDate: last.dataDate, checkedAt: last.checkedAt, importedAt: last.importedAt,
            dataUpdatedAt: last.dataUpdatedAt, pages: [], daily, serpVerification: "unverified" });
        }
      }
    }
  }
  return result;
}

// A page's average can never become a query ranking. Cross-source selection is
// only for legacy consumers; evidence retains each source separately.
export function latestQueryEvidence(evidence: RankingEvidence[]): RankingEvidence | undefined {
  return evidence.filter(row => row.scope === "query").sort((a, b) =>
    Date.parse(b.dataDate) - Date.parse(a.dataDate) ||
    Date.parse(b.dataUpdatedAt ?? b.checkedAt) - Date.parse(a.dataUpdatedAt ?? a.checkedAt) ||
    Date.parse(b.checkedAt) - Date.parse(a.checkedAt) ||
    Date.parse(b.importedAt ?? b.checkedAt) - Date.parse(a.importedAt ?? a.checkedAt) ||
    a.source.localeCompare(b.source),
  )[0];
}
