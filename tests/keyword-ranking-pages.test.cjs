const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const ts = require("typescript");
require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, filename);
const { keywordRankingPages } = require("../src/lib/keyword-ranking-pages.ts");
const capture = "2026-10-16T08:00:00.000Z";
const summary = { source: "dataforseo_labs", rank: 8, url: "https://flatkey.ai/models/model", checkedAt: capture,
  dataDate: "2026-10-15T10:00:00.000Z", dataUpdatedAt: "2026-10-15T10:00:00.000Z" };
const page = (url, rank, overrides = {}) => ({ url, rank, checkedAt: capture, dataDate: "2026-10-15T10:00:00.000Z", dataUpdatedAt: "2026-10-15T10:00:00.000Z", ...overrides });
const report = (pages, overrides = {}) => ({ source: "dataforseo_labs", scope: "query", checkedAt: capture, pages, ...overrides });

test("one keyword retains every ranked page with its own rank and source timestamp", () => {
  const model = page(summary.url, 8);
  const blog = page("https://flatkey.ai/blog/model", 3, { dataDate: "2026-10-12T09:00:00.000Z", dataUpdatedAt: "2026-10-12T09:00:00.000Z" });
  const unknownDate = page("https://flatkey.ai/zh/blog/model", 45, { dataDate: null, dataUpdatedAt: null });
  const result = keywordRankingPages(summary, [report([model, blog, unknownDate])], "flatkey.ai");
  assert.equal(result.length, 3);
  assert.deepEqual(result.map(p => [p.url, p.rank, p.dataUpdatedAt]), [[blog.url, 3, blog.dataUpdatedAt], [model.url, 8, model.dataUpdatedAt], [unknownDate.url, 45, null]]);
  assert.equal(result[2].checkedAt, capture, "unknown source date stays distinct from the capture time");
  assert.equal(summary.rank, 8, "displaying older page ranks does not rewrite the keyword summary to an older better rank");
});

test("latest no-data capture cannot resurrect older or historical page ranks", () => {
  const old = page(summary.url, 1, { checkedAt: "2026-10-01T08:00:00.000Z" });
  const noData = { ...summary, rank: null, url: null };
  assert.deepEqual(keywordRankingPages(noData, [report([old], { checkedAt: old.checkedAt }), report([page(summary.url, 2)], { source: "gsc" }), report([old])], "flatkey.ai"), []);
  assert.deepEqual(keywordRankingPages(null, [report([page(summary.url, 2)])], "flatkey.ai"), []);
});

test("duplicate page rows choose that page's newer source observation without distributing the query rank", () => {
  const url = "https://flatkey.ai/blog/model";
  const result = keywordRankingPages({ ...summary, url: null, rank: null }, [report([
    page(url, 1, { dataUpdatedAt: "2026-10-10T00:00:00Z" }),
    page(`${url}/#details`, 30), page(url, 12),
    page("https://flatkey.ai.attacker.example/page", 1), page("https://flatkey.ai/invalid", 1.5),
  ])], "flatkey.ai");
  assert.equal(result.length, 1); assert.equal(result[0].rank, 12); assert.equal(result[0].url, url);
});

test("explicit query URL can supply only its own page record when independent page detail is unavailable", () => {
  const result = keywordRankingPages(summary, [], "flatkey.ai");
  assert.equal(result.length, 1); assert.equal(result[0].url, summary.url); assert.equal(result[0].rank, 8);
  assert.equal(result[0].dataUpdatedAt, summary.dataUpdatedAt);
  assert.deepEqual(keywordRankingPages({ ...summary, source: "gsc" }, [], "flatkey.ai"), []);
});
