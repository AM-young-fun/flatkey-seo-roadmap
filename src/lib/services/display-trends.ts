import { REGION_CODES } from "@/lib/seo";
import { retryDatabaseRead } from "@/lib/database-read";
import { combinedSerpTrendPoints, multiRegionTrendResult, serpCheckTrendFrames, uniqueMarketTrendPoints, type MarketTrend, type SerpTrendFrame, type trendRange } from "@/lib/ranking-trends";
import { loadSerpTasks, loadSerpTrendCohorts } from "./serp-results";

export async function buildDisplayTrends(site: string, range: ReturnType<typeof trendRange>, now = new Date()) {
        // One shared immutable inventory read and one Lambda for all markets.
        // A failed market stays unavailable; it never becomes a zero trend.
        const cohorts = await loadSerpTrendCohorts("all", range.start, range.end);
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
        const value = multiRegionTrendResult(reads.map(read => read.market), range, now.toISOString(),
          combinedSerpTrendPoints(reads.map(read => ({ region: read.market.region, frames: read.frames })), cohorts, site));

return value;
}
