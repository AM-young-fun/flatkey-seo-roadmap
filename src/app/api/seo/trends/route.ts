import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { databaseErrorCode, retryDatabaseRead } from "@/lib/database-read";
import { REGION_CODES, type SearchRegionCode } from "@/lib/seo";
import { displayBucket } from "@/lib/rank-display";
import { dailyReportPoints, EARLIEST_TREND_DATE, trendRange, type TrendPoint } from "@/lib/ranking-trends";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
type Result = { points: TrendPoint[]; mode: "daily" | "capture"; start: string; end: string };
const cache = new Map<string, { expires: number; value: Result }>();
const pending = new Map<string, Promise<Result>>();

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const region = (params.get("region") ?? "US") as SearchRegionCode;
  if (!REGION_CODES.includes(region)) return NextResponse.json({ message: "地区无效" }, { status: 400 });
  let range: ReturnType<typeof trendRange>;
  try { range = trendRange(params.get("start") ?? undefined, params.get("end") ?? undefined); }
  catch { return NextResponse.json({ message: "日期范围无效，最早为 2026-10-08，最晚为今天" }, { status: 400 }); }
  const key = `${region}:${range.start}:${range.end}`;
  try {
    const saved = cache.get(key);
    if (saved && saved.expires > Date.now()) return NextResponse.json(saved.value, { headers: { "Cache-Control": "private, no-store" } });
    if (!pending.has(key)) pending.set(key, retryDatabaseRead(async (): Promise<Result> => {
      const daily = await prisma.dailyRankingReport.findMany({
        where: { region, source: { in: ["gsc", "ahrefs"] }, siteDomain: { in: ["flatkey.ai", "rackrate.org", "modelfit.cc"] }, site: { active: true }, date: { gte: new Date(EARLIEST_TREND_DATE) } },
        select: { date: true, siteDomain: true, source: true, top10: true, top30: true, top50: true, top100: true },
        orderBy: [{ collectedAt: "desc" }, { importedAt: "desc" }],
      });
      if (daily.length) {
        const value: Result = { ...range, mode: "daily", points: dailyReportPoints(daily, range.start, range.end) };
        cache.set(key, { value, expires: Date.now() + 30000 });
        return value;
      }
      const rows = await prisma.$queryRaw<Array<{ date: string; rank: number | null; siteDomain: string; source: string }>>`
        SELECT DISTINCT ON (TO_CHAR(o."collectedAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Shanghai', 'YYYY-MM-DD'), o."siteDomain", o."keywordId")
          TO_CHAR(o."collectedAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Shanghai', 'YYYY-MM-DD') AS date, o.rank, o."siteDomain", o.source
        FROM "KeywordObservation" o
        JOIN "SiteKeyword" sk ON sk."siteDomain" = o."siteDomain" AND sk."keywordId" = o."keywordId"
        JOIN "Keyword" k ON k.id = o."keywordId"
        WHERE o."rankReported" = true AND o.region = ${region}::"SearchRegion"
          AND o.source IN ('gsc', 'ahrefs') AND o."siteDomain" IN ('flatkey.ai', 'rackrate.org', 'modelfit.cc')
          AND o."collectedAt" >= (${range.start}::date::timestamp AT TIME ZONE 'Asia/Shanghai') AT TIME ZONE 'UTC'
          AND o."collectedAt" < ((${range.end}::date + 1)::timestamp AT TIME ZONE 'Asia/Shanghai') AT TIME ZONE 'UTC'
          AND sk.active = true AND k.active = true AND sk."topicId" IS NOT NULL
        ORDER BY TO_CHAR(o."collectedAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Shanghai', 'YYYY-MM-DD'), o."siteDomain", o."keywordId",
          CASE WHEN o.source = 'ahrefs' AND o."rankStatus" <> 'no_data' THEN 0 WHEN o.source = 'gsc' THEN 1 ELSE 2 END,
          o."collectedAt" DESC, o."importedAt" DESC
      `;
      const points = new Map<string, TrendPoint>();
      for (const row of rows) {
        const point = points.get(row.date) ?? { date: row.date, counts: [0,0,0,0], sites: [], sources: [] };
        const bucket = displayBucket(row.rank).key;
        const index = ["TOP_10", "TOP_30", "TOP_50", "TOP_100"].indexOf(bucket);
        if (index >= 0) point.counts[index]++;
        if (!point.sites.includes(row.siteDomain)) point.sites.push(row.siteDomain);
        if (!point.sources.includes(row.source)) point.sources.push(row.source);
        points.set(row.date, point);
      }
      const value: Result = { ...range, mode: "capture", points: [...points.values()].sort((a,b)=>a.date.localeCompare(b.date)) };
      cache.set(key, { value, expires: Date.now() + 30000 });
      return value;
    }).finally(() => pending.delete(key)));
    return NextResponse.json(await pending.get(key), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return NextResponse.json({ message: "趋势数据暂时无法读取", code: databaseErrorCode(error) }, { status: 503 });
  }
}
