const assert = require("node:assert/strict"), { test, beforeEach } = require("node:test");
const fs = require("node:fs"), path = require("node:path"), Module = require("node:module"), ts = require("typescript");
const root = path.resolve(__dirname, ".."), resolve = Module._resolveFilename, originalLoad = Module._load;
Module._resolveFilename = function(name, parent, ...rest) { return resolve.call(this, name.startsWith("@/") ? path.join(root, "src", name.slice(2)) : name, parent, ...rest); };
require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText, filename);
const mock = (relative, exports) => { const filename = path.join(root, relative); require.cache[filename] = { id: filename, filename, loaded: true, exports }; };
Module._load = function(name, ...rest) {
  if (name === "server-only") return {};
  if (name === "./approved-weekly-keyword-capture") return require.cache[path.join(root, "src/lib/services/approved-weekly-keyword-capture.ts")].exports;
  return originalLoad.call(this, name, ...rest);
};
let packet, reads, legacyReads, failure, capturedInput, workspaceReads, providedWorkspace, dailyWorkspace;
const noWrite = async () => assert.fail("weekly source adaptation must not write, prepare, send, or submit paid queries");
mock("src/lib/prisma.ts", { prisma: {
  seoAnalyticsDay: { findMany: async () => [], create: noWrite, update: noWrite },
  collectorRun: { findMany: async () => [] }, seoReportVersion: { createMany: noWrite },
} });
mock("src/lib/services/approved-weekly-keyword-capture.ts", { loadApprovedWeeklyKeywordCapture: async input => {
  reads.push(input); if (failure) throw failure; return packet;
} });
mock("src/lib/services/serp-results.ts", { loadSerpTasks: async () => { legacyReads++; return []; } });
mock("src/lib/services/growth-workspace.ts", { loadGrowthWorkspace: async (_local, asOf) => { workspaceReads.push(asOf.toISOString()); return dailyWorkspace; } });
mock("src/lib/services/growth-strategy.ts", { loadGrowthReportSnapshot: async (date, _local, asOf, provided) => {
  providedWorkspace = provided?.workspace;
  return require("../src/lib/growth-strategy.ts").unavailableGrowthReportSnapshot(require("../src/lib/seo-date-range.ts").weeklyReportRange(date), asOf);
} });
for (const [file, name, value] of [
  ["seo-registration-period", "loadRegistrationPeriods", []], ["daily-seo-traffic", "loadDailySeoTrafficHistory", undefined],
  ["daily-seo-page-groups", "loadDailySeoPageGroupsHistory", undefined], ["monthly-page-archive", "loadMonthlyPageArchive", []],
  ["seo-business-analytics", "loadBusinessAnalytics", []], ["seo-github-channel", "loadGithubChannels", []],
]) mock(`src/lib/services/${file}.ts`, { [name]: async () => structuredClone(value) });
const { workflowSnapshot } = require("../src/lib/seo-workflow-state.ts");
mock("src/lib/services/seo-workflow.ts", { loadWorkflowSnapshot: async query => workflowSnapshot([], query, "database") });
const { accountRegistrationSummary } = require("../src/lib/seo-account-registrations.ts");
mock("src/lib/services/seo-account-registrations.ts", { loadAccountRegistrationSummary: async query => accountRegistrationSummary(query) });
mock("src/lib/services/seo-reporting-control.ts", { getSeoReportingControl: noWrite });
const digest = require("../src/lib/seo-digest.ts"), originalBuild = digest.buildSeoDigest;
digest.buildSeoDigest = input => { capturedInput = input; return originalBuild(input); };
const { generateSeoDigest } = require("../src/lib/services/seo-digest.ts");
const now = new Date("2026-11-26T09:00:00Z");
beforeEach(t => {
  reads = []; legacyReads = 0; failure = null; capturedInput = null; workspaceReads = []; providedWorkspace = null;
  dailyWorkspace = { generatedAt: "2026-11-23T07:59:59.999Z", targets: [{ id: "daily-diagnostic", site: "flatkey.ai", keyword: "gpu cloud pricing", country: "US", language: "en", membership: "opportunity", rank: 8, rankUrl: "https://flatkey.ai/blog/gpu-cloud-pricing", rankSource: "serp", checkedAt: "2026-11-23T07:00:00Z", languageStatus: "match", captureState: "ranked", rankEligible: true, observationEligible: true, captureScope: "DIAGNOSTIC" }] };
  packet = { runIds: ["approved-keyword-review-20261123-v1", "approved-other-keyword-review-20261123-v1"],
    sourceHash: "b".repeat(64), complete: true, comparable: false, newQueryCount: 1498, reusedQueryCount: 1, targetCount: 1499,
    capturedKeywords: 1499, rankedKeywords: 200, unresolvedKeywords: 7, verifiedOutsideTop100: 1292,
    countries: [{ country: "US", language: "en", targetCount: 1499, rankedKeywords: 200 }],
    pages: Array.from({ length: 200 }, (_, index) => ({ keywordId: `kw-${index}`, country: "US", rank: index < 50 ? 8 : 51, url: "https://flatkey.ai/blog/example" })),
    notes: ["本期复核1499词：1498条新查询＋1条旧结果复用；实际有排名200词，未决7词。",
      "CN16词单列；中性词仅为本次已批准查询环境，不认定原词语种或变更主国家。",
      "原词 example query · 美国 · 第8名 · 真实页面 https://flatkey.ai/blog/example · 采集于2026-11-23。",
      "两批为本期一次性复核，无可比上期，不计算新增或涨跌。"] };
  t.mock.method(globalThis, "fetch", noWrite);
});

