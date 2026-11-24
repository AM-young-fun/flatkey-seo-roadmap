const assert = require("node:assert/strict"), { test } = require("node:test"), fs = require("node:fs"), path = require("node:path"), Module = require("node:module"), ts = require("typescript");
const root = path.resolve(__dirname, ".."), resolve = Module._resolveFilename;
Module._resolveFilename = function (name, parent, ...rest) { return resolve.call(this, name.startsWith("@/") ? path.join(root, "src", name.slice(2)) : name, parent, ...rest); };
require.extensions[".ts"] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, file);
const { maintenancePlanSchema, maintenanceQaSchema, maintenanceTaskProblems, maintenancePublicationProblems } = require("../src/lib/seo-maintenance.ts");
const { prepareWorkflowMutation, workflowSnapshot } = require("../src/lib/seo-workflow-state.ts");
const { assertGrowthPlan } = require("../src/lib/seo-growth-plan.ts");
const at = "2026-11-24T02:00:00Z", proof = [{ observedAt: at, source: "saved-actual-rendered-evidence", finding: "原页面事实已经过期，需补实际官方资料和可复核结果" }];
const evidence = [{ label: "来源及实际页面证据", artifact: "saved-source-evidence.json", observedAt: at }];
const refresh = { reason: "outdated_facts", baselineId: "baseline-original", originalPublishedAt: "2026-06-01T02:00:00Z", baseContentVersion: "v1", changes: ["将原文已过期的费用示例替换为同市场可复算的新示例"], evidence: proof };
const task = (patch = {}) => ({ id: "refresh-original", weekStart: "2026-11-23", title: "原文实质更新", siteDomain: "flatkey.ai", kind: "optimization", workClass: "content_refresh", maintenance: { version: "seo-maintenance-v1", refresh }, workflowContract: "growth-v1.5", problemKey: "flatkey:pricing:outdated-fact", country: "US", language: "en", business: "API", pageType: "blog", keyword: "model pricing", keywordId: "original-word", topicId: "original-topic", pageUrl: "https://flatkey.ai/blog/model-pricing", owner: "AI", dueAt: "2026-11-24T05:00:00Z", status: "researching", dependencies: [], evidence, nextAction: "补齐真实原市场研究后制作", contentVersion: null, acceptanceCriteria: ["保留原URL和首发日期"], research: null, approval: null, source: "automation", brief: require("./fixtures/chinese-task-brief.cjs")(evidence), ...patch });
const check = (key, pageUrl = task().pageUrl) => ({ key, pageUrl, result: "passed", method: "rendered_page", evidence: proof });
const publication = (patch = {}) => ({ kind: "optimization", pageUrl: task().pageUrl, contentVersion: "v2", status: "verified", publishedAt: at, automaticWrite: { baseContentVersion: "v1" }, maintenanceQa: { version: "seo-maintenance-v1", contentVersion: "v2", checkedAt: "2026-11-24T02:05:00Z", preservedPublishedAt: refresh.originalPublishedAt, modifiedAt: at, checks: [check("refresh_identity"), check("refresh_substance")] }, ...patch });
const save = (record, all = [], expectedVersion = 0) => prepareWorkflowMutation({ requestId: "maintenance-test", action: "save_task", expectedVersion, record }, all, "collector", new Date("2026-11-24T03:00:00Z"));

