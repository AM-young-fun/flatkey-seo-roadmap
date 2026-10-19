const assert = require("node:assert/strict");
const { test, beforeEach } = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");
const { createHash } = require("node:crypto");
const root = path.resolve(__dirname, "..");
const resolve = Module._resolveFilename;
Module._resolveFilename = function (name, parent, ...rest) { return resolve.call(this, name.startsWith("@/") ? path.join(root, "src", name.slice(2)) : name, parent, ...rest); };
require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText, filename);

const clone = value => structuredClone(value);
let state, targets, queue, inTransaction, fetches, respond, events, liveBalance, balanceRequests;
function matches(row, where = {}) {
  return Object.entries(where).every(([key, expected]) => {
    if (key === "OR") return expected.some(part => matches(row, part));
    if (key === "AND") return expected.every(part => matches(row, part));
    if (key === "periodKey_scope") return row.periodKey === expected.periodKey && (row.scope ?? "SCHEDULED") === expected.scope;
    const actual = row?.[key];
    if (expected && typeof expected === "object" && !(expected instanceof Date)) {
      if (Object.hasOwn(expected, "in") && !expected.in.includes(actual)) return false;
      if (Object.hasOwn(expected, "not") && actual === expected.not) return false;
      if (Object.hasOwn(expected, "gte") && !(actual >= expected.gte)) return false;
      if (Object.hasOwn(expected, "gt") && !(actual > expected.gt)) return false;
      if (Object.hasOwn(expected, "lt") && !(actual < expected.lt)) return false;
      return true;
    }
    return actual instanceof Date && expected instanceof Date ? +actual === +expected : actual === expected;
  });
}
function model(key, defaults = {}) {
  function rows() { return key === "config" ? state.config ? [state.config] : [] : state[key]; }
  function assign(row, data) { for (const [field, value] of Object.entries(data)) row[field] = value && typeof value === "object" && Object.hasOwn(value, "increment") ? (row[field] ?? 0) + value.increment : clone(value); }
  return {
    findUnique: async ({ where }) => clone(rows().find(row => matches(row, where)) ?? null),
    findUniqueOrThrow: async ({ where }) => { const row = rows().find(row => matches(row, where)); assert.ok(row); return clone(row); },
    findFirst: async ({ where }) => clone(rows().find(row => matches(row, where)) ?? null),
    findMany: async ({ where, take, orderBy }) => {
      const selected = rows().filter(row => matches(row, where));
      for (const order of [...(Array.isArray(orderBy) ? orderBy : orderBy ? [orderBy] : [])].reverse()) {
        const [field, value] = Object.entries(order)[0], direction = typeof value === "object" ? value.sort : value;
        selected.sort((a, b) => {
          if (typeof value === "object" && value.nulls === "first" && (a[field] == null || b[field] == null)) return a[field] == null && b[field] != null ? -1 : b[field] == null && a[field] != null ? 1 : 0;
          return (a[field] < b[field] ? -1 : a[field] > b[field] ? 1 : 0) * (direction === "desc" ? -1 : 1);
        });
      }
      return selected.slice(0, take ?? Infinity).map(clone);
    },
    create: async ({ data }) => {
      const row = { ...clone(defaults), createdAt: new Date(), startedAt: new Date(), completedAt: null, actualCostMicros: null, errorCode: null, ...clone(data) };
      if (key === "config") state.config = row; else state[key].push(row);
      return clone(row);
    },
    createMany: async ({ data }) => {
      assert.equal(inTransaction, true);
      state[key].push(...data.map(data => ({ ...clone(defaults), providerTaskId: null, rawResponse: null, submissionRaw: null, normalizedJson: null,
        checkedAt: null, costMicros: null, errorCode: null, submittedAt: null, lastPolledAt: null, createdAt: new Date(), ...clone(data) })));
      return { count: data.length };
    },
    update: async ({ where, data }) => { const row = rows().find(row => matches(row, where)); assert.ok(row); assign(row, data); return clone(row); },
    updateMany: async ({ where, data }) => {
      const selected = rows().filter(row => matches(row, where));
      if (data.state === "SUBMITTING") { assert.equal(inTransaction, true); events.push("reserve:SUBMITTING"); }
      if (data.rawResponse) events.push("persist:raw");
      if (data.normalizedJson) { assert.ok(selected.every(row => row.rawResponse)); events.push("persist:normalized"); }
      selected.forEach(row => assign(row, data)); return { count: selected.length };
    },
    upsert: async ({ where, create, update }) => {
      const row = rows().find(row => matches(row, where)); if (row) { assign(row, update); return clone(row); }
      state.config = { ...clone(defaults), ...clone(create) }; return clone(state.config);
    },
    aggregate: async ({ where, _sum }) => ({ _sum: Object.fromEntries(Object.keys(_sum).map(field => [field, rows().filter(row => matches(row, where)).reduce((sum, row) => sum + (row[field] ?? 0), 0)])) }),
    groupBy: async ({ by, where }) => {
      const field = by[0], counts = new Map(); for (const row of rows().filter(row => matches(row, where))) counts.set(row[field], (counts.get(row[field]) ?? 0) + 1);
      return [...counts].map(([value, count]) => ({ [field]: value, _count: count }));
    },
  };
}
const db = {
  $transaction: async callback => {
    const prior = queue; let release; queue = new Promise(resolve => { release = resolve; }); await prior;
    const before = clone(state); inTransaction = true;
    try { const result = await callback(db); events.push("commit"); return result; }
    catch (error) { state = before; throw error; }
    finally { inTransaction = false; release(); }
  },
  $executeRaw: async query => {
    if (query?.sql?.includes("serp-monitor:submission-receipts")) {
      assert.equal(inTransaction, true);
      const values = query.values, runId = values.at(-1); let count = 0;
      for (let index = 0; index < values.length - 1; index += 5) {
        const task = state.tasks.find(task => task.id === values[index] && task.runId === runId && task.state === "SUBMITTING");
        if (task) { Object.assign(task, { state: values[index + 1], providerTaskId: values[index + 2], costMicros: values[index + 3] ?? task.costMicros, errorCode: values[index + 4] }); count++; }
      }
      events.push("associate:batch"); return count;
    }
    if (query?.sql?.includes("serp-monitor:raw-results")) {
      assert.equal(inTransaction, true);
      const values = query.values, runId = values.at(-1); let count = 0;
      for (let index = 0; index < values.length - 1; index += 5) {
        const task = state.tasks.find(task => task.id === values[index] && task.runId === runId && task.state === "QUEUED");
        if (task) {
          Object.assign(task, { state: values[index + 1], rawResponse: values[index + 2] ?? task.rawResponse, costMicros: values[index + 3], errorCode: values[index + 4] }); count++;
          if (values[index + 2]) events.push("persist:raw");
        }
      }
      events.push("persist:raw-batch"); return count;
    }
    if (!query?.sql?.includes("serp-monitor:upgrade-cached-sample-results") && !query?.sql?.includes("serp-monitor:normalized-results")) return 0;
    const values = query.values, runId = values.at(-1); let count = 0;
    for (let index = 0; index < values.length - 1; index += 6) {
      const task = state.tasks.find(task => task.id === values[index] && task.runId === runId && ["RECEIVED", "INCOMPLETE", "COMPLETE"].includes(task.state));
      if (task) {
        assert.ok(task.rawResponse, "normalization follows durable raw persistence");
        Object.assign(task, { costMicros: values[index + 1], normalizedJson: values[index + 2] === null ? null : JSON.parse(values[index + 2]),
          checkedAt: values[index + 3], state: values[index + 4], errorCode: values[index + 5] }); count++;
      }
    }
    events.push(query.sql.includes("upgrade-cached-sample-results") ? "settle:cached" : "persist:normalized"); return count;
  },
  serpMonitorConfig: model("config", { revision: 1, nextDueAt: null }), serpMonitorRun: model("runs", { scope: "SCHEDULED", sampleAuthorizationHash: null }), serpMonitorTask: model("tasks"),
  dataForSeoConnection: { findUnique: async () => state.connection ? { loginMasked: "f***", encryptedCredentials: "fictional-ciphertext", connectionVersion: 1 } : null },
  schedulerCheck: { create: async ({ data }) => data, update: async ({ data }) => data },
};
function mockFile(relative, exports) { const name = path.join(root, relative); require.cache[name] = { id: name, filename: name, loaded: true, exports }; }
mockFile("src/lib/prisma.ts", { prisma: db });
mockFile("src/lib/services/serp-targets.ts", {
  loadSerpTargetCohort: async () => ({ targets: clone(targets), hash: "a".repeat(64) }),
  loadSerpMonitoringCohort: async () => ({ targets: clone(targets), hash: "a".repeat(64), allTargets: clone(targets), allTargetHash: "a".repeat(64), allTargetCount: targets.length, heldTargetCount: 0 }),
});
mockFile("src/lib/dataforseo-credentials.ts", { decryptDataForSeoCredentials: () => ({ apiLogin: "fictional@example.invalid", apiPassword: "fictional-not-a-real-password" }) });
const { SERP_DEFAULT_CONFIG, SERP_MARKETS, SERP_MARKET_CONFIG, configForSerpRegion, groupSerpQueries, groupSerpMarketQueries, quoteSerpTargets, buildSerpTask, normalizeSerpAdvanced, serpMonitorMutationSchema } = require("../src/lib/dataforseo-serp.ts");
const { periodDue, nextSerpPeriodKey, serpPeriod } = require("../src/lib/serp-periods.ts");
const { SERP_USER_DATA_URL, SERP_SAMPLE_AUTHORIZATION_HASH, SERP_SAMPLE_AUTHORIZATION_ID } = require("../src/lib/serp-sample.ts");
const { loadSerpMonitorStatus, mutateSerpMonitor, runSerpMonitorCron, submitSerpSampleBatch, startSerpScheduledPeriod } = require("../src/lib/services/serp-monitor.ts");

