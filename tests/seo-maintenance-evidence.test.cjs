const { test } = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), ts = require("typescript");
require.extensions[".ts"] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText, file);
const { maintenanceHistoryProblems, maintenancePublicationProblems } = require("../src/lib/seo-maintenance.ts");
const { prepareWorkflowMutation } = require("../src/lib/seo-workflow-state.ts");
const publishedAt = "2026-11-24T02:00:00Z", checkedAt = "2026-11-24T02:05:00Z", originalPublishedAt = "2026-10-01T02:00:00Z";
const pageUrl = "https://flatkey.ai/blog/model-pricing", modelUrl = "https://flatkey.ai/models/model-123";
const proof = (observedAt = publishedAt) => [{ source: "/tmp/exact-live-render.json", observedAt, finding: "核对当前实际渲染页面、版本、日期与双向锚文本结果" }];
const evidence = [{ label: "原始价格核验与页面版本", artifact: "/tmp/old-version.json", observedAt: "2026-11-23T02:00:00Z" }];
const task = (patch = {}) => ({ id: "refresh-task", weekStart: "2026-11-23", title: "更新模型费用原文事实", siteDomain: "flatkey.ai", channel: "website", kind: "optimization", workClass: "content_refresh", workflowContract: "growth-v1.5",
  pageUrl, pageType: "blog", country: "US", language: "en", business: "API", keyword: "model pricing", keywordId: "original-word", topicId: "real-topic", problemKey: "flatkey:us:model-pricing:old-fact", owner: "SEO/AI", dueAt: "2026-11-24T05:00:00Z", status: "ready", dependencies: [], evidence, nextAction: "按原页面核实修改，保留原ID和上线观察", brief: require("./fixtures/chinese-task-brief.cjs")(evidence), contentVersion: "v2", acceptanceCriteria: ["保留原文身份与实际版本"], research: { volume: 20, kd: 5, businessValue: 3, exceptionReason: null, intent: "核查具体模型费用", observedAt: evidence[0].observedAt, evidence }, approval: null, source: "automation",
  researchReview: { country: "US", language: "en", keyword: "model pricing", reviewedAt: evidence[0].observedAt,
    serpResults: Array.from({ length: 10 }, (_, i) => `https://example.org/result-${i}`), openedResults: Array.from({ length: 5 }, (_, i) => `https://example.org/result-${i}`), duplicateTaskIds: [], duplicateCheckedAt: evidence[0].observedAt,
    quality: Object.fromEntries(["intent", "keywordsAndAlt", "experience", "links", "behavior", "algorithmAndManual", "eeat"].map(key => [key, "真实原词研究及具体质量证据说明，不推测未发生结果"])), evidence },
  maintenance: { version: "seo-maintenance-v1", refresh: { reason: "outdated_facts", baselineId: "baseline-original", originalPublishedAt, baseContentVersion: "v1", changes: ["对照官方事实修正原文已经过时的模型计费示例"], evidence: proof("2026-11-23T02:00:00Z") } }, ...patch });
const check = (key, url = pageUrl, method = "rendered_page") => ({ key, pageUrl: url, result: "passed", method, evidence: proof() });
const publication = (patch = {}) => ({ taskId: "refresh-task", siteDomain: "flatkey.ai", pageUrl, kind: "optimization", status: "verified", contentVersion: "v2", publishedAt, automaticWrite: { baseContentVersion: "v1" },
  maintenanceQa: { version: "seo-maintenance-v1", contentVersion: "v2", checkedAt, preservedPublishedAt: originalPublishedAt, modifiedAt: publishedAt, checks: [check("refresh_identity"), check("refresh_substance")] }, ...patch });
const history = [{ taskId: "original-task", siteDomain: "flatkey.ai", pageUrl, kind: "source_blog", status: "verified", contentVersion: "v1", publishedAt: originalPublishedAt }];

