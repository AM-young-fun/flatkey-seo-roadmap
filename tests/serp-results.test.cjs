const assert = require("node:assert/strict");
const { test, beforeEach } = require("node:test");
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

const { eligibleSerpTargets } = require("../src/lib/serp-targets.ts");
const { buildSerpKeywordResults, summarizeSerpResults, summarizeSerpSampleResults, summarizeSerpMonitoring, withSerpMonitoringEligibility, serpRankSummary, serpRankingEvidence } = require("../src/lib/serp-results.ts");
const { PAGE_AUDIT_SOURCE_ID } = require("../src/lib/page-audit.ts");
const { serpCheckTrendPoints, serpTrendRange } = require("../src/lib/ranking-trends.ts");
const { rankingStats } = require("../src/lib/rank-display.ts");
const { serpPeriod, serpPeriodFromKey, periodDue, nextSerpPeriodDue } = require("../src/lib/serp-periods.ts");
const target = (id, overrides = {}) => ({ keywordId: id, keyword: `${id} api pricing`, siteDomain: "flatkey.ai", targetUrls: [`https://flatkey.ai/models/${id}`], ...overrides });
const candidate = (id, overrides = {}) => ({ ...target(id), text: `${id} api pricing`, active: true, keywordActive: true, siteActive: true, topicId: "topic", pool: "FORMAL", ...overrides });
const page = (url, rankGroup, rankAbsolute = rankGroup + 2) => ({ url, rankGroup, rankAbsolute, domain: new URL(url).hostname, title: "Actual result title" });
const task = (targets, overrides = {}) => ({ id: "task-one", runId: "run-one", keyword: targets[0].keyword,
  targetsJson: targets, state: "COMPLETE", checkedAt: "2026-10-16T03:00:00Z", providerTaskId: "provider-one", errorCode: null,
  runCreatedAt: "2026-10-16T02:00:00Z", updatedAt: "2026-10-16T03:00:00Z",
  normalizedJson: { completeDepth: true, maxOrganicRank: 100, checkedAt: "2026-10-16T03:00:00Z", googleUrl: "https://www.google.com/search?q=model+api", organicResults: [] }, ...overrides });

test("SERP runner and overview use the same protected formal business cohort without hardcoding a total", () => {
  const candidates = [candidate("claude"), candidate("claude"), candidate("research", { pool: "RESEARCH" }),
    candidate("noise", { text: "yes" }), candidate("off", { active: false }), candidate("global-off", { keywordActive: false }),
    candidate("site-off", { siteActive: false }), candidate("no-topic", { topicId: null }),
    candidate("rack", { siteDomain: "rackrate.org", pool: "RESEARCH", text: "gpu rental cost" }),
    candidate("model", { siteDomain: "modelfit.cc", pool: "RESEARCH" })];
  assert.deepEqual(eligibleSerpTargets(candidates).map(row => row.keywordId), ["claude", "rack", "model"]);
  const pending = buildSerpKeywordResults([target("claude"), target("rack", { siteDomain: "rackrate.org" })], []);
  assert.deepEqual(pending.map(item => item.status), ["PENDING", "PENDING"]);
  assert.equal(summarizeSerpResults(pending).outside, 0);
  assert.equal(summarizeSerpResults(pending).checked, 0);
  assert.equal(summarizeSerpResults(pending).pending, 2);
});

test("every actual URL keeps organic and absolute positions; a keyword counts once using its best own-site organic rank", () => {
  const model = target("claude");
  const record = task([model], { normalizedJson: { completeDepth: true, organicResults: [
    page("https://flatkey.ai/models/claude", 8, 14), page("https://flatkey.ai/blog/claude-pricing", 3, 7),
    page("https://flatkey.ai/blog/claude-pricing#fragment", 5, 9), page("https://flatkey.ai.attacker.example/model", 1),
    page("https://other.example/model", 2), page("https://flatkey.ai/invalid", 1.5), page("https://flatkey.ai/too-low", 101),
  ] } });
  const [result] = buildSerpKeywordResults([model], [record]);
  assert.equal(result.status, "RANKED"); assert.equal(result.rank, 3);
  assert.deepEqual(result.pages.map(row => [row.url, row.rankGroup, row.rankAbsolute]), [["https://flatkey.ai/blog/claude-pricing", 3, 7], ["https://flatkey.ai/models/claude", 8, 14]]);
  const stats = summarizeSerpResults([result]); assert.equal(stats.ranked, 1); assert.equal(stats.checked, 1); assert.equal(stats.buckets[0].count, 1);
  const summary = serpRankSummary(result), evidence = serpRankingEvidence(result);
  assert.equal(summary.source, "dataforseo_serp"); assert.equal(summary.serpVerification, "verified");
  assert.equal(evidence.pages[0].rankGroup, 3); assert.equal(evidence.pages[0].rankAbsolute, 7);
  assert.equal(evidence.checkedAt, "2026-10-16T03:00:00.000Z"); assert.equal(evidence.pages[1].checkedAt, evidence.checkedAt);
});

