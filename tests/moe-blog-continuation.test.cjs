const assert = require("node:assert/strict");
const { test } = require("node:test");
require("./register-ui-modules.cjs");
const { prepareWorkflowMutation, workflowSnapshot } = require("../src/lib/seo-workflow-state.ts");
const { workflowTaskSchema } = require("../src/lib/seo-workflow.ts");
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

test("binds only the approved MoE version under the verified original article lease", () => {
  const at = "2026-11-26T15:00:00Z";
  const oldVersion = "sha256:3da1e4cc0ce26bd3a40b5f8b703d862ec566a521856a263f340a171add36706c";
  const candidate = "sha256:10521a3a20e1b0e7be7adbc4b7172ff2ff1ea5ab1d275c8bc1b86dbbe9597573";
  const oldEvidence = [{ label: "原题相关的页面研究", url: "https://example.com/research", observedAt: at }];
  const quality = Object.fromEntries(["intent", "keywordsAndAlt", "experience", "links", "behavior",
    "algorithmAndManual", "eeat"].map(key => [key, "Completed the corresponding original review."]));
  const original = workflowTaskSchema.parse({
    ...task, title: "专家权重按需读取的存储与内存边界", pageType: "blog", business: "GPU", status: "drafting",
    owner: "Codex SEO", contentVersion: oldVersion, evidence: oldEvidence, nextAction: "核对原稿后完成原文章上线验收",
    acceptanceCriteria: ["核验正式网址与稿件版本"], brief: require("./fixtures/chinese-task-brief.cjs")(oldEvidence),
    research: { volume: 20, kd: 8, businessValue: 2, intent: "Inference deployment", exceptionReason: null, observedAt: at, evidence: oldEvidence },
    researchReview: { country: "US", language: "en", keyword: identity.keyword, reviewedAt: at,
      serpResults: urls, openedResults: urls.slice(0, 5), duplicateTaskIds: [], duplicateCheckedAt: at, quality, evidence: oldEvidence },
  });
  const rows = [{ kind: "task", record: { ...original, version: 9, recordedAt: at, updatedAt: at } },
    { kind: "task", record: research }, { kind: "plan", record: plan }];
  const evidenceFor = version => [...oldEvidence, { label: "原草稿生产读回 " + version, artifact: "/tmp/exact-cms-readback.json", observedAt: at }];
  const save = (version, leaseId, now = inside, patch = {}, records = rows) => prepareWorkflowMutation({
    action: "save_task", requestId: "moe-version-binding", expectedVersion: 9,
    record: { ...original, contentVersion: version, evidence: evidenceFor(version), ...patch },
  }, records, "collector", now, leaseId).record;
  assert.equal(save(candidate, moeBlogTaskId).contentVersion, candidate);
  assert.equal(save(candidate, moeBlogTaskId).dueAt, original.dueAt);
  assert.throws(() => save(candidate), { code: "human_field_conflict" });
  assert.throws(() => save(candidate, "seo-hotspot:another"), { code: "human_field_conflict" });
  assert.throws(() => save("sha256:" + "f".repeat(64), moeBlogTaskId), { code: "human_field_conflict" });
  assert.throws(() => save(candidate, moeBlogTaskId, new Date("2026-11-27T12:15:00+08:00")), { code: "human_field_conflict" });
  assert.throws(() => save(candidate, moeBlogTaskId, inside, { title: "未经授权的任务标题" }), { code: "human_field_conflict" });
  assert.throws(() => save(candidate, moeBlogTaskId, inside, { evidence: oldEvidence }), { code: "human_field_conflict" });
  assert.throws(() => save(candidate, moeBlogTaskId, inside, {}, rows.slice(0, 2)), { code: "human_field_conflict" });
});
