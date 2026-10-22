const assert = require("node:assert/strict");
const { test, beforeEach } = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");
const root = path.resolve(__dirname, "..");
const resolve = Module._resolveFilename;
Module._resolveFilename = function(name, parent, ...rest) { return resolve.call(this, name.startsWith("@/") ? path.join(root, "src", name.slice(2)) : name, parent, ...rest); };
require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText, filename);
const mock = (relative, exports) => { const filename = path.join(root, relative); require.cache[filename] = { id: filename, filename, loaded: true, exports }; };
const lib = require("../src/lib/optimized-page-monitor.ts");
const { pageRankingChange } = require("../src/lib/page-ranking-change.ts");
const url = "https://flatkey.ai/blog/example";
const target = { keywordId: "word-1", keyword: "example api", siteDomain: "flatkey.ai", targetUrls: [url] };
const source = (rowKey = "example", pageUrl = url) => ({ rowKey, snapshot: { title: "Example API", pageUrl, completion: "COMPLETED",
  publication: { pageVerified: true, verificationReason: "Published page and keyword intent verified against the public page." },
  keywords: [{ keyword: target.keyword, relevance: "RELEVANT", pageIntentMatched: true }] } });
let state, queue, submits, polls, committed, cohort, session;
function matches(row, where = {}) {
  return Object.entries(where).every(([key, value]) => {
    if (key === "OR") return value.some(part => matches(row, part));
    if (key === "periodKey_scope") return row.periodKey === value.periodKey && row.scope === value.scope;
    if (value && typeof value === "object") {
      if (Object.hasOwn(value, "in")) return value.in.includes(row[key]);
      if (Object.hasOwn(value, "gte")) return row[key] != null && row[key] >= value.gte;
    }
    return row[key] === value;
  });
}
const db = {
  $transaction: async callback => {
    const prior = queue; let release; queue = new Promise(resolve => { release = resolve; }); await prior;
    const before = structuredClone(state);
    try { const result = await callback(db); committed = true; return result; }
    catch (error) { state = before; throw error; }
    finally { release(); }
  },
  $executeRaw: async () => 1,
  $queryRaw: async query => String(query.strings?.join("") ?? query).includes("optimized-page:saved-ranking-baseline") ? state.baselines : state.runs.map(run => ({ id: run.id })),
  keywordSourceRow: { findMany: async () => state.sources },
  dataForSeoConnection: { findUnique: async () => state.connection },
  serpMonitorConfig: { findUnique: async () => state.config },
  serpMonitorRun: {
    findUnique: async ({ where }) => state.runs.find(run => matches(run, where)) ?? null,
    findFirst: async ({ where }) => state.runs.find(run => matches(run, where)) ?? null,
    findMany: async ({ where }) => state.runs.filter(run => matches(run, where)).sort((a, b) => b.createdAt - a.createdAt).map(run => ({ ...run, tasks: state.tasks.filter(task => task.runId === run.id) })),
    aggregate: async () => ({ _sum: { reservedCostMicros: state.runs.reduce((sum, run) => sum + run.reservedCostMicros, 0) } }),
    create: async ({ data }) => { const run = { ...data, startedAt: new Date(), createdAt: new Date(), completedAt: null, actualCostMicros: null, errorCode: null }; state.runs.push(run); return run; },
  },
  serpMonitorTask: { createMany: async ({ data }) => { state.tasks.push(...data.map(task => ({ ...task, checkedAt: null, normalizedJson: null }))); } },
};
mock("src/lib/prisma.ts", { prisma: db });
mock("src/lib/dataforseo-credentials.ts", { decryptDataForSeoCredentials: () => ({ apiLogin: "private-login", apiPassword: "private-password" }) });
mock("src/lib/services/serp-targets.ts", { loadSerpMonitoringCohort: async () => ({ targets: cohort }) });
mock("src/lib/services/serp-monitor.ts", {
  submitOptimizedPageBatch: async runId => {
    assert.ok(committed, "daily claim must commit before paid submission"); submits++;
    const run = state.runs.find(run => run.id === runId); run.status = "RUNNING";
    state.tasks.filter(task => task.runId === runId).forEach(task => { task.state = "QUEUED"; });
  },
  resumeSerpMonitorRun: async (_runId, options) => { assert.equal(options.allowSubmit, false); polls++; },
});
mock("src/lib/auth.ts", { AUTH_COOKIE_NAME: "seo_rank_auth", isAuthEnabled: () => true, isValidAuthToken: async token => token === "session" });
const headersPath = require.resolve("next/headers");
require.cache[headersPath] = { id: headersPath, filename: headersPath, loaded: true, exports: { cookies: async () => ({ get: () => session ? { value: "session" } : undefined }) } };
const service = require("../src/lib/services/optimized-page-monitor.ts");
const route = require("../src/app/api/rankings/monitor/route.ts");
beforeEach(() => {
  state = { runs: [], tasks: [], baselines: [], sources: [source()], connection: { encryptedCredentials: "secret-ciphertext", connectionVersion: 1, loginMasked: "masked" },
    config: { paidEnabled: false, maxRunCostMicros: 50000000, maxMonthCostMicros: 100000000 } };
  cohort = [structuredClone(target)]; queue = Promise.resolve(); submits = 0; polls = 0; committed = false; session = true;
  delete process.env.DISABLE_EXTERNAL_FETCH; process.env.DATABASE_URL = "postgresql://unused.invalid/monitor";
});
const start = () => { const page = lib.buildOptimizedPages(state.sources, cohort)[0]; return service.mutateOptimizedPageMonitor({ action: "start", pageId: page.id, expectedHash: page.hash, day: lib.monitorDay() }); };

