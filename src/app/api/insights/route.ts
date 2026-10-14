import { databaseErrorCode, settleReads, retryDatabaseRead } from "@/lib/database-read";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { weeklyPeriods, reportPeriods, registrationRate, relativeChange } from "@/lib/weekly-traffic";
import { compareCaptures } from "@/lib/daily-changes";
import { normalizeDomain, REGION_CODES, type SearchRegionCode } from "@/lib/seo";
import type { KeywordObservation, KeywordPageObservation } from "@prisma/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function readInsights(request: Request): Promise<NextResponse> {
  const params = new URL(request.url).searchParams;
  const siteDomain = normalizeDomain(params.get("site") ?? "all");
  const region = (params.get("region") ?? "US") as SearchRegionCode;
  let source = params.get("source") ?? "combined";
  const week = params.get("week");
  let periods = weeklyPeriods();
  if (week) {
    try { periods = reportPeriods(week); } catch { return NextResponse.json({ message: "周报日期无效" }, { status: 400 }); }
    if (periods.current.start > weeklyPeriods().current.start) return NextResponse.json({ message: "周报尚未结束" }, { status: 400 });
  }
  if (!REGION_CODES.includes(region) || !["gsc", "ahrefs", "combined"].includes(source)) return NextResponse.json({ message: "参数无效" }, { status: 400 });
    if (siteDomain === "all") return await summary(request, region, source);
    const site = await prisma.seoSite.findUnique({ where: { domain: siteDomain } });
    if (!site?.active) return NextResponse.json({ message: "网站未启用" }, { status: 400 });
    const combined = source === "combined";
    if (combined) {
      const ahrefs = await prisma.rankingCapture.findFirst({ where: { siteDomain, region, source: "ahrefs", status: "COMPLETE", coverage: "site_top100", captureDate: { gte: new Date(periods.previous.start), lte: new Date(periods.current.end) } } });
      source = ahrefs ? "ahrefs" : "gsc";
    }
    const [weekly, captures, pageRows, volumeRows, links] = await settleReads([
      prisma.weeklyTraffic.findMany({ where: { siteDomain, periodStart: { in: [new Date(periods.current.start), new Date(periods.previous.start)] } }, orderBy: [{ collectedAt: "desc" }, { importedAt: "desc" }] }),
      prisma.rankingCapture.findMany({ where: { siteDomain, region, source, status: "COMPLETE", coverage: "site_top100", captureDate: { gte: new Date(periods.previous.start), lte: new Date(periods.current.end) } }, orderBy: [{ captureDate: "desc" }, { updatedAt: "desc" }] }),
      prisma.$queryRaw<KeywordPageObservation[]>`SELECT DISTINCT ON ("keywordId", "url") * FROM "KeywordPageObservation" WHERE "siteDomain" = ${siteDomain} AND "region" = ${region}::"SearchRegion" AND ("source" = ${source} OR (${combined} AND "source" IN ('gsc','ahrefs'))) ORDER BY "keywordId", "url", CASE WHEN "source" = 'ahrefs' THEN 0 ELSE 1 END, "collectedAt" DESC, "importedAt" DESC`,
      prisma.$queryRaw<Array<{ keywordId: string; volume: number }>>`SELECT DISTINCT ON ("keywordId") "keywordId", "volume" FROM (SELECT "keywordId", "volume", "fetchedAt" AS date, CASE WHEN "source" = 'ahrefs' THEN 0 ELSE 1 END AS priority FROM "KeywordVolume" WHERE "region" = ${region}::"SearchRegion" AND "source" IN ('csv','ahrefs') UNION ALL SELECT "keywordId", "volume", "collectedAt" AS date, 0 AS priority FROM "KeywordObservation" WHERE "region" = ${region}::"SearchRegion" AND "volume" IS NOT NULL AND "source" = 'ahrefs') v ORDER BY "keywordId", priority, date DESC`,
      prisma.siteKeyword.findMany({ where: { siteDomain, active: true, topicId: { not: null } }, include: { keyword: { select: { text: true } } } }),
    ]);
    const current = weekly.find((row) => row.periodStart.toISOString().slice(0, 10) === periods.current.start && row.periodEnd.toISOString().slice(0, 10) === periods.current.end);
    const previous = weekly.find((row) => row.periodStart.toISOString().slice(0, 10) === periods.previous.start && row.periodEnd.toISOString().slice(0, 10) === periods.previous.end);
    const pack = (row: typeof current) => row ? { newUsers: row.newUsers, newRegistrations: row.newRegistrations, registrationRate: registrationRate(row.newUsers, row.newRegistrations), collectedAt: row.collectedAt.toISOString(), ga4PropertyId: row.ga4PropertyId, timezone: row.timezone, registrationMetric: row.registrationMetric } : null;
    const latest = captures.find(row=>row.captureDate >= new Date(periods.current.start));
    const prior = captures.find(row=>row.captureDate < new Date(periods.current.start));
    const observations = latest ? await prisma.$queryRaw<KeywordObservation[]>`SELECT DISTINCT ON ("captureId", "keywordId") * FROM "KeywordObservation" WHERE "captureId" IN (${latest.id}, ${prior?.id ?? ""}) AND "rankReported" = true ORDER BY "captureId", "keywordId", "importedAt" DESC` : [];
    const volumes = new Map(volumeRows.map((row) => [row.keywordId, row.volume]));
    const eligible = new Set(links.filter((link) => (volumes.get(link.keywordId) ?? 0) > 0).map((link) => link.keywordId));
    const changes = latest ? compareCaptures(observations.filter((row) => row.captureId === latest.id), prior ? observations.filter((row) => row.captureId === prior.id) : null, eligible) : null;
    const currentRate = current ? registrationRate(current.newUsers, current.newRegistrations) : null;
    const previousRate = previous ? registrationRate(previous.newUsers, previous.newRegistrations) : null;
    const comparable = current && previous && current.timezone === previous.timezone && current.registrationMetric === previous.registrationMetric && current.ga4PropertyId === previous.ga4PropertyId;
    return NextResponse.json({ siteDomain, rankingSource: source, periods, traffic: { current: pack(current), previous: pack(previous), changes: {
      newUsers: comparable ? relativeChange(current.newUsers, previous.newUsers) : null,
      newRegistrations: comparable ? relativeChange(current.newRegistrations, previous.newRegistrations) : null,
      registrationRate: comparable ? relativeChange(currentRate, previousRate) : null,
      ratePoints: comparable && currentRate !== null && previousRate !== null ? (currentRate - previousRate) * 100 : null,
    } }, daily: changes ? { ...changes, date: latest!.captureDate.toISOString().slice(0,10), previousDate: prior?.captureDate.toISOString().slice(0,10) ?? null, unknownVolume: links.filter((link) => !volumes.has(link.keywordId)).length } : null,
    pages: pageRows.filter((row) => links.some((link) => link.keywordId === row.keywordId)).map((row) => ({ ...row, keyword: links.find((link) => link.keywordId === row.keywordId)?.keyword.text })),
    keywords: links.map((link) => ({ id: link.keywordId, text: link.keyword.text })),
    }, { headers: { "Cache-Control": "private, no-store" } });
}


