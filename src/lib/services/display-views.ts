import { prisma } from "@/lib/prisma";
import { activeReportPeriods, reportPeriods } from "@/lib/weekly-traffic";
import { SERP_TRENDS_DISPLAY_VERSION, serpTrendRange } from "@/lib/ranking-trends";
import { rebuildDisplaySnapshot, type DisplaySpec } from "./display-snapshots";
import { overviewModule } from "@/lib/seo-overview-scope";
const trafficDisplayVersion = "organic-search-weekly-v6";
const dashboardDisplayVersion = "keyword-market-demand-targets-v3";

export function displayViewSpec(params: URLSearchParams): DisplaySpec {
  const view = params.get("view") ?? "dashboard", site = params.get("site") ?? "all";
  if (!["all","flatkey.ai","rackrate.org","modelfit.cc"].includes(site)) throw new Error("网站无效");
  const research = params.get("includeResearch") ?? "0";
  if (!["0","1"].includes(research)) throw new Error("词池范围无效");
  if (view === "dashboard") return {key:`display-v1:dashboard:${site}:${research}:${dashboardDisplayVersion}`, build:async () => {
    // A saved display read only needs its key. Load reconstruction code when a
    // bootstrap/background rebuild actually needs it, outside the read path.
    const [{ loadDashboard }, { loadKeywordOkr }, { loadOptimizedPageMonitor },
      { overviewPayload }, { compactDashboard }, { keywordDisplayRows }, { candidateKeywordCount }] = await Promise.all([
      import("./dashboard-data"), import("./keyword-okr"), import("./optimized-page-monitor"),
      import("@/lib/overview-payload"), import("@/lib/dashboard-payload"),
      import("@/lib/keyword-display-rows"), import("@/lib/keyword-inventory"),
    ]);
    const value = compactDashboard(await loadDashboard(site,"dataforseo_serp","week",new Date(),research === "1",{currentOnly:true}));
    if (value.usingDemoData) throw new Error("Live inventory unavailable");
    if (value.serpOverview) {
      // Read only candidate text while rebuilding the saved display. No rank or
      // history reads, and only the final count is sent to the browser.
      const candidates = site === "all" || site === "flatkey.ai" ? await prisma.siteKeyword.findMany({
        where:{siteDomain:"flatkey.ai",pool:"RESEARCH",active:true,keyword:{active:true},site:{active:true}},
        select:{keyword:{select:{text:true}}},
      }) : [];
      value.serpOverview.candidateCount = candidateKeywordCount(value.keywords.map(word => word.text), candidates.map(row => row.keyword.text));
    }
    const okr = site === "all" ? await loadKeywordOkr("flatkey.ai",research === "1" ? "RESEARCH" : "FORMAL") : null;
    if (okr && !okr.initialized) throw new Error("Formal inventory unavailable");
    const optimizedPages = okr ? (await loadOptimizedPageMonitor()).pages : [];
    return {value:overviewPayload(value), keywordRows:okr ? keywordDisplayRows(value,okr,research === "1",optimizedPages) : undefined};
  }};
  if (view === "traffic") {
    const periods = params.get("week") ? reportPeriods(params.get("week")!) : activeReportPeriods();
    if (periods.current.start > activeReportPeriods().current.start) throw new Error("周报尚未结束");
    // Scope is part of the durable cache identity: never serve a saved
    // all-channel payload in the organic-search report after deployment.
    return {key:`display-v1:traffic:${periods.current.start}:${trafficDisplayVersion}`,build:async () => {
      const { buildWeeklyReport } = await import("./weekly-report");
      return { value: await buildWeeklyReport(periods) };
    }};
  }
  if (view === "trends") {
    const range = serpTrendRange(params.get("start") ?? undefined,params.get("end") ?? undefined,new Date());
    const module = overviewModule(params.get("module"));
    return {key:`display-v1:trends:${site}:${range.start}:${range.end}:${module}:${SERP_TRENDS_DISPLAY_VERSION}`,build:async () => {
      const { buildDisplayTrends } = await import("./display-trends");
      return { value: await buildDisplayTrends(site,range,new Date(),module) };
    }};
  }
  throw new Error("页面类型无效");
}

// Existing coordinator only: no extra scheduler, and no paid/provider calls.
export async function refreshDisplayViews(deadline = Date.now()+50_000) {
  const defaults = [new URLSearchParams({view:"dashboard"}),new URLSearchParams({view:"traffic"}),new URLSearchParams({view:"trends"})].map(displayViewSpec);
  const rows = await prisma.$queryRaw<Array<{key:string}>>`SELECT key FROM "DisplaySnapshot" WHERE key LIKE 'display-v1:%'
    AND (key NOT LIKE 'display-v1:dashboard:%' OR key LIKE ${`display-v1:dashboard:%:${dashboardDisplayVersion}`})
    AND (key NOT LIKE 'display-v1:traffic:%' OR key LIKE ${`display-v1:traffic:%:${trafficDisplayVersion}`})
    AND (key NOT LIKE 'display-v1:trends:%' OR key LIKE ${`display-v1:trends:%:${SERP_TRENDS_DISPLAY_VERSION}`})
    AND (body IS NULL OR revision > "builtRevision") ORDER BY "builtAt" NULLS FIRST LIMIT 20`;
  const specs = new Map(defaults.map(spec => [spec.key,spec]));
  for (const {key} of rows) {
    const parts = key.split(":");
    try {
      const params = new URLSearchParams({view:parts[1]});
      if (parts[1] === "dashboard") {params.set("site",parts[2]);params.set("includeResearch",parts[3]);}
      else if(parts[1] === "traffic") params.set("week",parts[2]);
      else if(parts[1] === "trends") {params.set("site",parts[2]);params.set("start",parts[3]);params.set("end",parts[4]);params.set("module",parts[5] ?? "all");}
      const spec = displayViewSpec(params); if(spec.key === key) specs.set(key,spec);
    } catch { /* Obsolete keys do not block active views. */ }
  }
  let rebuilt = 0;
  for (const spec of specs.values()) {
    if (Date.now()+15_000 > deadline) break;
    try {if(await rebuildDisplaySnapshot(spec)) rebuilt++;} catch {console.error("Display refresh failed",spec.key);}
  }
  return {rebuilt};
}
