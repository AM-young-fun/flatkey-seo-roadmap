const assert = require("node:assert/strict");
const { test, beforeEach } = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");
const root = path.resolve(__dirname, "..");
const resolve = Module._resolveFilename;
Module._resolveFilename = function (name, parent, ...rest) { return resolve.call(this, name.startsWith("@/") ? path.join(root, "src", name.slice(2)) : name, parent, ...rest); };
require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText, filename);
const mockFile = (relative, exports) => { const filename = path.join(root, relative); require.cache[filename] = { id: filename, filename, loaded: true, exports }; };
let calls, failMarket, failCohort, scopedHistory;
const target = id => ({ keywordId: id, keyword: `${id} api pricing`, siteDomain: "flatkey.ai", targetUrls: [`https://flatkey.ai/models/${id}`] });
const frozenTargets = [target("claude"), target("deepseek")];
const task = (region, rank) => ({ id: `task-${region}`, runId: "frozen-run", region, keyword: frozenTargets[0].keyword, targetsJson: [frozenTargets[0]],
  state: "COMPLETE", checkedAt: "2026-10-16T03:00:00Z", providerTaskId: `provider-${region}`, errorCode: null,
  periodKey: "2026-10-2", periodLabel: "2026年10月2期", periodStart: "2026-10-16", periodEnd: "2026-10-31", runScope: "SCHEDULED", runTargetCount: 1,
  runCreatedAt: "2026-10-16T02:00:00Z", updatedAt: "2026-10-16T03:00:00Z", normalizedJson: {
    normalizationVersion: 2, captureComplete: true, rankingVerified: true, queryStatus: "EXACT", completeDepth: false,
    checkedAt: "2026-10-16T03:00:00Z", organicCount: 10, coveredThroughRank: 10,
    organicResults: rank === null ? [] : [rank, rank + 2].map((rankGroup, i) => ({ url: `https://flatkey.ai/models/claude-${i}`, domain: "flatkey.ai", rankGroup, rankAbsolute: rankGroup + 1, title: "Result" })),
  } });
mockFile("src/lib/prisma.ts", { prisma: new Proxy({}, { get() { throw new Error("trends must use only the shared ledger readers"); } }) });
mockFile("src/lib/services/serp-results.ts", {
  loadSerpTrendCohorts: async (region, start, end) => {
    calls.push(["cohort", region, start, end]);
    if (failCohort) throw new Error("fictional cohort unavailable");
    return scopedHistory ? [
      { runId: "frozen-run", periodKey: "2026-10-2", targets: frozenTargets, runScope: "SCHEDULED", runTargetCount: 1, runCreatedAt: "2026-10-16T02:00:00Z", regions: ["US"] },
      { runId: "frozen-jp-run", periodKey: "2026-10-2", targets: [...frozenTargets, target("previous-jp-word")], runScope: "SCHEDULED", runTargetCount: 1, runCreatedAt: "2026-10-16T01:00:00Z", regions: ["JP"] },
    ] : [{ runId: "frozen-run", periodKey: "2026-10-2", targets: frozenTargets, runScope: "SCHEDULED", runTargetCount: 1, runCreatedAt: "2026-10-16T02:00:00Z" }];
  },
  loadSerpTasks: async region => {
    calls.push(["tasks", region]);
    if (region === "all" && failMarket) throw new Error("fictional batch unavailable");
    if (region === failMarket) throw new Error("fictional market unavailable");
    return (region === "all" ? ["US", "JP", "BR"] : region === "ES" ? [] : [region]).map(market => ({ ...task(market, market === "BR" ? null : market === "JP" ? 20 : 3), ...(scopedHistory && market === "JP" ? { runId: "frozen-jp-run", runCreatedAt: "2026-10-16T01:00:00Z" } : {}) }));
  },
});
const { GET } = require("../src/app/api/seo/trends/route.ts");
const { combinedSerpTrendPoints, multiRegionTrendPeriods, marketTrendCount, serpCheckTrendFrames } = require("../src/lib/ranking-trends.ts");
const { REGION_CODES } = require("../src/lib/seo.ts");
const request = extra => new Request(`https://flatkey.test/api/seo/trends?region=all&start=2026-10-08&end=2026-10-16&refresh=1${extra ?? ""}`);
beforeEach(t => { calls = []; failMarket = null; failCohort = false; scopedHistory = false; t.mock.method(globalThis, "fetch", async () => { throw new Error("no provider requests from a trend read"); }); });

