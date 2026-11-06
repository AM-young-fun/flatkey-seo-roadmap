const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const ts = require("typescript");
require.extensions[".ts"] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, file);
const { buildKeywordOpportunities, combineKeywordMarkets, sortKeywordOpportunities, estimateMonthlyClicks, opportunityReason, planKey, flatkeyPage, optimizationWindow } = require("../src/lib/keyword-opportunities.ts");
const keyword = { text: "Model API", siteDomain: "flatkey.ai", marketVolumes: { US: 1000, JP: 30 }, latestRanks: { US: { rank: 14, rankStatus: "ranked", source: "dataforseo_serp" } } };

test("deduplicates keyword demand within a country even with several mapped target pages", () => {
 const rows = buildKeywordOpportunities([keyword, { ...keyword, text: " model   api " }, { ...keyword, siteDomain: "other.ai" }], [{ keyword: "MODEL API", targetUrls: ["https://flatkey.ai/models", "https://flatkey.ai/blog/models", "javascript:alert(1)"] }], "US");
 assert.equal(rows.length, 1); assert.equal(rows[0].volume, 1000); assert.equal(rows[0].urls.length, 2); assert.equal(rows[0].rank, 14);
 assert.match(opportunityReason(rows[0]), /接近首页/);
 assert.equal(buildKeywordOpportunities([keyword], [], "JP")[0].volume, 30);
});
test("missing and conflicting volume are not converted into zero or a global volume", () => {
 assert.equal(buildKeywordOpportunities([{ ...keyword, marketVolumes: { US: null }, volume: 2000 }], [], "US")[0].volume, null);
 assert.equal(buildKeywordOpportunities([keyword, { ...keyword, marketVolumes: { US: 900 } }], [], "US")[0].volume, null);
 assert.equal(buildKeywordOpportunities([{ ...keyword, marketVolumes: { US: 0 } }], [], "US")[0].volume, 0);
});
test("a partial SERP miss or changed query cannot become a claimed numeric rank", () => {
 const row = buildKeywordOpportunities([{ ...keyword, latestRanks: { US: { rank: 14, rankStatus: "query_changed", source: "dataforseo_serp" } } }], [], "US")[0];
 assert.equal(row.rank, null); assert.match(opportunityReason(row), /待核查/);
});
test("all-country ranks deduplicate keywords and retain the markets tied for best rank", () => {
 const ranked = { rank: 3, rankStatus: "ranked", source: "dataforseo_serp" };
 const inputs = [{ ...keyword, latestRanks: { ...keyword.latestRanks, JP: ranked, BR: ranked } }, { text: "Unmeasured", siteDomain: "flatkey.ai" }];
 const markets = new Map(["US", "JP", "ES", "BR"].map(market => [market, buildKeywordOpportunities(inputs, [], market)]));
 const rows = combineKeywordMarkets(markets);
 assert.equal(rows.length, 2);
 assert.equal(rows[0].rank, 3);
 assert.deepEqual(rows[0].bestMarkets, ["JP", "BR"]);
 assert.equal(rows[0].volume, 1030);
 assert.equal(rows[1].rank, null);
 assert.equal(rows[1].volume, null);
 assert.equal(markets.get("US")[0].rank, 14);
});
test("monthly scenarios require a deliberate valid CTR and preserve zero", () => {
 assert.equal(estimateMonthlyClicks(1000, ""), null); assert.equal(estimateMonthlyClicks(1000, "  "), null); assert.equal(estimateMonthlyClicks(null, "10"), null);
 assert.equal(estimateMonthlyClicks(1000, "3"), 30); assert.equal(estimateMonthlyClicks(1000, "0"), 0); assert.equal(estimateMonthlyClicks(1000, "101"), null); assert.equal(estimateMonthlyClicks(1000, "-1"), null); assert.equal(estimateMonthlyClicks(1000, "no"), null);
});
test("plans isolate markets, normalized keywords, and target pages; URLs stay on Flatkey", () => {
 assert.equal(planKey("US", "Model API", "https://flatkey.ai/models"), planKey("US", " model   API ", "https://flatkey.ai/models"));
 assert.notEqual(planKey("US", "Model API", "https://flatkey.ai/models"), planKey("JP", "Model API", "https://flatkey.ai/models"));
 assert.equal(flatkeyPage("https://flatkey.ai.evil.example/models"), null); assert.equal(flatkeyPage("https://user:password@flatkey.ai/models"), null);
});

test("optimization follow-up excludes action day and unfinished days and compares equal duration", () => {
 assert.deepEqual(optimizationWindow("2026-10-28", 7, "2026-11-04"), { start: "2026-10-29", end: "2026-11-03", compareStart: "2026-10-22", compareEnd: "2026-10-27", days: 6 });
 assert.equal(optimizationWindow("2026-11-04", 7, "2026-11-04"), null);
 assert.equal(optimizationWindow("2026-02-30", 7, "2026-11-04"), null);
 assert.deepEqual(optimizationWindow("2026-10-01", 7, "2026-11-04"), { start: "2026-10-02", end: "2026-10-08", compareStart: "2026-09-24", compareEnd: "2026-09-30", days: 7 });
});

test("opportunity ordering prioritizes mapped rank bands before large unranked terms without inventing a score", () => {
 const make = (keyword, rank, volume, mapped = true) => ({ key: keyword, keyword, rank, volume, rankState: rank == null ? "missing" : "ranked", urls: mapped ? ["https://flatkey.ai/models"] : [] });
 const rows = [make("huge", null, 1000000), make("leader", 2, 900), make("second-page", 15, 100), make("farther", 28, 2000), make("near", 4, 300), make("unmapped", 4, 900000, false)];
 assert.deepEqual(sortKeywordOpportunities(rows).map(r => r.keyword), ["near", "second-page", "farther", "leader", "huge", "unmapped"]);
 assert.equal(sortKeywordOpportunities(rows, "volume")[0].keyword, "huge");
 assert.equal(rows[0].keyword, "huge");
});
