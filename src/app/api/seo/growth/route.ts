import { analyticsLocalPreview, authorizeAnalyticsRead, privateAnalyticsHeaders } from "@/lib/seo-analytics-access";
import { authorizeSavedRankingCoverage } from "@/lib/services/ranking-coverage-access";
import { loadGrowthDashboardWorkspace, loadGrowthQuarterRankEvidence, loadGrowthWorkspace } from "@/lib/services/growth-workspace";
import { GROWTH_SITES } from "@/lib/growth-workspace";
import { growthDashboardProjection, growthOverviewWorkspace } from "@/lib/growth-overview-workspace";
import { growthQuarterPage } from "@/lib/growth-quarter-page";
import { readGrowthScope } from "@/components/growth-topic-view";
import type { GrowthWorkspace } from "@/lib/growth-types";

export const dynamic = "force-dynamic";
export const maxDuration = 300;
const quarterKeys = ["view", "site", "country", "language", "q", "topic", "page", "related", "target"];
let pageSnapshot: { expiresAt: number; result: ReturnType<typeof loadGrowthWorkspace> } | undefined;
let quarterSnapshot: typeof pageSnapshot;

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

function loadQuarterSnapshot(local: boolean): Promise<GrowthWorkspace> {
  if (local) return loadGrowthDashboardWorkspace(true);
  if (quarterSnapshot && quarterSnapshot.expiresAt > Date.now()) return quarterSnapshot.result;
  const result = loadGrowthDashboardWorkspace();
  const current = { expiresAt: Infinity, result };
  quarterSnapshot = current;
  void result.then(workspace => {
    if (workspace.reconciliation.sources.some(source => source.name === "最近14天的已存SERP" && !source.available)) {
      if (quarterSnapshot === current) quarterSnapshot = undefined;
    } else current.expiresAt = Date.now() + 30_000;
  }, () => { if (quarterSnapshot === current) quarterSnapshot = undefined; });
  return result;
}

/** GET only: projections of already-authorized saved evidence, with read-only auth. */
export async function GET(request: Request) {
  try {
    if (!await authorizeAnalyticsRead(request) && !await authorizeSavedRankingCoverage(request)) return Response.json({ message: "请先登录或使用只读采集凭据" }, { status: 401, headers: privateAnalyticsHeaders });
    const params = new URL(request.url).searchParams;
    const site = params.get("site") ?? undefined, view = params.get("view");
    const quarter = view === "quarter" || view === "quarter-evidence";
    const keys = quarter ? quarterKeys : ["site", "view"];
    const page = Number(params.get("page") ?? 1);
    if ([...params.keys()].some(key => !keys.includes(key) || params.getAll(key).length > 1)
      || (quarter && (!Number.isSafeInteger(page) || page < 1 || [...params.values()].some(value => value.length > 240)))
      || (view === "quarter-evidence" && !params.get("topic"))
      || site && !GROWTH_SITES.some(item => item.domain === site) || view !== null && !quarter && !["overview", "dashboard"].includes(view)) {
      return Response.json({ message: "站点参数无效" }, { status: 400, headers: privateAnalyticsHeaders });
    }
    const local = analyticsLocalPreview(request);
    if (view === "dashboard") {
      const started = performance.now();
      const data = growthDashboardProjection(await loadGrowthDashboardWorkspace(local, new Date(), site));
      const headers = new Headers(privateAnalyticsHeaders);
      headers.set("server-timing", `growth-dashboard;dur=${Math.round(performance.now() - started)}`);
      return Response.json(data, { headers });
    }
    if (quarter) {
      const started = performance.now();
      const data = await loadQuarterSnapshot(local);
      const result = growthQuarterPage(data, { scope: readGrowthScope(params), page,
        topicId: params.get("topic") ?? undefined, related: params.get("related") === "1", selected: params.get("target") ?? undefined });
      const core = performance.now() - started;
      if (view === "quarter-evidence") {
        const evidence = await loadGrowthQuarterRankEvidence(result.data.targets, data.generatedAt);
        return Response.json(evidence, { headers: { ...privateAnalyticsHeaders,
          "Server-Timing": `quarter-core;dur=${core.toFixed(1)}, quarter-evidence;dur=${(performance.now() - started - core).toFixed(1)}` } });
      }
      return Response.json(result, { headers: { ...privateAnalyticsHeaders, "Server-Timing": `quarter-core;dur=${core.toFixed(1)}` } });
    }
    const workspace = await (view === "overview" && !site ? loadPageSnapshot(local) : loadGrowthWorkspace(local, new Date(), site));
    return Response.json(view === "overview" ? growthOverviewWorkspace(workspace) : workspace, { headers: privateAnalyticsHeaders });
  } catch { return Response.json({ message: "增长工作台读取未完成，请重试；未触发任何采集或写入" }, { status: 503, headers: privateAnalyticsHeaders }); }
}
