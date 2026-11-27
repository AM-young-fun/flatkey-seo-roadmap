const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const ts = require("typescript");
require.extensions[".ts"] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, "utf8"),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, file);
const { summarizeWeeklyKeywordCatalog, weeklyKeywordCatalogLine } = require("../src/lib/seo-weekly-ranking-summary.ts");

test("weekly coverage uses the whole keyword catalog and matches proven ranks to each original identity", () => {
  const catalog = new Map([
    ["same word", { countries: ["US", "JP"] }],
    ["out", { countries: ["US"] }],
    ["untested market", { countries: ["US", "BR"] }],
    ["future keyword", { countries: ["ES"] }],
    ["unassigned", { countries: [] }],
  ]);
  const target = (keyword, country, language = "en", site = "flatkey.ai") => ({ keyword, site, country, language });
  const us = target("Same Word", "US"), jp = target("same word", "JP", "ja", "modelfit.cc");
  const out = target("out", "US"), partial = target("untested market", "US");
  const event = (identity, rank, checkedAt = "2026-11-22T08:00:00Z") => ({ ...identity, rank, checkedAt });
  const result = summarizeWeeklyKeywordCatalog(catalog, [us, jp, out, partial, target("unassigned", null, null)], [
    event(us, 6), event(jp, 3), event(out, 88), event(out, null, "2026-11-23T08:00:00Z"),
    event(partial, null), event(target("future keyword", "ES", "en", "rackrate.org"), 1),
  ]);
  assert.deepEqual([result.total, result.ranked, result.verifiedOutside, result.unresolved], [5, 1, 1, 3]);
  assert.equal(result.scope, "all-keywords");
  assert.equal(result.bands[0].count, 1);
  assert.equal(result.bands[1].count, 0);
  assert.deepEqual(result.countries.find(row => row.country === "US"), { country: "US", target: 3, ranked: 1 });
  assert.deepEqual(result.countries.find(row => row.country === "JP"), { country: "JP", target: 1, ranked: 1 });
  assert.deepEqual(result.countries.find(row => row.country === "unknown"), { country: "unknown", target: 1, ranked: 0 });
  assert.match(weeklyKeywordCatalogLine(result), /全部关键词 5 词，本期确认前 100 1 词（20\.0%）/);
  assert.equal(summarizeWeeklyKeywordCatalog(catalog, [out], []), undefined);
});
