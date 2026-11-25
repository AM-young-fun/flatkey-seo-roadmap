import { analyticsLocalPreview, authorizeAnalyticsRead, privateAnalyticsHeaders } from "@/lib/seo-analytics-access";
import { authorizeSavedRankingCoverage } from "@/lib/services/ranking-coverage-access";
import { loadGrowthDashboardWorkspace, loadGrowthWorkspace } from "@/lib/services/growth-workspace";
import { GROWTH_SITES } from "@/lib/growth-workspace";
import { growthOverviewWorkspace } from "@/lib/growth-overview-workspace";
import { growthQuarterPage } from "@/lib/growth-quarter-page";
import { readGrowthScope } from "@/components/growth-topic-view";

export const dynamic = "force-dynamic";
export const maxDuration = 300;
const quarterKeys = ["view", "site", "country", "language", "q", "topic", "page", "related", "target"];
let pageSnapshot: { expiresAt: number; result: ReturnType<typeof loadGrowthWorkspace> } | undefined;

function loadPageSnapshot(local: boolean) {
  if (local) return loadGrowthWorkspace(true);
  if (pageSnapshot && pageSnapshot.expiresAt > Date.now()) return pageSnapshot.result;
  const result = loadGrowthWorkspace();
  const current = { expiresAt: Infinity, result };
  pageSnapshot = current;
  void result.then(() => { current.expiresAt = Date.now() + 30_000; },
    () => { if (pageSnapshot === current) pageSnapshot = undefined; });
  return result;
}
/** GET only: projections of already-authorized saved evidence, with read-only auth. */
export async function GET(request: Request) {
  try {
    if (!await authorizeAnalyticsRead(request) && !await authorizeSavedRankingCoverage(request)) return Response.json({ message: "请先登录或使用只读采集凭据" }, { status: 401, headers: privateAnalyticsHeaders });
    const params = new URL(request.url).searchParams;
    const site = params.get("site") ?? undefined, view = params.get("view");
    const keys = view === "quarter" ? quarterKeys : ["site", "view"];
    const page = Number(params.get("page") ?? 1);
    if ([...params.keys()].some(key => !keys.includes(key) || params.getAll(key).length > 1)
      || (view === "quarter" && (!Number.isSafeInteger(page) || page < 1 || [...params.values()].some(value => value.length > 240)))
      || site && !GROWTH_SITES.some(item => item.domain === site) || view !== null && !["overview", "quarter", "dashboard"].includes(view)) {
      return Response.json({ message: "站点参数无效" }, { status: 400, headers: privateAnalyticsHeaders });
    }
    const local = analyticsLocalPreview(request);
    if (view === "dashboard") return Response.json(growthOverviewWorkspace(await loadGrowthDashboardWorkspace(local, new Date(), site)), { headers: privateAnalyticsHeaders });
    if (view === "quarter") {
      const data = await loadPageSnapshot(local);
      return Response.json(growthQuarterPage(data, { scope: readGrowthScope(params), page,
        topicId: params.get("topic") ?? undefined, related: params.get("related") === "1", selected: params.get("target") ?? undefined }), { headers: privateAnalyticsHeaders });
    }
    const workspace = await (view === "overview" && !site ? loadPageSnapshot(local) : loadGrowthWorkspace(local, new Date(), site));
    return Response.json(view === "overview" ? growthOverviewWorkspace(workspace) : workspace, { headers: privateAnalyticsHeaders });
  } catch { return Response.json({ message: "增长工作台读取未完成，请重试；未触发任何采集或写入" }, { status: 503, headers: privateAnalyticsHeaders }); }
}