function target(keyword, siteDomain = "flatkey.ai") { return { keyword, keywordId: `id-${keyword}`, siteDomain, targetUrls: [`https://${siteDomain}/models/example`] }; }
function advanced(task, count = 100, overrides = {}) {
  return { status_code: 20000, tasks: [{ id: task.providerTaskId, status_code: 20000, cost: 0.006, data: task.requestJson,
    result: [{ keyword: task.keyword, type: "organic", se_domain: task.requestJson.se_domain, location_code: task.requestJson.location_code, language_code: task.requestJson.language_code,
      datetime: "2026-10-15 12:00:00 +00:00", check_url: "https://www.google.com/search?q=example", items_count: count + 20,
      items: Array.from({ length: count }, (_, index) => ({ type: "organic", rank_group: index + 1, rank_absolute: index + 3,
        title: `Result ${index + 1}`, url: [4, 19].includes(index) ? `https://flatkey.ai/models/example-${index}` : `https://competitor.invalid/page-${index}` })), ...overrides }] }] };
}
const start = (id = "fictional-serp-run-1") => mutateSerpMonitor({ action: "start", idempotencyKey: id, expectedCohortHash: "a".repeat(64) });
beforeEach(t => {
  delete process.env.DATAFORSEO_SERP_PAID_ENABLED; delete process.env.DISABLE_EXTERNAL_FETCH;
  targets = [target("model api price"), target("brand key")];
  state = { config: { id: "default", ...SERP_DEFAULT_CONFIG, revision: 1, authorizationVersion: 1 }, connection: true, runs: [], tasks: [] };
  queue = Promise.resolve(); inTransaction = false; fetches = []; events = []; balanceRequests = []; liveBalance = 100;
  respond = async (url, init) => init.method === "POST" ? new Response(JSON.stringify({ status_code: 20000, tasks: JSON.parse(init.body).map((data, index) => ({ id: `provider-${index}-${fetches.length}`, status_code: 20100, cost: 0.006, data })) })) :
    new Response(JSON.stringify(advanced(state.tasks.find(task => url.endsWith(task.providerTaskId)))));
  t.mock.method(globalThis, "fetch", async (url, init) => {
    assert.equal(inTransaction, false, "network must follow durable transaction commit");
    if (url === SERP_USER_DATA_URL) {
      assert.equal(init.method, "GET"); balanceRequests.push({ url, init });
      return new Response(JSON.stringify({ status_code: 20000, cost: 0, tasks: [{ status_code: 20000, cost: 0, result: [{ money: { balance: liveBalance } }] }] }));
    }
    if (init.method === "POST") {
      const body = JSON.parse(init.body); assert.ok(body.length <= 100); assert.ok(body.every(row => state.tasks.find(task => task.id === row.tag)?.state === "SUBMITTING"));
      assert.ok(events.includes("reserve:SUBMITTING") && events.includes("commit"));
    } else { assert.equal(init.method, "GET"); assert.ok(state.tasks.some(task => task.providerTaskId && url.endsWith(task.providerTaskId)), "GET must use a known provider id"); }
    fetches.push({ url, method: init.method, body: init.body }); return respond(url, init);
  });
});

test("SERP setup, status and preview are offline; neither flag alone can spend and configure cannot enable", async () => {
  const status = await loadSerpMonitorStatus(), preview = await mutateSerpMonitor({ action: "preview" });
  assert.equal(status.config.paidEnabled, false); assert.equal(status.config.nextDueAt, null); assert.equal(preview.paidEnabled, false);
  assert.equal(status.quote.maxCostMicros, 48000); assert.deepEqual(status.config.regions, SERP_MARKETS); assert.equal(state.runs.length, 0); assert.equal(fetches.length, 0);
  await assert.rejects(start(), error => error.status === 409);
  process.env.DATAFORSEO_SERP_PAID_ENABLED = "true";
  await assert.rejects(start(), error => error.status === 409);
  assert.equal(serpMonitorMutationSchema.safeParse({ action: "configure", paidEnabled: true }).success, false);
  const saved = await mutateSerpMonitor({ action: "configure", paidEnabled: false, expectedRevision: 1 });
  assert.equal(saved.config.paidEnabled, false); assert.equal(saved.config.intervalDays, 14); assert.equal(saved.config.depth, 100);
  assert.equal(saved.config.nextDueAt, null); assert.equal(fetches.length, 0);
  assert.ok(!JSON.stringify(saved).includes("fictional-ciphertext"));
});

test("management authorization works without deployment paid flags while an unversioned legacy flag cannot spend", async () => {
  state.config.paidEnabled = true; state.config.authorizationVersion = 0;
  await assert.rejects(start(), error => error.status === 409); assert.equal(fetches.length, 0);
  state.config.authorizationVersion = 1;
  await start(); assert.equal(fetches.filter(row => row.method === "POST").length, 1);
});

test("advancing Oct20 keeps its single ledger and completion schedules Nov3 rather than another run tomorrow", async t => {
  state.config.paidEnabled = true; state.config.nextDueAt = new Date("2026-10-20T02:30:00Z");
  t.mock.method(Date, "now", () => Date.parse("2026-10-19T12:00:00Z"));
  const deadline = Date.now() + 230000;
  const first = await startSerpScheduledPeriod("2026-10-20", "a".repeat(64), deadline);
  assert.equal(first.periodKey, "2026-10-20");
  await mutateSerpMonitor({ action: "resume", runId: first.id });
  assert.equal(state.config.nextDueAt.toISOString(), "2026-11-03T02:30:00.000Z");
  assert.equal(state.config.paidEnabled, true);
  await startSerpScheduledPeriod("2026-10-20", "a".repeat(64), deadline);
  assert.equal(state.runs.length, 1); assert.equal(fetches.filter(row => row.method === "POST").length, 1);
  await assert.rejects(startSerpScheduledPeriod("2026-11-03", "a".repeat(64), deadline), /24小时/);
  assert.equal(state.runs.length, 1);
});

