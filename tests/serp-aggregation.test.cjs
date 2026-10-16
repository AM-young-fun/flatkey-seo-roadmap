const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");
const root = path.resolve(__dirname, "..");
const resolve = Module._resolveFilename;
Module._resolveFilename = function (name, parent, ...rest) {
  return resolve.call(this, name.startsWith("@/") ? path.join(root, "src", name.slice(2)) : name, parent, ...rest);
};
require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText, filename);
const { aggregateSerpRegionResults, buildSerpKeywordResults } = require("../src/lib/serp-results.ts");
const regions = ["US", "JP", "ES", "BR"];
const target = (keywordId, keyword = keywordId, siteDomain = "flatkey.ai") => ({ keywordId, keyword, siteDomain, targetUrls: [`https://${siteDomain}/models/${keywordId}`] });
const observation = (target, status = "PENDING", rank = null, extra = {}) => ({ ...buildSerpKeywordResults([target], [])[0], status, rank,
  captureComplete: ["RANKED", "OUTSIDE_TOP100", "NOT_FOUND_CAPTURE", "QUERY_CHANGED"].includes(status),
  checkedAt: status === "PENDING" ? null : "2026-10-16T03:00:00Z", url: rank ? target.targetUrls[0] : null,
  pages: rank ? [{ url: target.targetUrls[0], title: "Actual result", rankGroup: rank, rankAbsolute: rank + 2 }] : [], ...extra });

test("all-country totals and each country's ranking counts deduplicate the same word across sites", () => {
  const flat = target("flat", " ＦＯＯ   API "), rack = target("rack", "foo api", "rackrate.org"), bar = target("bar", "bar api");
  const all = [flat, rack, bar], records = [
    { region: "US", items: [observation(flat, "RANKED", 1, { monitoringEligible: true }), observation(rack, "RANKED", 2), observation(bar, "RANKED", 31)] },
    { region: "JP", items: [observation(flat), observation(rack, "RANKED", 11), observation(bar)] },
    { region: "ES", items: all.map(row => observation(row)) },
    { region: "BR", items: [observation(flat), observation(rack), observation(bar, "RANKED", 100)] },
  ];
  const before = structuredClone(records), result = aggregateSerpRegionResults(records, all);
  assert.deepEqual([result.summary.total, result.summary.rankedInAnyRegion, result.summary.rankedRecords], [2, 2, 4]);
  assert.deepEqual(result.summary.buckets.map(bucket => bucket.count), [1, 0, 1, 0]);
  assert.deepEqual(result.countries.map(country => country.rankedCount), [2, 1, 0, 1]);
  assert.deepEqual(result.countries.map(country => country.targetSharePercent), [100, 50, 0, 50]);
  assert.deepEqual(result.countries.map(country => country.rankingRecordSharePercent), [50, 25, 0, 25]);
  assert.deepEqual(result.monitoring, { allTargetCount: 2, eligibleTargetCount: 1, heldTargetCount: 1, siteTargetCount: 3 });
  assert.deepEqual(records, before, "display aggregation must not mutate the frozen site targets or country evidence");
});

test("a word is globally outside the top100 only when every site member in every country was checked completely", () => {
  const flat = target("flat", "shared api"), rack = target("rack", "shared api", "rackrate.org"), all = [flat, rack];
  const records = regions.map(region => ({ region, items: [observation(flat, "OUTSIDE_TOP100"), observation(rack, region === "JP" ? "PENDING" : "OUTSIDE_TOP100")] }));
  let result = aggregateSerpRegionResults(records, all);
  assert.equal(result.items[0].status, "NOT_FOUND_CAPTURE"); assert.equal(result.summary.outside, 0);
  assert.equal(result.countries.find(country => country.region === "JP").summary.outside, 0);
  records[1].items[1] = observation(rack, "OUTSIDE_TOP100"); result = aggregateSerpRegionResults(records, all);
  assert.equal(result.items[0].status, "OUTSIDE_TOP100"); assert.equal(result.summary.outside, 1);
});

test("unqueried, corrected, failed and short no-hit captures do not create ranked or outside totals", () => {
  const all = [target("pending"), target("corrected"), target("failed"), target("short")];
  const records = [{ region: "US", items: [observation(all[0]), observation(all[1], "QUERY_CHANGED", 3, { correctedKeyword: "different model" }),
    observation(all[2], "FAILED"), observation(all[3], "NOT_FOUND_CAPTURE", null, { coveredThroughRank: 10 })] }];
  const result = aggregateSerpRegionResults(records, all);
  assert.equal(result.summary.total, 4); assert.equal(result.summary.ranked, 0); assert.equal(result.summary.outside, 0);
  assert.deepEqual(result.items.map(item => item.status).sort(), ["FAILED", "NOT_FOUND_CAPTURE", "PENDING", "QUERY_CHANGED"]);
  assert.ok(result.items.every(item => item.rank === null));
  assert.ok(result.countries.every(country => country.rankingRecordSharePercent === null));
});

test("best rank retains the actual winning evidence time and source but not a single country's movement baseline", () => {
  const flat = target("flat", "shared api"), rack = target("rack", "shared api", "rackrate.org");
  const records = [{ region: "US", items: [observation(flat, "RANKED", 6, { checkedAt: "2026-10-15T03:00:00Z", movement: "UP", previousRank: 10 })] },
    { region: "JP", items: [observation(rack, "RANKED", 2, { checkedAt: "2026-10-16T03:00:00Z", periodKey: "2026-10-2", movement: "DOWN", previousRank: 1 })] }];
  const { items } = aggregateSerpRegionResults(records, [flat, rack]);
  assert.equal(items[0].rank, 2); assert.equal(items[0].siteDomain, "rackrate.org");
  assert.equal(items[0].checkedAt, "2026-10-16T03:00:00Z"); assert.equal(items[0].periodKey, "2026-10-2");
  assert.equal(items[0].previousRank, null); assert.equal(items[0].movement, "NOT_COMPARABLE");
});

test("empty inventories have undefined percentages while immutable unqueried words remain in the denominator", () => {
  const empty = aggregateSerpRegionResults([], []);
  assert.equal(empty.summary.total, 0); assert.equal(empty.summary.coveragePercent, null);
  assert.ok(empty.countries.every(country => country.targetSharePercent === null && country.rankingRecordSharePercent === null));
  const frozen = [target("first", "same api"), target("second", "SAME API", "rackrate.org"), target("unknown")];
  const result = aggregateSerpRegionResults([], frozen);
  assert.equal(result.summary.total, 2); assert.equal(result.summary.pending, 2); assert.equal(result.summary.rankedRecords, 0);
});
