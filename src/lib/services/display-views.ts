import { prisma } from "@/lib/prisma";
import { overviewPayload } from "@/lib/overview-payload";
import { compactDashboard } from "@/lib/dashboard-payload";
import { activeReportPeriods, reportPeriods } from "@/lib/weekly-traffic";
import { serpTrendRange } from "@/lib/ranking-trends";
import { keywordDisplayRows } from "@/lib/keyword-display-rows";
import { candidateKeywordCount } from "@/lib/keyword-inventory";
import { loadDashboard } from "./dashboard-data";
import { buildWeeklyReport } from "./weekly-report";
import { loadKeywordOkr } from "./keyword-okr";
import { loadOptimizedPageMonitor } from "./optimized-page-monitor";
import { buildDisplayTrends } from "./display-trends";
import { rebuildDisplaySnapshot, type DisplaySpec } from "./display-snapshots";
const trafficDisplayVersion = "declines-v2";
const dashboardDisplayVersion = "business-optimized-v1";

export function displayViewSpec(params: URLSearchParams): DisplaySpec {
  const view = params.get("view") ?? "dashboard", site = params.get("site") ?? "all";
  if (!["all","flatkey.ai","rackrate.org","modelfit.cc"].includes(site)) throw new Error("网站无效");
  const research = params.get("includeResearch") ?? "0";
  if (!["0","1"].includes(research)) throw new Error("词池范围无效");
  if (view === "dashboard") return {key:`display-v1:dashboard:${site}:${research}:${dashboardDisplayVersion}`, build:async () => {
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
    // This revision includes country-level decline receipts. Rebuild once on
    // upgrade instead of serving a prior payload without the new evidence.
    return {key:`display-v1:traffic:${periods.current.start}:${trafficDisplayVersion}`,build:async () => ({value:await buildWeeklyReport(periods)})};
  }
  if (view === "trends") {
    const range = serpTrendRange(params.get("start") ?? undefined,params.get("end") ?? undefined,new Date());
    return {key:`display-v1:trends:${site}:${range.start}:${range.end}`,build:async () => ({value:await buildDisplayTrends(site,range)})};
  }
  throw new Error("页面类型无效");
}

// Existing coordinator only: no extra scheduler, and no paid/provider calls.
export async function refreshDisplayViews(deadline = Date.now()+50_000) {
  const defaults = [new URLSearchParams({view:"dashboard"}),new URLSearchParams({view:"traffic"}),new URLSearchParams({view:"trends"})].map(displayViewSpec);
  const rows = await prisma.$queryRaw<Array<{key:string}>>`SELECT key FROM "DisplaySnapshot" WHERE key LIKE 'display-v1:%'
    AND (key NOT LIKE 'display-v1:dashboard:%' OR key LIKE ${`display-v1:dashboard:%:${dashboardDisplayVersion}`})
    AND (key NOT LIKE 'display-v1:traffic:%' OR key LIKE ${`display-v1:traffic:%:${trafficDisplayVersion}`})
    AND (body IS NULL OR revision > "builtRevision") ORDER BY "builtAt" NULLS FIRST LIMIT 20`;
  const specs = new Map(defaults.map(spec => [spec.key,spec]));
  for (const {key} of rows) {
    const parts = key.split(":");
    try {
      const params = new URLSearchParams({view:parts[1]});
      if (parts[1] === "dashboard") {params.set("site",parts[2]);params.set("includeResearch",parts[3]);}
      else if(parts[1] === "traffic") params.set("week",parts[2]);
      else if(parts[1] === "trends") {params.set("site",parts[2]);params.set("start",parts[3]);params.set("end",parts[4]);}
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
