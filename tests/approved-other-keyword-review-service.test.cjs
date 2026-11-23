const assert = require("node:assert/strict");
const { test, beforeEach } = require("node:test");
const fs = require("node:fs"), path = require("node:path"), Module = require("node:module"), ts = require("typescript");
const root = path.resolve(__dirname, ".."), resolve = Module._resolveFilename;
Module._resolveFilename = function(name, parent, ...rest) { return resolve.call(this, name.startsWith("@/") ? path.join(root, "src", name.slice(2)) : name, parent, ...rest); };
require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, resolveJsonModule: true } }).outputText, filename);
const mock = (relative, exports) => { const filename = path.join(root, relative); require.cache[filename] = { id: filename, filename, loaded: true, exports }; };
let first, run, tasks, config, connection, otherRuns, priorReserved, createCalls, taskCreateCalls, configWrites, requests, sessionToken;
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
  $queryRaw: async query => {
    assert.ok(query.sql.includes('FROM "SerpMonitorTask"'));
    return structuredClone(tasks.filter(row => row.runId === review.RUN_ID || row.runId === plan().reused[0].sourceRunId && row.queryKey === plan().reused[0].sourceQueryKey));
  },
  serpMonitorConfig: { findUnique: async () => structuredClone(config), updateMany: async () => { configWrites++; throw new Error("supplement must not change the recurring schedule"); } },
  dataForSeoConnection: { findUnique: async () => structuredClone(connection) },
  serpMonitorRun: {
    findUnique: async ({ where }) => [first, run, ...otherRuns].filter(Boolean).find(row => row.id === where.id) ?? null,
    findUniqueOrThrow: async ({ where }) => { const result = [first, run, ...otherRuns].filter(Boolean).find(row => row.id === where.id); assert.ok(result); return result; },
    findFirst: async ({ where }) => [first, run, ...otherRuns].filter(Boolean).find(row => matches(row, where)) ?? null,
    aggregate: async () => ({ _sum: { reservedCostMicros: priorReserved + (first?.reservedCostMicros ?? 0) + (run?.reservedCostMicros ?? 0) } }),
    create: async ({ data }) => { assert.equal(run, null); createCalls++; run = { startedAt: new Date(), createdAt: new Date(), completedAt: null, actualCostMicros: null, errorCode: null, ...structuredClone(data) }; return run; },
    update: async ({ where, data }) => { const row = [first, run, ...otherRuns].find(row => row?.id === where.id); assert.ok(row); Object.assign(row, data); return row; },
    updateMany: async ({ where, data }) => { const rows = [first, run, ...otherRuns].filter(row => row && matches(row, where)); rows.forEach(row => Object.assign(row, data)); return { count: rows.length }; },
  },
  serpMonitorTask: {
    createMany: async ({ data }) => { taskCreateCalls++; tasks.push(...data.map(row => ({ providerTaskId: null, submittedAt: null, submissionRaw: null, rawResponse: null, normalizedJson: null, checkedAt: null, lastPolledAt: null, costMicros: null, errorCode: null, updatedAt: new Date(), ...structuredClone(row) }))); return { count: data.length }; },
    findMany: async ({ where, take }) => tasks.filter(row => matches(row, where)).slice(0, take ?? tasks.length),
    findFirst: async ({ where }) => tasks.find(row => matches(row, where)) ?? null,
    count: async ({ where }) => tasks.filter(row => matches(row, where)).length,
    updateMany: async ({ where, data }) => { const rows = tasks.filter(row => matches(row, where)); rows.forEach(row => Object.assign(row, data)); return { count: rows.length }; },
    groupBy: async ({ where }) => { const rows = tasks.filter(row => matches(row, where)); return [...new Set(rows.map(row => row.state))].map(state => ({ state, _count: rows.filter(row => row.state === state).length })); },
    aggregate: async ({ where }) => ({ _sum: { costMicros: tasks.filter(row => matches(row, where)).reduce((sum, row) => sum + (row.costMicros ?? 0), 0) } }),
  },
};
mock("src/lib/prisma.ts", { prisma: db });
mock("src/lib/services/serp-targets.ts", { loadScheduledSerpMonitoringCohort: async () => assert.fail("a frozen supplement must not select the scheduled cohort") });
const headersPath = require.resolve("next/headers");
require.cache[headersPath] = { id: headersPath, filename: headersPath, loaded: true, exports: { cookies: async () => ({ get: name => name === "seo_rank_auth" && sessionToken ? { value: sessionToken } : undefined }) } };
mock("src/lib/seo-workflow-http.ts", {
  workflowHeaders: { "Cache-Control": "private, no-store" },
  authorizeWorkflow: async request => { if (request.headers.get("authorization") !== "Bearer fictional-read-token" && !sessionToken) throw new Error("unauthorized"); },
  readWorkflowBody: async request => request.json(), workflowErrorResponse: error => Response.json({ message: error.message }, { status: 503 }),
});
const firstReview = require("../src/lib/approved-keyword-review.ts");
const review = require("../src/lib/approved-other-keyword-review.ts");
const { serpTaskId } = require("../src/lib/dataforseo-serp.ts");
const { encryptDataForSeoCredentials } = require("../src/lib/dataforseo-credentials.ts");
const { getAuthToken } = require("../src/lib/auth.ts");
const { prepareApprovedOtherKeywordReview, advanceApprovedOtherKeywordReview, loadApprovedOtherKeywordReview } = require("../src/lib/services/approved-other-keyword-review.ts");
const { GET, POST } = require("../src/app/api/seo/approved-other-keyword-review/route.ts");
const plan = () => review.getApprovedOtherKeywordReviewPlan();
const newTasks = () => tasks.filter(row => row.runId === review.RUN_ID);
const command = action => ({ action, quoteSha256: review.QUOTE_SHA256, maxCostMicros: 2802000 });
const post = (action, headers = {}, override = {}) => POST(new Request("https://seo.test/api/seo/approved-other-keyword-review", { method: "POST", headers: { "Content-Type": "application/json", origin: "https://seo.test", ...headers }, body: JSON.stringify({ ...command(action), ...override }) }));
beforeEach(t => {
  process.env.LOGIN_PWD = "fictional-other-review-password"; delete process.env.DISABLE_EXTERNAL_FETCH; delete process.env.DATAFORSEO_SERP_PAID_ENABLED;
  run = null; otherRuns = []; priorReserved = 63120; createCalls = 0; taskCreateCalls = 0; configWrites = 0; requests = []; sessionToken = null;
  first = { id: firstReview.RUN_ID, scope: firstReview.APPROVED_KEYWORD_REVIEW_SCOPE, periodKey: firstReview.PERIOD_KEY, status: "COMPLETED",
    completedAt: new Date("2026-11-23T03:00:00Z"), estimatedCostMicros: 6186000, reservedCostMicros: 6186000, actualCostMicros: 3093000,
    targetCount: 1031, queryCount: 1031, cohortHash: firstReview.APPROVED_KEYWORD_REVIEW_QUERY_HASH, cohortJson: firstReview.getApprovedKeywordReviewPlan().targets,
    configJson: { approvedKeywordReview: { userApproved: true, quoteId: "keyword-fee-review-20261123-v1", quoteSha256: firstReview.APPROVAL_QUOTE_SHA256,
      queryHash: firstReview.APPROVED_KEYWORD_REVIEW_QUERY_HASH, combinedBudgetApprovedMicros: 8994000,
      originalScheduleMonthLimitMicros: 33594000, effectiveMonthLimitMicros: 42588000, monthReservedBeforeMicros: 63120 } } };
  tasks = Array.from({ length: 1031 }, (_, index) => ({ id: `first-${index}`, runId: first.id, state: "COMPLETE" }));
  const reused = plan().reused[0];
  tasks.push({ id: serpTaskId(reused.sourceRunId, reused.queryKey), runId: reused.sourceRunId, queryKey: reused.queryKey,
    keyword: reused.keyword, region: reused.region, targetsJson: [{ siteDomain: "flatkey.ai", keywordId: reused.keywordId }], state: "COMPLETE",
    costMicros: 3000, providerTaskId: "reused-original-provider-id", checkedAt: new Date(reused.checkedAt), errorCode: null,
    normalizedJson: { captureComplete: true, queryStatus: "EXACT", rankingVerified: true, completeDepth: false,
      organicResults: [{ url: reused.url, domain: "flatkey.ai", rankGroup: 15 }] } });
  config = { id: "default", paidEnabled: false, authorizationVersion: 0, revision: 14, maxRunCostMicros: 6000, maxMonthCostMicros: 33594000, nextDueAt: new Date("2026-12-03T08:00:00Z") };
  connection = { siteDomain: "flatkey.ai", connectionVersion: 2, encryptedCredentials: encryptDataForSeoCredentials("fictional-api-user", "fictional-api-password") };
  t.mock.method(globalThis, "fetch", async (url, options = {}) => {
    requests.push({ url, method: options.method, body: options.body ? JSON.parse(options.body) : null });
    if (url.endsWith("/appendix/user_data")) return Response.json({ status_code: 20000, cost: 0, tasks: [{ status_code: 20000, cost: 0, result: [{ money: { balance: 200 } }] }] });
    if (url.endsWith("/task_post")) {
      assert.equal(options.method, "POST"); assert.equal(options.redirect, "error");
      assert.equal(newTasks().filter(row => row.state === "SUBMITTING").length, 100);
      throw new Error("simulated lost supplier response");
    }
    if (url.includes("/task_get/advanced/")) return Response.json({ status_code: 20000, tasks: [{ id: url.split("/").at(-1), status_code: 40602 }] });
    assert.fail(`unexpected supplier request ${url}`);
  });
});