test("only a complete successful top100 check can conclude no ranking; incomplete and failures remain distinct", () => {
  const targets = ["outside", "partial", "failed", "queued", "never"].map(id => target(id));
  const records = [task([targets[0]]), task([targets[1]], { id: "partial", state: "INCOMPLETE", normalizedJson: { completeDepth: false, organicResults: [page(targets[1].targetUrls[0], 2)] } }),
    task([targets[2]], { id: "failed", state: "FAILED", normalizedJson: null, checkedAt: null, errorCode: "PROVIDER_ERROR" }),
    task([targets[3]], { id: "queued", state: "QUEUED", normalizedJson: null, checkedAt: null })];
  const results = buildSerpKeywordResults(targets, records);
  assert.deepEqual(results.map(item => item.status), ["OUTSIDE_TOP100", "INCOMPLETE", "FAILED", "QUEUED", "PENDING"]);
  assert.equal(results[1].rank, null); assert.equal(results[1].pages[0].rankGroup, 2, "partial evidence remains available without a complete-rank conclusion");
  const stats = summarizeSerpResults(results);
  assert.deepEqual([stats.total, stats.checked, stats.outside, stats.incomplete, stats.failed, stats.queued, stats.pending], [5, 1, 1, 1, 1, 1, 1]);
  const display = rankingStats(results.map(row => ({ latestRanks: { US: serpRankSummary(row) } })), "US");
  assert.deepEqual([display.checked, display.outside, display.incomplete, display.failed, display.queued, display.pending], [1, 1, 1, 1, 1, 1]);
  assert.equal(display.buckets[4].count, 1, "unknown and failed terms must not enter the no-ranking distribution");
  const malformed = buildSerpKeywordResults([targets[0]], [task([targets[0]], { checkedAt: null, normalizedJson: { completeDepth: true, organicResults: [] } })])[0];
  assert.equal(malformed.status, "INCOMPLETE");
});

test("a newer run supersedes an old positive rank even when it fails, and a captured rank remains unchanged between runs", () => {
  const model = target("claude"), old = task([model], { normalizedJson: { completeDepth: true, organicResults: [page(model.targetUrls[0], 4)] } });
  const failed = task([model], { id: "new", runId: "new-run", state: "FAILED", normalizedJson: null, checkedAt: null, runCreatedAt: "2026-11-01T02:00:00Z", updatedAt: "2026-11-01T03:00:00Z" });
  const [current] = buildSerpKeywordResults([model], [old, failed]);
  assert.equal(current.status, "FAILED"); assert.equal(current.rank, null); assert.equal(current.previousRank, 4);
  const [unchanged] = buildSerpKeywordResults([model], [old]); assert.equal(unchanged.rank, 4); assert.equal(unchanged.checkedAt, "2026-10-16T03:00:00.000Z");
  const updated = task([model], { ...failed, state: "COMPLETE", checkedAt: "2026-11-01T03:00:00Z", normalizedJson: { completeDepth: true, organicResults: [page(model.targetUrls[0], 2)] } });
  const summary = serpRankSummary(buildSerpKeywordResults([model], [old, updated])[0]);
  assert.equal(summary.previousRank, 4); assert.equal(summary.rankDelta, 2);
});

test("one shared Google query returns independent site results and cannot reuse a renamed or out-of-cohort target", () => {
  const a = target("shared"), b = target("shared", { siteDomain: "rackrate.org", targetUrls: ["https://rackrate.org/gpu"] });
  const record = task([a, b], { normalizedJson: { completeDepth: true, organicResults: [page(a.targetUrls[0], 6), page(b.targetUrls[0], 27)] } });
  const result = buildSerpKeywordResults([a, b, target("unsubmitted")], [record]);
  assert.deepEqual(result.map(row => row.rank), [6, 27, null]);
  assert.equal(buildSerpKeywordResults([{ ...a, keyword: "renamed api" }], [record])[0].status, "PENDING");
});

test("a verified brand hit is real with short SERPs, but other sites and autocorrected queries cannot become no-ranking or positive results", () => {
  const brand = target("flatkey"), other = target("flatkey", { siteDomain: "rackrate.org", targetUrls: [] });
  const partial = task([brand, other], { state: "INCOMPLETE", normalizedJson: { completeDepth: false, rankingVerified: true,
    organicResults: [page("https://flatkey.ai/", 1, 2)] } });
  const results = buildSerpKeywordResults([brand, other], [partial]);
  assert.equal(results[0].status, "RANKED"); assert.equal(results[0].rank, 1); assert.equal(results[0].depthIncomplete, true);
  assert.equal(results[1].status, "INCOMPLETE"); assert.equal(results[1].rank, null);
  const summary = summarizeSerpResults(results); assert.equal(summary.ranked, 1); assert.equal(summary.outside, 0); assert.equal(summary.partialRanked, 1); assert.equal(summary.fullDepth, 0);
  const changedQuery = { ...partial, normalizedJson: { ...partial.normalizedJson, rankingVerified: false } };
  const invalid = buildSerpKeywordResults([brand], [changedQuery])[0];
  assert.equal(invalid.status, "INCOMPLETE"); assert.equal(invalid.rank, null); assert.deepEqual(invalid.pages, []);
});

test("finished captures distinguish limited misses, corrected searches and complete top100 absences", () => {
  const models = ["limited", "outside", "corrected", "broken", "hit", "queued", "never"].map(id => target(id));
  const normalized = overrides => ({ normalizationVersion: 2, captureComplete: true, queryStatus: "EXACT", rankingVerified: true,
    completeDepth: false, organicCount: 10, coveredThroughRank: 5, maxOrganicRank: 11, correctedKeyword: null, spellType: null,
    pagesCount: 1, organicResults: [], ...overrides });
  const records = [task([models[0]], { id: "limited", normalizedJson: normalized({}) }),
    task([models[1]], { id: "outside", normalizedJson: normalized({ completeDepth: true, organicCount: 100, coveredThroughRank: 100 }) }),
    task([models[2]], { id: "corrected", normalizedJson: normalized({ queryStatus: "AUTOCORRECTED", rankingVerified: false,
      correctedKeyword: "corrected model pricing", spellType: "showing_results_for", organicResults: [page(models[2].targetUrls[0], 1)] }) }),
    task([models[3]], { id: "broken", state: "INCOMPLETE", normalizedJson: normalized({ captureComplete: false, rankingVerified: false }) }),
    task([models[4]], { id: "hit", normalizedJson: normalized({ organicResults: [page(models[4].targetUrls[0], 3)] }) }),
    task([models[5]], { id: "queued", state: "QUEUED", checkedAt: null, normalizedJson: null })];
  const results = buildSerpKeywordResults(models, records), summary = summarizeSerpResults(results);
  assert.deepEqual(results.map(row => row.status), ["NOT_FOUND_CAPTURE", "OUTSIDE_TOP100", "QUERY_CHANGED", "INCOMPLETE", "RANKED", "QUEUED", "PENDING"]);
  assert.deepEqual([summary.total, summary.captured, summary.checked, summary.notFoundCaptured, summary.queryChanged, summary.outside, summary.incomplete], [7, 4, 2, 1, 1, 1, 1]);
  assert.equal(results[0].organicCount, 10); assert.equal(results[0].coveredThroughRank, 5, "the largest returned rank cannot imply contiguous coverage");
  assert.equal(results[0].pagesCount, 1); assert.equal(results[0].rank, null); assert.equal(results[0].captureComplete, true);
  assert.equal(serpRankSummary(results[0]).rankStatus, "not_found_capture");
  assert.equal(serpRankingEvidence(results[0]).rankStatus, "not_found_capture");
  assert.equal(results[2].rank, null); assert.deepEqual(results[2].pages, []); assert.equal(results[2].correctedKeyword, "corrected model pricing");
  assert.equal(serpRankSummary(results[2]).rankStatus, "query_changed"); assert.equal(serpRankingEvidence(results[2]).queryStatus, "AUTOCORRECTED");
  assert.equal(results[4].rank, 3); assert.equal(results[4].depthIncomplete, true);
  assert.equal(summarizeSerpResults(results).buckets[0].count, 1);
});

