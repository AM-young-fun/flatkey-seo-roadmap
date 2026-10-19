const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const ts = require("typescript");
require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText, filename);
const { groupKeywordDetails, keywordDetailCountryRanks, bestKeywordDetailRank, keywordDetailBestPosition } = require("../src/lib/keyword-details-group.ts");
const { keywordRankingTag, keywordRankingResultTag } = require("../src/lib/keyword-status-tags.ts");
const rank = (position, overrides = {}) => ({ source: "dataforseo_serp", rankStatus: "ranked", rank: position,
  checkedAt: "2026-10-16T02:30:00Z", url: "https://flatkey.ai/", ...overrides });
const member = (id, siteDomain, text, latestRanks = {}) => ({ id: `${siteDomain}:${id}`, siteDomain, text,
  targetUrls: [`https://${siteDomain}/page-a`, `https://${siteDomain}/page-b`],
  latestRanks: { US: null, JP: null, ES: null, BR: null, ...latestRanks },
  rankingEvidence: { US: [{ pages: [{ url: `https://${siteDomain}/rank-a`, rank: 3 }, { url: `https://${siteDomain}/rank-b`, rank: 7 }] }] },
});

test("keyword grouping normalizes text across sites after website selection and keeps every member's page evidence", () => {
  const flat = member("f", "flatkey.ai", " Model   Price "), rack = member("r", "rackrate.org", "model price"), model = member("m", "modelfit.cc", "ＭＯＤＥＬ ＰＲＩＣＥ");
  const original = structuredClone([flat, rack, model]);
  const groups = groupKeywordDetails([flat, rack, model]);
  assert.equal(groups.length, 1); assert.equal(groups[0].id, "model price"); assert.equal(groups[0].members.length, 3);
  assert.equal(groups[0].members[0], flat); assert.equal(groups[0].members[1], rack);
  assert.equal(groups[0].members.flatMap(item => item.targetUrls).length, 6);
  assert.equal(groups[0].members.flatMap(item => item.rankingEvidence.US[0].pages).length, 6);
  const [scoped] = groupKeywordDetails([flat, rack, model], "rackrate.org");
  assert.deepEqual(scoped.members, [rack]); assert.deepEqual([flat, rack, model], original);
});

test("combined view selects an actual best country/site rank while a country or website filter cannot borrow another scope", () => {
  const flat = member("f", "flatkey.ai", "shared price", { US: rank(2), JP: rank(40) });
  const rack = member("r", "rackrate.org", "Shared Price", { US: rank(20), JP: rank(3) });
  const model = member("m", "modelfit.cc", "shared price", { ES: rank(1) });
  const [group] = groupKeywordDetails([flat, rack, model]);
  const countries = keywordDetailCountryRanks(group, "all");
  assert.deepEqual(countries.map(value => [value.region, value.rank?.rank ?? null]), [["US", 2], ["JP", 3], ["ES", 1], ["BR", null]]);
  assert.equal(bestKeywordDetailRank(group, "all").member, model); assert.equal(bestKeywordDetailRank(group, "all").region, "ES");
  assert.equal(keywordDetailBestPosition(group, "all"), 1); assert.equal(keywordDetailBestPosition(group, "JP"), 3);
  assert.deepEqual(keywordDetailCountryRanks(group, "US").map(value => value.region), ["US"]);
  const [rackOnly] = groupKeywordDetails([flat, rack, model], "rackrate.org");
  assert.equal(keywordDetailBestPosition(rackOnly, "all"), 3); assert.equal(keywordDetailBestPosition(rackOnly, "ES"), null);
  assert.equal(keywordRankingTag(bestKeywordDetailRank(group, "all").rank).key, "TOP_10", "the bin uses an actual best result, never an average");
});

test("unknown countries or site members prevent a partial no-hit receipt from becoming confirmed outside-top100", () => {
  const outside = rank(null, { rankStatus: "outside_top100" });
  const flat = member("f", "flatkey.ai", "same", { US: outside }), rack = member("r", "rackrate.org", "same");
  const [group] = groupKeywordDetails([flat, rack]);
  assert.equal(keywordRankingTag(bestKeywordDetailRank(group, "US")?.rank).key, "PENDING");
  assert.equal(keywordDetailBestPosition(group, "all"), null);
  const allOutside = Object.fromEntries(["US", "JP", "ES", "BR"].map(region => [region, outside]));
  const [confirmed] = groupKeywordDetails([member("a", "flatkey.ai", "same", allOutside), member("b", "rackrate.org", "same", allOutside)]);
  assert.equal(keywordRankingTag(bestKeywordDetailRank(confirmed, "all").rank).key, "UNRANKED");
});

test("autocorrect, failed captures and legacy averages never become sortable positive rankings", () => {
  for (const value of [rank(1, { rankStatus: "query_changed" }), rank(2, { rankStatus: "incomplete" }),
    rank(3, { rankStatus: "failed" }), rank(1.5), rank(101), rank(1, { source: "gsc" }),
    rank(null, { rankStatus: "not_found_capture" })]) {
    const [group] = groupKeywordDetails([member("a", "flatkey.ai", "same", { US: value })]);
    assert.equal(keywordDetailBestPosition(group, "all"), null);
    assert.notEqual(keywordRankingTag(bestKeywordDetailRank(group, "all")?.rank).key, "UNRANKED");
  }
});

test("ranking filters hide collection diagnostics without treating missing data as no ranking", () => {
  for (const rankStatus of ["pending", "queued", "failed", "incomplete", "query_changed", "not_found_capture"]) {
    const input = rank(null, { rankStatus });
    const tag = keywordRankingResultTag(input);
    assert.equal(tag.key, "UNKNOWN", rankStatus);
    assert.equal(tag.label, "暂无排名数据");
    assert.equal(tag.tooltip, keywordRankingTag(input).tooltip, "diagnostic evidence stays available");
  }
  assert.equal(keywordRankingResultTag(null).key, "UNKNOWN");
  for (const [value, key] of [[1, "TOP_10"], [10, "TOP_10"], [11, "TOP_30"], [30, "TOP_30"], [31, "TOP_50"], [50, "TOP_50"], [51, "TOP_100"], [100, "TOP_100"]]) {
    assert.equal(keywordRankingResultTag(rank(value)).key, key);
  }
  const outside = rank(null, { rankStatus: "outside_top100" });
  const [partial] = groupKeywordDetails([member("a", "flatkey.ai", "same", { US: outside })]);
  assert.equal(keywordRankingResultTag(bestKeywordDetailRank(partial, "US")?.rank).key, "UNRANKED");
  assert.equal(keywordRankingResultTag(bestKeywordDetailRank(partial, "all")?.rank).key, "UNKNOWN");
});
