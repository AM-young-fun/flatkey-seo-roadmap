import { analyticsLocalPreview, authorizeAnalyticsRead, privateAnalyticsHeaders } from "@/lib/seo-analytics-access";
import { authorizeSavedRankingCoverage } from "@/lib/services/ranking-coverage-access";
import { loadGrowthWorkspace } from "@/lib/services/growth-workspace";
import { GROWTH_SITES } from "@/lib/growth-workspace";

export const dynamic = "force-dynamic";
export const maxDuration = 300;
/** GET only: projections of already-authorized saved evidence, with read-only auth. */
export async function GET(request: Request) {
  try {
    if (!await authorizeAnalyticsRead(request) && !await authorizeSavedRankingCoverage(request)) return Response.json({ message: "请先登录或使用只读采集凭据" }, { status: 401, headers: privateAnalyticsHeaders });
    const params = new URL(request.url).searchParams, site = params.get("site") ?? undefined;
    if ([...params.keys()].some(key => key !== "site") || params.getAll("site").length > 1 || site && !GROWTH_SITES.some(item => item.domain === site)) return Response.json({ message: "站点参数无效" }, { status: 400, headers: privateAnalyticsHeaders });
    return Response.json(await loadGrowthWorkspace(analyticsLocalPreview(request), new Date(), site), { headers: privateAnalyticsHeaders });
  } catch { return Response.json({ message: "增长工作台读取未完成，请重试；未触发任何采集或写入" }, { status: 503, headers: privateAnalyticsHeaders }); }
}