test("daily allowance follows Beijing midnight and canonical page identity", () => {
  assert.equal(lib.monitorDay(new Date("2026-10-20T15:59:59Z")), "2026-10-20");
  assert.equal(lib.monitorDay(new Date("2026-10-20T16:00:00Z")), "2026-10-21");
  assert.equal(lib.optimizedPageUrl(`${url}/?utm_source=test#intro`), url);
  assert.equal(lib.optimizedPageUrl("https://www.flatkey.ai/blog/example"), url);
  for (const input of ["https://flatkey.ai.attacker.invalid/", "http://flatkey.ai/", "https://user:secret@flatkey.ai/", "https://flatkey.ai:4430/"]) assert.equal(lib.optimizedPageUrl(input), null);
});

test("completed legacy rows remain visible; paid eligibility uses independently audited exact pages", () => {
  const pending = source("pending", "https://flatkey.ai/blog/pending"); pending.snapshot.completion = "PENDING";
  const unverified = source("unverified", "https://flatkey.ai/blog/unverified"); unverified.snapshot.publication.pageVerified = false;
  const rows = [source(), source("duplicate", `${url}#faq`), pending, unverified];
  const pages = lib.buildOptimizedPages(rows, cohort);
  assert.equal(pages.length, 2); assert.equal(pages.find(page => page.url === url).targets.length, 1); assert.equal(pages.find(page => page.url === url).sourceRows.length, 2);
  assert.equal(pages.find(page => page.url.includes("unverified")).targets.length, 0);
  rows[0].snapshot.keywords[0].relevance = "UNRELATED"; rows[1].snapshot.keywords[0].relevance = "UNRELATED";
  assert.equal(lib.buildOptimizedPages(rows, cohort).find(page => page.url === url).targets.length, 0);
  assert.equal(lib.buildOptimizedPages([source()], [{ ...target, targetUrls: ["https://flatkey.ai/other"] }])[0].targets.length, 0);
  const legacy = source(); legacy.snapshot.publication.pageVerified = false; legacy.snapshot.keywords[0].pageIntentMatched = false;
  assert.equal(lib.buildOptimizedPages([legacy], cohort)[0].targets.length, 1, "a later exact-page audit supersedes absent source proof");
  assert.equal(lib.buildOptimizedPages([legacy], [])[0].targets.length, 0);
  assert.deepEqual(lib.buildOptimizedPages([legacy], [])[0].keywords, [target.keyword]);
});

