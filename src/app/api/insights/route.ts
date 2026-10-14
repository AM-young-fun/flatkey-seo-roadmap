import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { weeklyPeriods, registrationRate, relativeChange } from "@/lib/weekly-traffic";
import { compareCaptures } from "@/lib/daily-changes";
import { normalizeDomain, REGION_CODES, type SearchRegionCode } from "@/lib/seo";
import type { KeywordObservation, KeywordPageObservation } from "@prisma/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(request: Request): Promise<NextResponse> {
  const params = new URL(request.url).searchParams;
  const siteDomain = normalizeDomain(params.get("site") ?? "all");
  const region = (params.get("region") ?? "US") as SearchRegionCode;
  let source = params.get("source") ?? "combined";
  if (!REGION_CODES.includes(region) || !["gsc", "ahrefs", "combined"].includes(source)) return NextResponse.json({ message: "参数无效" }, { status: 400 });
  try {
    if (siteDomain === "all") return await summary(request, region, source);
    const site = await prisma.seoSite.findUnique({ where: { domain: siteDomain } });
    if (!site?.active) return NextResponse.json({ message: "网站未启用" }, { status: 400 });
    const combined = source === "combined";
    if (combined) {
      const ahrefs = await prisma.rankingCapture.findFirst({ where: { siteDomain, region, source: "ahrefs", status: "COMPLETE", coverage: "site_top100" } });
      source = ahrefs ? "ahrefs" : "gsc";
    }
    const periods = weeklyPeriods();
    const [weekly, captures, pageRows, volumeRows, links] = await Promise.all([
      prisma.weeklyTraffic.findMany({ where: { siteDomain, periodStart: { in: [new Date(periods.current.start), new Date(periods.previous.start)] } }, orderBy: [{ collectedAt: "desc" }, { importedAt: "desc" }] }),
      prisma.rankingCapture.findMany({ where: { siteDomain, region, source, status: "COMPLETE", coverage: "site_top100" }, orderBy: [{ captureDate: "desc" }, { updatedAt: "desc" }], take: 30 }),
      prisma.$queryRaw<KeywordPageObservation[]>`SELECT DISTINCT ON ("keywordId", "url") * FROM "KeywordPageObservation" WHERE "siteDomain" = ${siteDomain} AND "region" = ${region}::"SearchRegion" AND ("source" = ${source} OR (${combined} AND "source" IN ('gsc','ahrefs'))) ORDER BY "keywordId", "url", CASE WHEN "source" = 'ahrefs' THEN 0 ELSE 1 END, "collectedAt" DESC, "importedAt" DESC`,
      prisma.$queryRaw<Array<{ keywordId: string; volume: number }>>`SELECT DISTINCT ON ("keywordId") "keywordId", "volume" FROM (SELECT "keywordId", "volume", "fetchedAt" AS date, CASE WHEN "source" = 'ahrefs' THEN 0 ELSE 1 END AS priority FROM "KeywordVolume" WHERE "region" = ${region}::"SearchRegion" AND "source" IN ('csv','ahrefs') UNION ALL SELECT "keywordId", "volume", "collectedAt" AS date, 0 AS priority FROM "KeywordObservation" WHERE "region" = ${region}::"SearchRegion" AND "volume" IS NOT NULL AND "source" = 'ahrefs') v ORDER BY "keywordId", priority, date DESC`,
      prisma.siteKeyword.findMany({ where: { siteDomain, active: true, topicId: { not: null } }, include: { keyword: { select: { text: true } } } }),
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
    return NextResponse.json({ siteDomain, rankingSource: source, periods, traffic: { current: pack(current), previous: pack(previous), changes: {
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

async function summary(request: Request, region: SearchRegionCode, source: string): Promise<NextResponse> {
  const domains = ["flatkey.ai", "rackrate.org", "modelfit.cc"];
  const parts = await Promise.all(domains.map(async (domain) => {
    const url = new URL(request.url);
    url.searchParams.set("site", domain); url.searchParams.set("source", source); url.searchParams.set("region", region);
    const response = await GET(new Request(url));
    if (!response.ok) throw new Error(`Site insight unavailable: ${domain}`);
    return await response.json() as {
      rankingSource: string; periods: ReturnType<typeof weeklyPeriods>;
      traffic: { current: { newUsers: number; newRegistrations: number; collectedAt: string; ga4PropertyId: string } | null; previous: { newUsers: number; newRegistrations: number; collectedAt: string; ga4PropertyId: string } | null };
      daily: { count: number; baseline: boolean; entered: string[]; lost: string[]; missing: string[]; detectedReduction: number | null; net: number | null; date: string; previousDate: string | null; unknownVolume: number } | null;
      keywords: { id: string; text: string }[];
      pages: Array<Record<string, unknown> & { id: string; keyword: string }>;
    };
  }));
  const total = (period: "current" | "previous") => {
    const rows = parts.flatMap((part) => part.traffic[period] ? [part.traffic[period]!] : []);
    if (!rows.length) return null;
    const newUsers = rows.reduce((sum, row) => sum + row.newUsers, 0);
    const newRegistrations = rows.reduce((sum, row) => sum + row.newRegistrations, 0);
    return { newUsers, newRegistrations, registrationRate: registrationRate(newUsers, newRegistrations), collectedAt: rows.map((row) => row.collectedAt).sort().at(-1), ga4PropertyId: null, sites: rows.length };
  };
  const current = total("current"); const previous = total("previous");
  const comparable = current?.sites === domains.length && previous?.sites === domains.length;
  const days = parts.flatMap((part, index) => part.daily ? [{ ...part.daily, site: domains[index], source: part.rankingSource }] : []);
  const ids = (key: "entered" | "lost" | "missing") => parts.flatMap((part, index) => part.daily?.[key].map((id) => `${domains[index]}:${id}`) ?? []);
  const fullBaseline = days.length === domains.length && days.every((day) => !day.baseline);
  return NextResponse.json({ periods: parts[0].periods,
    traffic: { current, previous, changes: {
      newUsers: comparable ? relativeChange(current!.newUsers, previous!.newUsers) : null,
      newRegistrations: comparable ? relativeChange(current!.newRegistrations, previous!.newRegistrations) : null,
      registrationRate: comparable ? relativeChange(current!.registrationRate, previous!.registrationRate) : null,
      ratePoints: comparable && current!.registrationRate !== null && previous!.registrationRate !== null ? (current!.registrationRate - previous!.registrationRate) * 100 : null,
    }, missingCurrent: domains.filter((_, index) => !parts[index].traffic.current), missingPrevious: domains.filter((_, index) => !parts[index].traffic.previous) },
    daily: days.length ? { count: days.reduce((sum, row) => sum + row.count, 0), baseline: !fullBaseline, entered: ids("entered"), lost: ids("lost"), missing: ids("missing"), detectedReduction: fullBaseline ? days.reduce((sum,row) => sum + (row.detectedReduction ?? 0), 0) : null, net: fullBaseline ? days.reduce((sum,row) => sum + (row.net ?? 0), 0) : null, unknownVolume: days.reduce((sum,row) => sum + row.unknownVolume,0), date: days.map((day) => day.date).sort().at(-1), previousDate: fullBaseline ? "各站上次完整采集" : null, siteCaptures: days, pendingSites: domains.filter((_, index) => !parts[index].daily) } : null,
    keywords: parts.flatMap((part,index) => part.keywords.map((keyword) => ({ id: `${domains[index]}:${keyword.id}`, text: `${keyword.text} · ${domains[index]}` }))),
    pages: parts.flatMap((part,index) => part.pages.map((page) => ({ ...page, id: `${domains[index]}:${page.id}`, siteDomain: domains[index] }))),
  }, { headers: { "Cache-Control": "private, no-store" } });
}
