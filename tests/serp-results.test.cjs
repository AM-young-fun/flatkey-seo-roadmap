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
const { buildSerpKeywordResults, summarizeSerpResults, serpRankSummary, serpRankingEvidence } = require("../src/lib/serp-results.ts");
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

test("monthly reporting periods use Shanghai 1st/16th boundaries, retain the year and handle leap years and year transitions", () => {
  assert.equal(serpPeriod("2026-10-15T15:59:59Z").key, "2026-10-1");
  assert.equal(serpPeriod("2026-10-15T16:00:00Z").key, "2026-10-2");
  assert.deepEqual(serpPeriodFromKey("2026-10-1"), { key: "2026-10-1", label: "2026年10月第1期", start: "2026-10-01", end: "2026-10-15", dueAt: "2026-10-01T02:30:00.000Z" });
  assert.equal(serpPeriodFromKey("2028-02-2").end, "2028-02-29");
  assert.equal(serpPeriodFromKey("2027-02-2").end, "2027-02-28");
  assert.equal(nextSerpPeriodDue("2026-12-20T03:00:00Z").toISOString(), "2027-01-01T02:30:00.000Z");
  assert.equal(nextSerpPeriodDue("2026-10-01T03:00:00Z").toISOString(), "2026-10-16T02:30:00.000Z");
  assert.equal(periodDue("2026-10-2").toISOString(), "2026-10-16T02:30:00.000Z");
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

let sessionToken = null, queried = [], taskRows = [], cohortRows = [];
const db = {
  $queryRaw: async query => {
    queried.push(query);
    if (query.sql.includes("serp-monitor:cohort")) return cohortRows;
    if (query.sql.includes("serp-monitor:trend-cohorts")) return [{ runId: "run-one", periodKey: "2026-10-2", cohortJson: cohortRows.map(row => ({ keywordId: row.keywordId, keyword: row.text, siteDomain: row.siteDomain, targetUrls: row.targetUrls })) }];
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
const { loadSerpResults } = require("../src/lib/services/serp-results.ts");
const { loadDashboard } = require("../src/lib/services/dashboard-data.ts");
const { GET } = require("../src/app/api/serp-monitor/results/route.ts");
const { GET: trendGET } = require("../src/app/api/seo/trends/route.ts");
const { getAuthToken } = require("../src/lib/auth.ts");
beforeEach(t => {
  sessionToken = null; queried = []; taskRows = []; cohortRows = [candidate("claude")];
  process.env.DATABASE_URL = "postgresql://unused.invalid/serp-read-test"; process.env.LOGIN_PWD = "fictional-serp-read-password";
  t.mock.method(globalThis, "fetch", async () => assert.fail("a ranking read must never call a paid provider"));
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