test("cron can start the period already advanced by discovery and keeps the next fixed Tuesday", async t => {
  state.config.paidEnabled = true; state.config.nextDueAt = new Date("2026-10-20T02:30:00Z");
  t.mock.method(Date, "now", () => Date.parse("2026-10-19T12:00:00Z"));
  assert.equal((await runSerpMonitorCron()).status, "NOT_DUE");
  const result = await runSerpMonitorCron({ periodKey: "2026-10-20" });
  assert.equal(result.status, "FINISHED"); assert.equal(state.runs[0].periodKey, "2026-10-20");
  assert.equal(state.config.nextDueAt.toISOString(), "2026-11-03T02:30:00.000Z");
  assert.equal(fetches.filter(row => row.method === "POST").length, 1);
});

test("every daily cron while paused is a zero-provider-call no-op, including no DB configuration", async () => {
  state.config = null;
  assert.equal((await runSerpMonitorCron()).status, "DISABLED");
  process.env.DATAFORSEO_SERP_PAID_ENABLED = "true";
  assert.equal((await runSerpMonitorCron()).status, "DISABLED");
  assert.equal(state.runs.length, 0); assert.equal(fetches.length, 0);
});

test("status exposes only whether cron authentication is configured, never the cron secret", async () => {
  const original = process.env.CRON_SECRET;
  try {
    delete process.env.CRON_SECRET;
    assert.equal((await loadSerpMonitorStatus()).cronConfigured, false);
    process.env.CRON_SECRET = "fictional-never-expose-cron-secret";
    const configured = await loadSerpMonitorStatus();
    assert.equal(configured.cronConfigured, true);
    assert.ok(!JSON.stringify(configured).includes(process.env.CRON_SECRET));
    assert.equal(fetches.length, 0);
  } finally { if (original === undefined) delete process.env.CRON_SECRET; else process.env.CRON_SECRET = original; }
});

test("a configured future first run is not invented, and kill switch overrides both enable flags", async () => {
  process.env.DATAFORSEO_SERP_PAID_ENABLED = "true"; state.config.paidEnabled = true;
  assert.equal((await runSerpMonitorCron()).status, "NOT_SCHEDULED");
  state.config.nextDueAt = new Date(Date.now() + 100000);
  assert.equal((await runSerpMonitorCron()).status, "NOT_DUE");
  process.env.DISABLE_EXTERNAL_FETCH = "true";
  assert.equal((await runSerpMonitorCron()).status, "DISABLED");
  await assert.rejects(start(), error => error.status === 409);
  assert.equal(fetches.length, 0);
});

test("query quote deduplicates shared normalized terms across sites without losing either target", () => {
  const pool = [target("MODEL API"), target("ｍｏｄｅｌ  api", "rackrate.org"), target("model price")];
  const groups = groupSerpQueries(pool), quote = quoteSerpTargets(pool);
  assert.equal(groups.length, 2); assert.equal(groups.find(row => row.queryKey === "model api").targets.length, 2);
  assert.equal(quote.targetCount, 3); assert.equal(quote.queryCount, 2); assert.equal(quote.sharedQueriesSaved, 1);
  assert.equal(quote.maxCostMicros, 12000); assert.equal(quote.annualCostMicros, 312000);
});

test("requests use exact approved scope, full depth, no stop-on-match or paid extras, preserving plus and percent", () => {
  const task = buildSerpTask(groupSerpQueries([target("C++ 20% api")])[0], "fictional-tag", SERP_DEFAULT_CONFIG);
  assert.equal(task.keyword, "C%2B%2B 20%25 api"); assert.equal(task.depth, 100); assert.equal(task.max_crawl_pages, 10); assert.equal(task.priority, 1);
  assert.equal(task.stop_crawl_on_match, undefined); assert.equal(task.calculate_rectangles, false); assert.equal(task.load_async_ai_overview, false);
  assert.throws(() => buildSerpTask(groupSerpQueries([target("site:flatkey.ai model api")])[0], "tag", SERP_DEFAULT_CONFIG));
});

test("a paid reservation precedes the single <=100-task POST and retries reuse the same immutable ledger", async () => {
  process.env.DATAFORSEO_SERP_PAID_ENABLED = "true"; state.config.paidEnabled = true;
  targets = Array.from({ length: 101 }, (_, index) => target(`model api ${index}`));
  const original = clone(targets), first = await start();
  assert.equal(first.run.taskCounts.QUEUED, 100); assert.equal(first.run.taskCounts.PLANNED, 304);
  assert.equal(fetches.length, 1); assert.equal(state.runs.length, 1); assert.deepEqual(state.runs[0].cohortJson, original);
  assert.equal(state.tasks.length, 404); assert.ok(state.tasks.filter(task => task.state === "QUEUED").every(task => task.submissionRaw));
  assert.equal((await start()).duplicate, true); assert.equal(fetches.length, 1);
});

test("concurrent new runs cannot reserve and spend twice", async () => {
  process.env.DATAFORSEO_SERP_PAID_ENABLED = "true"; state.config.paidEnabled = true;
  const outcomes = await Promise.allSettled([start("fictional-run-concurrent-a"), start("fictional-run-concurrent-b")]);
  assert.equal(outcomes.filter(outcome => outcome.status === "fulfilled").length, 1);
  assert.equal(state.runs.length, 1); assert.equal(fetches.length, 1);
});

test("lost paid responses remain UNKNOWN and neither same-id nor different-id requests resubmit", async () => {
  process.env.DATAFORSEO_SERP_PAID_ENABLED = "true"; state.config.paidEnabled = true;
  respond = async () => { throw new Error("fictional network interruption"); };
  const first = await start(); assert.equal(first.run.status, "UNKNOWN"); assert.equal(first.run.taskCounts.UNKNOWN, 8);
  assert.equal((await start()).duplicate, true);
  await assert.rejects(start("fictional-different-run"), error => error.status === 409);
  assert.equal(fetches.length, 1);
});

test("failed preview hash, due date and budgets all stop before a provider call", async () => {
  process.env.DATAFORSEO_SERP_PAID_ENABLED = "true"; state.config.paidEnabled = true;
  await assert.rejects(mutateSerpMonitor({ action: "start", idempotencyKey: "fictional-invalid-hash", expectedCohortHash: "b".repeat(64) }), error => error.status === 409);
  state.config.nextDueAt = new Date(Date.now() + 100000);
  await assert.rejects(start(), error => error.status === 409);
  state.config.nextDueAt = null; state.config.maxRunCostMicros = 6000;
  await assert.rejects(start(), error => error.status === 409);
  assert.equal(state.runs.length, 0); assert.equal(fetches.length, 0);
});

test("free resume fetches only known task ids, caches raw before normalization and sets the next fixed calendar period due", async () => {
  process.env.DATAFORSEO_SERP_PAID_ENABLED = "true"; state.config.paidEnabled = true;
  await start(); delete process.env.DATAFORSEO_SERP_PAID_ENABLED; state.config.paidEnabled = false;
  const result = await mutateSerpMonitor({ action: "resume", runId: "fictional-serp-run-1" });
  assert.equal(result.run.status, "COMPLETED"); assert.equal(result.run.taskCounts.COMPLETE, 8);
  assert.equal(fetches.filter(row => row.method === "POST").length, 1); assert.equal(fetches.filter(row => row.method === "GET").length, 8);
  assert.ok(state.tasks.every(task => task.rawResponse && task.normalizedJson && task.checkedAt));
  assert.equal(state.tasks[0].normalizedJson.organicResults.filter(row => row.domain === "flatkey.ai").length, 2);
  assert.equal(state.config.nextDueAt.toISOString(), periodDue(nextSerpPeriodKey(state.runs[0].periodKey)).toISOString());
  assert.ok(events.indexOf("persist:raw") < events.indexOf("persist:normalized"));
});

