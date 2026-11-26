const { isSeoWorkday } = require("./seo-workday.cjs");
const { compareHotspotPriority } = require("./seo-hotspot-priority.cjs");

const dayFormat = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" });
const open = new Set(["planned", "researching", "ready", "drafting", "review_pending", "approved", "blocked", "failed"]);
const isExtra = task => ["authorized_hotspot_extra", "authorized_weekly_growth_extra"].includes(task.capacityClass);
const businessWeekEnd = date => {
  const day = new Date(date + "T00:00:00Z");
  day.setUTCDate(day.getUTCDate() + (11 - day.getUTCDay()) % 7);
  return day.toISOString().slice(0, 10);
};
// User scope, 2026-11-19: public websites only; analytics configuration is excluded.
function websiteTaskAllowed(task) {
  if (!task || task.deletedAt || !["flatkey.ai", "rackrate.org", "modelfit.cc"].includes(task.siteDomain)) return false;
  if (task.siteDomain === "flatkey.ai" && task.kind === "landing" && !["published", "verified", "observing"].includes(task.status)) {
    const dueAt = new Date(task.dueAt);
    if (task.workflowContract !== "growth-v1.5" || !Number.isFinite(dueAt.getTime()) || dayFormat.format(dueAt) < "2026-11-27") return false;
  }
  if (task.channel && task.channel !== "website") return false;
  // An article can legitimately discuss API backends, GA4 or instrumentation.
  // Scope follows the actual channel/site/target, not words in the article's
  // title. Explicitly withdrawn original IDs and cancellation markers remain
  // excluded, and the URL/channel checks still reject product work.
  if (["api-paid-success-evidence-20261118", "seo-core-pool-weekly-execution-20261111"].includes(task.id) ||
    /【用户已取消】/u.test(String(task.title ?? ""))) return false;
  let url;
  if (task.pageUrl) {
    try { url = new URL(task.pageUrl); } catch { return false; }
    if (url.protocol !== "https:" || url.username || url.password || url.port ||
      ![task.siteDomain, "www." + task.siteDomain].includes(url.hostname) || /^\/(?:api|console|router|admin|sign-in|sign-up)(?:\/|$)/.test(url.pathname)) return false;
  }
  const blog = task.kind === "blog" || task.pageType === "blog" || /\/(?:blog|blogs)(?:\/|$)/.test(url?.pathname || "");
  return !blog || ["flatkey.ai", "modelfit.cc"].includes(task.siteDomain);
}
const scopes = {
  blog: task => task.siteDomain === "flatkey.ai" && task.kind === "blog",
  modelfit_blog: task => task.siteDomain === "modelfit.cc" && task.kind === "blog"
    && task.country === "US" && task.language === "en",
  optimization: task => task.siteDomain === "flatkey.ai" && task.workClass !== "content_refresh" && (
    task.kind === "optimization" || task.kind === "technical" && (!task.channel || task.channel === "website")
  ),
  refresh: task => ["flatkey.ai", "modelfit.cc"].includes(task.siteDomain)
    && task.kind === "optimization" && task.workClass === "content_refresh",
  landing: task => task.siteDomain === "flatkey.ai" && task.kind === "landing",
  cluster: task => ["rackrate.org", "modelfit.cc"].includes(task.siteDomain) && task.workClass !== "content_refresh"
    && ["landing", "optimization", "cluster", "technical", "research"].includes(task.kind),
};

function dueTasks(snapshot, scope, now = new Date()) {
  const inScope = scopes[scope];
  if (!inScope) throw Error("unknown_scope");
  if (!snapshot.workWeek) throw Error("operational_worklist_unavailable");
  const asOf = dayFormat.format(now);
  if (!isSeoWorkday(now)) return { asOf, candidates: [] };
  const overdue = new Set(snapshot.workWeek.overdueTaskIds);
  const awaitingReviewOrRelease = new Set(snapshot.workWeek.reviewOrReleaseTaskIds);
  const dependencyStatuses = snapshot.workWeek.dependencyStatuses;
  const timeReservedToday = snapshot.tasks.some(task => !isExtra(task) && websiteTaskAllowed(task) && scopesForTask(task)
    && open.has(task.status) && !awaitingReviewOrRelease.has(task.id) && dayFormat.format(new Date(task.dueAt)) === asOf
    && Date.parse(task.dueAt) > now.getTime());
  const candidates = snapshot.tasks.flatMap(task => {
    if (!websiteTaskAllowed(task) || !open.has(task.status) || !inScope(task)) return [];
    if (isExtra(task) && timeReservedToday) return [];
    const dueDay = dayFormat.format(new Date(task.dueAt));
    if (task.capacityClass === "authorized_weekly_growth_extra" && asOf > businessWeekEnd(dueDay)) return [];
    if (Date.parse(task.dueAt) > now.getTime()) return [];
    const failed = ["blocked", "failed"].includes(task.status);
    if (!failed) {
      if (awaitingReviewOrRelease.has(task.id)) return [];
      if (task.dependencies.some(id => !["verified", "observing"].includes(dependencyStatuses[id]))) return [];
      if (["planned", "researching"].includes(task.status) && !["research", "technical"].includes(task.kind) && !task.research) return [];
    }
    return [{ task, disposition: failed ? "diagnose" : "continue", overdue: overdue.has(task.id),
      reason: failed ? "failed" : dueDay < asOf ? "overdue" : "today" }];
  }).sort((a, b) => Number(isExtra(a.task)) - Number(isExtra(b.task)) || compareHotspotPriority(a.task, b.task, now)
    || Date.parse(a.task.dueAt) - Date.parse(b.task.dueAt) || a.task.id.localeCompare(b.task.id));
  return { asOf, candidates };
}

const scopesForTask = (task) => Object.keys(scopes).find(scope => scopes[scope](task));
module.exports = { dueTasks, scopes, scopesForTask, websiteTaskAllowed };
