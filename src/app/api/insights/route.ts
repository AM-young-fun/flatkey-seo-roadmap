import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { weeklyPeriods, registrationRate, relativeChange } from "@/lib/weekly-traffic";
import { compareCaptures } from "@/lib/daily-changes";
import { normalizeDomain, REGION_CODES, type SearchRegionCode } from "@/lib/seo";
import type { KeywordObservation, KeywordPageObservation } from "@prisma/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const siteDomain = normalizeDomain(params.get("site") ?? "flatkey.ai");
  const region = (params.get("region") ?? "US") as SearchRegionCode;
  const source = params.get("source") ?? "ahrefs";
  if (!REGION_CODES.includes(region) || !["gsc", "ahrefs"].includes(source)) return NextResponse.json({ message: "参数无效" }, { status: 400 });
  try {
    const site = await prisma.seoSite.findUnique({ where: { domain: siteDomain } });
    if (!site?.active) return NextResponse.json({ message: "网站未启用" }, { status: 400 });
    const periods = weeklyPeriods();
    const [weekly, captures, pageRows, volumeRows, links] = await Promise.all([
      prisma.weeklyTraffic.findMany({ where: { siteDomain, periodStart: { in: [new Date(periods.current.start), new Date(periods.previous.start)] } }, orderBy: [{ collectedAt: "desc" }, { importedAt: "desc" }] }),
      prisma.rankingCapture.findMany({ where: { siteDomain, region, source, status: "COMPLETE", coverage: "site_top100" }, orderBy: [{ captureDate: "desc" }, { updatedAt: "desc" }], take: 30 }),
      prisma.$queryRaw<KeywordPageObservation[]>`SELECT DISTINCT ON ("keywordId", "url") * FROM "KeywordPageObservation" WHERE "siteDomain" = ${siteDomain} AND "region" = ${region}::"SearchRegion" AND "source" = ${source} ORDER BY "keywordId", "url", "collectedAt" DESC, "importedAt" DESC`,
      prisma.$queryRaw<Array<{ keywordId: string; volume: number }>>`SELECT DISTINCT ON ("keywordId") "keywordId", "volume" FROM (SELECT "keywordId", "volume", "fetchedAt" AS date, CASE WHEN "source" = 'ahrefs' THEN 0 ELSE 1 END AS priority FROM "KeywordVolume" WHERE "region" = ${region}::"SearchRegion" AND "source" IN ('csv','ahrefs') UNION ALL SELECT "keywordId", "volume", "collectedAt" AS date, 0 AS priority FROM "KeywordObservation" WHERE "region" = ${region}::"SearchRegion" AND "volume" IS NOT NULL AND "source" = 'ahrefs') v ORDER BY "keywordId", priority, date DESC`,
      prisma.siteKeyword.findMany({ where: { siteDomain, active: true }, include: { keyword: { select: { text: true } } } }),
    ]);
    const current = weekly.find((row) => row.periodStart.toISOString().slice(0, 10) === periods.current.start && row.periodEnd.toISOString().slice(0, 10) === periods.current.end);
    const previous = weekly.find((row) => row.periodStart.toISOString().slice(0, 10) === periods.previous.start && row.periodEnd.toISOString().slice(0, 10) === periods.previous.end);
    const pack = (row: typeof current) => row ? { newUsers: row.newUsers, newRegistrations: row.newRegistrations, registrationRate: registrationRate(row.newUsers, row.newRegistrations), collectedAt: row.collectedAt.toISOString(), ga4PropertyId: row.ga4PropertyId } : null;
    const latest = captures[0];
    const prior = latest ? captures.find((row) => row.captureDate < latest.captureDate) : null;
    const observations = latest ? await prisma.$queryRaw<KeywordObservation[]>`SELECT DISTINCT ON ("captureId", "keywordId") * FROM "KeywordObservation" WHERE "captureId" IN (${latest.id}, ${prior?.id ?? ""}) AND "rankReported" = true ORDER BY "captureId", "keywordId", "importedAt" DESC` : [];
    const volumes = new Map(volumeRows.map((row) => [row.keywordId, row.volume]));
    const eligible = new Set(links.filter((link) => (volumes.get(link.keywordId) ?? 0) > 0).map((link) => link.keywordId));
    const changes = latest ? compareCaptures(observations.filter((row) => row.captureId === latest.id), prior ? observations.filter((row) => row.captureId === prior.id) : null, eligible) : null;
    const currentRate = current ? registrationRate(current.newUsers, current.newRegistrations) : null;
    const previousRate = previous ? registrationRate(previous.newUsers, previous.newRegistrations) : null;
    return NextResponse.json({ periods, traffic: { current: pack(current), previous: pack(previous), changes: {
      newUsers: relativeChange(current?.newUsers ?? null, previous?.newUsers ?? null),
      newRegistrations: relativeChange(current?.newRegistrations ?? null, previous?.newRegistrations ?? null),
      registrationRate: relativeChange(currentRate, previousRate),
      ratePoints: currentRate !== null && previousRate !== null ? (currentRate - previousRate) * 100 : null,
    } }, daily: changes ? { ...changes, date: latest!.captureDate.toISOString().slice(0,10), previousDate: prior?.captureDate.toISOString().slice(0,10) ?? null, unknownVolume: links.filter((link) => !volumes.has(link.keywordId)).length } : null,
    pages: pageRows.filter((row) => links.some((link) => link.keywordId === row.keywordId)).map((row) => ({ ...row, keyword: links.find((link) => link.keywordId === row.keywordId)?.keyword.text })),
    keywords: links.map((link) => ({ id: link.keywordId, text: link.keyword.text })),
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    console.error("Insights read failed", error instanceof Error ? error.name : "Unknown");
    return NextResponse.json({ message: "分析数据读取失败，请重试" }, { status: 503 });
  }
}