test("free preview contains all 468 original ids, keeps B300's actual old receipt and charges zero for reuse", async () => {
  const value = await loadApprovedOtherKeywordReview();
  assert.equal(value.items.length, 468); assert.equal(new Set(value.items.map(row => row.keywordId)).size, 468);
  assert.equal(value.queryCount, 467); assert.equal(value.maxCostMicros, 2802000); assert.equal(value.combinedMaxCostMicros, 8988000);
  assert.equal(value.combinedApprovedCapMicros, 8994000); assert.equal(value.gate.firstRunComplete, true); assert.equal(value.run, null);
  const reused = value.items.find(row => row.reused); assert.equal(reused.keyword, "nvidia b300"); assert.equal(reused.rank, 15);
  assert.equal(reused.checkedAt, "2026-11-22T11:49:22.000Z"); assert.equal(reused.costMicros, 0); assert.equal(reused.previousCostMicros, 3000);
  assert.equal(reused.sourceRunId, "serp-cycle-2026-11-17"); assert.equal(reused.pages[0].url, plan().reused[0].url);
  assert.ok(value.items.filter(row => !row.reused).every(row => row.state === "NOT_STARTED" && row.rank === null));
  assert.equal(value.countries.find(row => row.country === "BR").rankedCount, 1);
  assert.equal(value.countries.reduce((sum, row) => sum + row.completeCount, 0), 0); assert.equal(requests.length, 0);
});