test("depth100 request, widgets count and rank100 alone do not prove complete top100 organic coverage", () => {
  const task = { providerTaskId: "fictional-provider-id", keyword: "model api price", requestJson: buildSerpTask(groupSerpQueries([target("model api price")])[0], "tag", SERP_DEFAULT_CONFIG) };
  const expected = { providerTaskId: task.providerTaskId, keyword: task.keyword, config: SERP_DEFAULT_CONFIG };
  assert.equal(normalizeSerpAdvanced(advanced(task), expected).completeDepth, true);
  assert.equal(normalizeSerpAdvanced(advanced(task, 10), expected).completeDepth, false);
  const sparse = advanced(task, 1); sparse.tasks[0].result[0].items[0].rank_group = 100;
  assert.equal(normalizeSerpAdvanced(sparse, expected).completeDepth, false);
  const invalidUrl = advanced(task); invalidUrl.tasks[0].result[0].items[20].url = "javascript:alert(1)";
  assert.equal(normalizeSerpAdvanced(invalidUrl, expected).completeDepth, false);
});

test("a scope mismatch or wrong keyword never becomes a successful ranking, and autocorrected keywords remain incomplete", () => {
  const task = { providerTaskId: "fictional-provider-id", keyword: "model api price", requestJson: buildSerpTask(groupSerpQueries([target("model api price")])[0], "tag", SERP_DEFAULT_CONFIG) };
  const expected = { providerTaskId: task.providerTaskId, keyword: task.keyword, config: SERP_DEFAULT_CONFIG };
  assert.throws(() => normalizeSerpAdvanced(advanced(task, 100, { location_code: 2392 }), expected), /SCOPE_MISMATCH/);
  assert.throws(() => normalizeSerpAdvanced(advanced(task, 100, { keyword: "other model" }), expected), /KEYWORD_MISMATCH/);
  assert.equal(normalizeSerpAdvanced(advanced(task, 100, { spell: { type: "showing_results_for", keyword: "different" } }), expected).completeDepth, false);
});

test("normalization v2 separates completed capture, contiguous organic coverage and Google query correction", () => {
  const task = { providerTaskId: "fictional-v2-provider", keyword: "model api price",
    requestJson: buildSerpTask(groupSerpQueries([target("model api price")])[0], "v2-tag", SERP_DEFAULT_CONFIG) };
  const expected = { providerTaskId: task.providerTaskId, keyword: task.keyword, config: SERP_DEFAULT_CONFIG };
  const short = normalizeSerpAdvanced(advanced(task, 10, { pages_count: 2 }), expected);
  assert.equal(short.normalizationVersion, 2); assert.equal(short.captureComplete, true); assert.equal(short.organicCount, 10);
  assert.equal(short.coveredThroughRank, 10); assert.equal(short.completeDepth, false); assert.equal(short.rankingVerified, true);
  assert.equal(short.queryStatus, "EXACT"); assert.equal(short.correctedKeyword, null); assert.equal(short.spellType, null); assert.equal(short.pagesCount, 2);
  const sparse = advanced(task, 1); sparse.tasks[0].result[0].items[0].rank_group = 100;
  const normalizedSparse = normalizeSerpAdvanced(sparse, expected);
  assert.equal(normalizedSparse.captureComplete, true); assert.equal(normalizedSparse.maxOrganicRank, 100);
  assert.equal(normalizedSparse.coveredThroughRank, 0); assert.equal(normalizedSparse.completeDepth, false);
  const corrected = normalizeSerpAdvanced(advanced(task, 10, { keyword: "corrected query", spell: {
    type: "showing_results_for", keyword: "corrected query", spell: "lower-priority fallback",
  } }), expected);
  assert.equal(corrected.captureComplete, true); assert.equal(corrected.queryStatus, "AUTOCORRECTED");
  assert.equal(corrected.correctedKeyword, "corrected query"); assert.equal(corrected.spellType, "showing_results_for");
  assert.equal(corrected.rankingVerified, false); assert.equal(corrected.completeDepth, false);
  const fallback = normalizeSerpAdvanced(advanced(task, 10, { spell: { type: "including_results_for", spell: "legacy corrected query" } }), expected);
  assert.equal(fallback.correctedKeyword, "legacy corrected query"); assert.equal(fallback.queryStatus, "AUTOCORRECTED"); assert.equal(fallback.rankingVerified, false);
  const suggestion = normalizeSerpAdvanced(advanced(task, 10, { spell: { type: "did_you_mean", keyword: "suggested query" } }), expected);
  assert.equal(suggestion.queryStatus, "EXACT"); assert.equal(suggestion.rankingVerified, true, "an unaccepted suggestion does not replace the search query");
  const invalid = advanced(task, 10); invalid.tasks[0].result[0].items[3].url = "javascript:alert(1)";
  const malformed = normalizeSerpAdvanced(invalid, expected);
  assert.equal(malformed.captureComplete, false); assert.equal(malformed.rankingVerified, false); assert.equal(malformed.completeDepth, false);
});

test("successful short captures are COMPLETE while top100 coverage stays limited, and local replay never makes a second paid request", async () => {
  process.env.DATAFORSEO_SERP_PAID_ENABLED = "true"; state.config.paidEnabled = true;
  await start(); respond = async url => new Response(JSON.stringify(advanced(state.tasks.find(task => url.endsWith(task.providerTaskId)), 10)));
  const resumed = await mutateSerpMonitor({ action: "resume", runId: "fictional-serp-run-1" });
  assert.equal(resumed.run.status, "COMPLETED"); assert.equal(resumed.run.taskCounts.COMPLETE, 8);
  const count = fetches.length;
  const replayed = await mutateSerpMonitor({ action: "replay", runId: "fictional-serp-run-1" });
  assert.equal(replayed.run.taskCounts.COMPLETE, 8); assert.equal(fetches.length, count);
  assert.ok(state.tasks.every(task => !task.normalizedJson.completeDepth && task.normalizedJson.captureComplete && task.errorCode === null));
});

test("a saved POST receipt recovers task IDs after interruption without another paid POST", async () => {
  process.env.DATAFORSEO_SERP_PAID_ENABLED = "true"; state.config.paidEnabled = true;
  await start();
  for (const task of state.tasks) { task.state = "SUBMITTING"; task.providerTaskId = null; task.submittedAt = new Date(Date.now() - 300000); }
  delete process.env.DATAFORSEO_SERP_PAID_ENABLED;
  const result = await mutateSerpMonitor({ action: "resume", runId: "fictional-serp-run-1" });
  assert.equal(result.run.status, "COMPLETED"); assert.equal(fetches.filter(row => row.method === "POST").length, 1);
  assert.ok(state.tasks.every(task => task.providerTaskId && task.state === "COMPLETE"));
});

test("daily worker submits more than 100 queries in safe batches and follows completion with twice-monthly calendar cadence", async () => {
  process.env.DATAFORSEO_SERP_PAID_ENABLED = "true"; state.config.paidEnabled = true;
  state.config.nextDueAt = new Date(Date.now() - 1000);
  targets = Array.from({ length: 101 }, (_, index) => target(`model api ${index}`));
  const result = await runSerpMonitorCron();
  assert.equal(result.paidRequests, 5); assert.equal(state.runs.length, 1);
  assert.equal(fetches.filter(row => row.method === "POST").length, 5);
  assert.ok(fetches.findIndex(row => row.method === "GET") < fetches.findIndex((row, index) => index > 0 && row.method === "POST"), "known results are checked before the second paid batch");
  assert.equal(events.filter(event => event === "associate:batch").length, 5, "one atomic receipt association per POST");
  assert.equal(events.filter(event => event === "persist:raw-batch").length, 11, "404 free responses use eleven bounded raw writes");
  assert.equal(events.filter(event => event === "persist:normalized").length, 11, "normalization is saved per group rather than per keyword");
  assert.ok(state.tasks.every(task => task.state === "COMPLETE"));
  assert.equal((await runSerpMonitorCron()).status, "NOT_DUE");
  assert.equal(fetches.filter(row => row.method === "POST").length, 5);
});