test("old partial caches remain conservative until replay while null-projected legacy full captures remain compatible", () => {
  const model = target("legacy");
  const partial = task([model], { state: "INCOMPLETE", normalizedJson: { completeDepth: false, rankingVerified: true, organicResults: [] } });
  const [old] = buildSerpKeywordResults([model], [partial]);
  assert.equal(old.status, "INCOMPLETE"); assert.equal(old.captureComplete, false); assert.equal(old.organicCount, null);
  const [full] = buildSerpKeywordResults([model], [task([model], { normalizedJson: { normalizationVersion: null, captureComplete: null,
    completeDepth: true, rankingVerified: null, organicResults: [] } })]);
  assert.equal(full.status, "OUTSIDE_TOP100"); assert.equal(full.captureComplete, true);
});

test("limited misses and corrected queries finish the period capture without inventing ranking losses or future comparison baselines", () => {
  const models = [target("lost"), target("corrected"), target("first-rank")];
  const capture = (model, current, normalized) => task([model], { id: `${model.keywordId}-${current}`, runId: current ? "current" : "previous",
    periodKey: current ? "2026-10-2" : "2026-10-1", runCreatedAt: current ? "2026-10-16T02:00:00Z" : "2026-10-01T02:00:00Z",
    checkedAt: current ? "2026-10-16T03:00:00Z" : "2026-10-01T03:00:00Z",
    normalizedJson: { normalizationVersion: 2, captureComplete: true, queryStatus: "EXACT", rankingVerified: true,
      completeDepth: false, organicCount: 10, coveredThroughRank: 10, organicResults: [], ...normalized } });
  const records = [capture(models[0], false, { organicResults: [page(models[0].targetUrls[0], 5)] }),
    capture(models[1], false, { organicResults: [page(models[1].targetUrls[0], 4)] }), capture(models[2], false, {}),
    capture(models[0], true, {}), capture(models[1], true, { queryStatus: "AUTOCORRECTED", correctedKeyword: "different keyword", rankingVerified: false }),
    capture(models[2], true, { organicResults: [page(models[2].targetUrls[0], 3)] })];
  const results = buildSerpKeywordResults(models, records);
  assert.deepEqual(results.map(row => row.movement), ["NOT_COMPARABLE", "NOT_COMPARABLE", "FIRST_CHECK"]);
  const points = serpCheckTrendPoints(models, records, "2026-10-01", "2026-10-31"), latest = points.at(-1);
  assert.equal(latest.captured, 3); assert.equal(latest.checked, 1); assert.equal(latest.notFoundCaptured, 1); assert.equal(latest.queryChanged, 1);
  assert.equal(latest.incomplete, 0); assert.equal(latest.outside, 0); assert.equal(latest.movementSummary.droppedOut, 0);
  assert.equal(latest.movementSummary.newInTop100, 0);
});

test("biweekly Tuesday slots retain legacy snapshots and cross month/year boundaries", () => {
  assert.equal(serpPeriod("2026-10-19T03:00:00Z").key, "2026-10-06");
  assert.equal(serpPeriod("2026-10-20T02:30:00Z").key, "2026-10-20");
  assert.equal(serpPeriodFromKey("2026-10-20").label, "2026年10月第2期");
  assert.equal(nextSerpPeriodDue("2026-10-19T03:00:00Z").toISOString(), "2026-10-20T02:30:00.000Z");
  assert.equal(nextSerpPeriodDue("2026-10-20T03:00:00Z").toISOString(), "2026-11-03T02:30:00.000Z");
  assert.equal(serpPeriodFromKey("2027-01-26").dueAt, "2027-01-26T02:30:00.000Z");
  assert.equal(periodDue("2026-10-2").toISOString(), "2026-10-16T02:30:00.000Z", "historical keys retain their actual dates");
  assert.equal(serpPeriodFromKey("2028-02-2").end, "2028-02-29");
  assert.throws(() => serpPeriodFromKey("2026-10-21"));
  assert.throws(() => serpPeriodFromKey("2026-13-1"));
});

