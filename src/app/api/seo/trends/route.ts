import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { databaseErrorCode, retryDatabaseRead } from "@/lib/database-read";
import { REGION_CODES, type SearchRegionCode } from "@/lib/seo";
import { displayBucket } from "@/lib/rank-display";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
type Trend = { date: string; counts: number[]; sites: string[]; sources: string[] };
const cache = new Map<string, { expires: number; value: Trend[] }>();
const pending = new Map<string, Promise<Trend[]>>();

export async function GET(request: Request) {
  const region = (new URL(request.url).searchParams.get("region") ?? "US") as SearchRegionCode;
  if (!REGION_CODES.includes(region)) return NextResponse.json({ message: "地区无效" }, { status: 400 });
  try {
    const saved = cache.get(region);
    if (saved && saved.expires > Date.now()) return NextResponse.json({ points: saved.value }, { headers: { "Cache-Control": "private, no-store" } });
    if (!pending.has(region)) pending.set(region, retryDatabaseRead(async () => {
      const rows = await prisma.$queryRaw<Array<{ date: string; rank: number | null; siteDomain: string; source: string }>>`
        SELECT DISTINCT ON (TO_CHAR(o."collectedAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Shanghai', 'YYYY-MM-DD'), o."siteDomain", o."keywordId")
          TO_CHAR(o."collectedAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Shanghai', 'YYYY-MM-DD') AS date, o.rank, o."siteDomain", o.source
        FROM "KeywordObservation" o
        JOIN "SiteKeyword" sk ON sk."siteDomain" = o."siteDomain" AND sk."keywordId" = o."keywordId"
        JOIN "Keyword" k ON k.id = o."keywordId"
        WHERE o."rankReported" = true AND o.region = ${region}::"SearchRegion"
          AND o.source IN ('gsc', 'ahrefs') AND o."siteDomain" IN ('flatkey.ai', 'rackrate.org', 'modelfit.cc')
          AND o."collectedAt" >= NOW() - INTERVAL '90 days' AND sk.active = true AND k.active = true AND sk."topicId" IS NOT NULL
        ORDER BY TO_CHAR(o."collectedAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Shanghai', 'YYYY-MM-DD'), o."siteDomain", o."keywordId",
          CASE WHEN o.source = 'ahrefs' AND o."rankStatus" <> 'no_data' THEN 0 WHEN o.source = 'gsc' THEN 1 ELSE 2 END,
          o."collectedAt" DESC, o."importedAt" DESC
      `;
      const points = new Map<string, Trend>();
      for (const row of rows) {
        const point = points.get(row.date) ?? { date: row.date, counts: [0,0,0,0], sites: [], sources: [] };
        const bucket = displayBucket(row.rank).key;
        const index = ["TOP_10", "TOP_30", "TOP_50", "TOP_100"].indexOf(bucket);
        if (index >= 0) point.counts[index]++;
        if (!point.sites.includes(row.siteDomain)) point.sites.push(row.siteDomain);
        if (!point.sources.includes(row.source)) point.sources.push(row.source);
        points.set(row.date, point);
      }
      const value = [...points.values()].sort((a,b)=>a.date.localeCompare(b.date));
      cache.set(region, { value, expires: Date.now() + 30000 });
      return value;
    }).finally(() => pending.delete(region)));
    return NextResponse.json({ points: await pending.get(region) }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return NextResponse.json({ message: "趋势数据暂时无法读取", code: databaseErrorCode(error) }, { status: 503 });
  }
}