test("existing SERP history populates a page before manual capture and supplies the first comparison baseline", async () => {
  const task = (rank, date, region = "US") => ({ keyword: target.keyword, region, state: "COMPLETE", checkedAt: new Date(date), normalizedJson: {
    queryStatus: "EXACT", rankingVerified: true, captureComplete: true, completeDepth: true, organicResults: [{ url, rankGroup: rank }],
  } });
  const latest = task(12, "2026-10-20T03:00Z"), older = task(18, "2026-10-16T03:00Z");
  state.baselines = [older, latest];
  let page = (await service.loadOptimizedPageMonitor()).pages[0];
  assert.equal(page.results[0].rank, 12); assert.equal(page.previousResults[0].rank, 18);
  assert.equal(submits, 0); assert.equal(page.usedToday, false);
  const after = task(9, "2026-10-20T05:00Z");
  const comparison = lib.savedPageRankingComparison(url, [target.keyword], [latest, older], { startedAt: new Date("2026-10-20T04:00Z"), tasks: [after] });
  assert.equal(comparison.results[0].rank, 9); assert.equal(comparison.previousResults[0].rank, 12);
  const future = task(4, "2026-10-20T06:00Z");
  const refreshed = lib.savedPageRankingComparison(url, [target.keyword], [future, latest], { startedAt: new Date("2026-10-20T04:00Z"), tasks: [after] });
  assert.equal(refreshed.results[0].rank, 4); assert.equal(refreshed.previousResults[0].rank, 9);
  assert.equal(lib.savedPageRankingComparison(url, [target.keyword], [task(7, "2026-10-20T03:00Z", "JP")]).results[0].region, "JP");
});

const savedTask = (id, rank, date, region = "US") => ({ id, keyword: target.keyword, region, state: "COMPLETE", checkedAt: new Date(date), normalizedJson: {
  queryStatus: "EXACT", rankingVerified: true, captureComplete: true, completeDepth: true, organicResults: rank == null ? [] : [{ url, rankGroup: rank }],
} });

test("rankings and movement use capture time across scheduled, sample and manual results, independently per country", () => {
  const older = savedTask("sample", 20, "2026-10-16T03:00Z"), manual = savedTask("manual", 12, "2026-10-20T03:00Z");
  const scheduled = savedTask("scheduled", 5, "2026-11-03T03:00Z"), japan = savedTask("japan", 30, "2026-10-20T04:00Z", "JP");
  const latest = { startedAt: new Date("2026-10-20T02:00Z"), tasks: [manual, japan] };
  let result = lib.savedPageRankingComparison(url, [target.keyword], [older, scheduled, manual], latest);
  assert.deepEqual(result.results.map(row => [row.region, row.rank]), [["US", 5], ["JP", 30]]);
  assert.equal(result.previousResults[0].rank, 12);
  assert.equal(pageRankingChange(result.results[0], result.previousResults[0]).label, "↑ 7");
  const nextManual = savedTask("next-manual", 8, "2026-11-04T03:00Z");
  result = lib.savedPageRankingComparison(url, [target.keyword], [nextManual, scheduled], { startedAt: new Date("2026-11-04T02:00Z"), tasks: [nextManual] }, latest);
  assert.equal(result.results[0].rank, 8); assert.equal(result.previousResults[0].rank, 5, "a duplicate task is not its own previous ranking");
  const delayed = savedTask("delayed", 40, "2026-10-19T03:00Z");
  result = lib.savedPageRankingComparison(url, [target.keyword], [scheduled, manual], { startedAt: new Date("2026-11-05T02:00Z"), tasks: [delayed] });
  assert.equal(result.results[0].rank, 5); assert.equal(result.previousResults[0].rank, 12, "run creation order cannot override capture time");
});

