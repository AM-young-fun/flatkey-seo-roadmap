import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { databaseErrorCode, retryDatabaseRead } from "@/lib/database-read";
import { REGION_CODES, type SearchRegionCode } from "@/lib/seo";
import { recentTrendRange, snapshotTrendPoints, trendRange, type TrendResult } from "@/lib/ranking-trends";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
type Result = TrendResult;
const cache = new Map<string, { expires: number; value: Result }>();
const pending = new Map<string, Promise<Result>>();

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const region = (params.get("region") ?? "US") as SearchRegionCode;
  if (!REGION_CODES.includes(region)) return NextResponse.json({ message: "地区无效" }, { status: 400 });
  let range: ReturnType<typeof trendRange>;
  try { const recent = recentTrendRange(); range = trendRange(params.get("start") ?? recent.start, params.get("end") ?? recent.end); }
  catch { return NextResponse.json({ message: "日期范围无效，最早为 2026-10-08，最晚为今天" }, { status: 400 }); }
  const key = `${region}:${range.start}:${range.end}`;
  try {
    const saved = cache.get(key);
    if (saved && saved.expires > Date.now()) return NextResponse.json(saved.value, { headers: { "Cache-Control": "private, no-store" } });
    if (!pending.has(key)) pending.set(key, retryDatabaseRead(async (): Promise<Result> => {
      // Only completed site reports establish a full-vocabulary snapshot day.
      // Daily GSC exposure queries are not a census of all ranked keywords.
      const rows = await prisma.$queryRaw<Array<{date:string;rank:number|null;siteDomain:string;source:string}>>`
        WITH snapshot_days AS (
          SELECT DISTINCT "captureDate" AS day FROM "RankingCapture"
          WHERE region = ${region}::"SearchRegion" AND status = 'COMPLETE' AND coverage = 'site_top100'
            AND "siteDomain" IN ('flatkey.ai','rackrate.org','modelfit.cc') AND source IN ('gsc','ahrefs')
            AND "captureDate" BETWEEN ${range.start}::date AND ${range.end}::date
        ), latest AS (
          SELECT DISTINCT ON (d.day, o."siteDomain", o."keywordId")
            d.day, o.rank, o."siteDomain", o.source
          FROM snapshot_days d
          JOIN "KeywordObservation" o ON o."collectedAt" < ((d.day + 1)::timestamp AT TIME ZONE 'Asia/Shanghai') AT TIME ZONE 'UTC'
          JOIN "SiteKeyword" sk ON sk."siteDomain" = o."siteDomain" AND sk."keywordId" = o."keywordId"
          JOIN "Keyword" k ON k.id = o."keywordId"
          JOIN "SeoSite" site ON site.domain = o."siteDomain"
          WHERE o.region = ${region}::"SearchRegion" AND o."rankReported" = true AND o.source IN ('gsc','ahrefs')
            AND (o.rank IS NOT NULL OR o."rankStatus" = 'outside_top100')
            AND o."siteDomain" IN ('flatkey.ai','rackrate.org','modelfit.cc')
            AND sk.active = true AND sk."topicId" IS NOT NULL AND k.active = true AND site.active = true
          ORDER BY d.day, o."siteDomain", o."keywordId",
            CASE WHEN o.source = 'ahrefs' AND o."rankStatus" <> 'no_data' THEN 0 WHEN o.source = 'gsc' THEN 1 ELSE 2 END,
            o."collectedAt" DESC, o."importedAt" DESC
        ) SELECT TO_CHAR(d.day, 'YYYY-MM-DD') AS date, l.rank, COALESCE(l."siteDomain",'') AS "siteDomain", COALESCE(l.source,'') AS source FROM snapshot_days d LEFT JOIN latest l ON l.day = d.day
      `;
      const value: Result = { ...range, mode: "capture", points: snapshotTrendPoints(rows), snapshot: null };
      cache.set(key, { value, expires: Date.now() + 30000 });
      return value;
    }).finally(() => pending.delete(key)));
    return NextResponse.json(await pending.get(key), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return NextResponse.json({ message: "趋势数据暂时无法读取", code: databaseErrorCode(error) }, { status: 503 });
  }
}