test("period comparisons distinguish first check, real new entries and dropouts; failures cannot count as lost rankings", () => {
  const models = ["up", "down", "new", "drop", "first", "same", "failed", "same-period-correction"].map(id => target(id));
  const capture = (model, rank, current, overrides = {}) => task([model], { id: `${model.keywordId}-${current ? "current" : "previous"}`, runId: current ? "current-run" : "previous-run",
    periodKey: current ? "2026-10-2" : "2026-10-1", runCreatedAt: current ? "2026-10-16T02:30:00Z" : "2026-10-01T02:30:00Z",
    checkedAt: current ? "2026-10-17T03:00:00Z" : "2026-10-02T03:00:00Z", updatedAt: current ? "2026-10-17T03:00:00Z" : "2026-10-02T03:00:00Z",
    normalizedJson: { completeDepth: true, rankingVerified: true, organicResults: rank == null ? [] : [page(model.targetUrls[0], rank)] }, ...overrides });
  const previousRanks = [5, 5, null, 4, undefined, 7, 6, 5], currentRanks = [2, 20, 10, null, 3, 7, null, 12];
  const previous = models.flatMap((model, i) => previousRanks[i] === undefined ? [] : [capture(model, previousRanks[i], false)]);
  const current = models.map((model, i) => capture(model, currentRanks[i], true, i === 6 ? { state: "FAILED", normalizedJson: null, checkedAt: null } : {}));
  const correction = capture(models[7], 3, true, { id: "earlier-correction", runCreatedAt: "2026-10-16T02:29:00Z" });
  const results = buildSerpKeywordResults(models, [...previous, ...current, correction]);
  assert.deepEqual(results.map(item => item.movement), ["UP", "DOWN", "NEW_IN_TOP100", "DROPPED_OUT", "FIRST_CHECK", "UNCHANGED", "NOT_COMPARABLE", "DOWN"]);
  assert.equal(results[7].previousRank, 5, "a same-period correction is not the preceding-period baseline");
  assert.equal(results[2].previousRankStatus, "outside_top100"); assert.equal(results[4].previousRankStatus, null);
  const summary = serpRankSummary(results[0]); assert.equal(summary.periodLabel, "2026年10月第2期"); assert.equal(summary.previousPeriodLabel, "2026年10月第1期"); assert.equal(summary.rankDelta, 3);
  const points = serpCheckTrendPoints(models, [...previous, ...current, correction], "2026-10-01", "2026-10-31");
  assert.equal(points.length, 2); assert.deepEqual(points.map(point => point.periodKey), ["2026-10-1", "2026-10-2"]);
  assert.equal(points[1].date, "2026-10-17"); assert.equal(points[1].periodStart, "2026-10-16"); assert.equal(points[1].periodEnd, "2026-10-31");
  assert.equal(points[1].captureEndAt, "2026-10-17T03:00:00.000Z");
  assert.deepEqual(points[1].movementSummary, { up: 1, down: 2, unchanged: 1, newInTop100: 1, droppedOut: 1, firstCheck: 1, notComparable: 1 });
});

test("historical period totals come from immutable run cohorts, including unchecked and failed terms, not today's added or deleted inventory", () => {
  const shared = target("shared"), retired = target("retired"), pending = target("pending"), failed = target("failed"), added = target("added");
  const first = [shared, retired, pending, failed], second = [shared, added];
  const capture = (model, rank, periodKey, overrides = {}) => task([model], { id: `${model.keywordId}-${periodKey}`, runId: periodKey,
    periodKey, runCreatedAt: periodKey.endsWith("-1") ? "2026-10-01T02:30:00Z" : "2026-10-16T02:30:00Z",
    checkedAt: periodKey.endsWith("-1") ? "2026-10-02T03:00:00Z" : "2026-10-17T03:00:00Z",
    normalizedJson: { completeDepth: true, rankingVerified: true, organicResults: rank == null ? [] : [page(model.targetUrls[0], rank)] }, ...overrides });
  const records = [capture(shared, 5, "2026-10-1"), capture(retired, 10, "2026-10-1"),
    capture(failed, null, "2026-10-1", { state: "FAILED", checkedAt: null, normalizedJson: null }),
    capture(shared, 2, "2026-10-2"), capture(added, 25, "2026-10-2")];
  const cohorts = [{ runId: "2026-10-1", periodKey: "2026-10-1", targets: first }, { runId: "2026-10-2", periodKey: "2026-10-2", targets: second }];
  for (const currentInventory of [second, [target("brand-new")], []]) {
    const points = serpCheckTrendPoints(currentInventory, records, "2026-10-01", "2026-10-31", { cohorts });
    assert.deepEqual(points.map(point => [point.total, point.ranked, point.pending, point.failed]), [[4, 2, 1, 1], [2, 2, 0, 0]]);
    assert.equal(points[1].movementSummary.up, 1); assert.equal(points[1].movementSummary.firstCheck, 1); assert.equal(points[1].movementSummary.droppedOut, 0);
  }
  const point = serpCheckTrendPoints([], records, "2026-10-10", "2026-10-31", { cohorts: [cohorts[1]] })[0];
  assert.equal(point.movementSummary.up, 1, "the first visible period may compare with an older valid baseline outside the graph range");
});

test("a site without any actual captures in a reporting period keeps a gap rather than fabricating a zero point", () => {
  const flatkey = target("shared"), rack = target("shared", { siteDomain: "rackrate.org", targetUrls: [] });
  const tasks = [task([flatkey], { normalizedJson: { completeDepth: true, organicResults: [page(flatkey.targetUrls[0], 3)] } }),
    task([rack], { id: "rack-pending", state: "PLANNED", checkedAt: null, normalizedJson: null })];
  const options = { cohorts: [{ runId: "run-one", periodKey: "2026-10-2", targets: [flatkey, rack] }], site: "rackrate.org" };
  assert.deepEqual(serpCheckTrendPoints([], tasks, "2026-10-01", "2026-10-31", options), []);
});

test("SERP trends emit real Shanghai check days only and never manufacture a daily series", () => {
  const model = target("claude"), record = task([model], { checkedAt: "2026-10-16T16:01:00Z" });
  const points = serpCheckTrendPoints([model, target("unmeasured")], [record], "2026-10-10", "2026-10-30");
  assert.equal(points.length, 1); assert.equal(points[0].date, "2026-10-17"); assert.equal(points[0].outside, 1); assert.equal(points[0].pending, 1);
  assert.deepEqual(points[0].sources, ["dataforseo_serp"]);
  assert.deepEqual(serpCheckTrendPoints([model], [], "2026-10-10", "2026-10-30"), []);
  assert.deepEqual(serpTrendRange(undefined, undefined, new Date("2026-10-16T03:00:00Z")), { start: "2026-07-19", end: "2026-10-16" });
});

