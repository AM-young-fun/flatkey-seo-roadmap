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
const { eligibleTrendKeywords, trendPeriod, weeklyEvidenceTrendPoints, labsSnapshotTrendPoints, recentTrendRange } = require("../src/lib/ranking-trends.ts");
const { labsReportingPeriod } = require("../src/lib/ranking-evidence.ts");
const { rankingStats } = require("../src/lib/rank-display.ts");
const keyword = (id, overrides = {}) => ({ keywordId: id, text: `${id} api`, siteDomain: "flatkey.ai", active: true, keywordActive: true, siteActive: true, topicId: "topic", pool: "FORMAL", ...overrides });
const observation = (id, overrides = {}) => ({ id: `report-${id}`, keywordId: id, siteDomain: "flatkey.ai", region: "US", source: "gsc", rank: 7, rankStatus: "ranked", rankReported: true,
  periodStart: new Date("2026-10-09T00:00:00Z"), periodEnd: new Date("2026-10-15T00:00:00Z"), collectedAt: new Date("2026-10-16T02:00:00Z"), importedAt: new Date("2026-10-16T02:01:00Z"), ...overrides });
const point = (keys, reports, date = "2026-10-15") => weeklyEvidenceTrendPoints(keys, reports, "US", date, date)[0];

test("trend eligibility matches active business inventory and excludes Flatkey research without affecting other-site business terms", () => {
  const rows = [keyword("formal"), keyword("research", { pool: "RESEARCH" }), keyword("noise", { text: "yes" }),
    keyword("rack-noise", { siteDomain: "rackrate.org", text: '"compare the market"', pool: "RESEARCH" }),
    keyword("rack-business", { siteDomain: "rackrate.org", text: "gpu cloud cost", pool: "RESEARCH" }),
    keyword("model-business", { siteDomain: "modelfit.cc", pool: "RESEARCH" }),
    keyword("disabled", { active: false }), keyword("keyword-disabled", { keywordActive: false }),
    keyword("site-disabled", { siteActive: false }), keyword("unassigned", { topicId: null }), keyword("foreign", { siteDomain: "foreign.example" })];
  assert.deepEqual(eligibleTrendKeywords(rows).map(row => row.keywordId), ["formal", "rack-business", "model-business"]);
  const result = point(rows, rows.map(row => observation(row.keywordId, { siteDomain: row.siteDomain })));
  assert.equal(result.total, 3);
  assert.equal(result.ranked, 3);
});

test("each report-period point has a complete current cohort, even when no weekly query evidence exists", () => {
  const keys = [keyword("ranked"), keyword("not-yet-measured"), keyword("outside"), keyword("no-data")];
  const result = point(keys, [observation("ranked"), observation("outside", { rank: null, rankStatus: "outside_top100" }), observation("no-data", { rank: null, rankStatus: "no_data" })]);
  assert.equal(result.total, 4);
  assert.equal(result.ranked, 1);
  assert.equal(result.pending, 2);
  assert.equal(result.outside, 1);
  assert.deepEqual(result.counts, [1, 0, 0, 0]);
  assert.equal(result.total, result.ranked + result.pending + result.outside);
  assert.equal(result.periodStart, "2026-10-09");
  assert.equal(result.periodEnd, "2026-10-15");
  const empty = point(keys, []);
  assert.equal(empty.total, 4);
  assert.equal(empty.pending, 4);
  assert.deepEqual(empty.counts, [0, 0, 0, 0]);
});

test("single-day GSC, 28/90-day reports, and undated or expired Ahrefs cannot become weekly query ranks", () => {
  const keys = ["daily", "28d", "90d", "undated", "expired"].map(id => keyword(id));
  const reports = [
    observation("daily", { periodStart: new Date("2026-10-15"), periodEnd: new Date("2026-10-15") }),
    observation("28d", { periodStart: new Date("2026-09-18") }),
    observation("90d", { periodStart: new Date("2026-07-18") }),
    observation("undated", { source: "ahrefs", periodStart: null, periodEnd: null, dataUpdatedAt: null }),
    observation("expired", { source: "ahrefs", dataUpdatedAt: new Date("2026-10-08T15:59:00Z") }),
  ];
  const result = point(keys, reports);
  assert.equal(result.ranked, 0);
  assert.equal(result.pending, 5);
  assert.equal(result.outside, 0);
});

