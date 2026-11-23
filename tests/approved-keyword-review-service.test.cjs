const assert = require("node:assert/strict");
const { test, beforeEach } = require("node:test");
const fs = require("node:fs"), path = require("node:path"), Module = require("node:module"), ts = require("typescript");
const root = path.resolve(__dirname, ".."), resolve = Module._resolveFilename;
Module._resolveFilename = function(name, parent, ...rest) { return resolve.call(this, name.startsWith("@/") ? path.join(root, "src", name.slice(2)) : name, parent, ...rest); };
require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, resolveJsonModule: true } }).outputText, filename);
const mock = (relative, exports) => { const filename = path.join(root, relative); require.cache[filename] = { id: filename, filename, loaded: true, exports }; };
let run, tasks, config, connection, otherRuns, priorReserved, createCalls, taskCreateCalls, configWrites, requests, sessionToken, submissionMode;
const matches = (row, where = {}) => Object.entries(where).every(([key, value]) => {
  if (key === "OR") return value.some(part => matches(row, part));
  if (value && typeof value === "object" && !(value instanceof Date)) {
    if (Object.hasOwn(value, "in")) return value.in.includes(row[key]);
    if (Object.hasOwn(value, "not")) return row[key] !== value.not;
    if (Object.hasOwn(value, "lt")) return row[key] != null && row[key] < value.lt;
    if (Object.hasOwn(value, "gt")) return row[key] > value.gt;
  }
  return row[key] === value;
});
const db = {
  $transaction: async fn => fn(db), $executeRaw: async () => 0,
  $queryRaw: async query => { assert.ok(query.sql.includes('FROM "SerpMonitorTask"')); assert.ok(query.values.includes(review.RUN_ID)); return structuredClone(tasks); },
  serpMonitorConfig: { findUnique: async () => structuredClone(config), updateMany: async () => { configWrites++; throw new Error("the one-off review must not change recurring configuration"); } },
  dataForSeoConnection: { findUnique: async () => structuredClone(connection) },
  serpMonitorRun: {
    findUnique: async ({ where }) => run && (where.id === run.id || where.periodKey_scope?.periodKey === run.periodKey && where.periodKey_scope?.scope === run.scope) ? run : null,
    findUniqueOrThrow: async ({ where }) => { assert.equal(where.id, run?.id); return run; },
    findFirst: async ({ where }) => [run, ...otherRuns].filter(Boolean).find(item => matches(item, where)) ?? null,
    aggregate: async () => ({ _sum: { reservedCostMicros: priorReserved + (run?.reservedCostMicros ?? 0) } }),
    create: async ({ data }) => { assert.equal(run, null); createCalls++; run = { startedAt: new Date(), createdAt: new Date(), completedAt: null, actualCostMicros: null, errorCode: null, ...structuredClone(data) }; return run; },
    update: async ({ where, data }) => { assert.equal(where.id, run.id); Object.assign(run, data); return run; },
    updateMany: async ({ where, data }) => { if (!run || !matches(run, where)) return { count: 0 }; Object.assign(run, data); return { count: 1 }; },
  },
  serpMonitorTask: {
    createMany: async ({ data }) => { taskCreateCalls++; tasks.push(...data.map(row => ({ providerTaskId: null, submittedAt: null, submissionRaw: null, rawResponse: null, normalizedJson: null, checkedAt: null, lastPolledAt: null, costMicros: null, errorCode: null, updatedAt: new Date(), ...structuredClone(row) }))); return { count: data.length }; },
    findMany: async ({ where, take }) => tasks.filter(row => matches(row, where)).slice(0, take ?? tasks.length),
    findFirst: async ({ where }) => tasks.find(row => matches(row, where)) ?? null,
    count: async ({ where }) => tasks.filter(row => matches(row, where)).length,
    updateMany: async ({ where, data }) => { const rows = tasks.filter(row => matches(row, where)); rows.forEach(row => Object.assign(row, data)); return { count: rows.length }; },
    groupBy: async () => [...new Set(tasks.map(row => row.state))].map(state => ({ state, _count: tasks.filter(row => row.state === state).length })),
    aggregate: async ({ where }) => ({ _sum: { costMicros: tasks.filter(row => matches(row, where)).reduce((sum, row) => sum + (row.costMicros ?? 0), 0) } }),
  },
};
mock("src/lib/prisma.ts", { prisma: db });
mock("src/lib/services/serp-targets.ts", { loadScheduledSerpMonitoringCohort: async () => assert.fail("one-off approval must not select the normal paid cohort") });
const headersPath = require.resolve("next/headers");
require.cache[headersPath] = { id: headersPath, filename: headersPath, loaded: true, exports: { cookies: async () => ({ get: name => name === "seo_rank_auth" && sessionToken ? { value: sessionToken } : undefined }) } };
mock("src/lib/seo-workflow-http.ts", {
  workflowHeaders: { "Cache-Control": "private, no-store" },
  authorizeWorkflow: async request => { if (request.headers.get("authorization") !== "Bearer fictional-read-token" && !sessionToken) throw new Error("unauthorized"); },
  readWorkflowBody: async request => request.json(),
  workflowErrorResponse: error => Response.json({ message: error.message }, { status: 503 }),
});
const { encryptDataForSeoCredentials } = require("../src/lib/dataforseo-credentials.ts");
const review = require("../src/lib/approved-keyword-review.ts");
const { prepareApprovedKeywordReview, advanceApprovedKeywordReview, loadApprovedKeywordReview } = require("../src/lib/services/approved-keyword-review.ts");
const { POST, GET } = require("../src/app/api/seo/approved-keyword-review/route.ts");
const { getAuthToken } = require("../src/lib/auth.ts");
const body = action => ({ action, quoteSha256: review.APPROVAL_QUOTE_SHA256, maxCostMicros: review.MAX_COST_MICROS });
const post = (action, headers = {}) => POST(new Request("https://seo.test/api/seo/approved-keyword-review", { method: "POST", headers: { "Content-Type": "application/json", origin: "https://seo.test", ...headers }, body: JSON.stringify(body(action)) }));
beforeEach(t => {
  process.env.LOGIN_PWD = "fictional-review-password"; delete process.env.DISABLE_EXTERNAL_FETCH; delete process.env.DATAFORSEO_SERP_PAID_ENABLED;
  run = null; tasks = []; otherRuns = []; priorReserved = 63120; createCalls = 0; taskCreateCalls = 0; configWrites = 0; requests = []; sessionToken = null; submissionMode = "lost";
  config = { id: "default", paidEnabled: false, authorizationVersion: 0, revision: 14, maxRunCostMicros: 6000, maxMonthCostMicros: 33594000, nextDueAt: new Date("2026-12-03T08:00:00Z") };
  connection = { siteDomain: "flatkey.ai", connectionVersion: 2, encryptedCredentials: encryptDataForSeoCredentials("fictional-api-user", "fictional-api-password") };
  t.mock.method(globalThis, "fetch", async (url, options = {}) => {
    requests.push({ url, method: options.method, body: options.body ? JSON.parse(options.body) : null });
    if (url.endsWith("/appendix/user_data")) return Response.json({ status_code: 20000, cost: 0, tasks: [{ status_code: 20000, cost: 0, result: [{ money: { balance: 200 } }] }] });
    if (url.endsWith("/task_post")) {
      assert.equal(options.method, "POST"); assert.equal(options.redirect, "error");
      assert.equal(tasks.filter(row => row.state === "SUBMITTING").length, 100, "the paid reservation must be durable before network access");
      if (submissionMode === "lost") throw new Error("simulated lost supplier response");
      assert.fail("unexpected paid submission in a read-only test");
    }
    if (url.includes("/task_get/advanced/")) return Response.json({ status_code: 20000, tasks: [{ id: url.split("/").at(-1), status_code: 40602 }] });
    assert.fail(`unexpected supplier request ${url}`);
  });
});

