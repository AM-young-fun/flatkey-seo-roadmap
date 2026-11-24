const assert = require("node:assert/strict"), { test } = require("node:test");
const fs = require("node:fs"), ts = require("typescript");
require.extensions[".ts"] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, file);
const { currentRankingSummary, isCurrentNativeRanking } = require("../src/lib/current-ranking-summary.ts");
const asOf = "2026-11-24T08:00:00Z";
const target = (id, patch = {}) => ({ id, keywordId: id, keyword: "GPU rental", site: "flatkey.ai", topicId: "gpu", topicName: "GPU", country: "US", language: "en", membership: "formal", pageState: "published", workState: "completed", publishedUrls: ["https://flatkey.ai/gpu"], plannedUrls: [], rank: 22, rankSource: "serp", rankUrl: "https://flatkey.ai/gpu", checkedAt: "2026-11-23T00:00:00Z", languageStatus: "match", captureState: "ranked", rankEligible: true, taskIds: [], ...patch });

test("global original-word union chooses a real best native capture and preserves all source identities", () => {
  const rows = [target("formal"), target("other-site", { keyword: " ＧＰＵ   RENTAL ", site: "rackrate.org", rankUrl: "https://rackrate.org/gpu", rank: 8, membership: "opportunity" }), target("jp", { keyword: "GPUレンタル", country: "JP", language: "ja", rank: 60 })];
  const before = JSON.stringify(rows), summary = currentRankingSummary(rows, asOf);
  assert.equal(summary.total, 2); assert.equal(summary.combinationCount, 3); assert.equal(summary.formalWords, 2);
  assert.equal(summary.top50, 1); assert.equal(summary.selected.find(row => row.country === "US").id, "other-site");
  assert.equal(summary.words.find(word => word.wordKey === "gpu rental").observations.length, 2);
  assert.deepEqual(summary.countries.map(row => [row.country, row.count, row.share]), [["JP", 1, .5], ["US", 1, .5]]);
  assert.equal(summary.countries.reduce((sum, row) => sum + row.count, 0), summary.total);
  assert.equal(summary.bands.reduce((sum, row) => sum + row.count, 0), summary.total);
  assert.equal(JSON.stringify(rows), before, "projection must never rewrite source countries, ranks, pages or membership");
});

test("a better rank from a wrong-language country or a neutral term cannot be reassigned", () => {
  const rows = [target("us", { rank: 75, wordLanguage: "en" }), target("jp-english", { country: "JP", language: "ja", wordLanguage: "en", rank: 1 }), target("unknown", { keyword: "nvidia b300", wordLanguage: null, rank: 2 }), target("mismatch", { keyword: "GPUレンタル", languageStatus: "mismatch", rank: 3 })];
  const summary = currentRankingSummary(rows, asOf);
  assert.equal(summary.total, 1); assert.equal(summary.selected[0].id, "us"); assert.equal(summary.selected[0].rank, 75);
  assert.equal(summary.countries[0].country, "US"); assert.equal(summary.bands[3].count, 1);
});

test("same-language countries retain the best observation's actual original country", () => {
  const rows = [target("sg", { keyword: "gemini token 价格", country: "SG", language: "zh-CN", wordLanguage: "zh-CN", rank: 7 }), target("cn", { keyword: "GEMINI token 价格", country: "CN", language: "zh-CN", wordLanguage: "zh-CN", rank: 3 })];
  const summary = currentRankingSummary(rows, asOf);
  assert.equal(summary.total, 1); assert.equal(summary.combinationCount, 2);
  assert.equal(summary.countries[0].country, "CN"); assert.equal(summary.selected[0].rank, 3);
  assert.equal(summary.selected[0].rankUrl, "https://flatkey.ai/gpu");
});

test("latest same-ID capture wins before global best-rank selection, with stable ties", () => {
  const rows = [target("first", { rank: 2, checkedAt: "2026-11-20T00:00:00Z" }), target("first", { rank: 22 }), target("second", { rank: 22, checkedAt: "2026-11-23T01:00:00Z" }), target("second", { rank: 22, checkedAt: "2026-11-23T01:00:00Z" })];
  const summary = currentRankingSummary(rows, asOf), reversed = currentRankingSummary([...rows].reverse(), asOf);
  assert.equal(summary.combinationCount, 2); assert.equal(summary.total, 1); assert.equal(summary.selected[0].id, "second");
  assert.equal(summary.selected[0].id, reversed.selected[0].id); assert.equal(summary.selected[0].rank, 22);
});

test("only complete same-market SERP within the closed 14-day window qualifies", () => {
  assert.equal(isCurrentNativeRanking(target("boundary", { checkedAt: "2026-11-10T08:00:00Z" }), asOf), true);
  const excluded = [
    { checkedAt: "2026-11-10T07:59:59Z" }, { checkedAt: "2026-11-24T08:00:01Z" }, { checkedAt: null },
    { rankSource: "gsc" }, { rankSource: "database" }, { captureState: "incomplete" }, { rankEligible: false },
    { rank: 0 }, { rank: 101 }, { rank: 1.5 }, { languageStatus: "unknown" }, { wordLanguage: "ja" },
    { country: "XX" }, { country: null }, { keyword: "Flatkey GPU rental" }, { keyword: " " },
    { rankUrl: "https://competitor.org/gpu" }, { rankUrl: "http://flatkey.ai/gpu" },
    { rankUrl: "https://flatkey.ai:1234/gpu" }, { rankUrl: "https://user:pass@flatkey.ai/gpu" },
  ];
  for (const patch of excluded) assert.equal(isCurrentNativeRanking(target("excluded", patch), asOf), false, JSON.stringify(patch));
  assert.equal(isCurrentNativeRanking(target("www", { rankUrl: "https://www.flatkey.ai/gpu" }), asOf), true);
  assert.equal(isCurrentNativeRanking(target("invalid-asof"), "not-a-date"), false);
});

test("no eligible words means unknown shares rather than fabricated zero percentages", () => {
  const summary = currentRankingSummary([target("neutral", { keyword: "b300" })], asOf);
  assert.equal(summary.total, 0); assert.equal(summary.top50, 0); assert.deepEqual(summary.countries, []);
  assert.equal(summary.bands.every(band => band.count === 0 && band.share === null), true);
});
