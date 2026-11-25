import { analyticsLocalPreview, authorizeAnalyticsRead, privateAnalyticsHeaders as headers } from "@/lib/seo-analytics-access";
import { analyticsKinds, analyticsObservationSchema, analyticsStorageKind, analyticsView, landingTrafficDays, observedPageUrls, pageDailyView, pageQueryView, rangeDays, safeAnalyticsUrl } from "@/lib/seo-analytics";
import { readAnalyticsEvidence } from "@/lib/seo-analytics-files";
import { prisma } from "@/lib/prisma";
import { seoCountry } from "@/lib/seo";
import { CLUSTER_SITES, clusterDomainForProperty } from "@/lib/seo-cluster-sites";
import { optimizationEffect, optimizationRange } from "@/lib/seo-page-effects";
import { pageOptimizationPriorities, pagePrioritySignals, type PagePriorityFilters } from "@/lib/seo-page-priority";
import { publishedKeywordRankLabels } from "@/lib/published-keyword-rank";
import { GROWTH_EXECUTION_SITES } from "@/lib/seo-growth-markets";
import { loadGrowthDashboardWorkspace } from "@/lib/services/growth-workspace";
import { loadWorkflowSnapshot } from "@/lib/services/seo-workflow";
import { previousRange, propertyToday, seoToday, shiftDay, validRange } from "@/lib/seo-date-range";
import { overviewModule } from "@/lib/seo-overview-scope";
import { flatkeyBrandTraffic } from "@/lib/seo-brand-traffic";
import { trafficOverview, trafficPeriodComparison } from "@/lib/seo-traffic-overview";
import { closedTrafficSummaryDay, TRAFFIC_SUMMARY_KIND, trafficSummaryDaySchema, trafficSummaryPeriodKind, trafficSummaryPeriodSchema } from "@/lib/seo-traffic-summary";
import { overviewModuleAnalytics, overviewTrafficAnalytics } from "@/lib/seo-overview-analytics";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!await authorizeAnalyticsRead(request)) return Response.json({ message: "请先登录" }, { status: 401, headers });
  const search = new URL(request.url).searchParams;
  const requestedCountry = search.get("country");
  const country = seoCountry(requestedCountry);
  if (requestedCountry !== null && requestedCountry !== country) {
    return Response.json({ message: "国家筛选无效" }, { status: 400, headers });
  }
  const range = { start: search.get("start") ?? "", end: search.get("end") ?? "" };
  if (search.get("view") === "traffic-overview") return readTrafficOverview(request, search, range);
  const urls = [...new Set(search.getAll("url"))];
  const allPages = search.get("pages") === "all", pageDaily = search.get("pageDaily") === "1";
  const pageQueries = search.get("pageQueries") === "1";
  const priority = search.get("priority") === "1";
  const effectAt = search.get("effectAt");
  const requestedModule = search.get("module");
  const module = overviewModule(requestedModule);
  const requestedSite = search.get("site");
  const site = CLUSTER_SITES.find(entry => entry.domain === requestedSite);
  const siteDomain = site?.domain ?? "flatkey.ai";
  const priorityFilters = { page: Number(search.get("page") ?? 1),
    rank: search.get("rank") ?? "all", signal: search.get("signal") ?? "all" } as PagePriorityFilters;
  const viewMode = search.get("view");
  const overview = viewMode === "overview-traffic", brandTraffic = viewMode === "brand-traffic";
  const compareStart = search.get("compareStart"), compareEnd = search.get("compareEnd");
  const comparison = compareStart !== null || compareEnd !== null ? { start: compareStart ?? "", end: compareEnd ?? "" } : null;
  try {
    const days = rangeDays(range);
    if (brandTraffic && ([...search.keys()].some(key => !["view", "start", "end"].includes(key) || search.getAll(key).length !== 1)
      || range.end >= propertyToday("America/Los_Angeles"))) throw new Error("无效品牌词统计范围");
    if (overview) {
      const keys = ["view", "start", "end", "compareStart", "compareEnd", "country", "module"];
      const today = propertyToday("America/Los_Angeles");
      if ([...search.keys()].some(key => !keys.includes(key) || search.getAll(key).length !== 1)
        || requestedModule !== null && requestedModule !== module || range.end >= today || comparison && comparison.end >= today) throw new Error("无效总览范围");
      if (comparison) rangeDays(comparison);
    }
    if (priority) {
      const keys = ["start", "end", "site", "country", "priority", "rank", "signal", "page"];
      if ([...search.keys()].some(key => !keys.includes(key) || search.getAll(key).length !== 1)
        || country === "all" || days.length > 35 || !GROWTH_EXECUTION_SITES.some(site => site === siteDomain)
        || !Number.isSafeInteger(priorityFilters.page) || priorityFilters.page < 1
        || priorityFilters.rank !== "all" && !Object.hasOwn(publishedKeywordRankLabels, priorityFilters.rank)
        || priorityFilters.signal !== "all" && !pagePrioritySignals.includes(priorityFilters.signal)) throw new Error("无效优先级范围");
    }
    if (effectAt && (!pageDaily || !Number.isFinite(Date.parse(effectAt)) || Date.parse(effectAt) > Date.now()
      || optimizationRange(effectAt, range.end).start !== range.start)) throw new Error("无效上线日期");
    // The cluster comparison uses one Beijing date range. Import still checks each source's timezone.
    if (range.end >= seoToday() || urls.length > 25 || !urls.every(value => {
      if (!safeAnalyticsUrl(value)) return false;
      const domain = site?.domain ?? "flatkey.ai", host = new URL(value).hostname;
      return host === domain || host.endsWith(`.${domain}`);
    })
      || pageDaily && (urls.length !== 1 || allPages) || pageQueries && urls.length > 1
      || requestedSite !== null && requestedSite !== "flatkey.ai" && !site
      || requestedModule !== null && (requestedModule !== module || pageQueries || pageDaily || urls.length > 0)) throw new Error("无效筛选");
  } catch {
    return Response.json({ message: "请选择已结束日期；一次最多366天和25个所选站点页面。" }, { status: 400, headers });
  }
  try {
    if (brandTraffic) {
      const source = analyticsLocalPreview(request) ? await readAnalyticsEvidence(range, "all", undefined, ["gsc-page-queries"])
        : (await prisma.seoAnalyticsDay.findMany({ where: { date: { gte: range.start, lte: range.end }, kind: { in: ["gsc-page-queries"] } },
          select: { payload: true } })).flatMap(row => {
            const result = analyticsObservationSchema.safeParse(row.payload);
            return result.success ? [result.data] : [];
          });
      return Response.json(flatkeyBrandTraffic(range, source), { headers });
    }
    if (overview) {
      const started = performance.now(), local = analyticsLocalPreview(request);
      const sources = module === "all" ? ["ga4-site" as const] : ["ga4-pages" as const, "gsc-pages" as const];
      const currentKinds = module === "all" ? [...sources, "ga4-pages" as const] : sources;
      const requests = [{ range, kinds: currentKinds }, ...(comparison ? [{ range: comparison, kinds: sources }] : [])];
      const sourceRows = local ? (await Promise.all(requests.map(entry => readAnalyticsEvidence(entry.range, country, undefined, entry.kinds)))).flat()
        : (await prisma.seoAnalyticsDay.findMany({ where: { OR: requests.map(entry => ({
          date: { gte: entry.range.start, lte: entry.range.end },
          kind: { in: entry.kinds.map(kind => analyticsStorageKind(kind, country)) },
        })) }, select: { payload: true } })).map(row => analyticsObservationSchema.parse(row.payload));
      const rows = [...new Map(sourceRows.filter(row => !clusterDomainForProperty(row.property) && (row.country ?? "all") === country)
        .map(row => [`${row.date}:${row.kind}`, row])).values()];
      const responseHeaders = new Headers(headers);
      responseHeaders.set("Server-Timing", `overview-traffic;dur=${Math.round(performance.now() - started)}`);
      return Response.json(overviewTrafficAnalytics(range, comparison, module, country, rows), { headers: responseHeaders });
    }
    // Site summaries use only daily site totals. Reading the page archives here
    // also deserializes and validates every landing/search URL for no output.
    const siteSummary = !urls.length && !allPages && !pageDaily && requestedModule === null;
    const kinds = priority ? ["gsc-pages" as const] : pageQueries ? ["gsc-page-queries" as const]
      : siteSummary ? ["ga4-site" as const, "gsc-site" as const]
        : analyticsKinds.filter(kind => kind !== "gsc-page-queries");
    const local = analyticsLocalPreview(request);
    const readObservations = async () => local ? readAnalyticsEvidence(range, country, site?.domain, kinds)
      : (await prisma.seoAnalyticsDay.findMany({
        where: { date: { gte: range.start, lte: range.end }, kind: { in: kinds.map(kind => analyticsStorageKind(kind, country, site?.domain)) } },
        select: { payload: true },
      })).map(row => analyticsObservationSchema.parse(row.payload))
        .filter(row => clusterDomainForProperty(row.property) === site?.domain && (row.country ?? "all") === country);
    if (priority) {
      const now = new Date();
      const [rows, workflow, inventory] = await Promise.all([
        readObservations(), loadWorkflowSnapshot({ allHistory: true }, local), loadGrowthDashboardWorkspace(local, now, siteDomain),
      ]);
      return Response.json(pageOptimizationPriorities(rows, workflow, inventory.targets, siteDomain, country, now, priorityFilters), { headers });
    }
    const rows = await readObservations();
    if (requestedModule !== null) return Response.json({ ...overviewModuleAnalytics(range, module, rows), country, site: site?.domain ?? "flatkey.ai" }, { headers });
    if (site && !pageQueries && !urls.length && !allPages) {
      const view = analyticsView(range, [], rows);
      const searchByDay = new Map(rows.flatMap(row => row.kind === "gsc-site" ? [[row.date, row] as const] : []));
      const daily = view.daily.map(day => {
        const search = searchByDay.get(day.date);
        return { ...day, clicks: search?.clicks ?? null, impressions: search?.impressions ?? null, searchFinal: search?.complete ?? false };
      });
      return Response.json({ site: site.domain, country, daily }, { headers });
    }
    if (pageQueries) return Response.json({ ...pageQueryView(range, rows, urls[0]), country, site: site?.domain ?? "flatkey.ai" }, { headers });
    const view = { ...analyticsView(range, allPages ? observedPageUrls(rows) : urls, rows), country, site: site?.domain ?? "flatkey.ai" };
    if (pageDaily) return Response.json({ ...view, pageDaily: pageDailyView(range, urls[0], rows),
      ...(effectAt ? { optimizationEffect: optimizationEffect({ url: urls[0], site: site?.domain ?? "flatkey.ai", country, publishedAt: effectAt, end: range.end, now: new Date(), observations: rows }) } : {}) }, { headers });
    if (allPages && search.get("landingDaily") === "1") {
      return Response.json({ ...view, landingDaily: landingTrafficDays(range, rows) }, { headers });
    }
    return Response.json(view, { headers });
  } catch {
    return Response.json({ message: "暂时无法读取已归档的 SEO 数据。" }, { status: 503, headers });
  }
}


