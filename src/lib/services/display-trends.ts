import { REGION_CODES } from "@/lib/seo";
import { retryDatabaseRead } from "@/lib/database-read";
import { multiRegionTrendResult, scopeTrendCohorts, serpCheckTrendFrames, uniqueMarketTrendPoints, type MarketTrend, type SerpTrendFrame, type trendRange } from "@/lib/ranking-trends";
import { loadSerpTasks, loadSerpTrendCohorts } from "./serp-results";
import { prisma } from "@/lib/prisma";
import type { OverviewPageModule } from "@/lib/seo-overview-scope";
import type { SerpTrendCohort } from "@/lib/serp-results";
import { projectHistoricalWordLanguage } from "@/lib/ranking-language-history";
import { reviewGrowthLanguage } from "@/lib/growth-workspace";
import { GROWTH_MARKET_LANGUAGES } from "@/lib/seo-growth-markets";
import { approvedDiagnosticWordLanguages } from "@/lib/growth-word-language-evidence";
import { isOwnedBrandKeyword } from "@/lib/keyword-market-policy";

export async function loadModuleTrendCohorts(cohorts: SerpTrendCohort[], module: OverviewPageModule) {
  if (module === "all" || !cohorts.length) return cohorts;
  // Include inactive rows if still registered: today's eligibility must not
  // rewrite a historical cohort. Deleted or missing mappings fall under other.
  const members = cohorts.flatMap(cohort => cohort.targets);
  if (!members.length) return cohorts;
  const current = await prisma.siteKeyword.findMany({
    where: { keywordId: { in: [...new Set(members.map(target => target.keywordId))] }, siteDomain: { in: [...new Set(members.map(target => target.siteDomain))] } },
    select: { keywordId: true, siteDomain: true, targetUrls: true },
  });
  return scopeTrendCohorts(cohorts, current, module);
}

export async function buildDisplayTrends(site: string, range: ReturnType<typeof trendRange>, now = new Date(), module: OverviewPageModule = "all") {
        // One shared immutable inventory read and one Lambda for all markets.
        // A failed market stays unavailable; it never becomes a zero trend.
        const cohorts = await loadModuleTrendCohorts(await loadSerpTrendCohorts("all", range.start, range.end), module);
        // The transaction pool has one connection per function. Four parallel
        // queries still queue there; read all markets once, then split locally.
        // If that read fails, isolate country failures rather than showing zero.
        let sharedTasks: Awaited<ReturnType<typeof loadSerpTasks>> | null = null;
        try { sharedTasks = cohorts.length ? await loadSerpTasks("all", undefined, "desktop", range.start, range.end) : []; } catch { /* Isolate below. */ }
        const reads = await Promise.all(REGION_CODES.map(async (market): Promise<{ market: MarketTrend; frames: SerpTrendFrame[] }> => {
          try {
            const scoped = cohorts.filter(cohort => !cohort.regions || cohort.regions.includes(market));
            const tasks = scoped.length ? sharedTasks?.filter(task => task.region === market) ?? await retryDatabaseRead(() => loadSerpTasks(market, undefined, "desktop", range.start, range.end)) : [];
            const frames = serpCheckTrendFrames([], tasks, range.start, range.end, { cohorts: scoped, site });
            return { market: { region: market, status: "READY", points: uniqueMarketTrendPoints(market, frames) }, frames };
          } catch { return { market: { region: market, status: "ERROR", points: null }, frames: [] }; }
        }));
        const proofs = new Map(approvedDiagnosticWordLanguages().map(proof => [`${proof.site}:${proof.keywordId}:${proof.keyword.normalize("NFKC").trim().replace(/\s+/gu, " ").toLowerCase()}`, proof]));
        const projection = projectHistoricalWordLanguage(reads.map(read => ({ region: read.market.region, frames: read.frames })), (target, country) => {
          const language = GROWTH_MARKET_LANGUAGES[country];
          const proof = proofs.get(`${target.siteDomain}:${target.keywordId}:${target.keyword.normalize("NFKC").trim().replace(/\s+/gu, " ").toLowerCase()}`);
          return { ...reviewGrowthLanguage(target.keyword, country, language, undefined, proof), queryLanguage: language };
        }, isOwnedBrandKeyword);
        const value = multiRegionTrendResult(reads.map(read => ({ ...read.market,
          points: read.market.status === "ERROR" ? null : projection.markets.find(market => market.region === read.market.region)?.points ?? [] })), range, now.toISOString(), projection.points);

return { ...value, moduleScope: { module, basis: "current-registered-target-pages" as const } };
}