test("pending, failed, corrected and shallow misses preserve valid page rankings; verified exits remain current", () => {
  const older = savedTask("older", 18, "2026-10-16T03:00Z"), valid = savedTask("valid", 12, "2026-10-20T03:00Z");
  for (const state of ["QUEUED", "FAILED", "INCOMPLETE", "QUERY_CHANGED", "NOT_FOUND_CAPTURE"]) {
    const bad = savedTask("bad", null, "2026-11-03T03:00Z");
    if (["QUEUED", "FAILED", "INCOMPLETE"].includes(state)) { bad.state = state; bad.normalizedJson = null; }
    else if (state === "QUERY_CHANGED") bad.normalizedJson.queryStatus = "AUTOCORRECTED";
    else bad.normalizedJson.completeDepth = false;
    const latest = { startedAt: new Date("2026-11-03T02:00Z"), tasks: [bad] };
    const result = lib.savedPageRankingComparison(url, [target.keyword], [bad, valid, older], latest);
    assert.equal(result.results[0].rank, 12, state); assert.equal(result.previousResults[0].rank, 18, state);
    assert.equal(lib.savedPageRankingComparison(url, [target.keyword], [], latest).results[0].status, state);
  }
  const exit = savedTask("exit", null, "2026-11-03T03:00Z");
  const result = lib.savedPageRankingComparison(url, [target.keyword], [exit, valid, older]);
  assert.equal(result.results[0].status, "OUTSIDE_TOP100"); assert.equal(result.previousResults[0].rank, 12);
  assert.equal(pageRankingChange(result.results[0], result.previousResults[0]).label, "跌出前100");
});

test("a capture of the same query on another monitored page supplies this page's actual rank", async () => {
  const older = savedTask("older", 18, "2026-10-16T03:00Z"), newest = savedTask("other-page-manual", 6, "2026-11-04T03:00Z");
  state.baselines = [newest, older];
  const page = (await service.loadOptimizedPageMonitor()).pages[0];
  assert.equal(page.results[0].rank, 6); assert.equal(page.previousResults[0].rank, 18);
  assert.equal(page.usedToday, false); assert.equal(submits, 0);
});

test("monitor reads shared newer results after a manual capture without changing its daily allowance", async () => {
  const { runId } = await start();
  const run = state.runs.find(run => run.id === runId);
  run.status = "COMPLETED";
  const manual = savedTask("manual-us", 12, "2026-10-20T03:00Z");
  Object.assign(state.tasks.find(task => task.runId === runId && task.region === "US"), manual);
  state.baselines = [savedTask("scheduled-us", 5, "2026-11-03T03:00Z"), manual];
  const page = (await service.loadOptimizedPageMonitor()).pages[0];
  assert.equal(page.results.find(row => row.region === "US").rank, 5);
  assert.equal(page.previousResults.find(row => row.region === "US").rank, 12);
  assert.equal(page.usedToday, true); assert.equal(page.run.id, runId); assert.equal(submits, 1);
});

test("page-specific valid history survives repeated shallow misses without borrowing another page's rank", () => {
  const older = savedTask("older", 18, "2026-10-16T03:00Z"), valid = savedTask("valid", 12, "2026-10-20T03:00Z");
  const otherUrl = "https://flatkey.ai/other";
  const misses = [1, 2, 3].map(day => {
    const task = savedTask(`miss-${day}`, 2, `2026-11-0${day}T03:00Z`);
    task.normalizedJson.completeDepth = false; task.normalizedJson.organicResults[0].url = otherUrl;
    return task;
  });
  const foreign = { ...savedTask("other-page", null, "2026-11-04T03:00Z"), pageUrl: otherUrl };
  const result = lib.savedPageRankingComparison(url, [target.keyword], [foreign, ...misses, valid, older]);
  assert.equal(result.results[0].rank, 12); assert.equal(result.previousResults[0].rank, 18);
  const hit = savedTask("partial-hit", 7, "2026-11-05T03:00Z");
  hit.normalizedJson.completeDepth = false;
  hit.normalizedJson.organicResults[0].url = `${url}/?utm_source=test#faq`;
  const updated = lib.savedPageRankingComparison(url, [target.keyword], [foreign, hit, valid, older]);
  assert.equal(updated.results[0].rank, 7); assert.equal(updated.previousResults[0].rank, 12);
});

