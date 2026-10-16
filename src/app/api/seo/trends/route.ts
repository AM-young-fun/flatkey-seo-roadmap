import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { databaseErrorCode, retryDatabaseRead } from "@/lib/database-read";
import { REGION_CODES, type SearchRegionCode } from "@/lib/seo";
import { eligibleTrendKeywords, labsSnapshotTrendPoints, recentTrendRange, serpCheckTrendPoints, serpTrendRange, trendRange, type TrendKeyword, type TrendResult } from "@/lib/ranking-trends";
import type { RankingObservationRow } from "@/lib/ranking-evidence";
import { loadSerpTasks, loadSerpTrendCohorts } from "@/lib/services/serp-results";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
const cache = new Map<string, { expires: number; value: TrendResult }>();
const pending = new Map<string, Promise<TrendResult>>();

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const region = (params.get("region") ?? "US") as SearchRegionCode;
  if (!REGION_CODES.includes(region)) return NextResponse.json({ message: "地区无效" }, { status: 400 });
  const source = params.get("source") ?? "dataforseo_serp", site = params.get("site") ?? "all";
  if (!["dataforseo_serp", "dataforseo_labs"].includes(source) || !["all", "flatkey.ai", "rackrate.org", "modelfit.cc"].includes(site))
    return NextResponse.json({ message: "网站或来源无效" }, { status: 400 });
  const now = new Date();
  let range: ReturnType<typeof trendRange>;
  try {
    if (source === "dataforseo_serp") range = serpTrendRange(params.get("start") ?? undefined, params.get("end") ?? undefined, now);
    else {
      const recent = recentTrendRange(now, params.get("end") ?? undefined);
      range = trendRange(params.get("start") ?? recent.start, params.get("end") ?? recent.end, now);
    }
  } catch { return NextResponse.json({ message: "日期范围无效，最早为 2026-10-08，最晚为今天" }, { status: 400 }); }
  const key = `${source}:checks-v4:${site}:${region}:${range.start}:${range.end}`;
  try {
    const saved = cache.get(key);
    if (params.get("refresh") !== "1" && saved && saved.expires > Date.now()) return NextResponse.json(saved.value, { headers: { "Cache-Control": "private, no-store" } });
    if (!pending.has(key)) pending.set(key, retryDatabaseRead(async (): Promise<TrendResult> => {
      if (source === "dataforseo_serp") {
        const [cohorts, tasks] = await Promise.all([
          loadSerpTrendCohorts(region, range.start, range.end), loadSerpTasks(region, undefined, "desktop", range.start, range.end),
        ]);
        const value: TrendResult = { ...range, schemaVersion: 4, mode: "serp-checks", asOf: now.toISOString(),
          points: serpCheckTrendPoints([], tasks, range.start, range.end, { cohorts, site }), snapshot: null };
        cache.set(key, { value, expires: Date.now() + 30000 });
        return value;
      }
      const candidates = await prisma.$queryRaw<TrendKeyword[]>(Prisma.sql`
        /* labs-trends:cohort */
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
      const observations = cohort.length ? await prisma.$queryRaw<RankingObservationRow[]>(Prisma.sql`
        /* labs-trends:bounded-observations */
        SELECT DISTINCT ON (o."siteDomain", o."keywordId", o.region,
          (o."collectedAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Shanghai')::date)
          o.id, o."siteDomain", o."keywordId", o.region, o.source, o.rank, o."rankStatus", o."rankReported",
          o.url, o.clicks, o.impressions, o.ctr, o."periodStart", o."periodEnd", o."dataUpdatedAt", o."collectedAt", o."importedAt", o."captureId", capture.status AS "captureStatus"
        FROM "KeywordObservation" o
        JOIN "RankingCapture" capture ON capture.id = o."captureId" AND capture.status = 'COMPLETE'
          AND capture."siteDomain" = o."siteDomain" AND capture.source = o.source AND capture.region = o.region
        JOIN (VALUES ${Prisma.join(cohort.map(row => Prisma.sql`(${row.siteDomain}::text, ${row.keywordId}::text)`))}) AS tracked(site, keyword)
          ON tracked.site = o."siteDomain" AND tracked.keyword = o."keywordId"
        WHERE o.region = ${region}::"SearchRegion" AND o."rankReported" = true AND o.source = 'dataforseo_labs'
          AND (o."collectedAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Shanghai')::date BETWEEN ${range.start}::date AND ${range.end}::date
        ORDER BY o."siteDomain", o."keywordId", o.region,
          (o."collectedAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Shanghai')::date,
          o."collectedAt" DESC, o."importedAt" DESC, o.id DESC
      `) : [];
      const value: TrendResult = { ...range, schemaVersion: 3, mode: "labs-snapshots", asOf: now.toISOString(),
        points: labsSnapshotTrendPoints(cohort, observations, region, range.start, range.end), snapshot: null };
      cache.set(key, { value, expires: Date.now() + 30000 });
      return value;
    }).finally(() => pending.delete(key)));
    return NextResponse.json(await pending.get(key), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return NextResponse.json({ message: "趋势数据暂时无法读取", code: databaseErrorCode(error) }, { status: 503 });
  }
}