test("a one-off sample preserves the 1629-target denominator and does not turn unsampled words into no rankings", () => {
  const targets = Array.from({ length: 1629 }, (_, i) => target(`model-${i}`));
  const sampleTask = (model, overrides = {}) => task([model], { id: `sample-${model.keywordId}`, runId: "sample-run",
    runScope: "SAMPLE", runTargetCount: 3, periodKey: "2026-10-2", ...overrides });
  const records = [sampleTask(targets[0], { state: "INCOMPLETE", normalizedJson: { completeDepth: false, rankingVerified: true, organicResults: [page(targets[0].targetUrls[0], 1)] } }),
    sampleTask(targets[1], { state: "INCOMPLETE", normalizedJson: { completeDepth: false, rankingVerified: true, organicResults: [] } }),
    sampleTask(targets[2], { state: "FAILED", normalizedJson: null, checkedAt: null })];
  const results = buildSerpKeywordResults(targets, records), summary = summarizeSerpResults(results);
  assert.deepEqual([summary.total, summary.ranked, summary.outside, summary.pending, summary.incomplete, summary.failed], [1629, 1, 0, 1626, 1, 1]);
  const samples = summarizeSerpSampleResults(results);
  assert.deepEqual([samples.sampledTargetCount, samples.checked, samples.incomplete, samples.failed], [3, 1, 1, 1]);
  assert.equal(serpRankSummary(results[0]).runScope, "SAMPLE"); assert.equal(serpRankSummary(results[0]).runTargetCount, 3);
  assert.equal(serpRankingEvidence(results[0]).runScope, "SAMPLE");
  const [point] = serpCheckTrendPoints([], records, "2026-10-01", "2026-10-31", {
    cohorts: [{ runId: "sample-run", periodKey: "2026-10-2", targets, runScope: "SAMPLE", runTargetCount: 3 }],
  });
  assert.equal(point.total, 1629); assert.equal(point.sampleOnly, true); assert.equal(point.sampledTargetCount, 3);
  assert.equal(point.scopeLabel, "抽样实测"); assert.deepEqual(point.runScopes, ["SAMPLE"]);
  assert.equal(point.checked, 1); assert.equal(point.pending, 1626);
});

test("sample and scheduled runs share one period without losing observations or changing the formal denominator", () => {
  const targets = [target("shared"), target("sample-only"), target("scheduled-only"), target("not-checked")];
  const sample = (model, rank) => task([model], { id: `sample-${model.keywordId}`, runId: "sample-run", periodKey: "2026-10-2",
    runScope: "SAMPLE", runTargetCount: 2, normalizedJson: { completeDepth: true, rankingVerified: true, organicResults: [page(model.targetUrls[0], rank)] } });
  const scheduled = (model, rank) => task([model], { id: `scheduled-${model.keywordId}`, runId: "scheduled-run", periodKey: "2026-10-2",
    runScope: "SCHEDULED", runTargetCount: 4, runCreatedAt: "2026-10-17T02:30:00Z", checkedAt: "2026-10-17T03:00:00Z", updatedAt: "2026-10-17T03:00:00Z",
    normalizedJson: { completeDepth: true, rankingVerified: true, organicResults: [page(model.targetUrls[0], rank)] } });
  const records = [sample(targets[0], 1), sample(targets[1], 28), scheduled(targets[0], 7), scheduled(targets[2], 42)];
  const sampleCohort = { runId: "sample-run", periodKey: "2026-10-2", targets: targets.slice(0, 2), runScope: "SAMPLE", runCreatedAt: "2026-10-16T02:30:00Z" };
  const scheduledCohort = { runId: "scheduled-run", periodKey: "2026-10-2", targets, runScope: "SCHEDULED", runCreatedAt: "2026-10-17T02:30:00Z" };
  for (const cohorts of [[sampleCohort, scheduledCohort], [scheduledCohort, sampleCohort]]) {
    const [point] = serpCheckTrendPoints([], records, "2026-10-01", "2026-10-31", { cohorts });
    assert.equal(point.total, 4); assert.equal(point.checked, 3); assert.equal(point.pending, 1);
    assert.deepEqual(point.counts, [1, 1, 1, 0]); assert.equal(point.sampleOnly, false);
    assert.equal(point.sampledTargetCount, 1); assert.equal(point.scopeLabel, "正式监控（含抽样）");
    assert.deepEqual(point.runScopes, ["SAMPLE", "SCHEDULED"]);
    assert.equal(point.movementSummary.firstCheck, 3, "same-period sample is not a previous-period comparison baseline");
  }
});

