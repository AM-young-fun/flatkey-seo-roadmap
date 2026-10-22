const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs"), ts = require("typescript");
require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText, filename);
const { keywordMatchesCountry, keywordMarketVolume } = require("../src/lib/keyword-market.ts");
const { keywordDemandRows } = require("../src/lib/keyword-demand.ts");
const { groupKeywordDetails, scopeKeywordDetails } = require("../src/lib/keyword-details-group.ts");
const keyword = (id, text, extra = {}) => ({ id, text, siteDomain: "flatkey.ai", sourceLanguages: [], businessCategory: "FLATKEY_API",
  marketVolumes: { US: null, JP: null, ES: null, BR: null }, latestRanks: { US: null, JP: null, ES: null, BR: null }, ...extra });
const rank = value => ({ source: "dataforseo_serp", rankStatus: "ranked", rank: value, checkedAt: "2026-10-22T03:00:00Z" });

test("country selection scopes actual rows, retaining unmeasured targets from their source language", () => {
  const en = keyword("en", "model api", { sourceLanguages: ["en-US"] });
  const ja = keyword("ja", "モデル API", { sourceLanguages: ["ja"], latestRanks: { US: rank(3), JP: rank(2) } });
  const unknown = keyword("unknown", "unassigned api");
  const original = structuredClone([en, ja, unknown]);
  assert.deepEqual(scopeKeywordDetails(groupKeywordDetails([en, ja, unknown]), "US").map(group => group.text), [en.text]);
  assert.equal(keywordMatchesCountry(ja, "US", true), true, "cross-language real US data stays accessible");
  assert.equal(keywordMatchesCountry(ja, "JP"), true);
  assert.equal(keywordMatchesCountry(unknown, "US"), false);
  assert.equal(keywordMatchesCountry(unknown, "all"), true);
  assert.deepEqual([en, ja, unknown], original);
});

test("Japanese script is recognized without source metadata and unknown Latin terms require country evidence", () => {
  assert.equal(keywordMatchesCountry(keyword("a", "ｸﾗｳﾄﾞ GPU"), "US"), false);
  assert.equal(keywordMatchesCountry(keyword("a", "クラウド GPU"), "JP"), true);
  assert.equal(keywordMatchesCountry(keyword("b", "GPU", { marketVolumes: { JP: 100 } }), "JP"), true);
  assert.equal(keywordMatchesCountry(keyword("c", "model api", { sourceLanguages: ["Portuguese"] }), "BR"), true);
  assert.equal(keywordMatchesCountry(keyword("d", "API precios", { sourceLanguages: ["es"] }), "US"), false);
});

test("demand uses the selected country's volume and ranking, deduplicates sites, and separates zero from missing", () => {
  const high = keyword("a", "high", { sourceLanguages: ["en"], marketVolumes: { US: 200, JP: 9000 }, latestRanks: { US: rank(30), JP: rank(1) } });
  const duplicate = keyword("b", " HIGH ", { sourceLanguages: ["en"], marketVolumes: { US: 200 }, latestRanks: { US: rank(20) } });
  const zero = keyword("c", "zero", { sourceLanguages: ["English"], marketVolumes: { US: 0 } });
  const missing = keyword("d", "missing", { sourceLanguages: ["en"] });
  const foreign = keyword("e", "日本語 API", { marketVolumes: { US: 10000 } });
  const rows = keywordDemandRows([missing, zero, duplicate, high, foreign], "US", "FLATKEY_API");
  assert.deepEqual(rows.map(row => [row.text.toLowerCase().trim(), row.volume]), [["high", 200], ["zero", 0], ["missing", null]]);
  assert.equal(rows[0].position, 20);
  assert.equal(keywordMarketVolume([high, duplicate], "US"), 200);
  assert.equal(keywordDemandRows([high], "US", "CLOUD_GPU").length, 0);
  assert.equal(keywordDemandRows([high], "US", "FLATKEY_API", false, "zzz").length, 0);
});
