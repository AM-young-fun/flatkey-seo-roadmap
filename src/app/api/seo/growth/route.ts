import { analyticsLocalPreview, authorizeAnalyticsRead, privateAnalyticsHeaders } from "@/lib/seo-analytics-access";
import { authorizeSavedRankingCoverage } from "@/lib/services/ranking-coverage-access";
import { loadGrowthDashboardWorkspace, loadGrowthKeywordWorkspace, loadGrowthQuarterRankEvidence, loadGrowthWorkspace } from "@/lib/services/growth-workspace";
import { GROWTH_SITES } from "@/lib/growth-workspace";
import { growthDashboardProjection, growthOverviewWorkspace } from "@/lib/growth-overview-workspace";
import { growthQuarterPage } from "@/lib/growth-quarter-page";
import { growthKeywordInventoryPage } from "@/lib/growth-keyword-inventory";
import type { PublishedKeywordRank } from "@/lib/published-keyword-rank";
import { readGrowthScope } from "@/components/growth-topic-view";
import type { GrowthWorkspace } from "@/lib/growth-types";
import { profileRead, timedRead } from "@/lib/read-profile";

export const dynamic = "force-dynamic";
export const maxDuration = 300;
const inventoryKeys = ["view", "site", "country", "language", "q", "page"];
const quarterKeys = [...inventoryKeys, "topic", "related", "target", "new"];
const snapshotLoaders = { full: loadGrowthWorkspace, quarter: loadGrowthDashboardWorkspace, catalog: loadGrowthKeywordWorkspace };
const snapshots = new Map<keyof typeof snapshotLoaders, { expiresAt: number; result: Promise<GrowthWorkspace> }>();

function loadSnapshot(view: keyof typeof snapshotLoaders, local: boolean) {
  const load = snapshotLoaders[view];
  if (local) return load(true);
  const hit = snapshots.get(view);
  if (hit && hit.expiresAt > Date.now()) return hit.result;
  const result = load();
  const current = { expiresAt: Infinity, result };
  snapshots.set(view, current);
  const discard = () => { if (snapshots.get(view) === current) snapshots.delete(view); };
  void result.then(workspace => {
    if (view !== "full" && workspace.reconciliation.sources.some(source => !source.available && source.reason?.startsWith("来源读取失败"))) discard();
    else current.expiresAt = Date.now() + 30_000;
  }, discard);
  return result;
}

/** GET only: projections of already-authorized saved evidence, with read-only auth. */
export async function GET(request: Request) {
  try {
    if (!await authorizeAnalyticsRead(request) && !await authorizeSavedRankingCoverage(request)) return Response.json({ message: "请先登录或使用只读采集凭据" }, { status: 401, headers: privateAnalyticsHeaders });
    const params = new URL(request.url).searchParams;
    const site = params.get("site") ?? undefined, view = params.get("view");
    const quarter = view === "quarter" || view === "quarter-evidence";
    const library = view === "keywords" || view === "published" ? view : null;
    const keys = quarter ? quarterKeys : library === "published" ? [...inventoryKeys, "rank"] : library ? inventoryKeys : ["site", "view"];
    const page = Number(params.get("page") ?? 1);
    const rank = params.get("rank") ?? "all", newOnly = params.get("new");
    if ([...params.keys()].some(key => !keys.includes(key) || params.getAll(key).length > 1)
      || ((quarter || library) && (!Number.isSafeInteger(page) || page < 1 || [...params.values()].some(value => value.length > 240)))
      || (view === "quarter-evidence" && !params.get("topic"))
      || (newOnly !== null && newOnly !== "1") || !["all", "outside100", "ranked", "pending"].includes(rank)
      || site && !GROWTH_SITES.some(item => item.domain === site) || view !== null && !quarter && !library && !["overview", "dashboard"].includes(view)) {
      return Response.json({ message: "站点参数无效" }, { status: 400, headers: privateAnalyticsHeaders });
    }
    const local = analyticsLocalPreview(request);
    if (view === "dashboard") {
      const started = performance.now();
      const data = growthDashboardProjection(await (site ? loadGrowthDashboardWorkspace(local, new Date(), site) : loadSnapshot("quarter", local)));
      const headers = new Headers(privateAnalyticsHeaders);
      headers.set("server-timing", `growth-dashboard;dur=${Math.round(performance.now() - started)}`);
      return Response.json(data, { headers });
    }
    if (library) {
      const read = await profileRead(async () => {
        const data = await timedRead("workspace", () => loadSnapshot(library === "keywords" ? "catalog" : "quarter", local));
        return growthKeywordInventoryPage(data, readGrowthScope(params), page, library, rank as PublishedKeywordRank | "all");
      });
      const timing = [...read.phases.map(phase => `${phase.phase};dur=${phase.durationMs}`), `keyword-library;dur=${read.durationMs}`].join(", ");
      return Response.json(read.value, { headers: { ...privateAnalyticsHeaders, "Server-Timing": timing } });
    }
    if (quarter) {
      const started = performance.now();
      const data = await loadSnapshot("quarter", local);
      const result = growthQuarterPage(data, { scope: readGrowthScope(params), page,
        topicId: params.get("topic") ?? undefined, related: params.get("related") === "1", selected: params.get("target") ?? undefined, newOnly: newOnly === "1" });
      const core = performance.now() - started;
      if (view === "quarter-evidence") {
        const evidence = await loadGrowthQuarterRankEvidence(result.data.targets, data.generatedAt);
        return Response.json(evidence, { headers: { ...privateAnalyticsHeaders,
          "Server-Timing": `quarter-core;dur=${core.toFixed(1)}, quarter-evidence;dur=${(performance.now() - started - core).toFixed(1)}` } });
      }
      return Response.json(result, { headers: { ...privateAnalyticsHeaders, "Server-Timing": `quarter-core;dur=${core.toFixed(1)}` } });
    }
    const workspace = await (view === "overview" && !site ? loadSnapshot("full", local) : loadGrowthWorkspace(local, new Date(), site));
    return Response.json(view === "overview" ? growthOverviewWorkspace(workspace) : workspace, { headers: privateAnalyticsHeaders });
  } catch { return Response.json({ message: "增长工作台读取未完成，请重试；未触发任何采集或写入" }, { status: 503, headers: privateAnalyticsHeaders }); }
}