test("prepare creates exactly 467 approved one-country tasks with isolated CN requests and the fixed $2.802 reservation", async () => {
  const before = structuredClone(config); await prepareApprovedOtherKeywordReview();
  assert.equal(run.reservedCostMicros, 2802000); assert.equal(run.estimatedCostMicros, 2802000); assert.equal(newTasks().length, 467);
  assert.deepEqual(Object.fromEntries(["US", "JP", "ES", "BR", "CN"].map(country => [country, newTasks().filter(row => row.region === country).length])), { US: 447, JP: 2, ES: 1, BR: 1, CN: 16 });
  assert.ok(newTasks().filter(row => row.region === "CN").every(row => row.requestJson.location_code === 2156 && row.requestJson.language_code === "zh-CN" && row.requestJson.depth === 100));
  assert.equal(newTasks().some(row => row.keyword === "nvidia b300"), false);
  assert.equal(first.reservedCostMicros + run.reservedCostMicros, 8988000);
  assert.deepEqual(config, before); assert.equal(configWrites, 0); assert.equal(requests.length, 0);
});

test("parent approval identity, settled state and all 1031 terminal task receipts gate the second batch", async () => {
  first.status = "RUNNING"; await assert.rejects(prepareApprovedOtherKeywordReview(), /原1031/);
  first.status = "COMPLETED"; tasks[0].state = "UNKNOWN"; await assert.rejects(prepareApprovedOtherKeywordReview(), /原1031/);
  tasks[0].state = "COMPLETE"; first.configJson.approvedKeywordReview.quoteSha256 = "0".repeat(64);
  await assert.rejects(prepareApprovedOtherKeywordReview(), /原1031/);
  first.configJson.approvedKeywordReview.quoteSha256 = firstReview.APPROVAL_QUOTE_SHA256; first.reservedCostMicros++;
  await assert.rejects(prepareApprovedOtherKeywordReview(), /原1031/);
  assert.equal(createCalls, 0); assert.equal(taskCreateCalls, 0); assert.equal(requests.length, 0);
});

