const assert = require("node:assert/strict"), { test } = require("node:test");
const fs = require("node:fs"), Module = require("node:module"), ts = require("typescript");
const originalLoad = Module._load;
Module._load = function(name, ...rest) {
  if (name.endsWith(".module.css")) return new Proxy({}, { get: (_, property) => property === "__esModule" ? false : String(property) });
  return originalLoad.call(this, name, ...rest);
};
require.extensions[".tsx"] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText, file);
const React = require("react"), { renderToStaticMarkup } = require("react-dom/server");
const { GrowthProgressViews } = require("../src/components/GrowthProgressViews.tsx");
const cohort = (id, kind, patch = {}) => ({ id, kind, label: id, deadline: "2027-02-05", targetCount: 100, rankedCount: 60, top50Count: 48, verifiedCount: 100, coverage: .6, quality: .8, coverageRequired: 60, coverageGap: 0, qualityRequired: 48, qualityGap: 0, latestRankAt: "2026-11-23T00:00:00Z", complete: true, ...patch });
const render = props => renderToStaticMarkup(React.createElement(GrowthProgressViews, props));

test("frozen quarter does not use new-batch or platform denominators", () => {
  const html = render({ cohorts: [cohort("冻结100", "quarter"), cohort("新增20", "weekly", { targetCount: 20 }), cohort("平台120", "platform", { targetCount: 120 })] });
  assert.match(html, /冻结100/); assert.match(html, /60 \/ 100/); assert.match(html, /已达标/);
  assert.doesNotMatch(html, /新增20|平台120/);
});

test("each weekly batch retains its own deadline and 60/80 progress", () => {
  const html = render({ initialView: "weekly", cohorts: [cohort("批次A", "weekly", { deadline: "2026-12-20", complete: false }), cohort("批次B", "weekly", { deadline: "2027-01-10" })] });
  assert.match(html, /批次A/); assert.match(html, /2026-12-20/); assert.match(html, /批次B/); assert.match(html, /2027-01-10/);
  assert.match(html, /目标60%/); assert.match(html, /目标80%/); assert.match(html, /证据未齐/);
});

test("zero ranked denominator cannot show achieved; unknown targets stay N and cannot count R", () => {
  const html = render({ initialView: "platform", cohorts: [cohort("平台", "platform", { complete: false, rankedCount: 0, top50Count: 0, coverage: 0, quality: null, qualityGap: null })] });
  assert.match(html, /暂无可计算排名/); assert.match(html, /未知、缺采目标保留在分母且不计R/); assert.doesNotMatch(html, /已达标/);
  assert.match(render({ cohorts: [] }), /季度基线待核定/);
  assert.match(render({}), /历史快照尚未保存/);
});

test("versioned stable N can meet evidenced 60/80 goals with incomplete collection, while legacy snapshots retain their old gate", () => {
  const current = cohort("稳定100", "quarter", { complete: false, verifiedCount: 60, identityCompleteCount: 60, identityPendingCount: 40 });
  const html = render({ cohorts: [current] });
  assert.match(html, /60 \/ 100/); assert.match(html, /身份待核 40/); assert.match(html, /已达标/);
  assert.match(html, /证据覆盖另行提示/);
  const legacy = render({ cohorts: [cohort("旧快照", "quarter", { complete: false, verifiedCount: 60 })] });
  assert.match(legacy, /证据未齐/); assert.doesNotMatch(legacy, /已达标/);
});
