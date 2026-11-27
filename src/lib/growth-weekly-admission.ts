import type { GrowthDirection, GrowthDriver, GrowthStrategy } from "./growth-strategy";
import { assertGrowthDirectionScope } from "./growth-strategy";
import { growthWebsitePageUrl } from "./growth-live-page";
import { completeHotspotTaskResearch } from "./growth-hotspot-admission";
import { seoToday, shiftDay, weeklyReportRange, workWeekDateRange } from "./seo-date-range";
import type { SeoDigest } from "./seo-digest";
import { hasMaintenanceIntentReview } from "./seo-published-maintenance";
import { isSeoWorkday } from "./seo-workday";
import { automaticPageRoute, type WorkflowTask } from "./seo-workflow";

export type WeeklyGrowthReport = Pick<SeoDigest, "id" | "hash" | "kind" | "date" | "generatedAt" | "growthSnapshot"> & Partial<Pick<SeoDigest, "pagePerformance">>;
const driverKey = (driver: GrowthDriver) => JSON.stringify([
  driver.url, driver.country, driver.source, driver.metric, driver.topicId,
  driver.previous, driver.current, driver.window.start, driver.window.end, driver.window.previousStart, driver.window.previousEnd, driver.window.timezone,
]);

function archivedArticleGrowth(driver: GrowthDriver, task: WorkflowTask, report: WeeklyGrowthReport, week: ReturnType<typeof weeklyReportRange>) {
  if (task.siteDomain !== "flatkey.ai" || driver.country !== "ALL" || driver.topicId !== task.topicId) return false;
  const contributor = growthWebsitePageUrl(driver.url, task.siteDomain), page = growthWebsitePageUrl(task.pageUrl, task.siteDomain);
  // Flatkey's localized blog routes use the same CMS article slug as the source.
  if (!contributor || !page || automaticPageRoute(contributor, task.siteDomain) !== "blog" || automaticPageRoute(page, task.siteDomain) !== "blog"
    || new URL(contributor).pathname.split("/").at(-1) !== new URL(page).pathname.split("/").at(-1)) return false;
  const previousEnd = shiftDay(week.start, -1);
  return report.pagePerformance?.some(ranking => {
    const summary = ranking.flatkey;
    if (ranking.source !== driver.source || ranking.metric !== driver.metric || !summary || summary.periodDays !== 7
      || summary.date !== week.end || summary.previousDate !== previousEnd
      || summary.comparisonDates?.length !== 7 || !summary.comparisonDates.every((date, index) => date === shiftDay(week.start, index))) return false;
    return summary.modules.find(module => module.id === "blog")?.pages.some(row => row.site === task.siteDomain
      && growthWebsitePageUrl(row.url, task.siteDomain) === contributor && row.timezone === driver.window.timezone
      && row.previousDate === previousEnd && row.comparisonReason === null
      && row.previous === driver.previous && row.value === driver.current);
  }) ?? false;
}

export function weeklyGrowthReportProblem(direction: GrowthDirection, task: WorkflowTask, report: WeeklyGrowthReport | null, now: Date) {
  if (!direction.weeklyGrowth || !report || report.kind !== "weekly" || report.id !== direction.weeklyGrowth.reportId || report.hash !== direction.weeklyGrowth.reportHash
    || !Number.isFinite(Date.parse(report.generatedAt)) || Date.parse(report.generatedAt) > now.getTime()) {
    return "缺少该版本的真实已保存周报，请引用原周报ID和内容指纹";
  }
  const week = weeklyReportRange(report.date);
  const eligible = (driver: GrowthDriver) =>
    driver.topicId && (driver.source === "GA4" && driver.metric === "sessions" || driver.source === "GSC" && driver.metric === "clicks")
    && driver.current > driver.previous && driver.window.timezone === "America/Los_Angeles"
    && driver.window.start === week.start && driver.window.end === week.end
    && driver.window.previousStart === shiftDay(week.start, -7) && driver.window.previousEnd === shiftDay(week.start, -1);
  const positive = new Set((report.growthSnapshot?.directions ?? []).flatMap(row => row.drivers ?? []).filter(eligible).map(driverKey));
  if (!direction.drivers.length || direction.drivers.some(driver => !eligible(driver)
    || !positive.has(driverKey(driver)) && !archivedArticleGrowth(driver, task, report, week))) {
    return "加推须引用同一周报内实际上涨的自然会话或点击及同口径周期";
  }
  if (!direction.drivers.some(driver => driver.topicId === task.topicId && growthWebsitePageUrl(driver.url, task.siteDomain))) {
    return "原优化页须属于周报增长贡献对应的站点和话题";
  }
  if (!direction.evidence.some(item => item.source === "demand" && Number.isFinite(Date.parse(item.observedAt)) && Date.parse(item.observedAt) <= now.getTime())) {
    return "加推方向须补齐独立需求持续性证据";
  }
  return null;
}

export function weeklyGrowthDeliveryWeek(report: WeeklyGrowthReport) {
  const sourceWeek = weeklyReportRange(report.date);
  return workWeekDateRange(shiftDay(sourceWeek.end, 2));
}

export function weeklyGrowthTaskProblem(state: GrowthStrategy, task: WorkflowTask, report: WeeklyGrowthReport | null, now: Date) {
  const direction = state.directions.find(row => row.id === task.directionId);
  if (!direction || task.weeklyGrowthRevision !== direction.revision || !direction.taskIds.includes(task.id)) return "原优化任务须关联本次确切上涨加推方向版本";
  try { assertGrowthDirectionScope(state, task, now); }
  catch { return "当前已批准方向未覆盖该任务的站点、原话题、国家语种、交付类型或有效期"; }
  const evidenceProblem = weeklyGrowthReportProblem(direction, task, report, now);
  if (evidenceProblem || !report) return evidenceProblem;
  const due = new Date(task.dueAt), date = seoToday(due), range = weeklyGrowthDeliveryWeek(report);
  if (date < range.start || date > range.end || due.getTime() <= now.getTime() || !isSeoWorkday(due)
    || Date.parse(direction.expiresAt) < due.getTime()
    || !direction.decision?.scope.some(scope => scope.site === task.siteDomain && scope.topicId === task.topicId && scope.country === task.country && scope.language === task.language && scope.kinds.includes("optimization") && Date.parse(scope.validUntil) >= due.getTime())) {
    return "沿原交付日进入周报后的北京时间周五至周四工作日，并在方向有效期内完成";
  }
  if (task.kind !== "optimization" || !growthWebsitePageUrl(task.pageUrl, task.siteDomain)) return "加推须沿本站原优化页执行";
  if (!hasMaintenanceIntentReview(task) || !completeHotspotTaskResearch(task, now) || (task.research?.businessValue ?? 0) <= 0) return "须先完成原页意图、真实商业承接、当地SERP和去重研究";
  return null;
}
