const assert = require("node:assert/strict"), { test } = require("node:test"), fs = require("node:fs"), path = require("node:path"), Module = require("node:module"), ts = require("typescript");
const root = path.resolve(__dirname, ".."), resolve = Module._resolveFilename;
Module._resolveFilename = function (name, parent, ...rest) { return resolve.call(this, name.startsWith("@/") ? path.join(root, "src", name.slice(2)) : name, parent, ...rest); };
require.extensions[".ts"] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, file);
const { workflowOptimizationComparisonSchema, shiftWorkflowDay } = require("../src/lib/seo-workflow.ts");
const { optimizationComparisonProblems } = require("../src/lib/seo-workflow-comparison.ts");
const evidence = [{ label: "GSC 来源", artifact: "gsc-export/2027-01-10.json", observedAt: "2027-01-10T12:00:00Z" }];
const metrics = { clicks: 5, impressions: 100, ctr: .05, averagePosition: 12, targetKeywordAveragePosition: 10, organicVisits: null, registrations: null, activation: null, payment: null };
const days = (start, length) => Array.from({ length }, (_, index) => shiftWorkflowDay(start, index));
function comparison(windowDays = 7) {
  const beforeStart = shiftWorkflowDay("2026-11-10", -windowDays), afterEnd = shiftWorkflowDay("2026-11-10", windowDays);
  return { changeId: "change-1", source: "GSC", timezone: "America/Los_Angeles", country: "US", device: "all", targetKeyword: "model api", pageUrl: "https://flatkey.ai/model-api", before: { periodStart: beforeStart, periodEnd: "2026-11-09", actualDays: days(beforeStart, windowDays), sourceDate: "2026-11-09", dataStatus: "complete", metrics: { ...metrics } }, after: { periodStart: "2026-11-11", periodEnd: afterEnd, actualDays: days("2026-11-11", windowDays), sourceDate: afterEnd, dataStatus: "complete", metrics: { ...metrics, clicks: 8, ctr: .08 } }, status: "comparable", reason: null, evidence };
}
function optimization(value = comparison(), windowDays = "7") { return { pageUrl: value.pageUrl, country: "US", keyword: "model api", changes: [{ id: "change-1" }], observations: [{ windowDays, checkedAt: "2027-01-10T12:00:00Z", status: "improved", comparableDays: Number(windowDays), note: "同范围比较", evidence, comparison: value }] }; }
const publicationTimes = new Map([["change-1", "2026-11-10T12:00:00Z"]]);

test("7/28/56 day comparisons preserve actual source dates and exclude publication day", () => {
  for (const windowDays of [7, 28, 56]) {
    const value = comparison(windowDays);
    assert.equal(workflowOptimizationComparisonSchema.safeParse(value).success, true);
    assert.deepEqual(optimizationComparisonProblems(optimization(value, String(windowDays)), publicationTimes), []);
  }
  const value = comparison(); value.after.periodStart = "2026-11-10";
  assert.match(optimizationComparisonProblems(optimization(value), publicationTimes).join(), /排除上线当天/);
});
test("delayed source days are partial and never silently padded with zero", () => {
  const value = comparison(); value.after.actualDays = value.after.actualDays.slice(0, 4); value.after.sourceDate = value.after.actualDays.at(-1);
  assert.equal(workflowOptimizationComparisonSchema.safeParse(value).success, false);
  value.after.dataStatus = "partial"; value.status = "partial"; value.reason = "GSC 最新三天未出齐";
  assert.equal(workflowOptimizationComparisonSchema.safeParse(value).success, true);
  const row = optimization(value); row.observations[0].comparableDays = 4;
  assert.match(optimizationComparisonProblems(row, publicationTimes).join(), /不能宣称/);
  row.observations[0].status = "insufficient_data";
  assert.deepEqual(optimizationComparisonProblems(row, publicationTimes), []);
  value.after.dataStatus = "not_connected";
  assert.equal(workflowOptimizationComparisonSchema.safeParse(value).success, false);
});
test("page country keyword source and timezone cannot be mixed", () => {
  for (const patch of [{ pageUrl: "https://flatkey.ai/other" }, { country: "BR" }, { targetKeyword: "different term" }]) {
    const row = optimization(); Object.assign(row.observations[0].comparison, patch);
    assert.match(optimizationComparisonProblems(row, publicationTimes).join(), /必须与优化一致/);
  }
  assert.equal(workflowOptimizationComparisonSchema.safeParse({ ...comparison(), timezone: "Asia/Shanghai" }).success, false);
  const mixed = comparison(); mixed.after.metrics.organicVisits = 10;
  assert.equal(workflowOptimizationComparisonSchema.safeParse(mixed).success, false);
  const impossible = comparison(); impossible.after.metrics.ctr = .99;
  assert.equal(workflowOptimizationComparisonSchema.safeParse(impossible).success, false);
});
test("unverified publication or future data cannot support measured improvement", () => {
  assert.match(optimizationComparisonProblems(optimization(), new Map()).join(), /已验收上线/);
  const value = optimization(); value.observations[0].checkedAt = "2026-11-12T12:00:00Z";
  assert.match(optimizationComparisonProblems(value, publicationTimes).join(), /尚未产生/);
});
test("old note-only history remains readable while new unsupported improvement fails", () => {
  const value = optimization(); delete value.observations[0].comparison;
  assert.match(optimizationComparisonProblems(value, publicationTimes).join(), /结构化/);
  assert.deepEqual(optimizationComparisonProblems(value, publicationTimes, value), []);
  value.observations[0].status = "observing";
  assert.deepEqual(optimizationComparisonProblems(value, publicationTimes), []);
});
test("multiple changes in one window require an attribution caveat", () => {
  const value = optimization(); value.changes.push({ id: "change-2" });
  const times = new Map([...publicationTimes, ["change-2", "2026-11-13T12:00:00Z"]]);
  assert.match(optimizationComparisonProblems(value, times).join(), /不能单独归因/);
  value.observations[0].comparison.reason = "期间另有内链变更，不能单独归因标题调整";
  assert.deepEqual(optimizationComparisonProblems(value, times), []);
});