test("prepare reserves exactly the approved 1031 single-country queries without any provider call or recurring configuration change", async () => {
  const before = structuredClone(config); const saved = await prepareApprovedKeywordReview();
  assert.equal(saved.scope, "APPROVED_KEYWORD_REVIEW"); assert.equal(saved.queryCount, 1031);
  assert.equal(saved.reservedCostMicros, 6186000); assert.equal(tasks.length, 1031);
  assert.deepEqual(Object.fromEntries(["US", "JP", "ES", "BR"].map(country => [country, tasks.filter(row => row.region === country).length])), { US: 1002, JP: 20, ES: 1, BR: 8 });
  assert.equal(new Set(tasks.map(row => row.keyword.toLowerCase())).size, 1031);
  assert.deepEqual(config, before); assert.equal(configWrites, 0); assert.equal(requests.length, 0);
  assert.equal(tasks.some(row => row.region === "BR" && row.keyword === "nvidia b300"), false);
});

test("repeated prepare reuses the original ledger and never creates another task set, including an unknown ledger", async () => {
  await prepareApprovedKeywordReview(); run.status = "UNKNOWN"; const original = run;
  assert.equal(await prepareApprovedKeywordReview(), original);
  assert.equal(createCalls, 1); assert.equal(taskCreateCalls, 1); assert.equal(tasks.length, 1031); assert.equal(requests.length, 0);
});

