const assert = require("node:assert/strict");
const { test } = require("node:test");
require("./register-ui-modules.cjs");
const { reservedOriginalIdentity, reservedOriginalProblem } = require("../src/lib/reserved-original-keyword.ts");
const { workflowSnapshot } = require("../src/lib/seo-workflow-state.ts");

const now = new Date("2026-11-26T10:00:00Z");
const firstSeen = "2026-11-23T06:00:00Z";
const hash = "a".repeat(64);
const links = Array.from({ length: 10 }, (_, index) => "https://example.com/" + index);
const evidence = ["official", "demand"].map(role => ({
  label: `seo-hotspot-v1;event=original-launch;at=2026-11-18T08:00:00.000Z;basis=event;role=${role};verified=1`,
  url: `https://${role}.example.com/launch`, observedAt: firstSeen,
}));
const provenance = { keyword: "desktop comparison", keywordId: "word-123", country: "US", language: "en", siteDomain: "modelfit.cc" };
const review = {
  ...provenance, reviewedAt: firstSeen, duplicateCheckedAt: firstSeen, evidence, serpResults: links, openedResults: links.slice(0, 5),
  quality: Object.fromEntries(["intent", "keywordsAndAlt", "experience", "links", "behavior", "algorithmAndManual", "eeat"].map(key => [key, "Existing documented review"])),
};
const dependency = { ...provenance, id: "original-research", kind: "research", status: "verified" };
const task = {
  ...provenance, id: "seo-hotspot:original-blog", title: "Original comparison", workflowContract: "growth-v1.5",
  status: "planned", channel: "website", kind: "blog", source: "human", capacityClass: "routine", topicId: "topic-1",
  dueAt: "2026-11-24T03:30:00Z", weekStart: "2026-11-23", pageUrl: "https://modelfit.cc/blog/comparison",
  dependencies: [dependency.id], research: { volume: null, kd: null, businessValue: 2, exceptionReason: "Existing researched demand", evidence },
  researchReview: review, evidence,
};
const command = { requestId: "original-request", taskId: task.id, expectedTaskVersion: 4, quarterHash: hash };
const approved = { quarterPlanning: { hash, approval: { hash }, plan: { reservedOriginalTaskIds: [task.id] } } };

test("only an approved frozen reservation with expired source evidence and exact verified research qualifies", () => {
  const problem = (record = task, strategy = approved, deps = [dependency], at = now) => reservedOriginalProblem(command, record, strategy, deps, at);
  assert.equal(problem(), undefined);
  assert.match(problem(task, { quarterPlanning: { ...approved.quarterPlanning, approval: null } }), /冻结保留/);
  assert.match(problem(task, { quarterPlanning: { ...approved.quarterPlanning, plan: { reservedOriginalTaskIds: [] } } }), /冻结保留/);
  assert.match(problem({ ...task, siteDomain: "flatkey.ai" }), /同站/);
  assert.match(problem({ ...task, capacityClass: "authorized_hotspot_extra" }), /常规/);
  assert.match(problem({ ...task, researchReview: { ...review, openedResults: links.slice(1, 6) } }), /前五/);
  assert.match(problem(task, approved, [{ ...dependency, keywordId: "wrong" }]), /研究依赖/);
  assert.match(problem(task, approved, [dependency], new Date(firstSeen)), /退出 P0/);
  assert.match(problem({ ...task, evidence: [] }), /原证据/);
});

test("regular scanning admits only the exact ready task matched to the saved receipt", () => {
  const ready = { ...task, status: "ready" };
  const intake = (record, identity) => workflowSnapshot([{ kind: "task", record }], {
    operational: true, reservedOriginalAdmissions: new Map([[record.id, identity]]),
  }, "database", now).tasks.map(row => row.id);
  const identity = reservedOriginalIdentity(ready);
  assert.deepEqual(intake(ready, identity), [task.id]);
  assert.deepEqual(intake(ready, undefined), []);
  assert.deepEqual(intake(ready, { ...identity, keywordId: "different" }), []);
  assert.deepEqual(intake({ ...ready, status: "planned" }, identity), []);
  assert.deepEqual(intake({ ...ready, country: "JP" }, identity), []);
  assert.deepEqual(intake({ ...ready, dueAt: "2026-11-25T03:30:00Z" }, identity), []);
});
