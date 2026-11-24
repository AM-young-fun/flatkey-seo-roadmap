const { isSeoWorkday } = require("./seo-workday.cjs");
const { compareHotspotPriority } = require("./seo-hotspot-priority.cjs");

const dayFormat = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" });
const open = new Set(["planned", "researching", "ready", "drafting", "review_pending", "approved", "blocked", "failed"]);
// User scope, 2026-11-19: public websites only; analytics configuration is excluded.
function websiteTaskAllowed(task) {
  if (!task || task.deletedAt || !["flatkey.ai", "rackrate.org", "modelfit.cc"].includes(task.siteDomain)) return false;
  // User 2026-11-19: stop new Flatkey landing work; retain already-live history for verification.
  if (task.siteDomain === "flatkey.ai" && task.kind === "landing" && !["published", "verified", "observing"].includes(task.status)) return false;
  if (task.channel && task.channel !== "website") return false;
  if (["api-paid-success-evidence-20261118", "seo-core-pool-weekly-execution-20261111"].includes(task.id) ||
    /(?:ga4|\bgtm\b|google analytics|后端|埋点|【用户已取消】)/i.test([task.id, task.title].join(" "))) return false;
  let url;
  if (task.pageUrl) {
    try { url = new URL(task.pageUrl); } catch { return false; }
    if (url.protocol !== "https:" || url.username || url.password || url.port ||
      ![task.siteDomain, "www." + task.siteDomain].includes(url.hostname) || /^\/(?:api|console|admin|sign-in|sign-up)(?:\/|$)/.test(url.pathname)) return false;
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
  const candidates = snapshot.tasks.flatMap(task => {
    if (!websiteTaskAllowed(task) || !open.has(task.status) || !inScope(task)) return [];
    const dueDay = dayFormat.format(new Date(task.dueAt));
    if (Date.parse(task.dueAt) > now.getTime()) return [];
    const failed = ["blocked", "failed"].includes(task.status);
    if (!failed) {
      if (awaitingReviewOrRelease.has(task.id)) return [];
      if (task.dependencies.some(id => !["verified", "observing"].includes(dependencyStatuses[id]))) return [];
      if (["planned", "researching"].includes(task.status) && !["research", "technical"].includes(task.kind) && !task.research) return [];
    }
    return [{ task, disposition: failed ? "diagnose" : "continue", overdue: overdue.has(task.id),
      reason: failed ? "failed" : dueDay < asOf ? "overdue" : "today" }];
  }).sort((a, b) => compareHotspotPriority(a.task, b.task, now)
    || Date.parse(a.task.dueAt) - Date.parse(b.task.dueAt) || a.task.id.localeCompare(b.task.id));
  return { asOf, candidates };
}

const scopesForTask = (task) => Object.keys(scopes).find(scope => scopes[scope](task));
module.exports = { dueTasks, scopes, scopesForTask, websiteTaskAllowed };
