const { test } = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), ts = require("typescript");
require.extensions[".ts"] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, file);
const { digestRankingNotes } = require("../src/lib/seo-digest-rankings.ts");
const row = (period, rank, extra = {}) => ({ id: period, runId: period, keyword: "model api", region: "US", targetsJson: [{ keywordId: "model", siteDomain: "flatkey.ai" }], state: "COMPLETE", checkedAt: period === "2026-11-1" ? "2026-11-10T08:00:00Z" : "2026-10-20T08:00:00Z", runCreatedAt: period === "2026-11-1" ? "2026-11-10T07:00:00Z" : "2026-10-20T07:00:00Z", updatedAt: "2026-11-10T08:00:00Z", providerTaskId: period, errorCode: null, periodKey: period, runScope: "SCHEDULED", normalizedJson: { normalizationVersion: 2, captureComplete: true, queryStatus: "EXACT", completeDepth: true, rankingVerified: true, organicResults: rank ? [{ url: "https://flatkey.ai/models/api", domain: "flatkey.ai", rankGroup: rank }] : [] }, ...extra });
const window = ["2026-11-09T18:00:00+08:00", "2026-11-10T18:00:00+08:00"];
test("only new receipts generate rank section, never old results or samples", () => {
 assert.deepEqual(digestRankingNotes([row("2026-10-2", 12)], ...window), []);
 assert.deepEqual(digestRankingNotes([row("2026-11-1", 8, { runScope: "SAMPLE" })], ...window), []);
});
test("same keyword in a different country is not a historical baseline", () => {
 const notes = digestRankingNotes([row("2026-11-1", 8), row("2026-10-2", 12, { region: "BR" })], ...window).join("\n");
 assert.match(notes, /尚无可比历史/); assert.doesNotMatch(notes, /新进前10/);
});
test("valid movement crosses top10 and includes real ranking page", () => {
 const notes = digestRankingNotes([row("2026-11-1", 8), row("2026-10-2", 12)], ...window).join("\n");
 assert.match(notes, /12→8 · 新进前10/); assert.match(notes, /https:\/\/flatkey.ai\/models\/api/);
});
test("failed current query is not a drop and owned brands are excluded", () => {
 const notes = digestRankingNotes([row("2026-11-1", null, { state: "FAILED", normalizedJson: null }), row("2026-10-2", 8)], ...window).join("\n");
 assert.match(notes, /待核验 1/); assert.doesNotMatch(notes, /掉出前10/);
 assert.deepEqual(digestRankingNotes([row("2026-11-1", 1, { keyword: "Flatkey pricing" })], ...window), []);
});