test("the explicitly approved one-off envelope covers the new batch without enlarging recurring limits", async () => {
  priorReserved = 33582000;
  const saved = structuredClone(config);
  await prepareApprovedKeywordReview();
  assert.deepEqual(config, saved); assert.equal(configWrites, 0);
  const approval = run.configJson.approvedKeywordReview;
  assert.equal(approval.combinedBudgetApprovedMicros, 8994000);
  assert.equal(approval.originalScheduleMonthLimitMicros, 33594000);
  assert.equal(approval.effectiveMonthLimitMicros, 42588000);
  assert.equal(approval.monthReservedBeforeMicros, 33582000);
  assert.equal(run.reservedCostMicros, 6186000); assert.equal(requests.length, 0);
});

test("the combined monthly envelope, emergency stop and a running recurring paid plan block new reservation", async () => {
  priorReserved = config.maxMonthCostMicros + 8994000 - review.MAX_COST_MICROS + 1;
  await assert.rejects(prepareApprovedKeywordReview(), /本月原预算/); assert.equal(run, null);
  priorReserved = 63120;
  config.paidEnabled = true;
  await assert.rejects(prepareApprovedKeywordReview(), /暂停/); assert.equal(run, null);
  config.paidEnabled = false; process.env.DISABLE_EXTERNAL_FETCH = "true";
  await assert.rejects(prepareApprovedKeywordReview(), /紧急停止/);
  assert.equal(createCalls, 0); assert.equal(taskCreateCalls, 0); assert.equal(configWrites, 0); assert.equal(requests.length, 0);
});

test("another unresolved ledger prevents a fresh reservation without altering it or the recurring plan", async () => {
  otherRuns = [{ id: "unresolved-earlier-submission", status: "UNKNOWN", reservedCostMicros: 6000 }];
  await assert.rejects(prepareApprovedKeywordReview(), /未完成或结果不明/);
  assert.equal(run, null); assert.equal(createCalls, 0); assert.equal(taskCreateCalls, 0); assert.equal(requests.length, 0);
  assert.equal(otherRuns[0].status, "UNKNOWN"); assert.equal(config.paidEnabled, false);
});

test("a lost paid response stops the original run; repeated resume or prepare cannot repeat that POST", async () => {
  await prepareApprovedKeywordReview();
  await advanceApprovedKeywordReview(true);
  assert.equal(requests.filter(row => row.method === "POST").length, 1);
  const paid = requests.find(row => row.method === "POST"); assert.equal(paid.body.length, 100);
  const ids = new Set(tasks.map(row => row.id)); assert.ok(paid.body.every(row => ids.has(row.tag)));
  assert.equal(run.status, "UNKNOWN"); assert.equal(tasks.filter(row => row.state === "UNKNOWN").length, 100);
  await advanceApprovedKeywordReview(true); await prepareApprovedKeywordReview(); await advanceApprovedKeywordReview(false);
  assert.equal(requests.filter(row => row.method === "POST").length, 1);
  assert.equal(createCalls, 1); assert.equal(taskCreateCalls, 1); assert.equal(config.paidEnabled, false); assert.equal(configWrites, 0);
});

test("an unknown run can still retrieve a known accepted provider task for free while new spending stays blocked", async () => {
  await prepareApprovedKeywordReview(); run.status = "UNKNOWN"; tasks[0].state = "UNKNOWN";
  tasks[1].state = "QUEUED"; tasks[1].providerTaskId = "known-paid-task-12345";
  await advanceApprovedKeywordReview(true);
  assert.equal(requests.filter(row => row.method === "POST").length, 0);
  assert.equal(requests.filter(row => row.url.endsWith("/known-paid-task-12345")).length, 1);
  assert.equal(run.status, "UNKNOWN"); assert.equal(tasks[0].state, "UNKNOWN");
});