async function summary(request: Request, region: SearchRegionCode, source: string): Promise<NextResponse> {
  type SiteInsights = {
    rankingSource: string; periods: ReturnType<typeof weeklyPeriods>;
    traffic: { current: { newUsers: number; newRegistrations: number; collectedAt: string; ga4PropertyId: string; timezone: string; registrationMetric: string } | null; previous: { newUsers: number; newRegistrations: number; collectedAt: string; ga4PropertyId: string; timezone: string; registrationMetric: string } | null };
    daily: { count: number; baseline: boolean; entered: string[]; lost: string[]; missing: string[]; detectedReduction: number | null; net: number | null; date: string; previousDate: string | null; unknownVolume: number } | null;
    keywords: { id: string; text: string }[];
    pages: Array<Record<string, unknown> & { id: string; keyword: string }>;
  };
  const domains = ["flatkey.ai", "rackrate.org", "modelfit.cc"];
  const parts: SiteInsights[] = [];
  for (const domain of domains) {
    const url = new URL(request.url);
    url.searchParams.set("site", domain); url.searchParams.set("source", source); url.searchParams.set("region", region);
    const response = await GET(new Request(url));
    if (!response.ok) {
      const failure = await response.json() as { code?: string };
      throw Object.assign(new Error("Site insight unavailable"), { code: failure.code ?? "UNKNOWN" });
    }
    parts.push(await response.json() as SiteInsights);
  }
  const total = (period: "current" | "previous") => {
    const rows = parts.flatMap((part) => part.traffic[period] ? [part.traffic[period]!] : []);
    if (!rows.length) return null;
    const newUsers = rows.reduce((sum, row) => sum + row.newUsers, 0);
    const newRegistrations = rows.reduce((sum, row) => sum + row.newRegistrations, 0);
    return { newUsers, newRegistrations, registrationRate: registrationRate(newUsers, newRegistrations), collectedAt: rows.map((row) => row.collectedAt).sort().at(-1), ga4PropertyId: null, sites: rows.length, timezones: [...new Set(rows.map(row=>row.timezone))], registrationMetrics: [...new Set(rows.map(row=>row.registrationMetric))] };
  };
  const current = total("current"); const previous = total("previous");
  const currentSites = domains.filter((_,index)=>parts[index].traffic.current);
  const previousSites = domains.filter((_,index)=>parts[index].traffic.previous);
  const comparable = Boolean(current && previous && currentSites.join() === previousSites.join() && parts.every(part=>!part.traffic.current || (part.traffic.current.timezone === part.traffic.previous?.timezone && part.traffic.current.registrationMetric === part.traffic.previous?.registrationMetric && part.traffic.current.ga4PropertyId === part.traffic.previous?.ga4PropertyId)));
  const weeks = await prisma.weeklyTraffic.findMany({ where: { siteDomain: { in: domains }, periodStart: { lte: new Date(weeklyPeriods().current.start) } }, distinct: ["periodStart"], select: { periodStart: true }, orderBy: { periodStart: "desc" }, take: 104 });
  const history = [...new Set([weeklyPeriods().current.start, ...weeks.map(row=>row.periodStart.toISOString().slice(0,10))])].sort().reverse();
  const days = parts.flatMap((part, index) => part.daily ? [{ ...part.daily, site: domains[index], source: part.rankingSource }] : []);
  const ids = (key: "entered" | "lost" | "missing") => parts.flatMap((part, index) => part.daily?.[key].map((id) => `${domains[index]}:${id}`) ?? []);
  const fullBaseline = days.length === domains.length && days.every((day) => !day.baseline);
  return NextResponse.json({ periods: parts[0].periods, history,
    traffic: { current, previous, changes: {
      newUsers: comparable ? relativeChange(current!.newUsers, previous!.newUsers) : null,
      newRegistrations: comparable ? relativeChange(current!.newRegistrations, previous!.newRegistrations) : null,
      registrationRate: comparable ? relativeChange(current!.registrationRate, previous!.registrationRate) : null,
      ratePoints: comparable && current!.registrationRate !== null && previous!.registrationRate !== null ? (current!.registrationRate - previous!.registrationRate) * 100 : null,
    }, currentSites, previousSites, comparable, missingCurrent: domains.filter((_, index) => !parts[index].traffic.current), missingPrevious: domains.filter((_, index) => !parts[index].traffic.previous) },
    daily: days.length ? { count: days.reduce((sum, row) => sum + row.count, 0), baseline: !fullBaseline, entered: ids("entered"), lost: ids("lost"), missing: ids("missing"), detectedReduction: fullBaseline ? days.reduce((sum,row) => sum + (row.detectedReduction ?? 0), 0) : null, net: fullBaseline ? days.reduce((sum,row) => sum + (row.net ?? 0), 0) : null, unknownVolume: days.reduce((sum,row) => sum + row.unknownVolume,0), date: days.map((day) => day.date).sort().at(-1), previousDate: fullBaseline ? "各站上次完整采集" : null, siteCaptures: days, pendingSites: domains.filter((_, index) => !parts[index].daily) } : null,
    keywords: parts.flatMap((part,index) => part.keywords.map((keyword) => ({ id: `${domains[index]}:${keyword.id}`, text: `${keyword.text} · ${domains[index]}` }))),
    pages: parts.flatMap((part,index) => part.pages.map((page) => ({ ...page, id: `${domains[index]}:${page.id}`, siteDomain: domains[index] }))),
  }, { headers: { "Cache-Control": "private, no-store" } });
}