test("queued tasks not ready for Google do not starve later unpolled tasks or trigger new paid submissions", async () => {
  process.env.DATAFORSEO_SERP_PAID_ENABLED = "true"; state.config.paidEnabled = true; state.config.nextDueAt = new Date(Date.now() - 1000);
  targets = Array.from({ length: 101 }, (_, index) => target(`model api ${index}`));
  const originalRespond = respond, notReadyTags = new Set();
  respond = async (url, init) => {
    if (init.method === "POST") {
      if (!notReadyTags.size) JSON.parse(init.body).slice(0, 40).forEach(task => notReadyTags.add(task.tag));
      return originalRespond(url, init);
    }
    const task = state.tasks.find(task => url.endsWith(task.providerTaskId));
    return notReadyTags.has(task.id) ? new Response(JSON.stringify({ status_code: 20000, tasks: [{ id: task.providerTaskId, status_code: 20101, result: null }] })) : originalRespond(url, init);
  };
  await runSerpMonitorCron();
  const gets = fetches.filter(row => row.method === "GET");
  assert.equal(gets.length, 404); assert.equal(new Set(gets.map(row => row.url)).size, 404);
  assert.equal(state.tasks.filter(task => task.state === "COMPLETE").length, 364);
  assert.equal(state.tasks.filter(task => task.state === "QUEUED").length, 40);
  assert.equal(fetches.filter(row => row.method === "POST").length, 5);
});

test("a completed period cannot be charged again under a different request identity", async () => {
  process.env.DATAFORSEO_SERP_PAID_ENABLED = "true"; state.config.paidEnabled = true;
  await start(); await mutateSerpMonitor({ action: "resume", runId: "fictional-serp-run-1" });
  state.config.nextDueAt = new Date(Date.now() - 1000);
  await assert.rejects(start("fictional-second-period-attempt"), error => error.status === 409 && error.message.includes("本期"));
  assert.equal(state.runs.length, 1); assert.equal(fetches.filter(row => row.method === "POST").length, 1);
});

test("an anomalous per-query paid receipt stops later batches while retaining IDs for free retrieval", async () => {
  process.env.DATAFORSEO_SERP_PAID_ENABLED = "true"; state.config.paidEnabled = true;
  targets = Array.from({ length: 101 }, (_, index) => target(`model api ${index}`));
  const originalRespond = respond;
  respond = async (url, init) => {
    const response = await originalRespond(url, init);
    if (init.method !== "POST") return response;
    const value = await response.json(); value.tasks[0].cost = 0.007;
    value.cost = value.tasks.reduce((sum, task) => sum + task.cost, 0);
    return new Response(JSON.stringify(value));
  };
  const first = await start();
  assert.equal(first.run.status, "UNKNOWN"); assert.equal(first.run.errorCode, "COST_LIMIT_EXCEEDED");
  assert.equal(first.run.taskCounts.QUEUED, 100); assert.equal(first.run.taskCounts.PLANNED, 304);
  assert.ok(state.tasks.filter(task => task.state === "QUEUED").every(task => task.providerTaskId));
  assert.equal((await runSerpMonitorCron()).status, "NEEDS_REVIEW");
  await mutateSerpMonitor({ action: "resume", runId: first.run.id });
  assert.equal(fetches.filter(row => row.method === "POST").length, 1);
  assert.ok(fetches.some(row => row.method === "GET")); assert.equal(state.runs[0].status, "UNKNOWN");
});

test("a batch total above its maximum preserves the greater actual cost and reservation and prevents repeat spending", async () => {
  process.env.DATAFORSEO_SERP_PAID_ENABLED = "true"; state.config.paidEnabled = true;
  targets = Array.from({ length: 101 }, (_, index) => target(`model api ${index}`));
  const originalRespond = respond;
  respond = async (url, init) => {
    const response = await originalRespond(url, init);
    if (init.method !== "POST") return response;
    const value = await response.json(); value.cost = 0.7;
    return new Response(JSON.stringify(value));
  };
  const result = await start();
  assert.equal(result.run.status, "UNKNOWN"); assert.equal(result.run.actualCostMicros, 700000);
  assert.equal(result.run.reservedCostMicros, 2424000);
  assert.equal((await start()).duplicate, true);
  assert.equal((await runSerpMonitorCron()).status, "NEEDS_REVIEW");
  assert.equal(fetches.filter(row => row.method === "POST").length, 1);
  assert.equal(fetches.filter(row => row.method === "GET").length, 100, "cost review blocks new spending but still collects paid IDs for free");
});

test("paused daily runner drains already-paid scheduled IDs without balance probes or new paid batches", async () => {
  process.env.DATAFORSEO_SERP_PAID_ENABLED = "true"; state.config.paidEnabled = true;
  targets = Array.from({ length: 30 }, (_, index) => target(`model ${index} price`));
  await start(); const probes = balanceRequests.length;
  delete process.env.DATAFORSEO_SERP_PAID_ENABLED; state.config.paidEnabled = false;
  const result = await runSerpMonitorCron();
  assert.equal(result.status, "PAUSED"); assert.equal(result.paidRequests, 0); assert.equal(result.freeResultsChecked, 100);
  assert.equal(result.remainingQueries, 20); assert.equal(result.continuationRequired, true);
  assert.equal(fetches.filter(row => row.method === "POST").length, 1); assert.equal(balanceRequests.length, probes);
  assert.equal(state.tasks.filter(task => task.state === "COMPLETE").length, 100);
  const gets = fetches.filter(row => row.method === "GET").length;
  process.env.DISABLE_EXTERNAL_FETCH = "true";
  assert.equal((await runSerpMonitorCron()).reason, "EXTERNAL_FETCH_DISABLED");
  assert.equal(fetches.filter(row => row.method === "GET").length, gets);
});

test("insufficient live balance halts the entire unpaid remainder before its first POST and does not auto-unblock", async () => {
  process.env.DATAFORSEO_SERP_PAID_ENABLED = "true"; state.config.paidEnabled = true; liveBalance = 0.067;
  targets = Array.from({ length: 3 }, (_, index) => target(`model ${index} price`));
  const result = await start();
  assert.equal(result.run.errorCode, "ACCOUNT_BALANCE_INSUFFICIENT"); assert.equal(result.run.status, "UNKNOWN");
  assert.equal(result.run.taskCounts.PLANNED, 12); assert.equal(balanceRequests.length, 1); assert.equal(fetches.length, 0);
  liveBalance = 100;
  assert.equal((await runSerpMonitorCron()).status, "NEEDS_REVIEW");
  assert.equal(balanceRequests.length, 1); assert.equal(fetches.length, 0);
});

test("pausing a paid gate during a run stops the next batch and still drains the already-paid batch", async () => {
  process.env.DATAFORSEO_SERP_PAID_ENABLED = "true"; state.config.paidEnabled = true; state.config.nextDueAt = new Date(Date.now() - 1000);
  targets = Array.from({ length: 30 }, (_, index) => target(`model ${index} price`));
  const original = respond;
  respond = async (url, init) => {
    const response = await original(url, init);
    if (init.method === "POST") state.config.paidEnabled = false;
    return response;
  };
  const result = await runSerpMonitorCron();
  assert.equal(result.status, "PAUSED"); assert.equal(result.remainingQueries, 20);
  assert.equal(fetches.filter(row => row.method === "POST").length, 1); assert.equal(fetches.filter(row => row.method === "GET").length, 100);
});

