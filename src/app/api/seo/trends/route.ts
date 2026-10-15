import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { databaseErrorCode, retryDatabaseRead } from "@/lib/database-read";
import { REGION_CODES, type SearchRegionCode } from "@/lib/seo";
import { dailyReportPoints, EARLIEST_TREND_DATE, recentTrendRange, selectDailyReports, trendRange, type TrendResult } from "@/lib/ranking-trends";

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
      const daily = await prisma.dailyRankingReport.findMany({
        where: { region, source: { in: ["gsc", "ahrefs"] }, siteDomain: { in: ["flatkey.ai", "rackrate.org", "modelfit.cc"] }, site: { active: true }, date: { gte: new Date(EARLIEST_TREND_DATE), lte: new Date(range.end) } },
        select: { id: true, date: true, siteDomain: true, source: true, top10: true, top30: true, top50: true, top100: true },
        orderBy: [{ collectedAt: "desc" }, { importedAt: "desc" }],
      });
      const latest = selectDailyReports(daily, EARLIEST_TREND_DATE, range.end).at(-1);
      const snapshotRows = latest ? await prisma.dailyRankingReport.findMany({
        where: { id: { in: [...latest[1].values()].map(row => row.id) } },
        select: { siteDomain: true, source: true, collectedAt: true, rankings: true },
      }) : [];
      const value: Result = { ...range, mode: "daily", points: dailyReportPoints(daily, range.start, range.end),
        snapshot: latest ? { date: latest[0], region, sites: [...latest[1].keys()].sort(), rankings: snapshotRows.flatMap(row =>
          (row.rankings as {keyword:string;rank:number}[]).map(rank => ({...rank, siteDomain:row.siteDomain, source:row.source as "gsc" | "ahrefs", collectedAt:row.collectedAt.toISOString()}))
        ) } : null,
      };
      cache.set(key, { value, expires: Date.now() + 30000 });
      return value;
    }).finally(() => pending.delete(key)));
    return NextResponse.json(await pending.get(key), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return NextResponse.json({ message: "趋势数据暂时无法读取", code: databaseErrorCode(error) }, { status: 503 });
  }
}
