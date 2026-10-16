import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { databaseErrorCode, retryDatabaseRead } from "@/lib/database-read";
import { REGION_CODES, type SearchRegionCode } from "@/lib/seo";
import { eligibleTrendKeywords, recentTrendRange, trendPeriod, trendRange, weeklyEvidenceTrendPoints, type TrendKeyword, type TrendResult } from "@/lib/ranking-trends";
import type { RankingObservationRow } from "@/lib/ranking-evidence";
import { loadRecentRankingReportPeriod } from "@/lib/services/ranking-report-period";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
const cache = new Map<string, { expires: number; value: TrendResult }>();
const pending = new Map<string, Promise<TrendResult>>();

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const region = (params.get("region") ?? "US") as SearchRegionCode;
  if (!REGION_CODES.includes(region)) return NextResponse.json({ message: "地区无效" }, { status: 400 });
  const now = new Date(), calendar = recentTrendRange(now);
  let reportEnd: string;
  try { reportEnd = params.get("end") ?? (await retryDatabaseRead(() => loadRecentRankingReportPeriod(now))).end; }
  catch (error) { return NextResponse.json({ message: "趋势数据暂时无法读取", code: databaseErrorCode(error) }, { status: 503 }); }
  let range: ReturnType<typeof trendRange>;
  try {
    const recent = recentTrendRange(now, reportEnd);
    range = trendRange(params.get("start") ?? recent.start, params.get("end") ?? recent.end, now);
    if (range.end > calendar.end) throw new Error("尚未结束的自然日");
  } catch { return NextResponse.json({ message: "日期范围无效，最早为 2026-10-08，最晚为昨天" }, { status: 400 }); }
  const key = `weekly-evidence:published-window-v3:${region}:${range.start}:${range.end}`;
  try {
    const saved = cache.get(key);
    if (saved && saved.expires > Date.now()) return NextResponse.json(saved.value, { headers: { "Cache-Control": "private, no-store" } });
    if (!pending.has(key)) pending.set(key, retryDatabaseRead(async (): Promise<TrendResult> => {
      const candidates = await prisma.$queryRaw<TrendKeyword[]>(Prisma.sql`
        /* weekly-trends:cohort */
        SELECT sk."siteDomain", sk."keywordId", k.text, sk.active, k.active AS "keywordActive",
          site.active AS "siteActive", sk."topicId", sk.pool
        FROM "SiteKeyword" sk JOIN "Keyword" k ON k.id = sk."keywordId"
        JOIN "SeoSite" site ON site.domain = sk."siteDomain"
        WHERE sk."siteDomain" IN ('flatkey.ai','rackrate.org','modelfit.cc')
          AND sk.active = true AND k.active = true AND site.active = true AND sk."topicId" IS NOT NULL
          AND (sk."siteDomain" <> 'flatkey.ai' OR sk.pool = 'FORMAL')
      `);
      // Repeat the business/activation guards in a pure function. SQL cannot
      // reproduce the reviewed, site-specific relevance policy on its own.
      const cohort = eligibleTrendKeywords(candidates);
      const firstPeriod = trendPeriod(range.start);
      const observations = cohort.length ? await prisma.$queryRaw<RankingObservationRow[]>(Prisma.sql`
        /* weekly-trends:bounded-observations */
        SELECT DISTINCT ON (o."siteDomain", o."keywordId", o.region, o.source, o."periodStart", o."periodEnd",
          CASE WHEN o.source = 'ahrefs' THEN o."dataUpdatedAt" END)
          o.id, o."siteDomain", o."keywordId", o.region, o.source, o.rank, o."rankStatus", o."rankReported",
          o.url, o.clicks, o.impressions, o.ctr, o."periodStart", o."periodEnd", o."dataUpdatedAt", o."collectedAt", o."importedAt"
        FROM "KeywordObservation" o
        JOIN (VALUES ${Prisma.join(cohort.map(row => Prisma.sql`(${row.siteDomain}::text, ${row.keywordId}::text)`))}) AS tracked(site, keyword)
          ON tracked.site = o."siteDomain" AND tracked.keyword = o."keywordId"
        WHERE o.region = ${region}::"SearchRegion" AND o."rankReported" = true
          AND ((o.source = 'gsc' AND o."periodEnd" - o."periodStart" = 6
            AND o."periodEnd" BETWEEN ${range.start}::date AND ${range.end}::date)
          OR (o.source = 'ahrefs' AND o."dataUpdatedAt" IS NOT NULL
            AND (o."dataUpdatedAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Shanghai')::date BETWEEN ${firstPeriod.start}::date AND ${range.end}::date))
        ORDER BY o."siteDomain", o."keywordId", o.region, o.source, o."periodStart", o."periodEnd",
          CASE WHEN o.source = 'ahrefs' THEN o."dataUpdatedAt" END,
          o."dataUpdatedAt" DESC NULLS LAST, o."collectedAt" DESC, o."importedAt" DESC, o.id DESC
      `) : [];
      const value: TrendResult = { ...range, schemaVersion: 2, mode: "weekly-evidence", asOf: now.toISOString(),
        points: weeklyEvidenceTrendPoints(cohort, observations, region, range.start, range.end), snapshot: null };
      cache.set(key, { value, expires: Date.now() + 30000 });
      return value;
    }).finally(() => pending.delete(key)));
    return NextResponse.json(await pending.get(key), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return NextResponse.json({ message: "趋势数据暂时无法读取", code: databaseErrorCode(error) }, { status: 503 });
  }
}
