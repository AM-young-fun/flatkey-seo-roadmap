import { approvedCaptureRankedWords, type ApprovedWeeklyKeywordCapture } from "../approved-weekly-keyword-capture";
import { isCurrentNativeRanking } from "../current-ranking-summary";
import { buildGrowthKeywordCatalog, catalogWorkspace } from "../growth-keyword-catalog";
import { quarterCalendarDisplay } from "../growth-quarter-display";
import { GROWTH_MARKETS } from "../growth-workspace";
import { isOwnedBrandKeyword } from "../keyword-market-policy";
import { reportDay } from "../seo-report-time.cjs";
import { summarizeWeeklyKeywordCatalog, type WeeklyKeywordObservation } from "../seo-weekly-ranking-summary";
import { serpCaptureBelongsToWeek } from "../serp-periods";
import { loadNovemberSecondKeywordCapture } from "./approved-weekly-keyword-capture";
import { loadGrowthHotspotView } from "./growth-hotspots";
import { loadGrowthStrategy } from "./growth-strategy";
import { loadGrowthDashboardWorkspace } from "./growth-workspace";

export async function loadWeeklyCatalogRanking(period: { start: string; end: string }, now: Date,
  approved: ApprovedWeeklyKeywordCapture | null) {
  const [strategy, workspace, hotspots, catalogCapture] = await Promise.all([
    loadGrowthStrategy(),
    loadGrowthDashboardWorkspace(false, now),
    loadGrowthHotspotView(false, now),
    approved?.complete ? Promise.resolve(approved) : loadNovemberSecondKeywordCapture(now),
  ]);
  if (workspace.reconciliation.sources.some(source => !source.available && source.reason?.startsWith("来源读取失败"))) {
    throw new Error("关键词目录来源未齐");
  }
  const catalogRanks = catalogCapture?.complete ? approvedCaptureRankedWords(catalogCapture) : [];
  const catalog = buildGrowthKeywordCatalog(quarterCalendarDisplay(strategy, workspace.targets), hotspots.items, workspace, catalogRanks);
  const identities = catalogWorkspace(workspace, hotspots.items, catalogRanks).targets;
  const observations: WeeklyKeywordObservation[] = [];
  for (const row of workspace.targets) {
    if (!row.checkedAt || row.checkedAt > now.toISOString() || row.captureScope === "SAMPLE") continue;
    const day = reportDay(new Date(row.checkedAt));
    const withinWeek = row.captureScope === "SCHEDULED" && row.capturePeriodKey
      ? serpCaptureBelongsToWeek(row.capturePeriodKey, period.start, period.end) : day >= period.start && day <= period.end;
    if (!withinWeek) continue;
    const outside = row.rank === null && row.rankSource === "serp" && row.observationEligible && row.captureState === "outside100"
      && row.languageStatus === "match" && (!row.wordLanguage || row.wordLanguage === row.language)
      && GROWTH_MARKETS.some(market => market.country === row.country && market.language === row.language)
      && !isOwnedBrandKeyword(row.keyword);
    if (outside || isCurrentNativeRanking(row, now.toISOString())) observations.push({ ...row, checkedAt: row.checkedAt });
  }
  if (approved) {
    observations.push(...approvedCaptureRankedWords(approved).map(row => ({ ...row, site: "flatkey.ai", rank: row.bestRank })),
      ...(approved.outsideWords ?? []).map(row => ({ ...row, site: "flatkey.ai", rank: null })));
  }
  return summarizeWeeklyKeywordCatalog(catalog, identities, observations);
}
