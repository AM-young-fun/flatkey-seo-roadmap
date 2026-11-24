const assert = require("node:assert/strict"), { test } = require("node:test"), fs = require("node:fs"), path = require("node:path"), Module = require("node:module"), ts = require("typescript");
const root = path.resolve(__dirname, ".."), resolve = Module._resolveFilename;
Module._resolveFilename = function (name, parent, ...rest) { return resolve.call(this, name.startsWith("@/") ? path.join(root, "src", name.slice(2)) : name, parent, ...rest); };
require.extensions[".ts"] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, file);
const { projectHistoricalWordLanguage } = require("../src/lib/ranking-language-history.ts");
const { reviewGrowthLanguage } = require("../src/lib/growth-workspace.ts");
const { isOwnedBrandKeyword } = require("../src/lib/keyword-market-policy.ts");
const { marketTrendCount, marketTrendComparison } = require("../src/lib/ranking-trends.ts");
const lang = { US: "en", JP: "ja", BR: "pt-BR", ES: "es-ES" };
const classify = (target, country) => ({ ...reviewGrowthLanguage(target.keyword, country, lang[country], []), queryLanguage: lang[country] });
const target = (keyword, site = "flatkey.ai", id = keyword) => ({ keywordId: id, keyword, siteDomain: site, targetUrls: [`https://${site}/blog/real-page`] });
const frame = (region, targets, ranks = {}, patch = {}) => ({ region, frames: [{ targets,
  point: { date: "2026-11-05", periodKey: "2026-11-03", periodLabel: "2026年11月第1期", counts: [2, 0, 0, 0], sites: [...new Set(targets.map(t => t.siteDomain))], sources: ["dataforseo_serp"], total: targets.length, ranked: 2, pending: 0, outside: 0, captured: targets.length, checked: targets.length, periodStart: "2026-11-03", periodEnd: "2026-11-16", dataDates: ["2026-11-05T09:00:00Z"], ...patch },
  items: targets.map(t => ({ ...t, status: ranks[t.keyword] == null ? "PENDING" : "RANKED", rank: ranks[t.keyword] ?? null, url: ranks[t.keyword] == null ? null : `https://${t.siteDomain}/blog/real-page`, checkedAt: ranks[t.keyword] == null ? null : "2026-11-05T09:00:00Z", runId: "original-run", captureComplete: ranks[t.keyword] != null })),
}] });
test("English words count in US only, Japanese in Japan, and the foreign-country best rank never moves countries", () => {
  const targets = [target("gpu rental prices"), target("GPU 料金 比較")];
  const raw = [frame("US", targets, { "gpu rental prices": 39, "GPU 料金 比較": 2 }), frame("JP", targets, { "gpu rental prices": 1, "GPU 料金 比較": 19 })];
  const before = JSON.stringify(raw), result = projectHistoricalWordLanguage(raw, classify, isOwnedBrandKeyword);
  assert.equal(JSON.stringify(raw), before);
  assert.equal(result.points[0].ranked, 2);
  assert.deepEqual(result.points[0].counts, [0, 1, 1, 0]);
  assert.deepEqual(result.periods[0].words.map(word => [word.keyword, word.selected.country, word.selected.rank]), [["gpu rental prices", "US", 39], ["GPU 料金 比較", "JP", 19]]);
  assert.equal(result.periods[0].mismatchedObservationRows, 2);
  assert.equal(result.periods[0].rawSnapshotsPreserved, true);
});
test("the same normalized word across sites contributes one valid winning rank and preserves foreign observations", () => {
  const targets = [target("GPU rental prices"), target("gpu rental prices", "modelfit.cc", "another-id")];
  const raw = [frame("US", targets, { "GPU rental prices": 39, "gpu rental prices": 12 }), frame("JP", targets, { "GPU rental prices": 9, "gpu rental prices": 6 })];
  const result = projectHistoricalWordLanguage(raw, classify, isOwnedBrandKeyword);
  assert.equal(result.points[0].total, 1); assert.equal(result.points[0].ranked, 1);
  assert.equal(result.periods[0].words[0].observations.length, 4);
  assert.equal(result.periods[0].rawTargetCount, 2, "raw target identities are not multiplied by the number of countries");
  assert.equal(result.periods[0].words[0].selected.site, "modelfit.cc");
  assert.equal(result.periods[0].words[0].selected.rank, 12);
  assert.equal(result.periods[0].words[0].selected.country, "US");
  assert.equal(result.periods[0].countries.reduce((sum, country) => sum + country.count, 0), 1);
});
test("neutral model names stay pending and owned brands stay excluded without a fabricated American language", () => {
  const targets = [target("nvidia b300"), target("flatkey pricing")];
  const result = projectHistoricalWordLanguage([frame("US", targets, { "nvidia b300": 2, "flatkey pricing": 1 })], classify, isOwnedBrandKeyword);
  assert.equal(result.points[0].total, 1); assert.equal(result.points[0].ranked, 0); assert.equal(result.points[0].pending, 1);
  assert.equal(result.periods[0].unknownLanguageWords, 1); assert.equal(result.periods[0].excludedBrandWords, 1);
  assert.equal(result.periods[0].words.find(word => word.keyword === "nvidia b300").selected, null);
  assert.equal(marketTrendCount(result.points[0]), 0, "a real captured but unresolved language period remains visible");
});
test("an English result found only in Japan is preserved as a mismatch, not a zero American rank", () => {
  const targets = [target("gpu rental prices")];
  const result = projectHistoricalWordLanguage([frame("JP", targets, { "gpu rental prices": 2 })], classify, isOwnedBrandKeyword);
  assert.equal(result.points[0].ranked, 0); assert.equal(result.points[0].pending, 1);
  assert.equal(result.periods[0].words[0].observations[0].rank, 2);
  assert.equal(result.periods[0].words[0].selected, null);
});
test("period identity, sample scope and missing captures remain separate; corrective projection never creates a comparable trend", () => {
  const targets = [target("gpu rental prices")];
  const a = frame("US", targets, { "gpu rental prices": 39 }, { periodKey: "2026-10-2", periodLabel: "2026年10月第1期", sampleOnly: true });
  const b = frame("US", targets, {}, { periodKey: "2026-10-20", periodLabel: "2026年10月第2期", dataDates: [] });
  a.frames.push(...b.frames);
  const result = projectHistoricalWordLanguage([a], classify, isOwnedBrandKeyword);
  assert.equal(result.points.length, 2); assert.equal(result.points[0].sampleOnly, true);
  assert.equal(result.points[1].pending, 1); assert.equal(result.points[1].outside, 0);
  assert.equal(marketTrendCount(result.points[1]), null);
  assert.equal(marketTrendComparison(result.points[0], result.points[1]), null);
});
test("country allocations and rank buckets sum exactly to the unique ranked words", () => {
  const targets = [target("gpu rental prices"), target("GPU 料金 比較"), target("aluguel gpu"), target("precio gpu alquiler")];
  const raw = Object.keys(lang).map(region => frame(region, targets, Object.fromEntries(targets.map((t, index) => [t.keyword, [8, 28, 48, 88][index]]))));
  const result = projectHistoricalWordLanguage(raw, classify, isOwnedBrandKeyword), point = result.points[0];
  assert.equal(point.ranked, 4); assert.deepEqual(point.counts, [1, 1, 1, 1]);
  assert.equal(result.periods[0].countries.reduce((sum, row) => sum + row.count, 0), point.ranked);
  assert.equal(point.counts.reduce((sum, n) => sum + n, 0), point.ranked);
  assert.equal(result.periods[0].words.flatMap(word => word.observations).length, 16);
  for (const market of result.markets) {
    assert.deepEqual(market.points[0].languageProjection.countryCounts, [{ country: market.region, count: 1 }]);
    assert.equal(market.points[0].counts.reduce((sum, n) => sum + n, 0), 1);
  }
});
