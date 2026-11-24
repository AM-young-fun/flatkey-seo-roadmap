const assert = require("node:assert/strict"), { test } = require("node:test"), fs = require("node:fs"), path = require("node:path"), Module = require("node:module"), ts = require("typescript");
const root = path.resolve(__dirname, ".."), resolve = Module._resolveFilename;
Module._resolveFilename = function (name, parent, ...rest) { return resolve.call(this, name.startsWith("@/") ? path.join(root, "src", name.slice(2)) : name, parent, ...rest); };
require.extensions[".ts"] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, file);
const { assertGrowthPlan } = require("../src/lib/seo-growth-plan.ts");
const { prepareWorkflowMutation } = require("../src/lib/seo-workflow-state.ts");
const { quarterAllocationProblems } = require("../src/lib/growth-quarter-planning.ts");
const languages = { en: 8, ja: 6, "pt-BR": 5, "zh-CN": 5, "es-ES": 1, fr: 0, de: 0, ru: 0, vi: 0, id: 0 };
const dates = ["2026-11-27", "2026-11-30", "2026-12-01", "2026-12-02", "2026-12-03"];
function plan(patch = {}) {
  return { id: "quarter-independent-plan", weekStart: "2026-11-30", title: "Preserve original task and approved quarter contract", status: "scheduled", taskIds: [], owner: "AI", preparedAt: "2026-11-24T05:00:00Z", reviewedAt: null, reviewedBy: null,
    targets: { cadence: "growth", executionRange: { start: dates[0], end: dates[4] }, landing: 0, clusterLanding: 7, apiBlogs: 10, gpuBlogs: 15, optimizedPages: 10, maintenanceVersion: "seo-maintenance-v1", contentRefreshPages: 10, blogLanguages: languages },
    gaps: [...dates.flatMap(date => [{ category: "modelFitBlogs", date, siteDomain: "modelfit.cc", count: 1, reason: "Original local demand research is not complete" }, { category: "contentRefreshPages", date, count: 2, reason: "No qualified original page evidence yet" }]), ...[["apiBlogs", 10], ["gpuBlogs", 15], ["optimizedPages", 10], ["clusterLanding", 7]].map(([category, count]) => ({ category, count, reason: "Keep actual research gap without fabricated delivery" }))], evidence: [], notes: "", ...patch };
}
const task = { id: "already-scheduled-original", dueAt: "2026-12-01T06:00:00Z", siteDomain: "flatkey.ai", kind: "optimization", pageUrl: "https://flatkey.ai/blog/original", country: "US", language: "en", status: "ready" };
test("saving a draft before scheduling does not bypass the required quarter allocation", () => {
  const draft = plan({ status: "draft" });
  assert.throws(() => assertGrowthPlan(plan(), draft, [{ kind: "plan", record: draft }]), /季度|投入|分配|原任务/);
});
test("downgrading a formal plan to draft cannot discard a previously scheduled original task", () => {
  const previous = plan({ taskIds: [task.id] });
  assert.throws(() => assertGrowthPlan(plan({ status: "draft" }), previous, [{ kind: "task", record: task }, { kind: "plan", record: previous }]), /原任务|保留|丢失/);
});
test("a saved growth plan cannot change cadence to exit its quarter and maintenance contract", () => {
  const previous = { ...plan({ status: "draft" }), version: 1, updatedAt: "2026-11-24T04:00:00Z", recordedAt: "2026-11-24T04:00:00Z" };
  const legacy = plan({ status: "draft", targets: { cadence: "workdays", landing: 0, clusterLanding: 7, apiBlogs: 10, gpuBlogs: 15, optimizedPages: 10, blogLanguages: { en: 10, ja: 5, "pt-BR": 5, "es-ES": 5 } } });
  assert.throws(() => prepareWorkflowMutation({ action: "save_plan", requestId: "independent-cadence-regression", expectedVersion: 1, record: legacy }, [{ kind: "plan", record: previous }], "collector", new Date("2026-11-24T05:00:00Z")), /契约|growth|保留|维护|季度/);
});
test("an old quarter approval cannot grant first execution by staging the same new task in a draft", () => {
  const oldHash = "a".repeat(64), activeHash = "b".repeat(64);
  const version = (revision, hash) => ({ revision, hash, approval: { hash, actor: "human" }, plan: { executionStart: "2026-11-25", executionEnd: "2027-02-05", deliveryBudget: { total: 100 }, researchBudget: { total: 100 }, workstreams: [{ id: "old-direction", bucket: "primary", topicIds: ["original-topic"] }] } });
  const strategy = { quarterPlanningHistory: [version(1, oldHash)], quarterPlanning: version(2, activeHash) };
  const record = plan({ strategyAllocation: { quarterPlanHash: oldHash, tasks: [{ taskId: task.id, bucket: "primary", workstreamId: "old-direction" }], futureBudget: { total: 1, offset: 0 }, marketResearchBudget: { total: 1, offset: 0 } } });
  const savedDraft = { ...record, status: "draft" };
  assert.ok(quarterAllocationProblems(record, strategy, [{ ...task, topicId: "original-topic" }], [savedDraft]).length, "A draft has no previously approved execution to grandfather");
});
test("weekly allocation cannot reclaim capacity before the approved quarterly start or deliver past its deadline", () => {
  const hash = "c".repeat(64), strategy = { quarterPlanning: { revision: 1, hash, approval: { hash, actor: "human" }, plan: { executionStart: "2026-11-25", executionEnd: "2027-02-05", deliveryBudget: { total: 100 }, researchBudget: { total: 100 }, workstreams: [{ id: "direction", bucket: "primary", topicIds: ["original-topic"] }] } } };
  const allocation = { quarterPlanHash: hash, tasks: [{ taskId: task.id, bucket: "primary", workstreamId: "direction" }], futureBudget: { total: 1, offset: 0 }, marketResearchBudget: { total: 1, offset: 0 } };
  const early = plan({ targets: { ...plan().targets, executionRange: { start: "2026-11-20", end: "2026-11-26" } }, strategyAllocation: allocation });
  assert.ok(quarterAllocationProblems(early, strategy, [{ ...task, topicId: "original-topic", dueAt: "2026-11-25T06:00:00Z" }]).length, "Omitting capacityStart must not silently reclaim November 20-24 slots");
  const late = plan({ targets: { ...plan().targets, executionRange: { start: "2027-02-05", end: "2027-02-11" } }, strategyAllocation: { ...allocation, capacityStart: "2027-02-05" } });
  assert.ok(quarterAllocationProblems(late, strategy, [{ ...task, topicId: "original-topic", dueAt: "2027-02-08T06:00:00Z" }]).length, "Unused quota does not authorize delivery after the reviewed quarter deadline");
});
test("a formerly formal empty plan retains its budget receipt and same-week identity after returning to draft", () => {
  const hash = "d".repeat(64), strategy = { quarterPlanning: { revision: 1, hash, approval: { hash, actor: "human" }, plan: { executionStart: "2026-11-20", executionEnd: "2027-02-05", deliveryBudget: { total: 100 }, researchBudget: { total: 100 }, workstreams: [] } } };
  const prior = plan({ id: "original-empty-budget", status: "draft", committedTaskIds: [], targets: { ...plan().targets, executionRange: { start: "2026-11-20", end: "2026-11-26" } }, strategyAllocation: { quarterPlanHash: hash, tasks: [], futureBudget: { total: 10, offset: 0 }, marketResearchBudget: { total: 5, offset: 0 } } });
  const current = plan({ strategyAllocation: { quarterPlanHash: hash, tasks: [], futureBudget: { total: 1, offset: 0 }, marketResearchBudget: { total: 1, offset: 0 } } });
  assert.match(quarterAllocationProblems(current, strategy, [], [prior]).join(" "), /累计/);
  const continued = { ...current, strategyAllocation: { ...current.strategyAllocation, futureBudget: { total: 1, offset: 10 }, marketResearchBudget: { total: 1, offset: 5 } } };
  assert.deepEqual(quarterAllocationProblems(continued, strategy, [], [prior]), []);
  const sameWindowPrior = { ...prior, targets: current.targets };
  assert.throws(() => assertGrowthPlan(current, undefined, [{ kind: "plan", record: sameWindowPrior }]), { code: "allocation_business_week_duplicate" });
});
test("caller-supplied committed markers cannot forge first execution or erase an original task through a draft", () => {
  const now = new Date("2026-11-24T05:00:00Z");
  const forged = prepareWorkflowMutation({ action: "save_plan", requestId: "independent-forged-committed", expectedVersion: 0, record: plan({ status: "draft", committedTaskIds: [] }) }, [], "collector", now);
  assert.equal(Object.hasOwn(forged.record, "committedTaskIds"), false, "The server strips a new draft's caller-authored formal marker");
  const previous = { ...plan({ taskIds: [task.id] }), version: 1, updatedAt: now.toISOString(), recordedAt: now.toISOString() };
  const draft = prepareWorkflowMutation({ action: "save_plan", requestId: "independent-retain-committed", expectedVersion: 1, record: plan({ status: "draft", taskIds: [task.id], committedTaskIds: [] }) }, [{ kind: "task", record: task }, { kind: "plan", record: previous }], "collector", now);
  assert.deepEqual(draft.record.committedTaskIds, [task.id], "An empty caller ledger cannot erase server-known formal IDs");
  assert.throws(() => prepareWorkflowMutation({ action: "save_plan", requestId: "independent-drop-after-draft", expectedVersion: draft.record.version, record: plan({ status: "draft", committedTaskIds: [] }) }, [{ kind: "task", record: task }, { kind: "plan", record: draft.record }], "collector", now), { code: "plan_preserve_committed" });
});
