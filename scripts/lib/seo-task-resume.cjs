// Pure eligibility for continuing the original session after a real CMS write.
// This returns the original reservation only; it never claims, publishes or
// reopens a completed run. The normal lease API remains the authority.
const { createHash } = require("node:crypto");
const { websiteTaskAllowed, scopesForTask } = require("./seo-task-due.cjs");

function originalAcceptance(task) {
  const retry = ["blocked", "failed", "review_pending", "approved"].includes(task.status);
  const identity = retry ? JSON.stringify([task.id, task.version]) : task.id;
  const hash = createHash("sha256").update(identity).digest("hex").slice(0, 24);
  return { runId: "task-claim:" + hash, stage: "TASK_" + hash.toUpperCase(), scheduledFor: task.recordedAt, leaseSeconds: 1800 };
}
function publishedResumeReservation(scope, task, detail, binding, sessionId, acceptance = originalAcceptance) {
  if (!websiteTaskAllowed(task) || !["blog", "modelfit_blog", "optimization", "refresh"].includes(scope)
    || task.status !== "published" || scopesForTask(task) !== scope || task.pageType !== "blog" || task.codeSource
    || !task.pageUrl || !/\/blog\/[^/?#]+\/?$/.test(new URL(task.pageUrl).pathname)
    || !task.contentVersion || detail?.task?.id !== task.id || detail.task.contentVersion !== task.contentVersion) throw Error("published_resume_not_allowed");
  if (task.siteDomain === "modelfit.cc" && (task.country !== "US" || task.language !== "en")) throw Error("published_resume_not_allowed");
  if (!sessionId || binding?.taskId !== task.id || binding.phase !== "work" || binding.sessionId !== sessionId) throw Error("published_resume_session_not_bound");
  const base = acceptance(task);
  const reservationFor = runId => {
    if (runId === base.runId) return base;
    // A retry was claimed while the task was failed, so its original ID used
    // [taskId, version]. Once published, never recompute a different claim.
    // Reuse only a real original run naming this task and the exact CMS write.
    const hash = /^task-claim:([a-f0-9]{24})$/u.exec(String(runId))?.[1];
    const recorded = detail.runs?.find(run => run.id === runId && run.taskIds?.includes(task.id));
    return hash && recorded ? { ...base, runId, stage: "TASK_" + hash.toUpperCase() } : null;
  };
  const exact = row => row.taskId === task.id && row.pageUrl === task.pageUrl && row.siteDomain === task.siteDomain
    && row.country === task.country && row.language === task.language && row.keyword === task.keyword
    && reservationFor(row.runId) && row.publicationPolicy === "auto_blog" && ["published", "verified"].includes(row.status);
  const receipts = (detail.publications ?? []).filter(exact);
  const current = receipts.filter(row => row.contentVersion === task.contentVersion && row.automaticWrite?.contentVersion === row.contentVersion
    && row.automaticWrite.publishedAt === row.publishedAt).find(row => {
    if (task.kind === "optimization") return row.kind === "optimization" && row.automaticWrite.operation === "update"
      && row.automaticWrite.baseContentVersion && row.automaticWrite.baseContentVersion !== row.contentVersion
      && (task.workClass !== "content_refresh" || row.automaticWrite.baseContentVersion === task.maintenance?.refresh?.baseContentVersion);
    if (task.kind !== "blog") return false;
    if (row.kind === "source_blog") return row.automaticWrite.operation === "create";
    // A first-delivery correction must still have its original source receipt.
    return row.kind === "optimization" && row.automaticWrite.operation === "update"
      && receipts.some(source => source.kind === "source_blog" && source.contentVersion === row.automaticWrite.baseContentVersion
        && source.automaticWrite?.sourceId === row.automaticWrite.sourceId);
  });
  if (!current) throw Error("published_resume_original_run_unconfirmed");
  const reservation = reservationFor(current.runId);
  if (detail.runs?.some(run => run.id === reservation.runId && run.status === "completed")) throw Error("published_resume_run_completed");
  return reservation;
}
module.exports = { originalAcceptance, publishedResumeReservation };
