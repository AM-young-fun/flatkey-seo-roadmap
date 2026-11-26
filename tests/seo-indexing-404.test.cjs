const assert = require("node:assert/strict");
const { test } = require("node:test");
const { readFileSync } = require("node:fs");
const ts = require("typescript");
const source = readFileSync(require.resolve("../src/lib/seo-indexing-404.ts"), "utf8");
const moduleExports = {};
new Function("exports", ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText)(moduleExports);
const { indexing404History, indexing404Trend, isIndexing404Day } = moduleExports;

function run(date, metric, extra = {}) {
  const observedAt = `${date}T02:30:00.000Z`;
  return { id: `gsc-indexing:flatkey.ai:all-known:${date}`, stage: "GSC_INDEXING_DAILY", startedAt: observedAt,
    sourceDates: { gsc_report: "2026-11-16" }, evidence: [{ label: metric, observedAt }], ...extra };
}

test("projects historical 404 evidence without merging observations of the same Google report or inventing zeros", () => {
  const historical = run("2026-11-23", "未找到 (404)：3,280；较上次：0；数据日期：2026-11-16；验证：失败");
  const current = run("2026-11-25", "未找到 (404)：3,280；较上次：0；数据日期：2026-11-16；验证：失败");
  const missing = run("2026-11-26", "未找到 (404)：未取得；较上次：首次基线或缺少可比值");
  const realZero = run("2026-11-22", "未找到 (404)：0；较上次：-1；验证：通过");
  const otherScope = { ...current, id: "gsc-indexing:flatkey.ai:main-sitemap:2026-11-25" };
  const rows = indexing404History([otherScope, historical, current, missing, realZero]);
  assert.deepEqual(rows.map(row => [row.collectedDate, row.total, row.change]), [["2026-11-26", null, null], ["2026-11-25", 3280, 0], ["2026-11-23", 3280, 0], ["2026-11-22", 0, -1]]);
  assert.equal(rows[1].reportDate, "2026-11-16");
  assert.equal(rows[1].validation, "失败");
});

test("404 trend ends on the selected report day and retains gaps and confirmed zeros", () => {
  const rows = indexing404History([
    run("2026-11-27", "未找到 (404)：3,301"),
    run("2026-11-25", "未找到 (404)：未取得"),
    run("2026-11-23", "未找到 (404)：3,280"),
    run("2026-11-22", "未找到 (404)：0"),
  ], "2026-11-26");
  assert.ok(rows.every(row => row.collectedDate <= "2026-11-26"));
  const points = indexing404Trend(rows, "2026-11-26");
  assert.equal(points.length, 30);
  assert.deepEqual(points.slice(-5), [
    { label: "2026-11-22", value: 0 },
    { label: "2026-11-23", value: 3280 },
    { label: "2026-11-24", value: null },
    { label: "2026-11-25", value: null },
    { label: "2026-11-26", value: null },
  ]);
  assert.equal(indexing404Trend(rows).at(-1).label, "2026-11-25");
  assert.equal(isIndexing404Day("2026-02-30"), false);
});
