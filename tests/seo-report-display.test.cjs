const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"), ts = require("typescript");
require.extensions[".ts"] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, file);
const { collectionDateRange, seoToday } = require("../src/lib/seo-date-range.ts");
const { reportCountryShares } = require("../src/lib/seo-report-comparisons.ts");
const { approvalPreview } = require("../src/lib/seo-approval-display.ts");

test("collection is filed under Beijing today and closed source days retain their dates", () => {
  const now = new Date("2026-11-13T02:24:00Z");
  assert.equal(seoToday(now), "2026-11-13");
  assert.equal(collectionDateRange(14, now, "Asia/Shanghai").end, "2026-11-12");
  assert.equal(collectionDateRange(14, now).end, "2026-11-11");
  assert.equal(collectionDateRange(14, new Date("2026-11-13T08:01:00Z")).end, "2026-11-12");
});

test("country shares require four values with the same periods", () => {
  const rows = ["US", "JP", "BR", "ES"].map((name, index) => ({
    name, metrics: [{ label: "曝光", current: (index + 1) * 10, period: "same" }],
  }));
  assert.deepEqual(reportCountryShares(rows, "曝光").map(row => row.share), [.1, .2, .3, .4]);
  rows[1].metrics[0].period = "another day";
  assert.equal(reportCountryShares(rows, "曝光"), null);
});

test("an approval only links a recorded preview for its exact version", () => {
  const item = { pageUrl: "https://flatkey.ai/llm-cost-calculator", contentVersion: "current" };
  assert.equal(approvalPreview(item).url, null);
  const previewUrl = "https://staging-website.flatkey.ai/llm-cost-calculator";
  assert.equal(approvalPreview({ ...item, previewUrl, previewContentVersion: "old" }).url, null);
  assert.equal(approvalPreview({ ...item, previewUrl, previewContentVersion: "current" }).url, previewUrl);
});