test("a provider ID already owned by another paid task leaves the new reservation unknown instead of relinking it", async () => {
  process.env.DATAFORSEO_SERP_PAID_ENABLED = "true"; state.config.paidEnabled = true;
  targets = Array.from({ length: 30 }, (_, index) => target(`model ${index} price`));
  const created = await start(), taken = state.tasks.find(task => task.providerTaskId).providerTaskId;
  const original = respond;
  respond = async (url, init) => {
    const response = await original(url, init);
    if (init.method !== "POST") return response;
    const raw = await response.json(); raw.tasks[0].id = taken;
    return new Response(JSON.stringify(raw));
  };
  await runSerpMonitorCron();
  assert.equal(state.tasks.filter(task => task.providerTaskId === taken).length, 1);
  assert.equal(state.tasks.filter(task => task.errorCode === "PROVIDER_ID_ALREADY_OWNED").length, 1);
  assert.equal(state.runs.find(run => run.id === created.run.id).status, "UNKNOWN");
  const paid = fetches.filter(row => row.method === "POST").length;
  await runSerpMonitorCron(); assert.equal(fetches.filter(row => row.method === "POST").length, paid);
});

test("provider account rejection atomically stops later paid batches while preserving accepted IDs for free collection", async () => {
  process.env.DATAFORSEO_SERP_PAID_ENABLED = "true"; state.config.paidEnabled = true; state.config.nextDueAt = new Date(Date.now() - 1000);
  targets = Array.from({ length: 30 }, (_, index) => target(`model ${index} price`));
  const original = respond;
  respond = async (url, init) => {
    const response = await original(url, init);
    if (init.method !== "POST") return response;
    const raw = await response.json(); raw.tasks[0] = { ...raw.tasks[0], id: null, status_code: 40200, cost: 0 };
    return new Response(JSON.stringify(raw));
  };
  const result = await runSerpMonitorCron();
  assert.equal(result.status, "NEEDS_REVIEW"); assert.equal(result.run.errorCode, "ACCOUNT_40200");
  assert.equal(result.run.taskCounts.COMPLETE, 99); assert.equal(result.run.taskCounts.FAILED, 1); assert.equal(result.run.taskCounts.PLANNED, 20);
  assert.equal(fetches.filter(row => row.method === "POST").length, 1);
  assert.equal(fetches.filter(row => row.method === "GET").length, 99); assert.equal(balanceRequests.length, 1);
  assert.equal(events.filter(event => event === "associate:batch").length, 1);
});

test("account errors discovered during free GET prevent any later paid batch", async () => {
  process.env.DATAFORSEO_SERP_PAID_ENABLED = "true"; state.config.paidEnabled = true; state.config.nextDueAt = new Date(Date.now() - 1000);
  targets = Array.from({ length: 30 }, (_, index) => target(`model ${index} price`));
  const original = respond;
  respond = async (url, init) => init.method === "GET" ? new Response(JSON.stringify({ status_code: 40200, tasks: null })) : original(url, init);
  const result = await runSerpMonitorCron();
  assert.equal(result.status, "NEEDS_REVIEW"); assert.equal(result.run.errorCode, "ACCOUNT_40200");
  assert.equal(fetches.filter(row => row.method === "POST").length, 1);
  assert.equal(result.run.taskCounts.PLANNED, 20); assert.equal(result.run.taskCounts.QUEUED, 100);
});

test("worker deadline covers setup and stops before another paid POST, leaving a resumable immutable ledger", async t => {
  let now = Date.now(); const began = now;
  t.mock.method(Date, "now", () => now);
  process.env.DATAFORSEO_SERP_PAID_ENABLED = "true"; state.config.paidEnabled = true; state.config.nextDueAt = new Date(now - 1000);
  targets = Array.from({ length: 30 }, (_, index) => target(`model ${index} price`));
  const original = respond;
  respond = async (url, init) => { assert.ok(now < began + 100000); const result = await original(url, init); if (init.method === "POST") now += 85000; return result; };
  const result = await runSerpMonitorCron({ maxDurationMs: 100000 });
  assert.equal(result.paidRequests, 1); assert.equal(result.continuationRequired, true); assert.equal(result.remainingQueries, 120);
  assert.equal(fetches.filter(row => row.method === "POST").length, 1); assert.equal(fetches.filter(row => row.method === "GET").length, 0);
  now += 200000;
  assert.equal((await runSerpMonitorCron({ maxDurationMs: 0 })).status, "TIME_BUDGET_EXHAUSTED");
  assert.equal(fetches.filter(row => row.method === "POST").length, 1);
});

async function seedAuthorizedSample(count = 2) {
  const id = "fictional-brand-model-sample", period = serpPeriod(new Date()), selected = [target("flatkey"), target("deepseek pricing"),
    ...Array.from({ length: Math.max(0, count - 2) }, (_, index) => target(`model ${index} pricing`))];
  const groups = groupSerpMarketQueries(selected), maximum = groups.length * 6000;
  const configJson = { ...SERP_DEFAULT_CONFIG, connectionHash: createHash("sha256").update("fictional-ciphertext").digest("hex"),
    selectedTargetIds: selected.map(target => `${target.siteDomain}:${target.keywordId}`),
    sampleAuthorizationHash: SERP_SAMPLE_AUTHORIZATION_HASH, sampleAuthorizationId: SERP_SAMPLE_AUTHORIZATION_ID,
    sampleMaxBudgetMicros: maximum, sampleBalanceBeforeMicros: 978280, sampleSafetyMarginMicros: 20000,
    sampleAuthorizedAt: new Date().toISOString(), sampleAuthorizationExpiresAt: new Date(Date.now() + 10 * 60_000).toISOString() };
  const run = await db.$transaction(async tx => {
    const created = await tx.serpMonitorRun.create({ data: { id, scope: "SAMPLE", sampleAuthorizationHash: SERP_SAMPLE_AUTHORIZATION_HASH,
      periodKey: period.key, periodLabel: `${period.label} · 品牌与模型价格验证`, periodStart: new Date(), periodEnd: new Date(),
      status: "PLANNED", cohortHash: "a".repeat(64), cohortJson: [...selected, target("unselected formal target")], configJson,
      queryCount: groups.length, targetCount: selected.length, estimatedCostMicros: maximum, reservedCostMicros: maximum, connectionVersion: 1 } });
    await tx.serpMonitorTask.createMany({ data: groups.map((group, index) => ({ id: `fictional-sample-task-${index}`, runId: id,
      queryKey: group.queryKey, region: group.region, keyword: group.keyword, targetsJson: group.targets, state: "PLANNED",
      requestJson: buildSerpTask(group, `fictional-sample-task-${index}`, configForSerpRegion(group.region)) })) });
    return created;
  });
  return state.runs.find(item => item.id === run.id);
}

test("one fixed sample authorization submits once while both scheduled spending gates stay disabled", async () => {
  const run = await seedAuthorizedSample();
  assert.equal(await submitSerpSampleBatch(run.id, SERP_SAMPLE_AUTHORIZATION_HASH), 8);
  assert.equal(state.config.paidEnabled, false); assert.equal(process.env.DATAFORSEO_SERP_PAID_ENABLED, undefined);
  assert.equal(fetches.filter(item => item.method === "POST").length, 1);
  assert.ok(state.tasks.every(task => task.providerTaskId && task.submissionRaw && task.state === "QUEUED"));
  assert.equal(await submitSerpSampleBatch(run.id, SERP_SAMPLE_AUTHORIZATION_HASH), 0);
  assert.equal(fetches.filter(item => item.method === "POST").length, 1);
  const completed = await mutateSerpMonitor({ action: "resume", runId: run.id });
  assert.equal(completed.run.status, "COMPLETED"); assert.equal(completed.run.scope, "SAMPLE");
  assert.equal(state.config.nextDueAt, null, "a trial never schedules a full capture");
});

test("sample request validation tolerates PostgreSQL JSONB key ordering and preserves approved parameters", async () => {
  const run = await seedAuthorizedSample();
  for (const task of state.tasks) task.requestJson = Object.fromEntries(Object.entries(task.requestJson).reverse());
  await submitSerpSampleBatch(run.id, SERP_SAMPLE_AUTHORIZATION_HASH);
  assert.equal(fetches.filter(item => item.method === "POST").length, 1);
  for (const request of JSON.parse(fetches[0].body)) {
    assert.equal(request.depth, 100); assert.equal(request.max_crawl_pages, 10); assert.equal(request.priority, 1);
    assert.equal(request.stop_crawl_on_match, undefined);
  }
});