async function readTrafficOverview(request: Request, search: URLSearchParams, range: { start: string; end: string }) {
  const latest = closedTrafficSummaryDay();
  const requested = search.has("start") || search.has("end") ? range : null;
  if ([...search.keys()].some(key => !["view", "start", "end"].includes(key) || search.getAll(key).length !== 1)
    || requested && (!validRange(requested) || requested.end > latest || Date.parse(requested.end) - Date.parse(requested.start) > 365 * 86400000)) {
    return Response.json({ message: "请选择已结束日期；一次最多查询366天。" }, { status: 400, headers });
  }
  try {
    const scan = requested ?? { start: shiftDay(latest, -34), end: latest };
    const kinds = ["ga4-pages"] as const;
    const local = analyticsLocalPreview(request);
    const [rows, localAnalytics] = await Promise.all([
      prisma.seoAnalyticsDay.findMany({ where: { date: { gte: scan.start, lte: scan.end },
        kind: { in: local ? [TRAFFIC_SUMMARY_KIND] : [TRAFFIC_SUMMARY_KIND, ...kinds] } },
        select: { kind: true, date: true, payload: true } }),
      local ? readAnalyticsEvidence(scan, "all", undefined, kinds) : [],
    ]);
    const summaries = rows.flatMap(row => {
      if (row.kind !== TRAFFIC_SUMMARY_KIND) return [];
      const result = trafficSummaryDaySchema.safeParse(row.payload);
      return result.success && result.data.date === row.date ? [result.data] : [];
    });
    const sources = rows.flatMap(row => {
      if (row.kind === TRAFFIC_SUMMARY_KIND) return [];
      const result = analyticsObservationSchema.safeParse(row.payload);
      return result.success && result.data.date === row.date && result.data.kind === row.kind ? [result.data] : [];
    });
    const overview = trafficOverview(scan, requested, summaries, [...sources, ...localAnalytics]);
    const comparison = await readTrafficPeriodComparison(overview).catch(() => null);
    return Response.json({ ...overview, comparison }, { headers });
  } catch {
    return Response.json({ message: "暂时无法读取流量与注册数据。" }, { status: 503, headers });
  }
}


async function readTrafficPeriodComparison(range: { start: string; end: string }) {
  const rows = await prisma.seoAnalyticsDay.findMany({ where: { kind: { in: [trafficSummaryPeriodKind(range)] },
    date: { in: [previousRange(range).end, range.end] } }, select: { date: true, payload: true } });
  const periods = rows.flatMap(row => {
    const result = trafficSummaryPeriodSchema.safeParse(row.payload);
    return result.success && result.data.end === row.date ? [result.data] : [];
  });
  return trafficPeriodComparison(range, periods);
}
