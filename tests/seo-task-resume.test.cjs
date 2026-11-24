const { test } = require("node:test"), assert = require("node:assert/strict");
const { originalAcceptance, publishedResumeReservation } = require("../scripts/lib/seo-task-resume.cjs");
const task = patch => ({ id: "original-update", siteDomain: "flatkey.ai", channel: "website", kind: "optimization", workClass: "content_refresh", pageType: "blog",
  pageUrl: "https://flatkey.ai/blog/original-article", country: "US", language: "en", keyword: "model pricing", contentVersion: "v2", status: "published", recordedAt: "2026-11-20T02:00:00Z",
  maintenance: { refresh: { baseContentVersion: "v1" } }, ...patch });
const binding = task => ({ taskId: task.id, phase: "work", sessionId: "original-session" });
function detail(task, publicationPatch = {}) {
  const reservation = originalAcceptance(task), publishedAt = "2026-11-24T02:00:00Z";
  return { storage: "database", task, runs: [{ id: reservation.runId, status: "partial" }], publications: [{ taskId: task.id, siteDomain: task.siteDomain, country: task.country, language: task.language, keyword: task.keyword, pageUrl: task.pageUrl,
    kind: task.kind === "blog" ? "source_blog" : "optimization", status: "published", publicationPolicy: "auto_blog", contentVersion: task.contentVersion, runId: reservation.runId, publishedAt,
    automaticWrite: { operation: task.kind === "blog" ? "create" : "update", contentVersion: task.contentVersion, baseContentVersion: task.kind === "blog" ? null : "v1", sourceId: "actual-cms-id", publishedAt }, ...publicationPatch }] };
}
test("a written refresh resumes only its exact original task, session and reservation", () => {
  const t = task(), input = detail(t), prior = structuredClone({ t, input });
  assert.deepEqual(publishedResumeReservation("refresh", t, input, binding(t), "original-session"), originalAcceptance(t));
  assert.deepEqual({ t, input }, prior);
  const ordinary = task({ workClass: undefined, maintenance: undefined });
  assert.deepEqual(publishedResumeReservation("optimization", ordinary, detail(ordinary), binding(ordinary), "original-session"), originalAcceptance(ordinary));
  const modelFit = task({ siteDomain: "modelfit.cc", pageUrl: "https://modelfit.cc/blog/original-article" });
  assert.deepEqual(publishedResumeReservation("refresh", modelFit, detail(modelFit), binding(modelFit), "original-session"), originalAcceptance(modelFit));
});
test("wrong scope, unbound session and new/verified/product tasks gain no resume authority", () => {
  const original = task();
  for (const scope of ["blog", "cluster", "release", "landing"]) assert.throws(() => publishedResumeReservation(scope, original, detail(original), binding(original), "original-session"), /not_allowed/);
  for (const patch of [{ status: "ready" }, { status: "verified" }, { channel: "product" }, { siteDomain: "rackrate.org" }, { pageUrl: "https://console.flatkey.ai/blog/example" }, { pageType: "landing" }, { codeSource: { commitSha: "a".repeat(40) } }]) {
    const t = task(patch); assert.throws(() => publishedResumeReservation("refresh", t, detail(t), binding(t), "original-session"), /not_allowed/);
  }
  for (const b of [undefined, { ...binding(original), sessionId: "other" }, { ...binding(original), phase: "release" }, { ...binding(original), taskId: "new-task" }]) assert.throws(() => publishedResumeReservation("refresh", original, detail(original), b, "original-session"), /session_not_bound/);
});
test("source-blog receipts, stale versions, unrelated runs and completed runs cannot resume a refresh", () => {
  const t = task();
  for (const patch of [{ kind: "source_blog" }, { contentVersion: "old" }, { runId: "other-run" }, { country: "JP" }, { language: "ja" }, { pageUrl: "https://flatkey.ai/blog/other" }, { publicationPolicy: undefined }, { taskId: "other" }]) assert.throws(() => publishedResumeReservation("refresh", t, detail(t, patch), binding(t), "original-session"), /original_run_unconfirmed/);
  const wrongBase = detail(t); wrongBase.publications[0].automaticWrite.baseContentVersion = "stale";
  assert.throws(() => publishedResumeReservation("refresh", t, wrongBase, binding(t), "original-session"), /original_run_unconfirmed/);
  const completed = detail(t); completed.runs[0].status = "completed";
  assert.throws(() => publishedResumeReservation("refresh", t, completed, binding(t), "original-session"), /run_completed/);
});
test("existing source-blog and same-delivery corrections retain their original run", () => {
  const t = task({ kind: "blog", workClass: undefined, maintenance: undefined }), input = detail(t);
  assert.deepEqual(publishedResumeReservation("blog", t, input, binding(t), "original-session"), originalAcceptance(t));
  const correction = detail(t, { kind: "optimization" });
  correction.publications[0].automaticWrite.operation = "update"; correction.publications[0].automaticWrite.baseContentVersion = "v1";
  assert.throws(() => publishedResumeReservation("blog", t, correction, binding(t), "original-session"), /original_run_unconfirmed/);
  const source = structuredClone(input.publications[0]); source.contentVersion = "v1"; source.automaticWrite.contentVersion = "v1";
  correction.publications.push(source);
  assert.deepEqual(publishedResumeReservation("blog", t, correction, binding(t), "original-session"), originalAcceptance(t));
});
test("a failed-task retry reuses its actual recorded claim instead of recomputing a new task-ID claim", () => {
  const t = task(), input = detail(t), retry = originalAcceptance({ ...t, status: "failed", version: 7 });
  assert.notEqual(retry.runId, originalAcceptance(t).runId);
  input.publications[0].runId = retry.runId;
  assert.throws(() => publishedResumeReservation("refresh", t, input, binding(t), "original-session"), /original_run_unconfirmed/);
  input.runs.push({ id: retry.runId, taskIds: [t.id], status: "partial" });
  assert.deepEqual(publishedResumeReservation("refresh", t, input, binding(t), "original-session"), retry);
  input.runs[1].status = "completed";
  assert.throws(() => publishedResumeReservation("refresh", t, input, binding(t), "original-session"), /run_completed/);
});