test("weekly digest consumes the merged approved notes, complete page links and limitations unchanged", async () => {
  const report = await generateSeoDigest("2026-11-26", now, "weekly");
  assert.deepEqual(reads, [{ start: "2026-11-19", end: "2026-11-25", asOf: now }]);
  assert.equal(legacyReads, 0, "the latest per-country scheduled selector cannot overwrite either approved batch");
  assert.deepEqual(capturedInput.rankingNotes, packet.notes); assert.deepEqual(report.rankingNotes, packet.notes);
  for (const text of ["1498条新查询", "1条旧结果复用", "CN16词", "https://flatkey.ai/blog/example", "无可比上期"]) assert.ok(report.detailText.includes(text), text);
  assert.deepEqual(report.weeklyRankingSummary, {
    total: 1499, ranked: 200, verifiedOutside: 1292, unresolved: 7,
    countries: [{ country: "US", target: 1499, ranked: 200 }],
    bands: [[1, 3, 0], [4, 10, 50], [11, 20, 0], [21, 50, 0], [51, 100, 150]]
      .map(([from, to, count]) => ({ from, to, count })),
  });
  assert.doesNotMatch(report.detailText, /全部记为新增|前100.*净增.*200/);
});

test("a week without an actual approved packet keeps normal weekly evidence and cannot leak this capture", async () => {
  packet = null;
  const report = await generateSeoDigest("2026-11-19", now, "weekly");
  assert.deepEqual(reads, [{ start: "2026-11-12", end: "2026-11-18", asOf: now }]);
  assert.equal(legacyReads, 1); assert.deepEqual(report.rankingNotes, []);
  assert.doesNotMatch(report.detailText, /1498条新查询|CN16词|flatkey\.ai\/blog\/example/);
});

test("an unavailable approved source stays missing instead of silently using stale or partial legacy totals", async () => {
  failure = new Error("approved source unavailable");
  const report = await generateSeoDigest("2026-11-26", now, "weekly");
  assert.equal(legacyReads, 0); assert.deepEqual(report.rankingNotes, []);
  assert.ok(capturedInput.issues.some(note => note.includes("排名回执读取失败")));
  assert.doesNotMatch(report.detailText, /1498条新查询|CN16词/);
});

test("daily collection shares one complete saved workspace and never reads weekly supplement or the scope-filtered legacy source", async () => {
  const report = await generateSeoDigest("2026-11-23", now, "daily");
  assert.equal(reads.length, 0); assert.equal(legacyReads, 0);
  assert.deepEqual(workspaceReads, ["2026-11-23T07:59:59.999Z"]);
  assert.equal(providedWorkspace, dailyWorkspace, "ranking notes and growth snapshot must consume the identical daily source projection");
  assert.deepEqual(capturedInput.rankingNotes, report.rankingNotes);
  assert.match(report.rankingNotes.join("\n"), /前100有排名 1 个组合/);
  assert.match(report.rankingNotes.join("\n"), /正式规划有排名 0 个组合，机会及待归类 1 个组合/);
  assert.match(report.rankingNotes.join("\n"), /https:\/\/flatkey\.ai\/blog\/gpu-cloud-pricing/);
  assert.doesNotMatch(report.detailText, /1498条新查询|CN16词|flatkey\.ai\/blog\/example/);
});