type InsightResult = { body: string; headers: Record<string,string>; status: number };
const insightCache = new Map<string, InsightResult & {expiresAt:number}>();
const insightPending = new Map<string, Promise<InsightResult>>();
export async function GET(request: Request): Promise<NextResponse> {
  const url = new URL(request.url);
  const key = [url.searchParams.get("site") ?? "all",url.searchParams.get("source") ?? "combined",url.searchParams.get("region") ?? "US",url.searchParams.get("week") ?? "latest",weeklyPeriods().current.start].join(":");
  try {
    const saved = insightCache.get(key);
    if (saved && saved.expiresAt > Date.now()) return new NextResponse(saved.body,{status:saved.status,headers:saved.headers});
    if (!insightPending.has(key)) insightPending.set(key,retryDatabaseRead(()=>readInsights(request)).then(async response=>{
      const result = {body:await response.text(),headers:Object.fromEntries(response.headers),status:response.status};
      if (result.status === 200) insightCache.set(key,{...result,expiresAt:Date.now()+30000});
      return result;
    }).finally(()=>insightPending.delete(key)));
    const result = await insightPending.get(key)!;
    return new NextResponse(result.body,{status:result.status,headers:result.headers});
  } catch (error) {
    const code = databaseErrorCode(error);
    console.error("Insights read failed",code);
    return NextResponse.json({message:"分析数据读取失败，请重试",code},{status:503,headers:{"Cache-Control":"private, no-store"}});
  }
}