test("rolling report periods never carry an old weekly rank into a missing subsequent week", () => {
  const reports = [observation("a", { periodStart: new Date("2026-10-08"), periodEnd: new Date("2026-10-14") })];
  const points = weeklyEvidenceTrendPoints([keyword("a")], reports, "US", "2026-10-14", "2026-10-15");
  assert.deepEqual(points.map(row => [row.periodStart, row.periodEnd, row.ranked, row.pending]), [["2026-10-08", "2026-10-14", 1, 0], ["2026-10-09", "2026-10-15", 0, 1]]);
});

test("late imported reports correct their real report period rather than fabricating collection history", () => {
  const reports = [observation("late", { collectedAt: new Date("2026-10-18"), importedAt: new Date("2026-10-18"), periodStart: new Date("2026-10-08"), periodEnd: new Date("2026-10-14") })];
  const result = point([keyword("late")], reports, "2026-10-14");
  assert.equal(result.ranked, 1);
  assert.equal(result.date, "2026-10-14");
});

test("source selection, corrections and no_data exactly follow the dashboard evidence helpers", () => {
  const keys = [keyword("a"), keyword("b"), keyword("c"), keyword("d")];
  const reports = [
    observation("a", { rank: 4 }),
    observation("a", { id: "a-new-ahrefs", source: "ahrefs", rank: 41, periodStart: new Date("2026-09-01"), periodEnd: new Date("2026-09-30"), dataUpdatedAt: new Date("2026-10-15T07:00:00Z") }),
    observation("b", { rank: 8 }),
    observation("b", { id: "b-corrected", rank: null, rankStatus: "no_data", collectedAt: new Date("2026-10-16T03:00:00Z") }),
    observation("c", { source: "ahrefs", rank: 100.1, rankStatus: "outside_top100", dataUpdatedAt: new Date("2026-10-14T07:00:00Z") }),
    observation("d", { rank: 10.5 }),
  ];
  const result = point(keys, reports);
  const dashboardRows = keys.map(row => ({ ...row, id: row.keywordId, type: "MAIN", parentId: null, parentIds: [], topicText: "API", topicTexts: [], origin: "PLANNED", targetUrls: [], defaultVolume: 0, lastSyncedAt: null }));
  const dashboard = assembleDashboard("all", [], dashboardRows, reports, [], null, null, [], { ...trendPeriod("2026-10-15"), label: "test" }, "combined");
  const ranked = dashboard.keywords.filter(row => row.latestRanks.US?.rank >= 1 && row.latestRanks.US?.rank <= 100).length;
  const stats = rankingStats(dashboard.keywords, "US");
  assert.equal(result.ranked, ranked);
  assert.equal(result.ranked, stats.ranked);
  assert.equal(result.pending, stats.pending);
  assert.equal(result.outside, stats.total - stats.ranked - stats.pending);
  assert.deepEqual(result.counts, stats.buckets.slice(0, 4).map(row => row.count));
  assert.equal(dashboard.keywords.find(row => row.text === "a api").latestRanks.US.rank, 41);
  assert.deepEqual(result.counts, [0, 1, 1, 0]);
  assert.equal(result.pending, 1);
  assert.equal(result.outside, 1);
  assert.equal(result.total, 4);
});

test("deduplication is by site and keyword, including source duplicates, while countries stay separate", () => {
  const keys = [keyword("shared"), keyword("shared"), keyword("shared", { siteDomain: "modelfit.cc" })];
  const reports = [observation("shared"), observation("shared", { source: "ahrefs", dataUpdatedAt: new Date("2026-10-15T02:00:00Z"), rank: 22 }),
    observation("shared", { region: "JP", rank: 88 }), observation("shared", { siteDomain: "modelfit.cc", rank: 60 })];
  const result = point(keys, reports);
  assert.equal(result.total, 2);
  assert.equal(result.ranked, 2);
  assert.equal(result.counts.reduce((sum, value) => sum + value, 0), 2);
});

test("Labs recent dates include today and match the default collection window", () => {
  const before = new Date("2026-10-14T15:59:00Z"), after = new Date("2026-10-14T16:00:00Z");
  assert.deepEqual(recentTrendRange(before), { start: "2026-10-08", end: "2026-10-14" });
  assert.deepEqual(recentTrendRange(after), { start: "2026-10-09", end: "2026-10-15" });
  const now = new Date("2026-10-16T03:00:00Z"), range = recentTrendRange(now), week = labsReportingPeriod(now);
  assert.deepEqual(range, { start: week.start, end: week.end });
  assert.deepEqual(range, { start: "2026-10-10", end: "2026-10-16" });
});

