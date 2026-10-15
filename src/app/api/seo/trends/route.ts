import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { databaseErrorCode, retryDatabaseRead } from "@/lib/database-read";
import { REGION_CODES, type SearchRegionCode } from "@/lib/seo";
import { inventoryTrendByDay, recentTrendRange, snapshotTrendPoints, trendRange, type TrendResult } from "@/lib/ranking-trends";

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
      // Historical report inventory as known on each collection day. A newer
      // no_data report supersedes an older rank; report date determines recency.
      const rows = await prisma.$queryRaw<Array<{date:string;rank:number|null;siteDomain:string;source:string}>>`
        WITH update_days AS (
          SELECT "captureDate" AS day FROM "RankingCapture" c
          JOIN "SeoSite" site ON site.domain = c."siteDomain" AND site.active = true
          WHERE region = ${region}::"SearchRegion" AND status = 'COMPLETE' AND coverage = 'site_top100'
            AND "siteDomain" IN ('flatkey.ai','rackrate.org','modelfit.cc') AND source IN ('gsc','ahrefs')
            AND "captureDate" <= ${range.end}::date
          UNION
          SELECT (o."collectedAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Shanghai')::date AS day
          FROM "KeywordObservation" o
          JOIN "SiteKeyword" sk ON sk."siteDomain" = o."siteDomain" AND sk."keywordId" = o."keywordId"
          JOIN "Keyword" k ON k.id = o."keywordId"
          JOIN "SeoSite" site ON site.domain = o."siteDomain"
          WHERE o.region = ${region}::"SearchRegion" AND o."rankReported" = true
            AND o.source IN ('gsc','ahrefs')
            AND o."siteDomain" IN ('flatkey.ai','rackrate.org','modelfit.cc')
            AND sk.active = true AND sk."topicId" IS NOT NULL AND k.active = true AND site.active = true
            AND (o."collectedAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Shanghai')::date <= ${range.end}::date
        ), snapshot_days AS (
          SELECT day FROM update_days WHERE day BETWEEN ${range.start}::date AND ${range.end}::date
          UNION SELECT MAX(day) FROM update_days WHERE day < ${range.start}::date HAVING MAX(day) IS NOT NULL
        ), latest AS (
          SELECT DISTINCT ON (d.day, o."siteDomain", o."keywordId")
            d.day, o.rank, o."siteDomain", o.source
          FROM snapshot_days d
          JOIN "KeywordObservation" o ON o."collectedAt" < ((d.day + 1)::timestamp AT TIME ZONE 'Asia/Shanghai') AT TIME ZONE 'UTC'
          JOIN "SiteKeyword" sk ON sk."siteDomain" = o."siteDomain" AND sk."keywordId" = o."keywordId"
          JOIN "Keyword" k ON k.id = o."keywordId"
          JOIN "SeoSite" site ON site.domain = o."siteDomain"
          WHERE o.region = ${region}::"SearchRegion" AND o."rankReported" = true AND o.source IN ('gsc','ahrefs')
            AND o."siteDomain" IN ('flatkey.ai','rackrate.org','modelfit.cc')
            AND sk.active = true AND sk."topicId" IS NOT NULL AND k.active = true AND site.active = true
          ORDER BY d.day, o."siteDomain", o."keywordId",
            COALESCE(o."periodEnd"::timestamp, o."dataUpdatedAt", o."collectedAt") DESC,
            o."dataUpdatedAt" DESC NULLS LAST, o."collectedAt" DESC, o."importedAt" DESC, o.source ASC, o.id DESC
        ) SELECT TO_CHAR(d.day, 'YYYY-MM-DD') AS date, l.rank, COALESCE(l."siteDomain",'') AS "siteDomain", COALESCE(l.source,'') AS source FROM snapshot_days d LEFT JOIN latest l ON l.day = d.day
      `;
      const value: Result = { ...range, mode: "capture", points: inventoryTrendByDay(snapshotTrendPoints(rows), range.start, range.end), snapshot: null };
      cache.set(key, { value, expires: Date.now() + 30000 });
      return value;
    }).finally(() => pending.delete(key)));
    return NextResponse.json(await pending.get(key), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return NextResponse.json({ message: "趋势数据暂时无法读取", code: databaseErrorCode(error) }, { status: 503 });
  }
}
