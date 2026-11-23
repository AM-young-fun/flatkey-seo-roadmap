const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), ts = require("typescript");
require.extensions[".ts"] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true,
} }).outputText, file);
const { coverageSelection, summarizeSavedRankings } = require("../src/lib/saved-ranking-coverage.ts");
const period = "2026-11-17", selected = () => coverageSelection(new URLSearchParams({ periodKey: period })), now = new Date("2026-11-22T14:00:00Z");
const locales = { US: ["en", 2840], JP: ["ja", 2392], ES: ["es", 2724], BR: ["pt", 2076] };
const row = (country, keyword, rank, url = "https://flatkey.ai/blog/example") => ({ source: "dataforseo_labs", keyword: keyword.normalize("NFKC").toLowerCase().trim().replace(/\s+/g, " "), rawKeyword: keyword,
  region: country, locationCode: locales[country][1], languageCode: locales[country][0], rank_group: rank, url, title: keyword,
  sourceSerpUpdatedAt: "2026-11-01T08:00:00Z", collectedAt: "2026-11-22T11:00:00Z" });
const run = (country, rows = []) => ({ requestId: `discovery-${period}-flatkey-ai-${country}`, siteDomain: "flatkey.ai", status: "COMPLETED", collectedAt: new Date("2026-11-22T11:00:00Z"), completedAt: new Date("2026-11-22T11:01:00Z"),
  normalized: { schemaVersion: 1, source: "dataforseo_labs", datasetType: "provider_ranked_keywords_snapshot", runId: `discovery-${period}-flatkey-ai-${country}`, targetDomain: "flatkey.ai", region: country,
    languageCode: locales[country][0], collectedAt: "2026-11-22T11:00:00Z", requestedLimit: 1000, returnedItems: rows.length, totalMatchingCount: rows.length, truncated: false, rows, rejectedItems: [] } });

test("requires an explicit valid period or exactly four same-period allowlisted run IDs", () => {
  assert.equal(selected().runIds.length, 4);
  assert.deepEqual(coverageSelection(new URLSearchParams(selected().runIds.map(id => ["runId", id]))), selected());
  for (const query of ["", "periodKey=2026-11-31", "periodKey=2026-11-17&site=rackrate.org", "periodKey=2026-11-17&action=refresh", "periodKey=2026-11-17&periodKey=2026-11-03"]) assert.throws(() => coverageSelection(new URLSearchParams(query)));
  const ids = selected().runIds; ids[3] = ids[3].replace("2026-11-17", "2026-11-03");
  assert.throws(() => coverageSelection(new URLSearchParams(ids.map(id => ["runId", id]))));
});

test("separates returned observations, per-country terms, global union, brands and mutually exclusive rank bands", () => {
  const runs = [run("US", [row("US", "GPU COST", 7), row("US", "gpu cost", 3, "https://flatkey.ai/blog/second"), row("US", "Flatkey pricing", 1)]),
    run("JP", [row("JP", "gpu cost", 2), row("JP", "LLM API 料金", 10)]), run("ES", [row("ES", "precio api", 18)]), run("BR", [row("BR", "como usar api", 50)])];
  const result = summarizeSavedRankings(selected(), runs, now);
  assert.equal(result.complete, true); assert.equal(result.totals.returnedItems, 7); assert.equal(result.totals.validNormalizedRows, 7);
  assert.equal(result.totals.rawDistinctKeywords, 5); assert.equal(result.totals.rawNonBrandDistinctKeywords, 4);
  assert.equal(result.totals.sumOfCountryNonBrandDistinctKeywords, 5); assert.equal(result.totals.ownBrandObservationsExcluded, 1);
  assert.deepEqual(result.rankBandsExclusive, { top3: 1, rank4to10: 1, rank11to20: 1, rank21to100: 1 });
  const term = result.items.find(item => item.keyword === "gpu cost");
  assert.equal(term.observations.length, 3); assert.equal(term.bestObservedCountry, "JP"); assert.equal(term.bestRank, 2);
  assert.equal(term.rawKeywords.length, 2); assert.equal(term.primaryCountryAssigned, false);
  assert.equal(result.scope.originalWordLanguageFilterApplied, false); assert.equal(result.scope.strictNativeLanguageMatchedDistinctKeywordCount, null);
  assert.equal(result.items[0].wordLanguageStatus, "not_reviewed"); assert.equal(result.indexFreshness.realTime, false);
  assert.equal(result.newPaidRequests, 0); assert.equal(result.newCostMicros, 0);
});

