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
  $queryRaw: async () => state.runs.map(run => ({ id: run.id })),
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
  state = { runs: [], tasks: [], sources: [source()], connection: { encryptedCredentials: "secret-ciphertext", connectionVersion: 1, loginMasked: "masked" },
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

test("published rows deduplicate by page; incomplete, unverified, unrelated and mismatched words cannot be charged", () => {
  const pending = source("pending", "https://flatkey.ai/blog/pending"); pending.snapshot.completion = "PENDING";
  const unverified = source("unverified", "https://flatkey.ai/blog/unverified"); unverified.snapshot.publication.pageVerified = false;
  const rows = [source(), source("duplicate", `${url}#faq`), pending, unverified];
  const pages = lib.buildOptimizedPages(rows, cohort);
  assert.equal(pages.length, 1); assert.equal(pages[0].targets.length, 1); assert.equal(pages[0].sourceRows.length, 2);
  rows[0].snapshot.keywords[0].relevance = "UNRELATED"; rows[1].snapshot.keywords[0].pageIntentMatched = false;
  assert.equal(lib.buildOptimizedPages(rows, cohort)[0].targets.length, 0);
  assert.equal(lib.buildOptimizedPages([source()], [{ ...target, targetUrls: ["https://flatkey.ai/other"] }])[0].targets.length, 0);
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