test("a settled PARTIAL parent is allowed while another unresolved run or the approved effective monthly cap still blocks prepare", async () => {
  first.status = "PARTIAL";
  otherRuns = [{ id: "unresolved", status: "UNKNOWN" }];
  await assert.rejects(prepareApprovedOtherKeywordReview(), /结果不明/); otherRuns = [];
  priorReserved = first.configJson.approvedKeywordReview.effectiveMonthLimitMicros - first.reservedCostMicros - 2802000 + 1;
  await assert.rejects(prepareApprovedOtherKeywordReview(), /本月已预留/); priorReserved--;
  await prepareApprovedOtherKeywordReview(); assert.equal(createCalls, 1); assert.equal(newTasks().length, 467);
});

test("the exact new approval remains usable when the old monthly reservation has only $0.012 left", async () => {
  priorReserved = 33582000; first.configJson.approvedKeywordReview.monthReservedBeforeMicros = priorReserved;
  const before = structuredClone(config);
  assert.equal(config.maxMonthCostMicros - priorReserved, 12000);
  await prepareApprovedOtherKeywordReview();
  assert.equal(run.reservedCostMicros, 2802000);
  assert.equal(run.configJson.approvedOtherKeywordReview.effectiveMonthLimitMicros, 42588000);
  assert.equal(run.configJson.approvedOtherKeywordReview.originalScheduleMonthLimitMicros, 33594000);
  assert.equal(run.configJson.approvedOtherKeywordReview.monthReservedBeforeMicros, 39768000);
  assert.deepEqual(config, before); assert.equal(configWrites, 0); assert.equal(requests.length, 0);
});

test("a changed schedule month limit or a forged parent envelope pauses the second batch without rewriting configuration", async () => {
  config.maxMonthCostMicros++;
  await assert.rejects(prepareApprovedOtherKeywordReview(), /月度预算/);
  config.maxMonthCostMicros--; first.configJson.approvedKeywordReview.effectiveMonthLimitMicros++;
  await assert.rejects(prepareApprovedOtherKeywordReview(), /月度预算/);
  first.configJson.approvedKeywordReview.effectiveMonthLimitMicros--; first.configJson.approvedKeywordReview.combinedBudgetApprovedMicros++;
  await assert.rejects(prepareApprovedOtherKeywordReview(), /合计费用/);
  assert.equal(createCalls, 0); assert.equal(taskCreateCalls, 0); assert.equal(configWrites, 0); assert.equal(requests.length, 0);
});

