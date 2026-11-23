const assert = require("node:assert/strict"), { test } = require("node:test");
const fs = require("node:fs"), Module = require("node:module"), ts = require("typescript");
const originalLoad = Module._load;
let response = { data: null };
let expectedUrl = "/api/seo/growth";
Module._load = function(name, ...rest) {
  if (name === "./useSeoAnalytics") return { useSeoRead: url => { assert.equal(url, expectedUrl); return response; } };
  if (name === "./AppLink") return { __esModule: true, default: ({ children, ...props }) => React.createElement("a", props, children) };
  if (name.endsWith(".module.css")) return new Proxy({}, { get: (_, property) => property === "__esModule" ? false : String(property) });
  return originalLoad.call(this, name, ...rest);
};
require.extensions[".tsx"] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText, file);
const React = require("react"), { renderToStaticMarkup } = require("react-dom/server");
const { GrowthHistoricalReview } = require("../src/components/GrowthHistoricalReview.tsx");
const { GrowthTopicDirections } = require("../src/components/GrowthTopicDirections.tsx");

test("historical language review exposes original scope, denominator and unknowns without rewriting raw periods", () => {
  expectedUrl = "/api/seo/growth";
  response = { data: { reconciliation: { historicalLanguageReview: { rows: 1499, matched: 208, mismatched: 39, unknown: 1252, reason: "原历史期次及分母不同", periods: [{ id: "2026-11-2", label: "11月第2期", scope: "DIAGNOSTIC", originalTargetCount: 1525, originalQueryCount: 1, checkedQueries: 1, matchedRankedTargets: 0, unknownLanguageTargets: 1, mismatchedLanguageTargets: 0, cohortHash: "original-cohort", rawSnapshotPreserved: true, comparable: false }] } } } };
  const html = renderToStaticMarkup(React.createElement(GrowthHistoricalReview));
  assert.match(html, /DIAGNOSTIC/); assert.match(html, /1525 \/ 1/); assert.match(html, /待核 1252/);
  assert.match(html, /1 \/ 0/); assert.match(html, /original-cohort/); assert.match(html, /不可比；原快照保留/);
  assert.doesNotMatch(html, /周环比|付费|开启采集/);
});

test("topic direction uses the same stored strategy scope, real drivers and exact human-review deep link", () => {
  expectedUrl = "/api/seo/growth/strategy";
  const direction = { id: "gpu/方向", title: "GPU比较方向", revision: 3, updatedAt: "2026-11-23T00:00:00Z", scope: [{ site: "flatkey.ai", topicId: "gpu", country: "US", language: "en" }], decision: null, hypothesis: "比较页更能承接价格需求", proposedAction: "补充成本实验", taskIds: ["existing-task"], experiment: { primaryMetric: "自然搜索会话", successCondition: "同窗提升", adjustmentCondition: "下降则补原页", reviewAt: "2026-12-01T00:00:00Z" }, drivers: [{ topicId: "gpu", title: "真实比较文章", url: "https://flatkey.ai/blog/gpu-compare", country: "US", language: "en", source: "GA4", metric: "sessions", previous: 10, current: 20, explanation: "旧页优化后的相关增长", limitation: "尚不能证明因果", nextAction: "核验转化", taskIds: ["existing-task"] }, { topicId: "other", title: "其他话题", country: "US", language: "en", taskIds: [] }] };
  response = { data: { state: { directions: [direction, { ...direction, id: "excluded", title: "其他站方向", scope: [{ site: "rackrate.org", topicId: "gpu", country: "US", language: "en" }] }] } } };
  const html = renderToStaticMarkup(React.createElement(GrowthTopicDirections, { site: "flatkey.ai", topicId: "gpu", country: "US", language: "en" }));
  assert.match(html, /10 → 20（\+10）/); assert.match(html, /尚不能证明因果/); assert.match(html, /核验转化/);
  assert.match(html, /href="https:\/\/flatkey.ai\/blog\/gpu-compare"/); assert.match(html, /href="\/work\/existing-task"/);
  assert.match(html, /href="\/#growth-direction-gpu%2F%E6%96%B9%E5%90%91"/); assert.match(html, /v3 完整方向/);
  assert.doesNotMatch(html, /其他站方向|其他话题|批准当前范围|付费/);
});