test("one four-market read shares the immutable cohort and keeps failed, missing and measured-zero countries distinct", async () => {
  failMarket = "JP";
  const response = await GET(request()), body = await response.json();
  assert.equal(response.status, 200); assert.equal(body.schemaVersion, 5); assert.equal(body.mode, "serp-markets");
  assert.deepEqual(body.markets.map(market => market.region), REGION_CODES);
  assert.deepEqual(calls.filter(call => call[0] === "cohort"), [["cohort", "all", "2026-10-08", "2026-10-16"]]);
  assert.deepEqual(calls.filter(call => call[0] === "tasks").map(call => call[1]).sort(), ["all", ...REGION_CODES].sort());
  const markets = Object.fromEntries(body.markets.map(market => [market.region, market]));
  assert.equal(markets.US.points[0].total, 2, "frozen full inventory stays the historical denominator even though only one word was selected");
  assert.equal(markets.US.points[0].ranked, 1, "multiple ranking pages count once within one country");
  assert.equal(markets.JP.status, "ERROR"); assert.equal(markets.JP.points, null);
  assert.equal(body.points, null, "a failed country cannot become zero in the combined trend");
  assert.equal(markets.ES.status, "READY"); assert.deepEqual(markets.ES.points, []);
  assert.equal(markets.BR.points[0].ranked, 0); assert.equal(markets.BR.points[0].captured, 1);
  const [period] = multiRegionTrendPeriods(body.markets);
  assert.deepEqual(REGION_CODES.map(region => marketTrendCount(period.points[region])), [1, null, null, 0]);
  assert.equal(globalThis.fetch.mock.callCount(), 0);
});

test("the total trend counts a keyword once across countries and websites while keeping the immutable snapshot intact", async t => {
  frozenTargets.push({ ...frozenTargets[0], siteDomain: "rackrate.org", targetUrls: ["https://rackrate.org/models/claude"] });
  t.after(() => frozenTargets.pop());
  const response = await GET(request()), body = await response.json(), [period] = multiRegionTrendPeriods(body.markets);
  assert.deepEqual(calls.filter(call => call[0] === "tasks"), [["tasks", "all"]], "one healthy ledger query serves all four countries");
  assert.equal(marketTrendCount(period.points.US), 1); assert.equal(marketTrendCount(period.points.JP), 1);
  assert.equal(period.points.US.total, 2); assert.equal(period.points.JP.total, 2);
  assert.equal(period.points.US.captureStartAt, "2026-10-16T03:00:00.000Z");
  assert.equal(body.points[0].ranked, 1); assert.deepEqual(body.points[0].counts, [1, 0, 0, 0]);
  assert.equal(body.points[0].total, 2); assert.equal(body.points[0].movementSummary, undefined);
  assert.equal(frozenTargets.length, 3, "display deduplication must not rewrite the saved site-target inventory");
  assert.equal(globalThis.fetch.mock.callCount(), 0);
});

test("each country keeps its own frozen historical cohort when another country's newer run exists in the same period", async () => {
  scopedHistory = true;
  const response = await GET(request()), body = await response.json();
  const countries = Object.fromEntries(body.markets.map(market => [market.region, market]));
  assert.equal(countries.US.points[0].total, 2); assert.equal(countries.JP.points[0].total, 3);
  assert.deepEqual(countries.BR.points, []); assert.deepEqual(countries.ES.points, []);
  assert.equal(body.points[0].total, 3, "the global period unions the countries' immutable snapshots rather than taking one country's newer inventory");
  assert.equal(globalThis.fetch.mock.callCount(), 0);
});

test("different country-only runs in one period contribute both frozen targets and both valid rankings to the total", () => {
  const usTarget = target("country-us"), jpTarget = target("country-jp");
  const snapshots = [
    { runId: "us-only-run", periodKey: "2026-10-2", targets: [usTarget], runScope: "SCHEDULED", runCreatedAt: "2026-10-16T02:00:00Z", regions: ["US"] },
    { runId: "jp-only-run", periodKey: "2026-10-2", targets: [jpTarget], runScope: "SCHEDULED", runCreatedAt: "2026-10-16T01:00:00Z", regions: ["JP"] },
  ];
  const markets = snapshots.map((snapshot, index) => {
    const region = snapshot.regions[0], selected = snapshot.targets[0];
    const record = { ...task(region, index === 0 ? 3 : 20), runId: snapshot.runId, keyword: selected.keyword,
      targetsJson: [selected], runCreatedAt: snapshot.runCreatedAt };
    return { region, frames: serpCheckTrendFrames([], [record], "2026-10-08", "2026-10-16", { cohorts: [snapshot] }) };
  });
  const [point] = combinedSerpTrendPoints(markets, snapshots);
  assert.equal(point.total, 2); assert.equal(point.ranked, 2); assert.deepEqual(point.counts, [1, 1, 0, 0]);
  assert.deepEqual(snapshots.map(snapshot => snapshot.targets.length), [1, 1], "saved inventories remain untouched");
});

test("shared history failures surface as unavailable and unsupported all-country sources are rejected without provider calls", async () => {
  failCohort = true;
  assert.equal((await GET(request())).status, 503);
  assert.equal(calls.filter(call => call[0] === "tasks").length, 0);
  assert.equal((await GET(request("&source=dataforseo_labs"))).status, 400);
  assert.equal(globalThis.fetch.mock.callCount(), 0);
});