test("the submit guard rechecks the frozen whole task set and a changed recurring gate before any paid request", async () => {
  await prepareApprovedKeywordReview();
  tasks[0].requestJson.location_code = 2392;
  await assert.rejects(advanceApprovedKeywordReview(true), /TASK_REQUEST_MISMATCH/);
  assert.equal(requests.filter(row => row.method === "POST").length, 0);
  assert.ok(tasks.every(row => row.state === "PLANNED"));
  const expected = review.getApprovedKeywordReviewPlan().queries.find(query => query.queryKey === tasks[0].queryKey);
  const { buildSerpTask, configForSerpRegion } = require("../src/lib/dataforseo-serp.ts");
  tasks[0].requestJson = buildSerpTask(expected, tasks[0].id, configForSerpRegion(expected.region));
  config.paidEnabled = true;
  await assert.rejects(advanceApprovedKeywordReview(true), /常设付费计划/);
  assert.equal(requests.filter(row => row.method === "POST").length, 0);
});

test("collector Bearer credentials can read progress but cannot prepare or resume paid work even with a valid cookie", async () => {
  sessionToken = await getAuthToken();
  const headers = { authorization: "Bearer fictional-read-token" };
  for (const action of ["prepare", "resume", "collect"]) assert.equal((await post(action, headers)).status, 403);
  assert.equal(createCalls, 0); assert.equal(taskCreateCalls, 0); assert.equal(requests.length, 0);
  assert.equal((await GET(new Request("https://seo.test/api/seo/approved-keyword-review", { headers }))).status, 200);
});

test("paid controls require a valid session and same origin; exact budget and hash are checked before reservation", async () => {
  assert.equal((await post("prepare")).status, 403);
  sessionToken = await getAuthToken();
  assert.equal((await post("prepare", { origin: "https://untrusted.test" })).status, 403);
  const tampered = new Request("https://seo.test/api/seo/approved-keyword-review", { method: "POST", headers: { origin: "https://seo.test", "Content-Type": "application/json" }, body: JSON.stringify({ ...body("prepare"), maxCostMicros: 6186001 }) });
  assert.equal((await POST(tampered)).status, 400); assert.equal(createCalls, 0);
  assert.equal((await post("prepare")).status, 200); assert.equal(createCalls, 1); assert.equal(requests.length, 0);
  const status = await loadApprovedKeywordReview();
  assert.equal(status.scheduledPlan.paidEnabled, false); assert.ok(status.countries.every(row => row.rankedCount === null));
});

test("saved result counts preserve the original domain/subdomain scope and never count a failed, corrected or invalid rank", async () => {
  await prepareApprovedKeywordReview();
  const own = { domain: "flatkey.ai", url: "https://flatkey.ai/blog/original", rankGroup: 4 };
  for (const item of tasks.slice(0, 5)) {
    item.state = "COMPLETE"; item.checkedAt = new Date("2026-11-23T03:10:00Z");
    item.normalizedJson = { queryStatus: "EXACT", rankingVerified: true, completeDepth: false, captureComplete: true, organicResults: [own] };
  }
  tasks[0].normalizedJson.organicResults = [own,
    { domain: "console.flatkey.ai", url: "https://console.flatkey.ai/pricing", rankGroup: 2 },
    { domain: "flatkey.ai.attacker.test", url: "https://flatkey.ai.attacker.test/", rankGroup: 1 },
    { domain: "flatkey.ai", url: "https://flatkey.ai/invalid-zero", rankGroup: 0 },
    { domain: "flatkey.ai", url: "https://flatkey.ai/invalid-fraction", rankGroup: 1.5 },
    { domain: "flatkey.ai", url: "https://flatkey.ai/invalid-depth", rankGroup: 101 }];
  tasks[1].state = "FAILED";
  tasks[2].normalizedJson.queryStatus = "AUTOCORRECTED";
  tasks[3].normalizedJson.rankingVerified = false;
  tasks[4].normalizedJson.organicResults = [];
  const status = await loadApprovedKeywordReview();
  assert.equal(status.siteScope, "flatkey.ai_and_subdomains_as_saved_serp_results_only");
  const rows = tasks.slice(0, 5).map(task => status.items.find(row => row.keyword === task.keyword && row.country === task.region));
  assert.equal(rows[0].rank, 2); assert.equal(rows[0].pages.length, 2); assert.equal(rows[0].ranked, true);
  assert.ok(rows.slice(1).every(row => row.ranked === null && row.rank === null));
  assert.equal(status.countries.reduce((sum, row) => sum + (row.rankedCount ?? 0), 0), 1);
  assert.equal(requests.length, 0, "reading saved subdomain evidence never opens or scans the product website");
});