test("refresh preserves the old optimization protocol but is limited to existing authorized blogs", () => {
  assert.deepEqual(maintenanceTaskProblems(task()), []);
  for (const patch of [{ kind: "blog" }, { siteDomain: "rackrate.org" }, { pageUrl: "https://flatkey.ai/models/example" }, { channel: "product" }]) assert.ok(maintenanceTaskProblems(task(patch)).length);
  const old = task({ workClass: undefined, maintenance: undefined });
  assert.deepEqual(maintenanceTaskProblems(old), []);
});
test("decline and plateau need closed comparable 28-day source windows, never one-day or mixed-source evidence", () => {
  const trend = { source: "GSC", timezone: "America/Los_Angeles", metric: "clicks", beforeStart: "2026-09-28", beforeEnd: "2026-10-25", afterStart: "2026-10-26", afterEnd: "2026-11-22", beforeValue: 200, afterValue: 100, observedAt: at, sourceEvidence: "saved-gsc-exact-window.json" };
  const plan = { version: "seo-maintenance-v1", refresh: { ...refresh, reason: "decline", trend } };
  assert.equal(maintenancePlanSchema.safeParse(plan).success, true);
  for (const patch of [{ beforeStart: "2026-10-25" }, { afterEnd: "2026-11-24" }, { source: "GA4" }, { timezone: "Asia/Shanghai" }]) assert.equal(maintenancePlanSchema.safeParse({ ...plan, refresh: { ...plan.refresh, trend: { ...trend, ...patch } } }).success, false);
  assert.equal(maintenancePlanSchema.safeParse({ ...plan, refresh: { ...refresh, reason: "plateau" } }).success, false);
});
test("refresh needs original task baseline before production and cannot reclassify an already-ready task", () => {
  const old = save(task()).record;
  const ready = task({ status: "ready" });
  assert.throws(() => save(ready), { code: "refresh_baseline_missing" });
  const previous = { ...old, workClass: undefined, maintenance: undefined, status: "ready" };
  assert.throws(() => save(task(), [{ kind: "task", record: previous }], previous.version), { code: "maintenance_class_immutable" });
});
test("old client progress does not erase the persisted maintenance class or plan", () => {
  const old = save(task()).record;
  const { version, workClass, maintenance } = old;
  const legacy = Object.fromEntries(Object.entries(old).filter(([key]) => !["version", "updatedAt", "recordedAt", "workClass", "maintenance"].includes(key)));
  const next = save({ ...legacy, nextAction: "继续原任务的补证，不另建同题" }, [{ kind: "task", record: old }], version).record;
  assert.equal(next.workClass, workClass);
  assert.deepEqual(next.maintenance, maintenance);
});
test("actual published/failed writes remain recordable before QA, only verified refresh earns completion", () => {
  const candidate = task({ status: "ready" });
  assert.deepEqual(maintenancePublicationProblems(candidate, publication()), []);
  for (const status of ["published", "failed", "unknown"]) assert.deepEqual(maintenancePublicationProblems(candidate, publication({ status, maintenanceQa: undefined })), []);
  assert.ok(maintenancePublicationProblems(candidate, publication({ maintenanceQa: undefined })).length);
  const changedDate = publication(); changedDate.maintenanceQa.preservedPublishedAt = at;
  assert.ok(maintenancePublicationProblems(candidate, changedDate).length);
  const fakeUpdate = publication(); fakeUpdate.automaticWrite.baseContentVersion = "another-base";
  assert.ok(maintenancePublicationProblems(candidate, fakeUpdate).length);
});
const relation = { entityId: "model-123", topicId: "original-topic", language: "en", modelUrl: "https://flatkey.ai/models/model-123", articleUrl: task().pageUrl, modelToArticleAnchor: "Model pricing guide", articleToModelAnchor: "Model specifications", relevance: "同一模型的价格决策文章与实际能力详情相互承接", evidence: proof };
test("model links must match topic, real module, native language, host and both directions", () => {
  const linking = task({ workClass: "internal_linking", status: "ready", maintenance: { version: "seo-maintenance-v1", links: [relation] } });
  assert.deepEqual(maintenanceTaskProblems(linking), []);
  for (const patch of [{ language: "ja" }, { modelUrl: "https://flatkey.ai/ja/models/model-123" }, { topicId: "unrelated" }, { modelUrl: "https://rackrate.org/models/model-123" }, { modelUrl: "https://flatkey.ai/pricing" }]) assert.ok(maintenanceTaskProblems({ ...linking, maintenance: { ...linking.maintenance, links: [{ ...relation, ...patch }] } }).length);
  const receipt = publication({ maintenanceQa: { version: "seo-maintenance-v1", contentVersion: "v2", checkedAt: at, checks: [check("reciprocal_links", relation.modelUrl), check("reciprocal_links", relation.articleUrl)], linkReadbacks: [[relation.modelUrl, relation.articleUrl, relation.modelToArticleAnchor], [relation.articleUrl, relation.modelUrl, relation.articleToModelAnchor]].map(([from, to, anchor]) => ({ from, to, canonicalUrl: to, language: "en", checkedAt: at, fromContentVersion: from === task().pageUrl ? "v2" : "model-v1", toContentVersion: to === task().pageUrl ? "v2" : "model-v1", httpStatus: 200, anchor, crawlableAnchor: true, indexable: true, redirectCount: 0, evidence: proof })) } });
  assert.deepEqual(maintenancePublicationProblems(linking, receipt), []);
  receipt.maintenanceQa.linkReadbacks.pop();
  assert.ok(maintenancePublicationProblems(linking, receipt).length);
  assert.equal(maintenanceQaSchema.safeParse({ ...receipt.maintenanceQa, linkReadbacks: [{ ...receipt.maintenanceQa.linkReadbacks[0], crawlableAnchor: false }] }).success, false);
});
test("technical maintenance requires area-specific real QA, retaining lab versus field method", () => {
  const technical = task({ kind: "technical", pageType: "technical", workClass: "technical_seo", status: "ready", maintenance: { version: "seo-maintenance-v1", technical: [{ area: "performance", method: "lab", before: "移动实验室发现主图延迟，现场数据尚未取得", change: "压缩实际LCP主图并修复同模板加载优先级", verify: "同条件复测LCP、INP、CLS，不冒称CrUX达标", evidence: proof }] } });
  assert.deepEqual(maintenanceTaskProblems(technical), []);
  assert.ok(maintenancePublicationProblems(technical, publication()).length);
  const pub = publication(); pub.maintenanceQa.checks = [{ ...check("performance"), method: "lab" }];
  assert.deepEqual(maintenancePublicationProblems(technical, pub), []);
});
const dates = ["2026-11-20", "2026-11-23", "2026-11-24", "2026-11-25", "2026-11-26"];
const plan = () => ({ id: "maintenance-plan", weekStart: "2026-11-23", status: "scheduled", taskIds: [], targets: { cadence: "growth", executionRange: { start: "2026-11-20", end: "2026-11-26" }, landing: 0, clusterLanding: 7, apiBlogs: 10, gpuBlogs: 15, optimizedPages: 10, maintenanceVersion: "seo-maintenance-v1", contentRefreshPages: 10, blogLanguages: { en: 8, ja: 6, "pt-BR": 5, "zh-CN": 5, "es-ES": 1, fr: 0, de: 0, ru: 0, vi: 0, id: 0 } }, gaps: [...dates.flatMap(date => [{ category: "modelFitBlogs", date, siteDomain: "modelfit.cc", count: 1, reason: "当地研究尚待补证" }, { category: "contentRefreshPages", date, count: 2, reason: "无合格原文时保留真实缺口" }]), ...[["apiBlogs", 10], ["gpuBlogs", 15], ["optimizedPages", 10], ["clusterLanding", 7]].map(([category, count]) => ({ category, count, reason: "保留原计划缺口，不造交付" }))] });
test("refresh adds 10 capacity to the unchanged 47, while old growth plans remain valid", () => {
  assert.doesNotThrow(() => assertGrowthPlan(plan(), undefined, []));
  const legacy = plan(); delete legacy.targets.maintenanceVersion; delete legacy.targets.contentRefreshPages;
  assert.doesNotThrow(() => assertGrowthPlan(legacy, undefined, []));
  const wrong = plan(); wrong.targets.contentRefreshPages = 20;
  assert.throws(() => assertGrowthPlan(wrong, undefined, []), { code: "growth_refresh_capacity" });
  const noGaps = plan(); noGaps.gaps = noGaps.gaps.filter(gap => gap.category !== "contentRefreshPages");
  assert.throws(() => assertGrowthPlan(noGaps, undefined, []), { code: "growth_refresh_daily_gap" });
});
test("two sites share 2 daily refresh slots and duplicate original-page optimization is rejected", () => {
  const p = plan(), tasks = [0, 1, 2].map(index => task({ id: "refresh-" + index, pageUrl: `https://flatkey.ai/blog/page-${index}`, status: "ready" }));
  p.taskIds = tasks.map(task => task.id);
  assert.throws(() => assertGrowthPlan(p, undefined, tasks.map(record => ({ kind: "task", record }))), { code: "growth_refresh_daily_capacity" });
  const duplicate = [tasks[0], { ...tasks[0], id: "ordinary-opt", workClass: undefined }];
  p.taskIds = duplicate.map(task => task.id);
  assert.throws(() => assertGrowthPlan(p, undefined, duplicate.map(record => ({ kind: "task", record }))), { code: "growth_refresh_duplicate_page" });
});
test("snapshot separates a verified refresh from original optimization count", () => {
  const t = task(), p = { ...publication(), id: "pub-refresh", taskId: t.id, weekStart: t.weekStart, siteDomain: t.siteDomain, country: t.country, language: t.language };
  const snapshot = workflowSnapshot([{ kind: "task", record: t }, { kind: "publication", record: p }], { weekStart: t.weekStart }, "local_preview", new Date(at));
  assert.equal(snapshot.summary.refreshedPages, 1);
  assert.equal(snapshot.summary.optimizedPages, 0);
});
