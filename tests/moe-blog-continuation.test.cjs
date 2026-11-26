const assert = require("node:assert/strict");
const { test } = require("node:test");
require("./register-ui-modules.cjs");
const { workflowSnapshot } = require("../src/lib/seo-workflow-state.ts");
const { canClaimMoeBlogContinuation, moeBlogPlanId, moeBlogResearchId, moeBlogTaskId } = require("../src/lib/moe-blog-continuation.ts");

const identity = {
  country: "US", language: "en", keyword: "moe expert streaming", keywordId: "3bc72ab5-7710-4c4b-b1b7-d27dbf34f590",
};
const urls = Array.from({ length: 10 }, (_, index) => "https://example.com/source/" + index);
const task = {
  ...identity, id: moeBlogTaskId, siteDomain: "flatkey.ai", channel: "website", kind: "blog", status: "ready", source: "human",
  dueAt: "2026-11-24T11:30:00+08:00", weekStart: "2026-11-23", pageUrl: "https://flatkey.ai/blog/moe-expert-streaming",
  dependencies: [moeBlogResearchId], researchReview: {
    ...identity, serpResults: urls, openedResults: urls.slice(0, 5), evidence: [{ label: "Reviewed original study" }],
  },
};
const research = {
  ...identity, id: moeBlogResearchId, siteDomain: "modelfit.cc", kind: "research", status: "verified", source: "automation",
  dueAt: task.dueAt, weekStart: task.weekStart,
};
const plan = {
  id: moeBlogPlanId, status: "scheduled", weekStart: "2026-11-30", taskIds: [],
  notes: "北京时间 2026-11-27 10:15–12:15 续做 Flatkey US/en「moe expert streaming」，保留原交付日。",
  strategyAllocation: {
    quarterPlanHash: "a8f73a80ed763eb606b4876f1337c11a747481a86e1777a8cba68ea6781cbf03",
    preservedTaskIds: [moeBlogTaskId],
  },
};
const inside = new Date("2026-11-27T10:15:00+08:00");

test("allows only the named original blog within its stored Beijing morning slot", () => {
  const eligible = (entry = task, dependency = research, reservation = plan, time = inside) =>
    canClaimMoeBlogContinuation(entry, dependency, reservation, time);
  assert.equal(eligible(), true);
  assert.equal(eligible({ ...task, status: "drafting" }), true);
  assert.equal(eligible(task, research, plan, new Date("2026-11-27T10:14:59+08:00")), false);
  assert.equal(eligible(task, research, plan, new Date("2026-11-27T12:15:00+08:00")), false);
  assert.equal(eligible({ ...task, id: "seo-hotspot:another-blog" }), false);
  assert.equal(eligible({ ...task, dueAt: "2026-11-27T11:30:00+08:00" }), false);
  assert.equal(eligible({ ...task, researchReview: { ...task.researchReview, openedResults: urls.slice(1, 6) } }), false);
  assert.equal(eligible(task, { ...research, status: "planned" }), false);
  assert.equal(eligible(task, { ...research, keywordId: "another-keyword" }), false);
  assert.equal(eligible(task, research, { ...plan, notes: "Slot removed" }), false);
  assert.equal(eligible(task, research, { ...plan, strategyAllocation: { ...plan.strategyAllocation, preservedTaskIds: [] } }), false);
});

test("operational worklist admits the named continuation and keeps other unadmitted hotspots out", () => {
  const other = { ...task, id: "seo-hotspot:another-blog" };
  const rows = [
    { kind: "task", record: task }, { kind: "task", record: research },
    { kind: "task", record: other }, { kind: "plan", record: plan },
  ];
  const runnable = now => workflowSnapshot(rows, { operational: true }, "database", now).tasks.map(row => row.id);
  assert.deepEqual(runnable(inside), [moeBlogTaskId]);
  assert.deepEqual(runnable(new Date("2026-11-27T12:15:00+08:00")), []);
});
