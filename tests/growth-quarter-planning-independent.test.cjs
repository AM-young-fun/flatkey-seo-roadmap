const assert = require("node:assert/strict"), { test } = require("node:test"), fs = require("node:fs"), path = require("node:path"), Module = require("node:module"), ts = require("typescript");
const root = path.resolve(__dirname, ".."), resolve = Module._resolveFilename;
Module._resolveFilename = function (name, parent, ...rest) { return resolve.call(this, name.startsWith("@/") ? path.join(root, "src", name.slice(2)) : name, parent, ...rest); };
require.extensions[".ts"] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, file);
const { assertGrowthPlan } = require("../src/lib/seo-growth-plan.ts");
const { prepareWorkflowMutation } = require("../src/lib/seo-workflow-state.ts");
const { allocateIntegerBudget, BUSINESS_DELIVERY_WEIGHTS, quarterAllocationProblems } = require("../src/lib/growth-quarter-planning.ts");
const { routineDailyLanguageBudgets, routineLanguageBudget, routineLanguageGroup, routineLanguageProblems } = require("../src/lib/seo-routine-languages.ts");
const languages = { en: 8, ja: 6, "pt-BR": 5, "zh-CN": 5, "es-ES": 1, fr: 0, de: 0, ru: 0, vi: 0, id: 0 };
const dates = ["2026-11-27", "2026-11-30", "2026-12-01", "2026-12-02", "2026-12-03"];
function plan(patch = {}) {
  return { id: "quarter-independent-plan", weekStart: "2026-11-30", title: "Preserve original task and approved quarter contract", status: "scheduled", taskIds: [], owner: "AI", preparedAt: "2026-11-24T05:00:00Z", reviewedAt: null, reviewedBy: null,
    targets: { cadence: "growth", executionRange: { start: dates[0], end: dates[4] }, landing: 2, clusterLanding: 7, apiBlogs: 10, gpuBlogs: 15, optimizedPages: 10, maintenanceVersion: "seo-maintenance-v1", contentRefreshPages: 10, blogLanguages: languages },
    gaps: [...dates.flatMap(date => [{ category: "modelFitBlogs", date, siteDomain: "modelfit.cc", count: 1, reason: "Original local demand research is not complete" }, { category: "contentRefreshPages", date, count: 2, reason: "No qualified original page evidence yet" }]), ...[["apiBlogs", 10], ["gpuBlogs", 15], ["optimizedPages", 10], ["clusterLanding", 7], ["landing", 2]].map(([category, count]) => ({ category, count, reason: "Keep actual research gap without fabricated delivery" }))], evidence: [], notes: "", ...patch };
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

test("small daily capacity rotates across the full week, pooling only authorized additional languages", () => {
  const days = dates.map((date, index) => ({ date, slots: [1, 0, 2, 1, 1][index] }));
  const budgets = routineDailyLanguageBudgets(days.reverse());
  assert.deepEqual(budgets.map(({ counts }) => Object.keys(counts).filter(key => counts[key])), [["zh-CN"], [], ["ja", "en"], ["es-ES"], ["other"]]);
  for (const group of Object.keys(budgets[0].counts)) assert.equal(budgets.reduce((sum, day) => sum + day.counts[group], 0), 1);
  assert.deepEqual(routineLanguageBudget(7, 3), { "zh-CN": 1, ja: 1, en: 1, "es-ES": 2, other: 2 });
  for (const language of ["pt-BR", "fr", "de", "vi", "id"]) assert.equal(routineLanguageGroup(language), "other");
  for (const language of ["ru", "ko", null]) assert.equal(routineLanguageGroup(language), null);
});

test("prior commitments and qualified extra work survive the new routine ceilings", () => {
  const original = (id, language, extra = {}) => ({ ...task, id, keyword: "original " + id, language, ...extra });
  const old = [original("old-1", "en"), original("old-2", "en")];
  const extra = original("hotspot", "en", { capacityClass: "authorized_hotspot_extra" });
  const committedIds = new Set(old.map(row => row.id));
  const options = { capacity: 5, committedIds, dailySlots: new Map([["2026-12-01", 5]]) };
  assert.deepEqual(routineLanguageProblems({ ...options, tasks: [...old, extra, original("new-ja", "ja")] }), []);
  assert.equal(routineLanguageProblems({ ...options, tasks: [...old, extra, original("new-en", "en")] })[0].code, "routine_weekly_language_capacity");
  assert.equal(routineLanguageProblems({ ...options, tasks: [...old, original("new-ru", "ru")] })[0].code, "routine_keyword_language_scope");
  assert.equal(routineLanguageProblems({ ...options, capacity: 10, tasks: [original("new-fr", "fr"), original("new-de", "de")] })[0].code, "routine_daily_language_capacity");
});

test("two-site production links the supplement without borrowing Flatkey workstreams or growing caps", () => {
  const hash = "d".repeat(64), satelliteHash = "e".repeat(64);
  const original = { ...task, id: "old-model-promise", kind: "blog", siteDomain: "modelfit.cc", keyword: "existing original promise" };
  const blog = { ...original, id: "new-model-blog", topicId: "local-models", keywordId: "model-guide", keyword: "model compatibility guide", dueAt: dates[0] + "T06:00:00Z" };
  const rack = { ...blog, id: "new-rack-landing", siteDomain: "rackrate.org", kind: "landing", topicId: "rental", keywordId: "rental-prices", keyword: "gpu rental pricing" };
  const records = [original, blog, rack].map(record => ({ kind: "task", record }));
  const strategy = {
    baseline: { planHash: hash },
    quarterPlanning: { revision: 1, hash, approval: { hash }, plan: { version: "quarter-planning-v3", executionStart: dates[0], executionEnd: "2027-02-05",
      deliveryBudget: { total: 100 }, researchBudget: { total: 1000 }, workstreams: [], reservedOriginalTaskIds: [original.id] } },
    satelliteQuarter: { baselinePlanHash: hash, selectionHash: satelliteHash, members: [blog, rack] },
  };
  const counts = allocateIntegerBudget(45, BUSINESS_DELIVERY_WEIGHTS);
  const allocation = { version: "quarter-planning-v3", quarterPlanHash: hash, satelliteQuarterHash: satelliteHash,
    futureBudget: { total: 45, counts }, preservedTaskIds: [], tasks: [], marketResearchBudget: { total: 0 },
    gaps: Object.entries(counts).map(([bucket, count]) => ({ bucket, count })) };
  const base = plan();
  const record = plan({ taskIds: [original.id, blog.id, rack.id], strategyAllocation: allocation,
    targets: { ...base.targets, blogLanguages: { en: 5, ja: 5, "pt-BR": 5, "zh-CN": 5, "es-ES": 5, fr: 0, de: 0, ru: 0, vi: 0, id: 0 } } });
  assert.doesNotThrow(() => assertGrowthPlan(record, undefined, records));
  assert.deepEqual(quarterAllocationProblems(record, strategy, [original, blog, rack]), []);
  assert.match(quarterAllocationProblems({ ...record, strategyAllocation: { ...allocation, satelliteQuarterHash: undefined } }, strategy, [original, blog, rack]).join(" "), /确切季度词批次/);
  assert.match(quarterAllocationProblems(record, strategy, [original, { ...blog, topicId: "wrong" }, rack]).join(" "), /确切季度词批次/);
  assert.throws(() => assertGrowthPlan(record, undefined, [{ ...records[0], record: { ...original, dueAt: blog.dueAt } }, ...records.slice(1)]),
    { code: "growth_plan_daily_capacity" });
  assert.throws(() => assertGrowthPlan({ ...record, strategyAllocation: { ...allocation, satelliteQuarterHash: hash } }, record, records),
    { code: "satellite_allocation_immutable" });
});

test("formal growth save accepts new Spanish and pooled languages under the new budgets and preserves a legacy plan on extra-only append", () => {
  const newRows = ["zh-CN", "ja", "en", "es-ES", "fr"].map((language, index) => ({ ...task, id: `blog-${index}`, kind: "blog", business: "GPU", keyword: `original ${index}`, language }));
  const empty = plan(), taskIds = newRows.map(row => row.id), records = newRows.map(record => ({ kind: "task", record }));
  const budget = allocateIntegerBudget(57, BUSINESS_DELIVERY_WEIGHTS);
  const allocation = { version: "quarter-planning-v2", futureBudget: { total: 57, counts: budget }, preservedTaskIds: [], marketResearchBudget: { total: 0 },
    tasks: taskIds.map(taskId => ({ taskId, bucket: "gpu", workstreamId: "gpu-workstream" })),
    gaps: Object.entries(budget).map(([bucket, count]) => ({ bucket, count: count - (bucket === "gpu" ? taskIds.length : 0) })) };
  const targets = { ...empty.targets, blogLanguages: { en: 5, ja: 5, "pt-BR": 2, "zh-CN": 5, "es-ES": 5, fr: 1, de: 1, ru: 0, vi: 0, id: 1 } };
  const next = plan({ taskIds, targets, strategyAllocation: allocation });
  assert.doesNotThrow(() => assertGrowthPlan(next, undefined, records));
  assert.throws(() => assertGrowthPlan({ ...next, targets: empty.targets }, undefined, records), { code: "growth_plan_language_targets" });

  const page = (id, date) => ({ ...task, id, kind: "landing", keyword: id, workflowContract: "growth-v1.5", pageUrl: `https://flatkey.ai/gpu/${id}`, dueAt: `${date}T06:00:00Z` });
  const landings = [page("first-page", dates[0]), page("second-page", dates[4])];
  const withLanding = { ...next, taskIds: [...next.taskIds, ...landings.map(row => row.id)], gaps: next.gaps.filter(gap => gap.category !== "landing") };
  const landingRecords = [...records, ...landings.map(record => ({ kind: "task", record }))];
  assert.doesNotThrow(() => assertGrowthPlan(withLanding, undefined, landingRecords));
  const third = page("third-page", dates[1]);
  assert.throws(() => assertGrowthPlan({ ...withLanding, taskIds: [...withLanding.taskIds, third.id] }, undefined,
    [...landingRecords, { kind: "task", record: third }]), { code: "flatkey_landing_capacity" });
  assert.throws(() => assertGrowthPlan({ ...withLanding, targets: { ...targets, landing: 0 } }, undefined, landingRecords), { code: "flatkey_landing_capacity" });

  const previous = plan({ taskIds, strategyAllocation: allocation });
  const hotspot = { ...newRows[0], id: "hotspot-extra", capacityClass: "authorized_hotspot_extra" };
  assert.doesNotThrow(() => assertGrowthPlan({ ...previous, taskIds: [...taskIds, hotspot.id] }, previous,
    [...records, { kind: "task", record: hotspot }, { kind: "plan", record: previous }]));
});
