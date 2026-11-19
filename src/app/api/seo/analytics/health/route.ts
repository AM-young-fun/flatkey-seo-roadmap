import { CLUSTER_SITES } from "@/lib/seo-cluster-sites";
import { analyticsStorageKind } from "@/lib/seo-analytics";
import { authorizeAnalyticsRead, privateAnalyticsHeaders as headers } from "@/lib/seo-analytics-access";
import { prisma } from "@/lib/prisma";
import { defaultRange, seoToday } from "@/lib/seo-date-range";
import { basicAnalyticsHealth } from "@/lib/analytics-health";
import { seoCountry } from "@/lib/seo";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  if (!await authorizeAnalyticsRead(request)) return Response.json({ message: "请先登录" }, { status: 401, headers });
  const query = new URL(request.url).searchParams;
  const range = { start: query.get("start") ?? defaultRange().start, end: query.get("end") ?? defaultRange().end };
  const country = seoCountry(query.get("country"));
  try {
    basicAnalyticsHealth(range, country, []);
    if (range.end >= seoToday()) throw new Error("Date not ended");
    if (query.has("country") && query.get("country") !== country) throw new Error("Invalid country");
  } catch { return Response.json({ message: "请选择最多90个已结束日和有效国家" }, { status: 400, headers }); }
  try {
    const kinds = [undefined, ...CLUSTER_SITES.map(site => site.domain)].flatMap(site =>
      (["ga4-site", "gsc-site", ...(!site || ["rackrate.org", "modelfit.cc"].includes(site) ? ["ga4-pages", "gsc-pages"] : [])] as Array<"ga4-site" | "gsc-site" | "ga4-pages" | "gsc-pages">).map(kind => analyticsStorageKind(kind, country, site)));
    const rows = await prisma.seoAnalyticsDay.findMany({ where: { date: { gte: range.start, lte: range.end }, kind: { in: kinds } }, select: { kind: true, date: true, payload: true } });
    return Response.json(basicAnalyticsHealth(range, country, rows), { headers });
  } catch { return Response.json({ message: "基础数据完整性读取失败，不能判定为正常" }, { status: 503, headers }); }
}
