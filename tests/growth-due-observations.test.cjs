const { test } = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), ts = require("typescript");
require.extensions[".ts"] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, file);
const { growthDueObservationInventory } = require("../src/lib/growth-due-observations.ts");
const now = new Date("2026-11-24T03:00:00Z"), pageUrl = "https://flatkey.ai/pt/blog/original-article";
const legacy = patch => ({ id: "legacy-publication", sourceTaskId: "legacy-source-task", contentVersion: "legacy-v1", kind: "source_blog", cmsId: "actual-cms-id", pageUrl, publishedAt: "2026-11-10T12:00:00Z", language: "pt-BR", country: null, verificationState: "live_verified", ...patch });
const modern = patch => ({ id: "new-version", taskId: "original-optimization", contentVersion: "v2", kind: "optimization", siteDomain: "flatkey.ai", status: "verified", pageUrl, publishedAt: "2026-11-12T12:00:00Z", language: "pt-BR", country: "BR", automaticWrite: { operation: "update", sourceId: "actual-cms-id", baseContentVersion: "legacy-v1" }, ...patch });
const input = (patch = {}) => ({ tasks: [], publications: [], historicalImports: [{ id: "archive-original", siteDomain: "flatkey.ai", publications: [legacy()] }], ...patch });
test("historical source rows are scanned and exposed without inventing an executable task or observation grant", () => {
  const workflow = input(), before = structuredClone(workflow);
  const result = growthDueObservationInventory(workflow, [], { "flatkey.ai": "America/Los_Angeles" }, now);
  assert.equal(result.dueObservations.length, 0); assert.equal(result.historicalDueObservations.length, 1);
  const row = result.historicalDueObservations[0];
  assert.equal(row.publicationId, "legacy-publication"); assert.equal(row.taskId, "legacy-source-task"); assert.equal(row.archiveId, "archive-original");
  assert.equal(row.writeMode, "original_daily_run_only"); assert.equal(row.recordObservationAllowed, false); assert.equal(row.evidenceTaskId, null);
  assert.equal(row.country, null); assert.equal(row.language, "pt-BR"); assert.equal(row.dueDay, "2026-11-17");
  assert.equal(result.effectReviewCoverage.historicalPublicationRowsScanned, 1); assert.deepEqual(workflow, before);
});
test("only the actual same-CMS and original-content version chain offers an evidence carrier, never a country transplant", () => {
  const publication = modern(), task = { id: publication.taskId, siteDomain: "flatkey.ai", pageUrl, channel: "website", status: "observing" };
  const workflow = input({ tasks: [task], publications: [publication] });
  const check = data => growthDueObservationInventory(data, [], { "flatkey.ai": "America/Los_Angeles" }, now).historicalDueObservations[0];
  const linked = check(workflow);
  assert.equal(linked.writeMode, "linked_task_evidence_and_daily_run"); assert.equal(linked.evidenceTaskId, task.id);
  assert.equal(linked.taskId, "legacy-source-task"); assert.equal(linked.country, null); assert.equal(linked.recordObservationAllowed, false);
  for (const patch of [{ sourceId: "other-cms" }, { baseContentVersion: "other-v1" }, { operation: "create" }]) {
    const wrong = structuredClone(workflow); Object.assign(wrong.publications[0].automaticWrite, patch);
    assert.equal(check(wrong).writeMode, "original_daily_run_only");
  }
});
test("duplicate archives share one immutable source window and retain all raw provenance", () => {
  const workflow = input(); workflow.historicalImports.push({ id: "archive-copy", siteDomain: "flatkey.ai", publications: [legacy({ id: "another-export-id" })] });
  const result = growthDueObservationInventory(workflow, [], { "flatkey.ai": "America/Los_Angeles" }, now);
  assert.equal(result.historicalDueObservations.length, 1); assert.equal(result.historicalDueObservations[0].provenance.length, 2);
  assert.equal(result.effectReviewCoverage.historicalPublicationRowsScanned, 2); assert.equal(result.effectReviewCoverage.uniqueHistoricalPublications, 1); assert.equal(result.effectReviewCoverage.duplicateHistoricalRows, 1);
});
test("source-local completed days gate each 7/14/28 window; unknown timezones remain unknown", () => {
  const workflow = input({ historicalImports: [{ id: "archive", siteDomain: "flatkey.ai", publications: [legacy({ publishedAt: "2026-11-02T12:00:00Z" })] }] });
  const result = growthDueObservationInventory(workflow, [], { "flatkey.ai": "America/Los_Angeles" }, now);
  assert.deepEqual(result.historicalDueObservations.map(row => row.checkpoint), [7, 14]);
  const unknown = growthDueObservationInventory(workflow, [], {}, now);
  assert.equal(unknown.historicalDueObservations.length, 3); assert.ok(unknown.historicalDueObservations.every(row => row.timezone === null && row.dueDay === null));
  const closing = input({ historicalImports: [{ id: "archive", siteDomain: "flatkey.ai", publications: [legacy({ publishedAt: "2026-11-16T12:00:00Z" })] }] });
  assert.equal(growthDueObservationInventory(closing, [], { "flatkey.ai": "America/Los_Angeles" }, new Date("2026-11-24T03:00:00Z")).historicalDueObservations.length, 0);
  assert.equal(growthDueObservationInventory(closing, [], { "flatkey.ai": "America/Los_Angeles" }, new Date("2026-11-24T08:00:00Z")).historicalDueObservations.length, 1);
});
test("fully verified modern effects are reused, partial ranking stays due and history is never mistaken for the new version", () => {
  const publication = modern(), workflow = input({ publications: [publication] });
  const observation = { publicationId: publication.id, taskId: publication.taskId, contentVersion: publication.contentVersion, checkpoint: 7, coverage: { indexing: "verified", ranking: "verified", traffic: "verified" }, comparison: { status: "complete" } };
  const full = growthDueObservationInventory(workflow, [observation], { "flatkey.ai": "America/Los_Angeles" }, now);
  assert.equal(full.dueObservations.length, 0); assert.equal(full.historicalDueObservations.length, 1);
  const missing = { ...observation, coverage: { ...observation.coverage, ranking: "missing" } };
  assert.equal(growthDueObservationInventory(workflow, [missing], { "flatkey.ai": "America/Los_Angeles" }, now).dueObservations.length, 1);
});
test("product hosts, Router paths and data-only sites stay outside effect execution scope", () => {
  const workflow = input({ historicalImports: [{ id: "bad-archive", siteDomain: "flatkey.ai", publications: [legacy({ pageUrl: "https://console.flatkey.ai/blog/a" }), legacy({ id: "router", pageUrl: "https://flatkey.ai/router/model" })] },
    { id: "data-only", siteDomain: "jev-llm.com", publications: [legacy({ pageUrl: "https://jev-llm.com/blog/a" })] }] });
  const result = growthDueObservationInventory(workflow, [], { "flatkey.ai": "America/Los_Angeles" }, now);
  assert.equal(result.historicalDueObservations.length, 0); assert.equal(result.effectReviewCoverage.excludedArchiveRows, 3);
});
