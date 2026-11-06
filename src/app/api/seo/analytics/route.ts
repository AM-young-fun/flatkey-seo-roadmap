import { analyticsLocalPreview, authorizeAnalyticsRead, privateAnalyticsHeaders as headers } from "@/lib/seo-analytics-access";
import { analyticsKinds, analyticsObservationSchema, analyticsStorageKind, analyticsView, landingTrafficDays, observedPageUrls, pageDailyView, pageQueryView, rangeDays, safeAnalyticsUrl } from "@/lib/seo-analytics";
import { readAnalyticsEvidence } from "@/lib/seo-analytics-files";
import { prisma } from "@/lib/prisma";
import { seoCountry } from "@/lib/seo";
import { CLUSTER_SITES, clusterDomainForProperty } from "@/lib/seo-cluster-sites";
import { propertyToday } from "@/lib/seo-date-range";

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
  const urls = [...new Set(search.getAll("url"))];
  const allPages = search.get("pages") === "all", pageDaily = search.get("pageDaily") === "1";
  const pageQueries = search.get("pageQueries") === "1";
  const requestedSite = search.get("site");
  const site = CLUSTER_SITES.find(entry => entry.domain === requestedSite);
  try {
    rangeDays(range);
    // The cluster comparison uses one Beijing date range. Import still checks each source's timezone.
    if (range.end >= propertyToday(site ? "Asia/Shanghai" : undefined) || urls.length > 25 || !urls.every(safeAnalyticsUrl)
      || pageDaily && (urls.length !== 1 || allPages) || pageQueries && urls.length > 1
      || requestedSite !== null && (!site || urls.length || allPages || pageDaily || pageQueries)) throw new Error("无效筛选");
  } catch {
    return Response.json({ message: "请选择已结束日期；一次最多366天和25个 Flatkey 页面。" }, { status: 400, headers });
  }
  try {
    const kinds = site ? (["ga4-site", "gsc-site"] as const)
      : analyticsKinds.filter(kind => pageQueries === (kind === "gsc-page-queries"));
    const rows = analyticsLocalPreview(request)
      ? await readAnalyticsEvidence(range, country, site?.domain)
      : (await prisma.seoAnalyticsDay.findMany({
        where: { date: { gte: range.start, lte: range.end }, kind: { in: kinds.map(kind => analyticsStorageKind(kind, country, site?.domain)) } },
        select: { payload: true },
      })).map(row => analyticsObservationSchema.parse(row.payload))
        .filter(row => clusterDomainForProperty(row.property) === site?.domain && (row.country ?? "all") === country);
    if (site) {
      const view = analyticsView(range, [], rows);
      const searchByDay = new Map(rows.flatMap(row => row.kind === "gsc-site" ? [[row.date, row] as const] : []));
      const daily = view.daily.map(day => {
        const search = searchByDay.get(day.date);
        return { ...day, clicks: search?.clicks ?? null, impressions: search?.impressions ?? null, searchFinal: search?.complete ?? false };
      });
      return Response.json({ site: site.domain, country, daily }, { headers });
    }
    if (pageQueries) return Response.json({ ...pageQueryView(range, rows, urls[0]), country }, { headers });
    const view = { ...analyticsView(range, allPages ? observedPageUrls(rows) : urls, rows), country };
    if (pageDaily) return Response.json({ ...view, pageDaily: pageDailyView(range, urls[0], rows) }, { headers });
    if (allPages && search.get("landingDaily") === "1") {
      return Response.json({ ...view, landingDaily: landingTrafficDays(range, rows) }, { headers });
    }
    return Response.json(view, { headers });
  } catch {
    return Response.json({ message: "暂时无法读取已归档的 SEO 数据。" }, { status: 503, headers });
  }
}