test("a later QA envelope cannot turn pre-release evidence into verified refreshed content", () => {
  assert.deepEqual(maintenancePublicationProblems(task(), publication()), []);
  for (const observedAt of ["2026-11-23T02:00:00Z", "2026-11-24T02:06:00Z"]) {
    const value = publication(); value.maintenanceQa.checks[0].evidence = proof(observedAt);
    assert.match(maintenancePublicationProblems(task(), value).join("；"), /上线后的检查证据/);
  }
});
test("original release facts and latest page versions remain authoritative when history exists", () => {
  assert.deepEqual(maintenanceHistoryProblems(task(), history), []);
  const stale = task(); stale.maintenance.refresh.baseContentVersion = "stale";
  assert.match(maintenanceHistoryProblems(stale, history).join("；"), /最近已记录的正式版本/);
  const reset = task(); reset.maintenance.refresh.originalPublishedAt = publishedAt;
  assert.match(maintenanceHistoryProblems(reset, history).join("；"), /首发日期/);
  const latest = [...history, { ...history[0], taskId: "old-update", kind: "optimization", contentVersion: "v1.1", publishedAt: "2026-11-20T02:00:00Z" }];
  assert.match(maintenanceHistoryProblems(task(), latest).join("；"), /最近已记录的正式版本/);
  // The same task's first actual update receipt is not a replacement for its
  // immutable pre-update version while that delivery is being verified.
  assert.deepEqual(maintenanceHistoryProblems(task(), [...history, publication()]), []);
});
test("refresh entering production checks real recorded history and the supplied server clock", () => {
  const now = new Date("2026-11-24T03:00:00Z"), original = task();
  const rows = [{ kind: "optimization", record: { id: "baseline-original", taskId: original.id, siteDomain: original.siteDomain, pageUrl, country: "US", language: "en", baseline: { capturedAt: "2026-11-23T02:00:00Z" } } }, ...history.map(record => ({ kind: "publication", record }))];
  const save = record => prepareWorkflowMutation({ action: "save_task", requestId: "maintenance-evidence", expectedVersion: 0, record }, rows, "collector", now);
  assert.equal(save(original).record.status, "ready");
  const stale = task(); stale.maintenance.refresh.baseContentVersion = "stale";
  assert.throws(() => save(stale), { code: "refresh_history_mismatch" });
  const futureRows = structuredClone(rows); futureRows[0].record.baseline.capturedAt = "2026-11-24T03:01:00Z";
  assert.throws(() => prepareWorkflowMutation({ action: "save_task", requestId: "maintenance-clock", expectedVersion: 0, record: original }, futureRows, "collector", now), { code: "refresh_baseline_missing" });
});
const link = { entityId: "model-123", topicId: "real-topic", language: "en", modelUrl, articleUrl: pageUrl, modelToArticleAnchor: "Model pricing guide", articleToModelAnchor: "Model specifications", relevance: "同一模型的费用解释与实际能力详情互相承接", evidence: proof() };
function linkPublication() {
  return publication({ maintenanceQa: { version: "seo-maintenance-v1", contentVersion: "v2", checkedAt, checks: [check("reciprocal_links", pageUrl), check("reciprocal_links", modelUrl)],
    linkReadbacks: [[pageUrl, modelUrl, link.articleToModelAnchor, "v2", "model-v1"], [modelUrl, pageUrl, link.modelToArticleAnchor, "model-v1", "v2"]].map(([from, to, anchor, fromContentVersion, toContentVersion]) => ({ from, to, anchor, fromContentVersion, toContentVersion, checkedAt: publishedAt, canonicalUrl: to, language: "en", httpStatus: 200, crawlableAnchor: true, indexable: true, redirectCount: 0, evidence: proof() })) } });
}
test("two-sided link evidence binds both live page versions and cannot substitute a stale peer", () => {
  const input = task({ workClass: "internal_linking", maintenance: { version: "seo-maintenance-v1", links: [link] } });
  assert.deepEqual(maintenancePublicationProblems(input, linkPublication()), []);
  for (const patch of [{ fromContentVersion: "old-article" }, { toContentVersion: "old-model" }, { checkedAt: "2026-11-23T02:00:00Z" }]) {
    const value = linkPublication(); Object.assign(value.maintenanceQa.linkReadbacks[0], patch);
    assert.match(maintenancePublicationProblems(input, value).join("；"), /两端一致的实际版本/);
  }
  const peerHistory = [{ ...history[0], pageUrl: modelUrl, kind: "landing", contentVersion: "model-v2" }];
  assert.match(maintenanceHistoryProblems(input, peerHistory, linkPublication()).join("；"), /对端验收版本/);
});
test("a rendered-page check cannot masquerade as a promised field or lab performance result", () => {
  const input = task({ kind: "technical", workClass: "technical_seo", maintenance: { version: "seo-maintenance-v1", technical: [{ area: "performance", method: "field", before: "现场指标显示特定模板LCP偏高，需要核实真实样本", change: "按现场来源定位主图加载问题并实施有证据修正", verify: "分别记录同一现场来源和实验室辅助结果，不混用", evidence: proof() }] } });
  const value = publication(); value.maintenanceQa.checks = [check("performance")];
  assert.match(maintenancePublicationProblems(input, value).join("；"), /现场或实验室来源方法/);
  value.maintenanceQa.checks[0].method = "field";
  assert.deepEqual(maintenancePublicationProblems(input, value), []);
});