test("the four-market sample submits 38 keywords as exactly 100 and 52 paid tasks then collects only known IDs", async () => {
  const run = await seedAuthorizedSample(38);
  assert.equal(run.targetCount, 38); assert.equal(run.queryCount, 152); assert.equal(run.reservedCostMicros, 912000);
  assert.equal(await submitSerpSampleBatch(run.id, SERP_SAMPLE_AUTHORIZATION_HASH), 100);
  assert.equal(await submitSerpSampleBatch(run.id, SERP_SAMPLE_AUTHORIZATION_HASH), 52);
  assert.equal(await submitSerpSampleBatch(run.id, SERP_SAMPLE_AUTHORIZATION_HASH), 0);
  assert.deepEqual(fetches.filter(row => row.method === "POST").map(row => JSON.parse(row.body).length), [100, 52]);
  for (const region of SERP_MARKETS) {
    const market = SERP_MARKET_CONFIG[region], tasks = state.tasks.filter(task => task.region === region);
    assert.equal(tasks.length, 38);
    for (const task of tasks) { assert.equal(task.requestJson.language_code, market.languageCode); assert.equal(task.requestJson.location_code, market.locationCode); assert.equal(task.requestJson.se_domain, market.searchDomain); }
  }
  for (let attempt = 0; attempt < 4; attempt++) await mutateSerpMonitor({ action: "resume", runId: run.id });
  assert.ok(state.tasks.every(task => task.state === "COMPLETE")); assert.equal(state.config.nextDueAt, null);
  assert.equal(fetches.filter(row => row.method === "POST").length, 2);
});

test("four-market quote and parser bind each independent country, language and Google domain", () => {
  const selected = Array.from({ length: 38 }, (_, index) => target(`model ${index} price`)), quote = quoteSerpTargets(selected, SERP_MARKETS);
  assert.equal(quote.queryCount, 152); assert.equal(quote.keywordQueryCount, 38); assert.equal(quote.marketCount, 4); assert.equal(quote.maxCostMicros, 912000);
  for (const region of SERP_MARKETS) {
    const config = configForSerpRegion(region), task = { providerTaskId: "fictional-market-provider", keyword: "model price",
      requestJson: buildSerpTask(groupSerpQueries([target("model price")])[0], "market-tag", config) };
    const expected = { providerTaskId: task.providerTaskId, keyword: task.keyword, config };
    assert.equal(normalizeSerpAdvanced(advanced(task), expected).completeDepth, true);
    assert.throws(() => normalizeSerpAdvanced(advanced(task, 100, { language_code: "invalid" }), expected), /SCOPE_MISMATCH/);
    assert.throws(() => normalizeSerpAdvanced(advanced(task, 100, { se_domain: "wrong.invalid" }), expected), /SCOPE_MISMATCH/);
  }
});

test("completed GET settles a lower fee after unused-depth refunds without changing the original reservation", async () => {
  process.env.DATAFORSEO_SERP_PAID_ENABLED = "true"; state.config.paidEnabled = true;
  const created = await start(); assert.equal(created.run.actualCostMicros, 48000);
  respond = async url => {
    const result = advanced(state.tasks.find(task => url.endsWith(task.providerTaskId)), 10);
    result.tasks[0].cost = 0.0012; return new Response(JSON.stringify(result));
  };
  const result = await mutateSerpMonitor({ action: "resume", runId: created.run.id });
  assert.equal(result.run.actualCostMicros, 9600); assert.equal(result.run.reservedCostMicros, 48000);
  assert.ok(state.tasks.every(task => task.costMicros === 1200));
  assert.ok(state.tasks.every(task => JSON.parse(task.submissionRaw).tasks.every(receipt => receipt.cost === 0.006)), "original prepayment receipts remain unchanged");
  assert.equal(fetches.filter(row => row.method === "POST").length, 1);
});

test("free resume repairs all 152 cached legacy sample settlements once, including COMPLETE and INCOMPLETE, without any provider call", async () => {
  const run = await seedAuthorizedSample(38), completedAt = new Date("2026-10-16T03:00:00Z");
  run.status = "PARTIAL"; run.completedAt = completedAt; run.actualCostMicros = run.reservedCostMicros;
  for (const [index, task] of state.tasks.entries()) {
    task.providerTaskId = `fictional-settled-${index}`; task.costMicros = 6000; task.state = index % 2 ? "COMPLETE" : "INCOMPLETE";
    const raw = advanced(task, index % 2 ? 100 : 10); raw.tasks[0].cost = 0.0012;
    task.rawResponse = JSON.stringify(raw); task.submissionRaw = "original-prepayment-receipt";
  }
  const result = await mutateSerpMonitor({ action: "resume", runId: run.id });
  assert.equal(result.run.actualCostMicros, 182400); assert.equal(result.run.reservedCostMicros, 912000);
  assert.ok(state.tasks.every(task => task.costMicros === 1200 && task.state === "COMPLETE" && task.normalizedJson.normalizationVersion === 2 && task.normalizedJson.captureComplete && task.errorCode === null));
  assert.equal(result.run.status, "COMPLETED"); assert.equal(events.filter(event => event === "settle:cached").length, 1);
  assert.equal(result.run.completedAt, completedAt.toISOString()); assert.equal(fetches.length, 0); assert.equal(state.config.nextDueAt, null);
  await mutateSerpMonitor({ action: "resume", runId: run.id });
  await mutateSerpMonitor({ action: "replay", runId: run.id });
  assert.equal(events.filter(event => event === "settle:cached").length, 1, "unchanged cached rows produce no repeated settlement write");
  assert.ok(state.tasks.every(task => task.submissionRaw === "original-prepayment-receipt")); assert.equal(fetches.length, 0);
});

test("cached parser upgrade retains query-correction evidence and leaves genuinely invalid receipts incomplete", async () => {
  const run = await seedAuthorizedSample();
  for (const [index, task] of state.tasks.entries()) {
    task.providerTaskId = `fictional-upgrade-${index}`; task.state = "INCOMPLETE"; task.costMicros = 6000;
    const raw = advanced(task, 10, { pages_count: 1, spell: { type: "no_results_found_for", spell: "corrected query" } });
    raw.tasks[0].cost = 0.0012; task.rawResponse = JSON.stringify(raw);
  }
  state.tasks[0].rawResponse = "invalid cached JSON";
  const result = await mutateSerpMonitor({ action: "resume", runId: run.id });
  assert.equal(result.run.status, "PARTIAL"); assert.equal(result.run.taskCounts.COMPLETE, 7); assert.equal(result.run.taskCounts.INCOMPLETE, 1);
  assert.equal(state.tasks[0].errorCode, "RESULT_VALIDATION_FAILED_V2"); assert.equal(state.tasks[0].normalizedJson, null);
  assert.ok(state.tasks.slice(1).every(task => task.normalizedJson.queryStatus === "AUTOCORRECTED" && task.normalizedJson.correctedKeyword === "corrected query" && task.normalizedJson.rankingVerified === false));
  const writes = events.filter(event => event === "settle:cached").length;
  await mutateSerpMonitor({ action: "replay", runId: run.id });
  assert.equal(events.filter(event => event === "settle:cached").length, writes); assert.equal(fetches.length, 0);
});