test("single-page schema rejects bulk requests, arbitrary keywords, supplied dates and forged provider parameters", () => {
  const page = lib.buildOptimizedPages([source()], cohort)[0], valid = { action: "start", pageId: page.id, expectedHash: page.hash, day: "2026-10-20" };
  assert.ok(lib.optimizedPageMutationSchema.safeParse(valid).success);
  for (const extra of [{ pageIds: [page.id] }, { keywords: ["other"] }, { location_code: 1 }, { force: true }]) assert.equal(lib.optimizedPageMutationSchema.safeParse({ ...valid, ...extra }).success, false);
  assert.equal(lib.optimizedPageMutationSchema.safeParse([valid, valid]).success, false);
});

test("page rank never borrows another URL's better rank and incomplete/corrected SERPs never become a decline", () => {
  const task = { keyword: target.keyword, region: "US", state: "COMPLETE", checkedAt: new Date("2026-10-20T03:00Z"), normalizedJson: {
    queryStatus: "EXACT", rankingVerified: true, captureComplete: true, completeDepth: true,
    organicResults: [{ url: "https://flatkey.ai/other", rankGroup: 2 }, { url: `${url}/#faq`, rankGroup: 17 }],
  } };
  assert.equal(lib.optimizedPageRank(url, task).rank, 17);
  task.normalizedJson.organicResults.pop();
  assert.equal(lib.optimizedPageRank(url, task).status, "OUTSIDE_TOP100");
  task.normalizedJson.completeDepth = false;
  assert.equal(lib.optimizedPageRank(url, task).status, "NOT_FOUND_CAPTURE");
  task.normalizedJson.queryStatus = "AUTOCORRECTED";
  assert.equal(lib.optimizedPageRank(url, task).status, "QUERY_CHANGED");
  task.normalizedJson.queryStatus = "EXACT"; task.normalizedJson.rankingVerified = false;
  assert.equal(lib.optimizedPageRank(url, task).status, "INCOMPLETE");
});

test("changes compare the same page's valid ranks and distinguish first check, entry, exit and unknown", () => {
  const rank = (value, status = value == null ? "OUTSIDE_TOP100" : "RANKED") => ({ keyword: target.keyword, region: "US", rank: value, status, checkedAt: null, googleUrl: null, otherPages: [] });
  assert.deepEqual(pageRankingChange(rank(12), rank(18)), { label: "↑ 6", direction: "up", comparable: true });
  assert.equal(pageRankingChange(rank(9), rank(5)).label, "↓ 4");
  assert.equal(pageRankingChange(rank(9), rank(9)).label, "持平");
  assert.equal(pageRankingChange(rank(9)).label, "首次记录");
  assert.equal(pageRankingChange(rank(9), rank(null)).label, "进入前100");
  assert.equal(pageRankingChange(rank(null), rank(9)).label, "跌出前100");
  for (const status of ["FAILED", "QUERY_CHANGED", "NOT_FOUND_CAPTURE", "INCOMPLETE", "QUEUED"])
    assert.equal(pageRankingChange(rank(null, status), rank(9)).comparable, false);
});