test("page readiness pauses future collection without erasing an existing rank or rewriting historical period totals", () => {
  const ready = target("ready"), build = target("build"), buildWithRank = target("build-ranked"), research = target("research");
  const formal = [ready, build, buildWithRank], saved = task([buildWithRank], {
    normalizedJson: { normalizationVersion: 2, captureComplete: true, queryStatus: "EXACT", rankingVerified: true,
      completeDepth: false, organicCount: 10, coveredThroughRank: 10, organicResults: [page(buildWithRank.targetUrls[0], 7)] } });
  const original = buildSerpKeywordResults([...formal, research], [saved]);
  const held = model => ({ ...model, reason: "PAGE_NOT_BUILT", reasonLabel: "待建设，页面上线并核实后加入监控" });
  const cohort = { targets: [ready], hash: "readiness-before", allTargetCount: 3, heldTargetCount: 2,
    heldTargets: [held(build), held(buildWithRank)] };
  const before = withSerpMonitoringEligibility(original, cohort), summary = summarizeSerpMonitoring(before, cohort);
  assert.deepEqual([summary.allTargetCount, summary.eligibleTargetCount, summary.heldTargetCount, summary.pendingTargetCount], [3, 1, 2, 1]);
  assert.equal(before[2].monitoringEligible, false); assert.equal(before[2].status, "RANKED"); assert.equal(before[2].rank, 7);
  assert.equal(before[2].pages[0].url, buildWithRank.targetUrls[0]); assert.equal(before[2].checkedAt, original[2].checkedAt);
  assert.equal(before[3].monitoringHoldCode, "NOT_FORMAL_TARGET"); assert.equal(before[3].monitoringEligible, false);
  const afterCohort = { ...cohort, targets: [ready, build], hash: "readiness-after", heldTargets: [held(buildWithRank)], heldTargetCount: 1 };
  const after = withSerpMonitoringEligibility(original, afterCohort), next = summarizeSerpMonitoring(after, afterCohort);
  assert.equal(next.pendingTargetCount, 2); assert.equal(after[1].monitoringEligible, true);
  assert.equal(after[1].status, "PENDING", "page completion changes eligibility without pretending to perform a SERP check");
  assert.equal(after[2].rank, 7); assert.equal(original[1].monitoringEligible, undefined, "display annotations do not mutate the frozen result inputs");
  const frozen = [{ runId: saved.runId, periodKey: "2026-10-2", targets: formal }];
  for (const inventory of [cohort.targets, afterCohort.targets]) {
    const [point] = serpCheckTrendPoints(inventory, [saved], "2026-10-01", "2026-10-31", { cohorts: frozen });
    assert.equal(point.total, 3); assert.equal(point.ranked, 1); assert.equal(point.movementSummary.droppedOut, 0);
  }
});

let sessionToken = null, queried = [], taskRows = [], cohortRows = [], trendCohortRows = null, readinessRows = [];
const db = {
  $queryRaw: async query => {
    queried.push(query);
    if (query.sql.includes("serp-monitor:cohort")) return cohortRows;
    if (query.sql.includes("serp-monitor:page-readiness-evidence")) return readinessRows;
    if (query.sql.includes("serp-monitor:trend-cohorts")) return trendCohortRows ?? [{ runId: "run-one", periodKey: "2026-10-2", cohortJson: cohortRows.map(row => ({ keywordId: row.keywordId, keyword: row.text, siteDomain: row.siteDomain, targetUrls: row.targetUrls })) }];
    if (query.sql.includes("serp-monitor:results")) return taskRows.filter(row => query.values.includes(row.region ?? "US"));
    if (query.sql.includes("dashboard:keywords")) return cohortRows.map(row => ({ ...row, id: row.keywordId, type: "MAIN", parentId: null, parentIds: [], topicText: "API", topicTexts: [], origin: "PLANNED", defaultVolume: 0, lastSyncedAt: null }));
    if (query.sql.includes("dashboard:ranks")) return [{ keywordId: "claude", siteDomain: "flatkey.ai", region: "US", source: "dataforseo_labs", rank: 1, rankStatus: "ranked", rankReported: true, captureStatus: "COMPLETE", periodStart: null, periodEnd: null, collectedAt: new Date("2026-10-16T01:00:00Z"), dataUpdatedAt: new Date("2026-10-01T01:00:00Z") }];
    return [];
  }, rankingImport: { findFirst: async () => null }, syncRun: { findFirst: async () => null },
};
const prismaPath = path.join(root, "src/lib/prisma.ts");
require.cache[prismaPath] = { id: prismaPath, filename: prismaPath, loaded: true, exports: { prisma: db } };
const headersPath = require.resolve("next/headers");
require.cache[headersPath] = { id: headersPath, filename: headersPath, loaded: true, exports: {
  cookies: async () => ({ get: name => name === "seo_rank_auth" && sessionToken ? { value: sessionToken } : undefined }),
} };
const { loadSerpResults, loadSerpTasks, loadSerpTrendCohorts } = require("../src/lib/services/serp-results.ts");
const { loadDashboard } = require("../src/lib/services/dashboard-data.ts");
const { GET } = require("../src/app/api/serp-monitor/results/route.ts");
const { GET: trendGET } = require("../src/app/api/seo/trends/route.ts");
const { getAuthToken } = require("../src/lib/auth.ts");
beforeEach(t => {
  sessionToken = null; queried = []; taskRows = []; cohortRows = [candidate("claude")]; trendCohortRows = null; readinessRows = [];
  process.env.DATABASE_URL = "postgresql://unused.invalid/serp-read-test"; process.env.LOGIN_PWD = "fictional-serp-read-password";
  t.mock.method(globalThis, "fetch", async () => assert.fail("a ranking read must never call a paid provider"));
});