test("local replay lowers an already completed run's stale actual total even when its ranking status is unchanged", async () => {
  process.env.DATAFORSEO_SERP_PAID_ENABLED = "true"; state.config.paidEnabled = true;
  const created = await start(); await mutateSerpMonitor({ action: "resume", runId: created.run.id });
  const completedAt = state.runs[0].completedAt, dueAt = state.config.nextDueAt;
  for (const task of state.tasks) { const raw = JSON.parse(task.rawResponse); raw.tasks[0].cost = 0.0012; task.rawResponse = JSON.stringify(raw); }
  const before = fetches.length, result = await mutateSerpMonitor({ action: "replay", runId: created.run.id });
  assert.equal(result.run.status, "COMPLETED"); assert.equal(result.run.actualCostMicros, 9600); assert.equal(result.run.reservedCostMicros, 48000);
  assert.equal(result.run.completedAt, completedAt.toISOString()); assert.equal(state.config.nextDueAt.toISOString(), dueAt.toISOString()); assert.equal(fetches.length, before);
});

test("settlement refunds cannot clear a prior COST guard or lower the anomalous amount held for review", async () => {
  const run = await seedAuthorizedSample(); run.status = "UNKNOWN"; run.errorCode = "COST_LIMIT_EXCEEDED";
  run.actualCostMicros = 60000; run.reservedCostMicros = 60000;
  for (const [index, task] of state.tasks.entries()) {
    task.providerTaskId = `fictional-cost-review-${index}`; task.state = "INCOMPLETE"; task.costMicros = 6000;
    const raw = advanced(task, 10); raw.tasks[0].cost = 0.0012; task.rawResponse = JSON.stringify(raw);
  }
  const result = await mutateSerpMonitor({ action: "resume", runId: run.id });
  assert.equal(result.run.status, "UNKNOWN"); assert.equal(result.run.errorCode, "COST_LIMIT_EXCEEDED");
  assert.equal(result.run.actualCostMicros, 60000); assert.equal(result.run.reservedCostMicros, 60000);
  await assert.rejects(submitSerpSampleBatch(run.id, SERP_SAMPLE_AUTHORIZATION_HASH), error => error.status === 409);
  assert.equal(fetches.length, 0);
});

test("sample helper rejects wrong scope, authorization, count, cap, balance, expiry, connection or paid request extras before POST", async () => {
  const changes = [
    run => { run.scope = "SCHEDULED"; },
    run => { run.sampleAuthorizationHash = "b".repeat(64); },
    run => { run.configJson.sampleAuthorizationHash = "b".repeat(64); },
    run => { run.queryCount = 51; run.estimatedCostMicros = run.reservedCostMicros = 306000; run.configJson.sampleMaxBudgetMicros = 306000; },
    run => { run.configJson.sampleMaxBudgetMicros = 950001; },
    run => { run.configJson.sampleMaxBudgetMicros = 6000; },
    run => { run.configJson.sampleBalanceBeforeMicros = 31999; },
    run => { run.configJson.sampleAuthorizationExpiresAt = new Date(Date.now() - 1000).toISOString(); },
    run => { run.connectionVersion = 2; },
    run => { run.configJson.connectionHash = "b".repeat(64); },
    () => { state.tasks[0].requestJson.calculate_rectangles = true; },
    () => { state.tasks[0].requestJson.depth = 200; },
    () => { state.tasks[0].requestJson.priority = 2; },
    () => { state.tasks[0].requestJson.stop_crawl_on_match = "flatkey.ai"; },
    () => { state.tasks[0].region = "CA"; },
    () => { state.tasks[0].queryKey = "US:wrong keyword"; },
    run => { run.configJson.selectedTargetIds.push("flatkey.ai:unapproved-keyword"); },
    () => { state.tasks.pop(); },
  ];
  for (const change of changes) {
    state.runs = []; state.tasks = []; const run = await seedAuthorizedSample(); change(run);
    await assert.rejects(submitSerpSampleBatch(run.id, SERP_SAMPLE_AUTHORIZATION_HASH), error => error.status === 409);
    assert.equal(fetches.length, 0, "invalid sample never reaches the provider");
  }
  state.runs = []; state.tasks = []; const run = await seedAuthorizedSample();
  await assert.rejects(submitSerpSampleBatch(run.id, "c".repeat(64)), error => error.status === 409);
  process.env.DISABLE_EXTERNAL_FETCH = "true";
  await assert.rejects(submitSerpSampleBatch(run.id, SERP_SAMPLE_AUTHORIZATION_HASH), error => error.status === 409);
  delete process.env.DISABLE_EXTERNAL_FETCH; state.config.paidEnabled = true;
  await assert.rejects(submitSerpSampleBatch(run.id, SERP_SAMPLE_AUTHORIZATION_HASH), error => error.status === 409);
  state.config.paidEnabled = false; process.env.DATAFORSEO_SERP_PAID_ENABLED = "true";
  await assert.rejects(submitSerpSampleBatch(run.id, SERP_SAMPLE_AUTHORIZATION_HASH), error => error.status === 409);
  assert.equal(fetches.length, 0);
});

test("an uncertain sample POST is not repeated and only known IDs permit free result retrieval", async () => {
  const run = await seedAuthorizedSample(); respond = async () => { throw new Error("fictional lost receipt"); };
  await submitSerpSampleBatch(run.id, SERP_SAMPLE_AUTHORIZATION_HASH);
  assert.equal(state.runs[0].status, "UNKNOWN"); assert.ok(state.tasks.every(task => task.state === "UNKNOWN"));
  await assert.rejects(submitSerpSampleBatch(run.id, SERP_SAMPLE_AUTHORIZATION_HASH), error => error.status === 409);
  await mutateSerpMonitor({ action: "resume", runId: run.id });
  assert.equal(fetches.length, 1); assert.equal(fetches[0].method, "POST"); assert.equal(state.config.nextDueAt, null);
});

test("cron never submits or resumes open SAMPLE tasks even if the scheduled gates later change", async () => {
  const run = await seedAuthorizedSample(); process.env.DATAFORSEO_SERP_PAID_ENABLED = "true"; state.config.paidEnabled = true;
  assert.equal((await runSerpMonitorCron()).status, "NOT_SCHEDULED");
  state.config.nextDueAt = new Date(Date.now() - 1000);
  await assert.rejects(runSerpMonitorCron(), error => error.status === 409 && error.message.includes("未完成"));
  assert.equal(fetches.length, 0); assert.ok(state.tasks.every(task => task.runId === run.id && task.state === "PLANNED"));
});

let sessionToken;
const headersPath = require.resolve("next/headers");
require.cache[headersPath] = { id: headersPath, filename: headersPath, loaded: true, exports: { cookies: async () => ({ get: () => sessionToken ? { value: sessionToken } : undefined }) } };
const { GET: statusRoute, POST: mutateRoute } = require("../src/app/api/serp-monitor/route.ts");
const { GET: cronRoute } = require("../src/app/api/cron/daily-rankings/route.ts");
const { getAuthToken } = require("../src/lib/auth.ts");
test("management routes require a logged-in session and only accept disabled setup; cron always requires a secret", async () => {
  process.env.LOGIN_PWD = "fictional-serp-website-password"; process.env.DATABASE_URL = "postgresql://unused.invalid/test"; sessionToken = null;
  assert.equal((await statusRoute()).status, 401);
  const request = value => new Request("https://flatkey.test/api/serp-monitor", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(value) });
  assert.equal((await mutateRoute(request({ action: "preview" }))).status, 401);
  sessionToken = await getAuthToken();
  assert.equal((await statusRoute()).status, 200);
  assert.equal((await mutateRoute(request({ action: "configure", paidEnabled: true }))).status, 400);
  assert.equal((await mutateRoute(request({ action: "preview" }))).status, 200);
  assert.equal((await mutateRoute(request({ action: "start", idempotencyKey: "fictional-denied-run", expectedCohortHash: "a".repeat(64) }))).status, 409);
  delete process.env.CRON_SECRET;
  assert.equal((await cronRoute(new Request("https://flatkey.test/api/cron/serp-monitor"))).status, 401);
  process.env.CRON_SECRET = "fictional-serp-cron-secret";
  assert.equal((await cronRoute(new Request("https://flatkey.test/api/cron/serp-monitor", { headers: { Authorization: "Bearer fictional-serp-cron-secret" } }))).status, 200);
  assert.equal(fetches.length, 0);
});
