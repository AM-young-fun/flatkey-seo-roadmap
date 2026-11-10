const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs"), path = require("node:path"), Module = require("node:module"), ts = require("typescript");
const root = path.resolve(__dirname, ".."), resolve = Module._resolveFilename;
Module._resolveFilename = function (name, parent, ...rest) { return resolve.call(this, name.startsWith("@/") ? path.join(root, "src", name.slice(2)) : name, parent, ...rest); };
require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText, filename);
const policy = require("../src/lib/keyword-market-policy.ts");
const { groupSerpMarketQueries, quoteSerpTargets, buildSerpTask, SERP_DEFAULT_CONFIG } = require("../src/lib/dataforseo-serp.ts");
const { classifySerpMonitoringCohort, serpTargetKey } = require("../src/lib/serp-targets.ts");
const assignment = (primaryCountry = "US", extra = {}) => ({ primaryCountry, language: policy.KEYWORD_MARKET_LANGUAGES[primaryCountry], secondaryMarkets: [],
  evidence: "Ahrefs target-country research and confirmed target page intent", reviewedAt: "2026-01-01T00:00:00Z", ...extra });
const target = (keyword, country = "US", extra = {}) => ({ keywordId: keyword, keyword, siteDomain: "flatkey.ai", targetUrls: ["https://flatkey.ai/models/example"], marketAssignment: assignment(country), ...extra });

test("one explicit primary country queries once, saving 75% against broadcasting identical words to four countries", () => {
  const rows = [target("claude api pricing"), target("preço API", "BR"), target("precio API", "ES"), target("モデル API", "JP")];
  const queries = groupSerpMarketQueries(rows), quote = quoteSerpTargets(rows);
  assert.equal(queries.length, 4); assert.equal(quote.maxCostMicros, 24_000);
  assert.equal(queries.length / (rows.length * 4), 0.25);
  assert.deepEqual(queries.map(q => [q.region, q.keyword]), [["US", "claude api pricing"], ["JP", "モデル API"], ["ES", "precio API"], ["BR", "preço API"]]);
});
test("unmapped, language-only, mismatched-language and unjustified secondary markets never authorize paid queries", () => {
  for (const row of [target("モデル API", "JP", { marketAssignment: undefined, sourceLanguages: ["ja"] }),
    target("AI API", "US", { marketAssignment: { language: "en" } }),
    target("中文关键词", "ES"), target("model API", "US", { marketAssignment: assignment("US", { secondaryMarkets: [{ country: "JP", reason: "" }] }) })]) {
    assert.equal(groupSerpMarketQueries([row]).length, 0);
  }
  assert.equal(policy.readKeywordMarketAssignment(assignment("BR", { language: "es-ES" })), null);
});
test("same query can share a paid result across sites but keeps distinct explicitly researched countries", () => {
  const rows = [target("Model API"), target("ｍｏｄｅｌ  api", "US", { siteDomain: "rackrate.org" }), target("model api", "JP")];
  const quote = quoteSerpTargets(rows);
  assert.equal(quote.targetCount, 3); assert.equal(quote.keywordQueryCount, 1); assert.equal(quote.queryCount, 2); assert.equal(quote.sharedQueriesSaved, 1);
  const secondary = target("technical model API", "US", { marketAssignment: assignment("US", { secondaryMarkets: [{ country: "JP", reason: "Japan query evidence confirms users search this exact model/API name" }] }) });
  assert.deepEqual(groupSerpMarketQueries([secondary]).map(q => q.region), ["US", "JP"]);
  assert.equal(groupSerpMarketQueries([secondary], ["BR"]).length, 0);
});
test("all owned brands are excluded before quote and payload, while third-party model names remain valid", () => {
  for (const word of ["flatkey API", "Flat Key", "Flatkeyとは", "Flatkey官网", "https://rackrate.org", "model-fit.cc", "mochi chatbot ai", "jev-llm.com"]) {
    assert.equal(policy.isOwnedBrandKeyword(word), true);
    assert.equal(quoteSerpTargets([target(word)]).queryCount, 0);
    assert.throws(() => buildSerpTask({ keyword: word, queryKey: word, targets: [] }, "tag", SERP_DEFAULT_CONFIG), /OWN_BRAND/);
  }
  for (const word of ["OpenAI API pricing", "Claude API", "Gemini image API", "DeepSeek pricing", "flatkeyboards"]) assert.equal(policy.isOwnedBrandKeyword(word), false);
});
test("held brand or unassigned words stay in inventory instead of being reported as missing rankings", () => {
  const rows = [target("flatkey"), target("claude API", "US", { marketAssignment: undefined }), target("GPT API")];
  const proof = new Map(rows.map(row => [serpTargetKey(row), { verifiedSourcePages: row.targetUrls }]));
  const result = classifySerpMonitoringCohort(rows, proof);
  assert.equal(result.allTargetCount, 3); assert.equal(result.targets.length, 1);
  assert.deepEqual(result.heldTargets.map(row => row.reason), ["OWN_BRAND", "COUNTRY_REVIEW_REQUIRED"]);
  assert.deepEqual(rows.map(row => row.keyword), ["flatkey", "claude API", "GPT API"]);
});
test("volume/KD threshold treats missing evidence, boundary values and documented exceptions explicitly", () => {
  assert.equal(policy.keywordSelectionPriority({ volume: 10, kd: 29 }).status, "preferred");
  assert.equal(policy.keywordSelectionPriority({ volume: 10, kd: 30 }).eligible, false);
  assert.equal(policy.keywordSelectionPriority({ volume: 1, kd: 20 }).status, "exception_required");
  assert.equal(policy.keywordSelectionPriority({ volume: 0, kd: 20, exceptionReason: "Low-volume model launch query with verified purchase intent" }).status, "documented_exception");
  assert.equal(policy.keywordSelectionPriority({ volume: 20, kd: null, exceptionReason: "Strategic keyword does not turn missing KD into zero" }).status, "evidence_required");
});