test("API and keyword details share saved readiness while ready-page candidates remain outside paid scope", async () => {
  cohortRows = [candidate("ready"), candidate("gap"), candidate("build"), candidate("build-ranked"), candidate("research", { pool: "RESEARCH" })];
  const proof = (id, verdict, action) => ({ siteDomain: "flatkey.ai", sourceId: PAGE_AUDIT_SOURCE_ID, rowKey: `keyword:${id}`,
    snapshot: { keywordId: id, verdict, pageUrl: target(id).targetUrls[0], workPlan: { action, pageUrls: [target(id).targetUrls[0]] } } });
  readinessRows = [proof("ready", "VERIFIED", "LINK"), proof("gap", "CONTENT_GAP", "EXPAND"),
    proof("build", "NO_MATCH", "BUILD"), proof("build-ranked", "NO_MATCH", "BUILD"), proof("research", "VERIFIED", "LINK")];
  taskRows = [task([target("build-ranked")], { normalizedJson: { completeDepth: true, organicResults: [page(target("build-ranked").targetUrls[0], 7)] } })];
  const result = await loadSerpResults("all", "US");
  assert.equal(result.summary.total, 4); assert.equal(result.items.length, 4); assert.equal(result.summary.ranked, 1);
  assert.deepEqual([result.monitoring.allTargetCount, result.monitoring.eligibleTargetCount, result.monitoring.heldTargetCount,
    result.monitoring.pendingTargetCount, result.monitoring.capturedTargetCount], [4, 2, 2, 2, 0]);
  const build = result.items.find(item => item.keywordId === "build"), ranked = result.items.find(item => item.keywordId === "build-ranked");
  assert.equal(build.monitoringEligible, false); assert.equal(build.monitoringHoldCode, "PAGE_NOT_BUILT");
  assert.equal(ranked.monitoringEligible, false); assert.equal(ranked.rank, 7);
  const dashboard = await loadDashboard("all", "dataforseo_serp", "week", new Date("2026-10-16T03:00:00Z"), true);
  assert.equal(dashboard.keywords.length, 5);
  assert.equal(dashboard.keywords.find(item => item.id === "flatkey.ai:gap").monitoringEligible, true, "existing pages needing optimization remain monitorable");
  assert.equal(dashboard.keywords.find(item => item.id === "flatkey.ai:research").monitoringEligible, false, "a research candidate is never promoted by its nonempty or verified page");
  assert.equal(dashboard.keywords.find(item => item.id === "flatkey.ai:build-ranked").latestRanks.US.rank, 7);
  readinessRows = readinessRows.filter(row => row.rowKey !== "keyword:build").concat(proof("build", "VERIFIED", "LINK"));
  const next = await loadSerpResults("all", "US");
  assert.equal(next.monitoring.eligibleTargetCount, 3); assert.equal(next.monitoring.pendingTargetCount, 3);
  assert.notEqual(next.monitoring.hash, result.monitoring.hash); assert.equal(next.summary.ranked, 1);
});

test("four countries in one sample run remain independent 38-word samples against the same 1629-word inventory", async () => {
  sessionToken = await getAuthToken();
  cohortRows = Array.from({ length: 1629 }, (_, i) => candidate(`model-${i}`));
  const targets = cohortRows.map(row => target(row.keywordId));
  const ranks = { US: 1, JP: 11, ES: 31, BR: 51 }, languages = { US: "en", JP: "ja", ES: "es", BR: "pt" };
  taskRows = Object.entries(ranks).flatMap(([region, rank]) => targets.slice(0, 38).map(model => task([model], {
    id: `${region}-${model.keywordId}`, runId: "four-country-sample", periodKey: "2026-10-2", region,
    runScope: "SAMPLE", runTargetCount: 38,
    normalizedJson: { completeDepth: true, rankingVerified: true, organicResults: [page(model.targetUrls[0], rank)] },
  })));
  trendCohortRows = [{ runId: "four-country-sample", periodKey: "2026-10-2", runScope: "SAMPLE", runTargetCount: 38,
    cohortJson: targets, runCreatedAt: new Date("2026-10-16T02:00:00Z") }];
  for (const [region, rank] of Object.entries(ranks)) {
    const response = await GET(new Request(`https://flatkey.test/api/serp-monitor/results?region=${region}`));
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.region, region); assert.equal(body.languageCode, languages[region]);
    assert.deepEqual([body.summary.total, body.summary.checked, body.summary.pending, body.summary.outside], [1629, 38, 1591, 0]);
    assert.equal(body.sampleSummary.sampledTargetCount, 38); assert.equal(body.items[0].rank, rank);
    assert.equal(body.items[0].runTargetCount, 38, "152 country queries are still only 38 sampled target words per market");
    const frozen = await loadSerpTrendCohorts(region, "2026-10-01", "2026-10-31");
    const records = await loadSerpTasks(region, undefined, "desktop", "2026-10-01", "2026-10-31");
    assert.equal(records.length, 38); assert.ok(records.every(row => row.region === region));
    const [point] = serpCheckTrendPoints([], records, "2026-10-01", "2026-10-31", { cohorts: frozen });
    assert.equal(point.total, 1629); assert.equal(point.checked, 38); assert.equal(point.sampledTargetCount, 38); assert.equal(point.sampleOnly, true);
  }
  const cohortQuery = queried.find(query => query.sql.includes("serp-monitor:trend-cohorts"));
  assert.match(cohortQuery.sql, /EXISTS[\s\S]+t\.region/);
  assert.match(cohortQuery.sql, /'regions'[\s\S]+jsonb_build_array/);
  const resultQuery = queried.find(query => query.sql.includes("serp-monitor:results"));
  assert.match(resultQuery.sql, /WHERE t\.region/);
  assert.match(resultQuery.sql, /requestJson[\s\S]+language_code/);
});