test("same request language never becomes original-word language, and subdomains remain explicitly scoped evidence", () => {
  const result = summarizeSavedRankings(selected(), [run("US"), run("JP"), run("ES"), run("BR", [row("BR", "nvidia b300", 15, "https://console.flatkey.ai/example")])], now);
  assert.equal(result.totals.rawNonBrandDistinctKeywords, 1); assert.equal(result.totals.publicWebsiteNonBrandDistinctKeywords, 0);
  assert.equal(result.totals.otherSubdomainObservations, 1); assert.equal(result.items[0].observations[0].requestLocale, "pt");
  assert.equal(result.items[0].wordLanguageStatus, "not_reviewed"); assert.equal(result.items[0].observations[0].hostScope, "other_flatkey_subdomain");
});

test("missing countries, truncated pages, incomplete imports and mixed snapshot scopes cannot be called complete", () => {
  let result = summarizeSavedRankings(selected(), [run("US")], now);
  assert.equal(result.complete, false); assert.equal(result.countries.find(country => country.country === "BR").nonBrandDistinctKeywords, null);
  const runs = [run("US", [row("US", "api cost", 6)]), run("JP"), run("ES"), run("BR")];
  runs[0].normalized.totalMatchingCount = 1001; runs[0].normalized.truncated = true;
  result = summarizeSavedRankings(selected(), runs, now); assert.equal(result.complete, false); assert.match(result.countries[0].issues.join(), /TRUNCATED/);
  runs[0] = run("US"); runs[1].status = "RECEIVED"; runs[2].normalized.region = "US";
  result = summarizeSavedRankings(selected(), runs, now); assert.equal(result.complete, false); assert.equal(result.countries[1].nonBrandDistinctKeywords, null);
  assert.match(result.countries[2].issues.join(), /SCOPE_MISMATCH/);
});

test("wrong source/domain/run identity is quarantined and unavailable coverage is null instead of a false zero", () => {
  const runs = [run("US", [row("US", "api cost", 5)]), run("JP"), run("ES"), run("BR")];
  runs[0].normalized.runId = "discovery-2026-11-03-flatkey-ai-US";
  runs[1].normalized.targetDomain = "rackrate.org";
  runs[2].normalized.source = "gsc";
  runs[3].status = "FAILED";
  const result = summarizeSavedRankings(selected(), runs, now);
  assert.equal(result.complete, false); assert.equal(result.availableCountryCount, 0);
  assert.equal(result.totals.rawNonBrandDistinctKeywords, null); assert.equal(result.items.length, 0);
});

test("invalid rows and rejected items are accounted for separately, never filled with zero rankings", () => {
  const bad = row("US", "api pricing", 5); bad.rank_group = 0;
  const us = run("US", [bad, row("US", "api cost", 4)]);
  const result = summarizeSavedRankings(selected(), [us, run("JP"), run("ES"), run("BR")], now);
  assert.equal(result.complete, false); assert.equal(result.totals.returnedItems, 2); assert.equal(result.totals.validNormalizedRows, 1);
  assert.equal(result.countries[0].invalidNormalizedRows, 1); assert.equal(result.items[0].bestRank, 4);
});

test("best-country ties retain every country's actual URL and rank", () => {
  const result = summarizeSavedRankings(selected(), [run("US", [row("US", "same query", 3)]), run("JP", [row("JP", "same query", 3, "https://flatkey.ai/ja/blog/example")]), run("ES"), run("BR")], now);
  assert.deepEqual(result.items[0].bestCountries, ["US", "JP"]); assert.equal(result.items[0].observations.length, 2);
  assert.equal(result.totals.rawNonBrandDistinctKeywords, 1);
});