test("duplicate prepare retains an UNKNOWN second ledger without creating a replacement or resubmitting tasks", async () => {
  await prepareApprovedOtherKeywordReview(); const saved = run; run.status = "UNKNOWN";
  assert.equal(await prepareApprovedOtherKeywordReview(), saved);
  assert.equal(createCalls, 1); assert.equal(taskCreateCalls, 1); assert.equal(newTasks().length, 467); assert.equal(requests.length, 0);
});

test("lost response on a paid batch remains UNKNOWN and cannot be charged again by repeated resume", async () => {
  await prepareApprovedOtherKeywordReview(); await advanceApprovedOtherKeywordReview(true);
  assert.equal(requests.filter(row => row.method === "POST").length, 1); assert.equal(run.status, "UNKNOWN");
  assert.equal(newTasks().filter(row => row.state === "UNKNOWN").length, 100);
  await advanceApprovedOtherKeywordReview(true); await prepareApprovedOtherKeywordReview(); await advanceApprovedOtherKeywordReview(false);
  assert.equal(requests.filter(row => row.method === "POST").length, 1);
  assert.equal(configWrites, 0); assert.equal(config.paidEnabled, false);
});

test("free collection remains available for a known accepted task even if the parent gate later needs review", async () => {
  await prepareApprovedOtherKeywordReview(); run.status = "UNKNOWN"; first.status = "UNKNOWN";
  newTasks()[0].state = "UNKNOWN"; newTasks()[1].state = "QUEUED"; newTasks()[1].providerTaskId = "known-other-task-12345";
  await assert.rejects(advanceApprovedOtherKeywordReview(true), /原1031/);
  await advanceApprovedOtherKeywordReview(false);
  assert.equal(requests.filter(row => row.method === "POST").length, 0);
  assert.equal(requests.filter(row => row.url.endsWith("/known-other-task-12345")).length, 1);
  assert.equal(run.status, "UNKNOWN");
});

test("a missing or mismatched reuse receipt remains a gap and never falls back to the static historical rank", async () => {
  const old = tasks.find(row => row.keyword === "nvidia b300"); old.targetsJson = [{ siteDomain: "flatkey.ai", keywordId: "wrong-keyword-id" }];
  const value = await loadApprovedOtherKeywordReview(); const item = value.items.find(row => row.reused);
  assert.equal(item.state, "INVALID_SAVED_IDENTITY"); assert.equal(item.rank, null); assert.equal(item.ranked, null); assert.ok(item.gap);
  assert.equal(item.costMicros, 0); assert.equal(requests.length, 0);
});

test("Bearer credentials can read all progress but cannot spend, even with an otherwise valid session", async () => {
  sessionToken = await getAuthToken(); const headers = { authorization: "Bearer fictional-read-token" };
  for (const action of ["prepare", "resume", "collect"]) assert.equal((await post(action, headers)).status, 403);
  assert.equal((await GET(new Request("https://seo.test/api/seo/approved-other-keyword-review", { headers }))).status, 200);
  assert.equal(createCalls, 0); assert.equal(requests.length, 0);
});

test("same-origin authenticated controls require the exact second quote and budget", async () => {
  assert.equal((await post("prepare")).status, 403); sessionToken = await getAuthToken();
  assert.equal((await post("prepare", { origin: "https://untrusted.test" })).status, 403);
  assert.equal((await post("prepare", {}, { quoteSha256: firstReview.APPROVAL_QUOTE_SHA256 })).status, 400);
  assert.equal((await post("prepare", {}, { maxCostMicros: 2802001 })).status, 400);
  assert.equal(createCalls, 0); assert.equal((await post("prepare")).status, 200);
  assert.equal(createCalls, 1); assert.equal(requests.length, 0);
});
