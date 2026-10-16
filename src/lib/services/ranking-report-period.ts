import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { keywordRelevance } from "@/lib/keyword-relevance";
import { rankingReportingPeriod } from "@/lib/ranking-evidence";
import type { RankingReportingPeriod } from "@/lib/types";

export type WeeklyReportPeriodRow = { siteDomain: string; text: string; periodStart: Date | null; periodEnd: Date | null };

export function selectRecentWeeklyReportPeriod(rows: WeeklyReportPeriodRow[], now = new Date()): RankingReportingPeriod {
  const calendar = rankingReportingPeriod(now);
  const recent = rows.filter(row => {
    if (!["flatkey.ai", "rackrate.org", "modelfit.cc"].includes(row.siteDomain) || !row.periodStart || !row.periodEnd) return false;
    if (row.periodEnd.getTime() - row.periodStart.getTime() !== 6 * 86400000 || keywordRelevance(row.siteDomain, row.text).status === "unrelated") return false;
    const end = row.periodEnd.toISOString().slice(0, 10);
    return end >= calendar.start && end <= calendar.end;
  }).sort((a, b) => b.periodEnd!.getTime() - a.periodEnd!.getTime())[0];
  if (!recent) return calendar;
  const start = recent.periodStart!.toISOString().slice(0, 10), end = recent.periodEnd!.toISOString().slice(0, 10);
  return { start, end, label: `最近已导入7天 · ${start} 至 ${end}` };
}

// One global report window keeps country/site views comparable. Only an actual
// seven-day query report can anchor it; a page summary or daily row cannot.
export async function loadRecentRankingReportPeriod(now = new Date()): Promise<RankingReportingPeriod> {
  const calendar = rankingReportingPeriod(now);
  const rows = await prisma.$queryRaw<WeeklyReportPeriodRow[]>(Prisma.sql`
    /* ranking-period:recent-query-reports */
    SELECT DISTINCT o."siteDomain", k.text, o."periodStart", o."periodEnd"
    FROM "KeywordObservation" o JOIN "Keyword" k ON k.id = o."keywordId"
    JOIN "SiteKeyword" sk ON sk."siteDomain" = o."siteDomain" AND sk."keywordId" = o."keywordId"
    JOIN "SeoSite" site ON site.domain = sk."siteDomain"
    WHERE o."siteDomain" IN ('flatkey.ai','rackrate.org','modelfit.cc')
      AND o.source = 'gsc' AND o."rankReported" = true AND o."periodEnd" - o."periodStart" = 6
      AND o."periodEnd" BETWEEN ${calendar.start}::date AND ${calendar.end}::date
      AND site.active = true AND k.active = true AND sk.active = true AND sk."topicId" IS NOT NULL
      AND (sk."siteDomain" <> 'flatkey.ai' OR sk.pool = 'FORMAL')
  `);
  return selectRecentWeeklyReportPeriod(rows, now);
}
