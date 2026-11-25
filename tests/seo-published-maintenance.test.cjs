const { test } = require("node:test");
const assert = require("node:assert/strict");
require("./register-ui-modules.cjs");
const { hasMaintenanceIntentReview, hasPublishedMaintenanceSource, publishedMaintenanceMutationTasks } = require("../src/lib/seo-published-maintenance.ts");

const now = new Date("2026-11-25T00:00:00Z");
const pageUrl = "https://flatkey.ai/blog/gpu-rental";
const serpResults = Array.from({ length: 10 }, (_, index) => `https://example.org/${index}`);
const task = {
  id: "maintenance", kind: "optimization", status: "ready", siteDomain: "flatkey.ai", pageUrl,
  country: "US", language: "en", keyword: "GPU rental", keywordId: "kw", topicId: "rental",
  workflowContract: "growth-v1.5", research: { intent: "Compare rental prices and available GPUs" },
  researchReview: { country: "US", language: "en", keyword: "GPU rental", serpResults,
    openedResults: serpResults.slice(0, 5), quality: { intent: "Original page offers same task but lacks availability and pricing information" }, evidence: ["search-and-page-review"] },
};
const member = { siteDomain: task.siteDomain, keywordId: task.keywordId, keyword: task.keyword, active: true, targetUrls: [pageUrl], markets: [{ country: "US", language: "en" }] };
const row = (kind, record) => ({ kind, record });
const draft = { id: "plan", status: "draft", taskIds: [task.id] };

test("new ordinary optimization and old-article rewrite share the published-source gate", () => {
  assert.deepEqual(publishedMaintenanceMutationTasks("task", task, []), [task]);
  const refresh = { ...task, workClass: "content_refresh" };
  assert.deepEqual(publishedMaintenanceMutationTasks("task", refresh, []), [refresh]);
  assert.deepEqual(publishedMaintenanceMutationTasks("task", { ...task, workClass: "internal_linking" }, []), []);
  assert.deepEqual(publishedMaintenanceMutationTasks("task", { ...task, status: "researching" }, []), []);
  const history = [row("task", task), row("plan", draft)];
  assert.deepEqual(publishedMaintenanceMutationTasks("plan", { ...draft, status: "scheduled", committedTaskIds: [task.id] }, history), [task]);
  const committed = [history[0], row("plan", { ...draft, status: "scheduled" })];
  assert.deepEqual(publishedMaintenanceMutationTasks("task", { ...task, status: "drafting" }, committed), []);
  const changedPage = { ...task, pageUrl: "https://flatkey.ai/es/blog/gpu-rental" };
  assert.deepEqual(publishedMaintenanceMutationTasks("task", changedPage, committed), [changedPage]);
});

test("a new task cannot use its own URL as evidence of an existing keyword-page relationship", () => {
  const inventory = new Set([pageUrl]);
  assert.equal(hasPublishedMaintenanceSource(task, member, inventory, [], now), true);
  assert.equal(hasPublishedMaintenanceSource(task, { ...member, targetUrls: [] }, inventory, [row("task", task)], now), false);
  assert.equal(hasPublishedMaintenanceSource(task, { ...member, markets: [] }, inventory, [row("task", task)], now), false);
  assert.equal(hasPublishedMaintenanceSource({ ...task, country: "ES", language: "es-ES" }, member, inventory, [], now), false);
  assert.equal(hasPublishedMaintenanceSource({ ...task, pageUrl: "https://flatkey.ai/es/blog/gpu-rental" }, member, inventory, [], now), false);
});

test("an independent, same-market original publication can supply page proof", () => {
  const original = { ...task, id: "existing-live", kind: "blog", status: "verified" };
  const receipt = { id: "published", taskId: original.id, status: "verified", pageUrl, siteDomain: task.siteDomain,
    country: "US", language: "en", keyword: task.keyword, publishedAt: "2026-11-20T00:00:00Z" };
  const withoutInventory = { ...member, targetUrls: [], markets: [] };
  assert.equal(hasPublishedMaintenanceSource(task, withoutInventory, new Set(), [row("task", original), row("publication", receipt)], now), true);
  for (const patch of [{ status: "failed" }, { country: "ES" }, { keyword: "Another keyword" }, { taskId: task.id }, { publishedAt: "2026-11-26T00:00:00Z" }]) {
    assert.equal(hasPublishedMaintenanceSource(task, withoutInventory, new Set(), [row("task", original), row("publication", { ...receipt, ...patch })], now), false);
  }
});

test("research must document intent for the exact keyword and open all original top five pages", () => {
  assert.equal(hasMaintenanceIntentReview(task), true);
  assert.equal(hasMaintenanceIntentReview({ ...task, research: { intent: " " } }), false);
  assert.equal(hasMaintenanceIntentReview({ ...task, researchReview: { ...task.researchReview, country: "JP" } }), false);
  assert.equal(hasMaintenanceIntentReview({ ...task, researchReview: { ...task.researchReview, openedResults: serpResults.slice(1, 6) } }), false);
});
