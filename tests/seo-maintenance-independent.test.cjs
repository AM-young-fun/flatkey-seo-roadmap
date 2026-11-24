const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"), ts = require("typescript");
require.extensions[".ts"] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText, file);
const { prepareWorkflowMutation } = require("../src/lib/seo-workflow-state.ts");
const { prepareGrowthObservationComparison } = require("../src/lib/growth-observation-comparison.ts");
const { maintenancePublicationProblems } = require("../src/lib/seo-maintenance.ts");
const now = new Date("2026-11-24T03:30:00Z");
const evidence = [{ label: "原始价格核验及文章版本", artifact: "/tmp/maintenance-independent.json", observedAt: "2026-11-23T02:00:00Z" }];
const maintenance = { version: "seo-maintenance-v1", refresh: {
  reason: "outdated_facts", baselineId: "original-baseline", originalPublishedAt: "2026-10-01T00:00:00Z", baseContentVersion: "original-v1",
  changes: ["根据官方原始资料修正已经过时的价格计算示例"],
  evidence: [{ observedAt: evidence[0].observedAt, source: evidence[0].artifact, finding: "官方当前价格与原文章的计算示例存在明确差异" }],
} };
const task = patch => ({ id: "refresh-original", weekStart: "2026-11-23", title: "核对原博客过时的费用事实", siteDomain: "flatkey.ai", channel: "website",
  kind: "optimization", workClass: "content_refresh", maintenance, country: "US", language: "en", business: "API", pageType: "blog",
  keyword: "model pricing", keywordId: "real-word", topicId: "real-topic", problemKey: "flatkey:us:model-pricing:stale-facts", pageUrl: "https://flatkey.ai/blog/model-pricing",
  owner: "SEO/AI", dueAt: "2026-11-24T05:00:00Z", status: "researching", dependencies: [], evidence, nextAction: "先核对原文版本和原始价格证据，不重复创建交付。",
  brief: require("./fixtures/chinese-task-brief.cjs")(evidence), contentVersion: null, acceptanceCriteria: ["保留原页面身份并补齐具体研究与真实基线"],
  research: null, approval: null, source: "automation", ...patch });
const clean = record => Object.fromEntries(Object.entries(record).filter(([key]) => !["version", "recordedAt", "updatedAt"].includes(key)));
const save = (record, all = [], expectedVersion = 0) => prepareWorkflowMutation({ action: "save_task", requestId: "maintenance-independent", expectedVersion, record }, all, "collector", now);

test("older progress writers cannot erase maintenance classification or typed plan by omitting optional fields", () => {
  const original = save(task());
  const update = clean(original.record); delete update.workClass; delete update.maintenance;
  update.nextAction = "沿原任务补充新的可核验证据，保留既有翻新分类和原计划。";
  const next = save(update, [{ kind: "task", record: original.record }], original.record.version);
  assert.equal(next.record.workClass, original.record.workClass);
  assert.deepEqual(next.record.maintenance, original.record.maintenance);
  for (const key of ["id", "kind", "pageUrl", "dueAt", "weekStart", "problemKey"]) assert.deepEqual(next.record[key], original.record[key], key);
});

test("a new refresh ID cannot repeat an original same-problem delivery that is still under observation", () => {
  const original = { ...task(), id: "already-delivered-refresh", status: "observing", contentVersion: "refreshed-v2", version: 4,
    recordedAt: "2026-11-20T02:00:00Z", updatedAt: "2026-11-23T02:00:00Z" };
  assert.throws(() => save(task(), [{ kind: "task", record: original }]), { code: "refresh_problem_already_delivered" });
});

test("actual maintenance writes or failures can be journaled before the full live QA, while verified delivery cannot", () => {
  const publication = { id: "refresh-write", taskId: "refresh-original", pageUrl: "https://flatkey.ai/blog/model-pricing", contentVersion: "refreshed-v2",
    publishedAt: "2026-11-24T03:00:00Z", kind: "optimization" };
  for (const status of ["published", "failed", "unknown"]) assert.deepEqual(maintenancePublicationProblems(task(), { ...publication, status }), []);
  assert.match(maintenancePublicationProblems(task(), { ...publication, status: "verified" }).join("；"), /同版本实际上线检查/);
});

const shift = (day, offset) => new Date(Date.parse(day + "T00:00:00Z") + offset * 86400000).toISOString().slice(0, 10);
test("refresh optimization publications use their new version date for complete 7/14/28 comparisons and cannot claim new-page baseline", () => {
  const day = "2026-11-02";
  const publication = { id: "refresh-publication-v2", taskId: "refresh-original", siteDomain: "flatkey.ai", pageUrl: "https://flatkey.ai/blog/model-pricing",
    contentVersion: "refreshed-v2", publishedAt: day + "T12:00:00Z", country: "US", language: "en", kind: "optimization" };
  for (const checkpoint of [7, 14, 28]) {
    const checkedAt = shift(day, checkpoint + 2) + "T20:00:00Z";
    const reference = [{ source: "GA4", reference: "/tmp/whole-window-source.json", observedAt: checkedAt }];
    const window = offset => ({ start: shift(day, offset), end: shift(day, offset + checkpoint - 1),
      coveredDates: Array.from({ length: checkpoint }, (_, i) => shift(day, offset + i)), sessions: offset < 0 ? 10 : 20, evidence: reference, limitations: [] });
    const input = { status: "complete", publicationId: publication.id, taskId: publication.taskId, contentVersion: publication.contentVersion, site: publication.siteDomain,
      pageUrl: publication.pageUrl, country: "US", language: "en", source: "GA4", propertyId: "541304395", sourceTimezone: "America/Los_Angeles", scope: "page-session-organic-search",
      before: window(-checkpoint), after: window(1), reason: "按实际上线版本对比等长完整来源窗口", limitations: [] };
    const context = { sourceTimezone: "America/Los_Angeles", propertyId: "541304395", now: new Date(checkedAt), sessions: 20 };
    const result = prepareGrowthObservationComparison(input, publication, checkpoint, context);
    assert.deepEqual(result.issues, []); assert.equal(result.comparison.delta, 10);
    const newPage = { ...input, status: "new_page", before: { ...input.before, sessions: null, coveredDates: [], evidence: [], limitations: ["未补齐前窗"] } };
    assert.match(prepareGrowthObservationComparison(newPage, publication, checkpoint, context).issues.join("；"), /旧页优化.*不能冒充新页/);
  }
});
