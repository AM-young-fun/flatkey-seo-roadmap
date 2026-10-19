const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const ts = require("typescript");
require.extensions[".ts"] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, file);
const { weeklyFunnelMetrics } = require("../src/lib/weekly-funnel-metrics.ts");
const steps = (visitors, registrations) => [
  { name: "首次访问", users: visitors, completionRate: null },
  { name: "注册成功", users: registrations, completionRate: null },
];

test("conversion uses registrations from the same visitor cohort, not all-site totals", () => {
  const result = weeklyFunnelMetrics({ current: steps(1996, 205), previous: steps(1587, 251) });
  assert.equal(result.current.rate, 205 / 1996);
  assert.equal(result.previous.rate, 251 / 1587);
  assert.notEqual(result.current.rate, 222 / 2007);
  assert.equal(result.ratePoints.toFixed(2), "-5.55");
  assert.equal((result.change * 100).toFixed(1), "-35.1");
});
test("missing or incomparable funnel evidence does not fall back to total registrations", () => {
  assert.equal(weeklyFunnelMetrics(undefined), null);
  assert.equal(weeklyFunnelMetrics({ current: steps(10, 2), previous: [] }), null);
  const previous = steps(10, 2); previous[0].name = "其他入口";
  assert.equal(weeklyFunnelMetrics({ current: steps(10, 2), previous }), null);
  assert.equal(weeklyFunnelMetrics({ current: steps(10, 12), previous: steps(10, 2) }), null);
});
test("a zero denominator stays unknown; zero registrations remain a real zero", () => {
  const empty = weeklyFunnelMetrics({ current: steps(0, 0), previous: steps(10, 2) });
  assert.equal(empty.current.rate, null); assert.equal(empty.change, null); assert.equal(empty.ratePoints, null);
  const zero = weeklyFunnelMetrics({ current: steps(10, 0), previous: steps(10, 2) });
  assert.equal(zero.current.rate, 0); assert.equal(zero.change, -1);
});
