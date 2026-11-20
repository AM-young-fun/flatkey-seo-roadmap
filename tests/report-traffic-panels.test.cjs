const { test } = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), Module = require("node:module"), ts = require("typescript");
const root = path.resolve(__dirname, ".."), priorLoad = Module._load;
let pageGroupProps;
Module._load = function(name, parent, ...rest) {
  if (name === "./DailySeoPageGroups") return { DailySeoPageGroups(props) { pageGroupProps = props; return null; } };
  if (name.endsWith(".module.css")) return new Proxy({}, { get: (_, key) => String(key) });
  return priorLoad.call(this, name.startsWith("@/") ? path.join(root, "src", name.slice(2)) : name, parent, ...rest);
};
for (const ext of [".ts", ".tsx"]) require.extensions[ext] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText, file);
const React = require("react"), { renderToStaticMarkup } = require("react-dom/server");
const { ReportPageGroupTraffic, ReportModuleShares } = require("../src/components/ReportTrafficPanels.tsx");
const { wholePeriodUserShare, reportModuleShareRows } = require("../src/lib/report-module-shares.ts");
const range = { start: "2026-11-12", end: "2026-11-18" }, comparisonRange = { start: "2026-11-05", end: "2026-11-11" };

test("page-group requests stay inside the exact report window", () => {
  renderToStaticMarkup(React.createElement(ReportPageGroupTraffic, { range }));
  assert.deepEqual(pageGroupProps, { start: "2026-11-12", end: "2026-11-18", category: "all" });
  pageGroupProps = undefined;
  renderToStaticMarkup(React.createElement(ReportPageGroupTraffic, { range: { start: "2026-11-19", end: "2026-11-18" } }));
  assert.equal(pageGroupProps, undefined);
});

test("whole-interval shares retain overlapping groups instead of normalizing to 100 percent", () => {
  const values = { previous: { all: 100, modelDetail: 70, prompts: 60 }, current: { all: 100, modelDetail: 80, prompts: 70 } };
  const rows = reportModuleShareRows(values);
  assert.deepEqual(rows.map(row => row.currentShare), [.8, .7]);
  assert.ok(Math.abs(rows[0].sharePoints - 10) < 1e-9);
  const html = renderToStaticMarkup(React.createElement(ReportModuleShares, { range, comparisonRange, values }));
  assert.match(html, /80\.0%/); assert.match(html, /70\.0%/);
  assert.match(html, /不相加为 100%/); assert.match(html, /2026-11-05 — 2026-11-11/);
});

test("unknowns, empty denominators and invalid subsets never produce fabricated shares", () => {
  assert.equal(wholePeriodUserShare(null, 100), null);
  assert.equal(wholePeriodUserShare(0, 0), null);
  assert.equal(wholePeriodUserShare(101, 100), null);
  assert.equal(wholePeriodUserShare(0, 100), 0);
  const html = renderToStaticMarkup(React.createElement(ReportModuleShares, { range, comparisonRange }));
  assert.match(html, /<td>—<\/td>/); assert.doesNotMatch(html, /0\.0%|NaN|Infinity/);
});