test("all-country overview counts business targets once, shares readiness reads and keeps country buckets independent", async () => {
  sessionToken = await getAuthToken();
  cohortRows = Array.from({ length: 1629 }, (_, i) => candidate(`model-${i}`));
  const targets = cohortRows.map(row => target(row.keywordId));
  const ranks = { US: 1, JP: 11, ES: 31, BR: 51 };
  readinessRows = targets.slice(0, 40).map(model => ({ siteDomain: model.siteDomain, sourceId: PAGE_AUDIT_SOURCE_ID, rowKey: `keyword:${model.keywordId}`,
    snapshot: { keywordId: model.keywordId, verdict: "VERIFIED", pageUrl: model.targetUrls[0], workPlan: { action: "LINK", pageUrls: model.targetUrls } } }));
  taskRows = Object.entries(ranks).flatMap(([region, rank]) => targets.slice(0, region === "JP" ? 39 : 38).map(model => task([model], {
    id: `${region}-${model.keywordId}`, runId: "four-country", region,
    normalizedJson: { normalizationVersion: 2, captureComplete: true, queryStatus: "EXACT", rankingVerified: true,
      completeDepth: false, organicCount: 80, coveredThroughRank: 80, organicResults: [page(model.targetUrls[0], rank)] },
  })));
  const response = await GET(new Request("https://flatkey.test/api/serp-monitor/results?region=all"));
  assert.equal(response.status, 200); assert.equal(response.headers.get("Cache-Control"), "private, no-store");
  const body = await response.json();
  assert.equal(body.region, "all"); assert.deepEqual([body.summary.total, body.summary.rankedInAnyRegion, body.summary.capturedInAnyRegion], [1629, 39, 39]);
  assert.equal(body.summary.rankedRecords, 153);
  assert.deepEqual(body.summary.buckets.map(bucket => bucket.count), [38, 1, 0, 0], "the total uses each word's best known country rank once");
  assert.deepEqual([body.monitoring.allTargetCount, body.monitoring.eligibleTargetCount, body.monitoring.heldTargetCount], [1629, 40, 1589]);
  assert.deepEqual(body.regions.map(result => result.region), ["US", "JP", "ES", "BR"]);
  assert.deepEqual(body.regions.map(result => result.summary.buckets.map(bucket => bucket.count)), [[38, 0, 0, 0], [0, 39, 0, 0], [0, 0, 38, 0], [0, 0, 0, 38]]);
  assert.deepEqual(body.regions.map(result => result.rankedCount), [38, 39, 38, 38]);
  assert.equal(body.regions[1].targetSharePercent, 39 / 1629 * 100);
  assert.equal(body.regions[1].rankingRecordSharePercent, 39 / 153 * 100);
  assert.deepEqual(body.regions.map(result => result.monitoring.pendingTargetCount), [2, 1, 2, 2]);
  assert.equal(queried.filter(query => query.sql.includes("serp-monitor:cohort")).length, 1);
  assert.equal(queried.filter(query => query.sql.includes("serp-monitor:page-readiness-evidence")).length, 1);
  assert.equal(queried.filter(query => query.sql.includes("serp-monitor:results")).length, 4);
  for (const field of ["rawResponse", "requestJson", "encryptedCredentials", "submissionRaw", "organicResults", "\"items\""])
    assert.ok(!JSON.stringify(body).includes(field), `${field} must not leave the aggregate endpoint`);
  assert.equal((await GET(new Request("https://flatkey.test/api/serp-monitor/results?region=all&language=en"))).status, 400);
  assert.equal((await GET(new Request("https://flatkey.test/api/serp-monitor/results?region=all&device=mobile"))).status, 400);
});

test("SERP read API requires a session, reads only the selected market ledger and leaks no raw responses", async () => {
  assert.equal((await GET(new Request("https://flatkey.test/api/serp-monitor/results"))).status, 401); assert.equal(queried.length, 0);
  sessionToken = await getAuthToken(); taskRows = [task([target("claude")])];
  const response = await GET(new Request("https://flatkey.test/api/serp-monitor/results?region=US"));
  assert.equal(response.status, 200); assert.equal(response.headers.get("Cache-Control"), "private, no-store");
  const body = await response.json(); assert.equal(body.summary.total, 1); assert.equal(body.summary.outside, 1);
  const query = queried.find(query => query.sql.includes("serp-monitor:results"));
  assert.ok(query.values.includes("US")); assert.ok(query.values.includes("en")); assert.ok(query.values.includes("desktop"));
  for (const field of ["rawResponse", "requestJson", "encryptedCredentials", "submissionRaw"]) assert.ok(!JSON.stringify(body).includes(field));
  assert.equal((await GET(new Request("https://flatkey.test/api/serp-monitor/results?site=evil.example"))).status, 400);
  const jp = await loadSerpResults("all", "JP"); assert.equal(jp.summary.pending, 1); assert.equal(jp.summary.outside, 0);
});

test("default dashboard keeps Labs as historical evidence and does not invent SERP positions or no-ranking counts", async () => {
  const dashboard = await loadDashboard("all");
  assert.equal(dashboard.keywords[0].latestRanks.US, null);
  assert.equal(dashboard.keywords[0].rankingEvidence.US[0].source, "dataforseo_labs");
  assert.equal(rankingStats(dashboard.keywords, "US").pending, 1);
  assert.equal(rankingStats(dashboard.keywords, "US").outside, 0);
  taskRows = [task([target("claude")], { normalizedJson: { completeDepth: true, organicResults: [page("https://flatkey.ai/models/claude", 8)] } })];
  const measured = await loadDashboard("all");
  assert.equal(measured.keywords[0].latestRanks.US.rank, 8); assert.equal(measured.keywords[0].latestRanks.US.source, "dataforseo_serp");
  assert.equal(measured.keywords[0].rankingEvidence.US[0].serpVerification, "verified");
  assert.equal(measured.keywords[0].rankingEvidence.US[1].source, "dataforseo_labs");
});

test("default trend API reads only actual SERP checks with a 90-day window and no historical-provider fallback", async () => {
  const NativeDate = Date, fixed = NativeDate.parse("2026-10-16T04:00:00Z");
  global.Date = class extends NativeDate { constructor(...args) { super(...(args.length ? args : [fixed])); } static now() { return fixed; } };
  try {
    let response = await trendGET(new Request("https://flatkey.test/api/seo/trends?refresh=1"));
    assert.equal(response.status, 200); let body = await response.json();
    assert.equal(body.schemaVersion, 4); assert.equal(body.mode, "serp-checks"); assert.deepEqual(body.points, []);
    assert.deepEqual([body.start, body.end], ["2026-07-19", "2026-10-16"]);
    assert.ok(queried.every(query => !query.sql.includes("KeywordObservation")), "GSC/Labs rows are never queried for the primary trend");
    taskRows = [task([target("claude")])]; queried = [];
    response = await trendGET(new Request("https://flatkey.test/api/seo/trends?refresh=1")); body = await response.json();
    assert.equal(body.points.length, 1); assert.equal(body.points[0].outside, 1); assert.equal(body.points[0].date, "2026-10-16");
    const read = queried.find(query => query.sql.includes("serp-monitor:results"));
    assert.ok(read.values.includes("2026-07-19")); assert.ok(read.values.includes("2026-10-16"));
    assert.equal((await trendGET(new Request("https://flatkey.test/api/seo/trends?end=2026-10-17"))).status, 400);
  } finally { global.Date = NativeDate; }
});