test("concurrent clicks, refresh and new sessions share one daily paid request; different pages cannot be clicked in parallel", async () => {
  const results = await Promise.all([start(), start(), start()]);
  assert.equal(submits, 1); assert.equal(state.runs.length, 1); assert.equal(state.tasks.length, 4);
  assert.equal(results.filter(result => !result.duplicate).length, 1);
  assert.deepEqual(state.tasks.map(task => task.region), ["US", "JP", "ES", "BR"]);
  assert.equal(state.runs[0].scope, "OPTIMIZED_PAGE"); assert.equal(state.config.paidEnabled, false);
  const second = "https://flatkey.ai/blog/second";
  state.sources.push(source("second", second)); cohort[0].targetUrls.push(second);
  const page = lib.buildOptimizedPages(state.sources, cohort).find(page => page.url === second);
  await assert.rejects(service.mutateOptimizedPageMonitor({ action: "start", pageId: page.id, expectedHash: page.hash, day: lib.monitorDay() }), /已有页面/);
  assert.equal(submits, 1);
  const status = await service.loadOptimizedPageMonitor();
  assert.ok(status.pages.find(page => page.url === url).usedToday);
  assert.ok(!JSON.stringify(status).includes("secret-ciphertext"));
});

test("paid POST failure consumes the daily allowance and never gets retried", async t => {
  const module = require("../src/lib/services/serp-monitor.ts");
  t.mock.method(module, "submitOptimizedPageBatch", async () => { submits++; throw new Error("connection interrupted"); });
  await assert.rejects(start(), /interrupted/);
  assert.ok((await start()).duplicate); assert.equal(submits, 1); assert.equal(state.runs.length, 1);
});

test("tomorrow allows a fresh request, while changes to sources or query identity do not reset today's allowance", async t => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-10-20T15:59:59Z") });
  await start(); state.runs[0].status = "COMPLETED";
  state.sources[0].rowKey = "renamed-row";
  assert.ok((await start()).duplicate); assert.equal(submits, 1);
  t.mock.timers.tick(2000);
  assert.equal(lib.monitorDay(), "2026-10-21");
  await start(); assert.equal(submits, 2); assert.equal(state.runs.length, 2);
});

test("budget, external stop, stale date and changed targets reject before a paid request", async () => {
  state.config.maxMonthCostMicros = 100;
  await assert.rejects(start(), /预算/); assert.equal(submits, 0); assert.equal(state.runs.length, 0);
  state.config.maxMonthCostMicros = 100000000; process.env.DISABLE_EXTERNAL_FETCH = "true";
  await assert.rejects(start(), /暂停/); delete process.env.DISABLE_EXTERNAL_FETCH;
  const page = lib.buildOptimizedPages(state.sources, cohort)[0];
  await assert.rejects(service.mutateOptimizedPageMonitor({ action: "start", pageId: page.id, expectedHash: page.hash, day: "2000-01-01" }), /日期/);
  await assert.rejects(service.mutateOptimizedPageMonitor({ action: "start", pageId: page.id, expectedHash: "0".repeat(64), day: lib.monitorDay() }), /变化/);
  assert.equal(submits, 0);
});

test("reading and polling only collect original results, without sending a second paid request", async t => {
  t.mock.method(globalThis, "fetch", async () => assert.fail("reads must not contact paid provider"));
  await service.loadOptimizedPageMonitor(); assert.equal(submits, 0);
  const result = await start();
  await service.mutateOptimizedPageMonitor({ action: "poll", runId: result.runId });
  assert.equal(polls, 1); assert.equal(submits, 1);
  state.runs[0].scope = "SCHEDULED";
  await assert.rejects(service.mutateOptimizedPageMonitor({ action: "poll", runId: result.runId }), /未找到/);
});

test("API requires login, blocks cross-site writes and refuses bulk payloads", async () => {
  const request = (body, origin = "https://monitor.example") => new Request("https://monitor.example/api/rankings/monitor", { method: "POST", headers: { "content-type": "application/json", origin }, body: JSON.stringify(body) });
  session = false; assert.equal((await route.GET(new Request("https://monitor.example/api/rankings/monitor"))).status, 401);
  session = true; assert.equal((await route.POST(request({}, "https://attacker.invalid"))).status, 403);
  assert.equal((await route.POST(request({ action: "start", pageIds: [] }))).status, 400);
  assert.equal(state.runs.length, 0); assert.equal(submits, 0);
});