const labs = (id, overrides = {}) => observation(id, { source: "dataforseo_labs", captureId:"labs-capture", captureStatus:"COMPLETE", periodStart: null, periodEnd: null,
  collectedAt: new Date("2026-10-16T02:00:00Z"), dataUpdatedAt: new Date("2026-10-01T00:00:00Z"), rank: 12, ...overrides });
test("Labs trends emit real collection days only, preserving old SERP dates and the entire site cohort", () => {
  const keys = [keyword("a"), keyword("b"), keyword("c", { siteDomain: "rackrate.org" })];
  assert.deepEqual(labsSnapshotTrendPoints(keys, [observation("a")], "US", "2026-10-09", "2026-10-16"), []);
  const points = labsSnapshotTrendPoints(keys, [labs("a"), labs("b", {region:"JP"})], "US", "2026-10-09", "2026-10-16");
  assert.equal(points.length, 1);
  assert.equal(points[0].date, "2026-10-16");
  assert.equal(points[0].total, 3);
  assert.equal(points[0].ranked, 1);
  assert.equal(points[0].pending, 2);
  assert.equal(points[0].outside, 0);
  assert.deepEqual(points[0].dataDates, ["2026-10-01T00:00:00.000Z"]);
  assert.deepEqual(labsSnapshotTrendPoints(keys, [labs("a")], "JP", "2026-10-09", "2026-10-16"), []);
});
test("new Labs no_data replaces an earlier rank on its collection day without resurrecting GSC or implying outside", () => {
  const points = labsSnapshotTrendPoints([keyword("a")], [labs("a"), labs("a", { rank: null, rankStatus:"no_data", dataUpdatedAt:null,
    collectedAt:new Date("2026-10-16T03:00:00Z") }), observation("a", {rank:1})], "US", "2026-10-09", "2026-10-16");
  assert.equal(points[0].ranked, 0);
  assert.equal(points[0].pending, 1);
  assert.equal(points[0].outside, 0);
});

let queryCalls = [], trendObservations = [];
const db = { $queryRaw: async query => {
  queryCalls.push(query);
  if (query.sql.includes("labs-trends:cohort")) return [keyword("formal"), keyword("research", { pool: "RESEARCH" })];
  if (query.sql.includes("labs-trends:bounded-observations")) return trendObservations;
  throw new Error("unexpected SQL");
} };
const prismaPath = path.join(root, "src/lib/prisma.ts");
require.cache[prismaPath] = { id: prismaPath, filename: prismaPath, loaded: true, exports: { prisma: db } };
const { assembleDashboard } = require("../src/lib/services/dashboard-data.ts");
const { GET } = require("../src/app/api/seo/trends/route.ts");
test("trend API emits v3 Labs snapshots including today, never reads GSC periods, and refreshes cached reads", async () => {
  const NativeDate = Date, fixed = NativeDate.parse("2026-10-16T04:00:00Z");
  global.Date = class extends NativeDate { constructor(...args) { super(...(args.length ? args : [fixed])); } static now() { return fixed; } };
  try {
    queryCalls=[];trendObservations=[labs("formal"), labs("research")];
    const response=await GET(new Request("http://localhost/api/seo/trends?region=US"));
    assert.equal(response.status,200);const result=await response.json();
    assert.equal(result.schemaVersion,3);assert.equal(result.mode,"labs-snapshots");
    assert.deepEqual([result.start,result.end],["2026-10-10","2026-10-16"]);
    assert.equal(result.points.length,1);assert.equal(result.points[0].ranked,1);assert.equal(result.points[0].total,1);
    assert.equal(queryCalls.length,2);assert.ok(queryCalls[1].sql.includes("o.source = 'dataforseo_labs'"));
    assert.ok(queryCalls[1].sql.includes('"collectedAt"'));assert.ok(!queryCalls[1].values.includes("research"));
    await GET(new Request("http://localhost/api/seo/trends?region=US"));assert.equal(queryCalls.length,2);
    await GET(new Request("http://localhost/api/seo/trends?region=US&refresh=1"));assert.equal(queryCalls.length,4);
    const future=await GET(new Request("http://localhost/api/seo/trends?end=2026-10-17"));assert.equal(future.status,400);
    const noData=await GET(new Request("http://localhost/api/seo/trends?region=JP"));assert.deepEqual((await noData.json()).points,[]);
  } finally {global.Date=NativeDate;trendObservations=[];}
});
