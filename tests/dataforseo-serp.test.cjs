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

const clone = value => structuredClone(value);
let state, targets, queue, inTransaction, fetches, respond, events;
function matches(row, where = {}) {
  return Object.entries(where).every(([key, expected]) => {
    if (key === "OR") return expected.some(part => matches(row, part));
    if (key === "AND") return expected.every(part => matches(row, part));
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
  $executeRaw: async () => 0,
  serpMonitorConfig: model("config", { revision: 1, nextDueAt: null }), serpMonitorRun: model("runs"), serpMonitorTask: model("tasks"),
  dataForSeoConnection: { findUnique: async () => state.connection ? { loginMasked: "f***", encryptedCredentials: "fictional-ciphertext", connectionVersion: 1 } : null },
};
function mockFile(relative, exports) { const name = path.join(root, relative); require.cache[name] = { id: name, filename: name, loaded: true, exports }; }
mockFile("src/lib/prisma.ts", { prisma: db });
mockFile("src/lib/services/serp-targets.ts", { loadSerpTargetCohort: async () => ({ targets: clone(targets), hash: "a".repeat(64) }) });
mockFile("src/lib/dataforseo-credentials.ts", { decryptDataForSeoCredentials: () => ({ apiLogin: "fictional@example.invalid", apiPassword: "fictional-not-a-real-password" }) });
const { SERP_DEFAULT_CONFIG, groupSerpQueries, quoteSerpTargets, buildSerpTask, normalizeSerpAdvanced, serpMonitorMutationSchema } = require("../src/lib/dataforseo-serp.ts");
const { periodDue, nextSerpPeriodKey } = require("../src/lib/serp-periods.ts");
const { loadSerpMonitorStatus, mutateSerpMonitor, runSerpMonitorCron } = require("../src/lib/services/serp-monitor.ts");

function target(keyword, siteDomain = "flatkey.ai") { return { keyword, keywordId: `id-${keyword}`, siteDomain, targetUrls: [`https://${siteDomain}/models/example`] }; }
function advanced(task, count = 100, overrides = {}) {
  return { status_code: 20000, tasks: [{ id: task.providerTaskId, status_code: 20000, cost: 0.006, data: task.requestJson,
    result: [{ keyword: task.keyword, type: "organic", se_domain: "google.com", location_code: 2840, language_code: "en",
      datetime: "2026-10-15 12:00:00 +00:00", check_url: "https://www.google.com/search?q=example", items_count: count + 20,
      items: Array.from({ length: count }, (_, index) => ({ type: "organic", rank_group: index + 1, rank_absolute: index + 3,
        title: `Result ${index + 1}`, url: [4, 19].includes(index) ? `https://flatkey.ai/models/example-${index}` : `https://competitor.invalid/page-${index}` })), ...overrides }] }] };
}
const start = (id = "fictional-serp-run-1") => mutateSerpMonitor({ action: "start", idempotencyKey: id, expectedCohortHash: "a".repeat(64) });
beforeEach(t => {
  delete process.env.DATAFORSEO_SERP_PAID_ENABLED; delete process.env.DISABLE_EXTERNAL_FETCH;
  targets = [target("model api price"), target("brand key")];
  state = { config: { id: "default", ...SERP_DEFAULT_CONFIG, revision: 1 }, connection: true, runs: [], tasks: [] };
  queue = Promise.resolve(); inTransaction = false; fetches = []; events = [];
  respond = async (url, init) => init.method === "POST" ? new Response(JSON.stringify({ status_code: 20000, tasks: JSON.parse(init.body).map((data, index) => ({ id: `provider-${index}-${fetches.length}`, status_code: 20100, cost: 0.006, data })) })) :
    new Response(JSON.stringify(advanced(state.tasks.find(task => url.endsWith(task.providerTaskId)))));
  t.mock.method(globalThis, "fetch", async (url, init) => {
    assert.equal(inTransaction, false, "network must follow durable transaction commit");
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
  assert.equal(status.quote.maxCostMicros, 12000); assert.equal(state.runs.length, 0); assert.equal(fetches.length, 0);
  await assert.rejects(start(), error => error.status === 409);
  process.env.DATAFORSEO_SERP_PAID_ENABLED = "true";
  await assert.rejects(start(), error => error.status === 409);
  assert.equal(serpMonitorMutationSchema.safeParse({ action: "configure", paidEnabled: true }).success, false);
  const saved = await mutateSerpMonitor({ action: "configure", paidEnabled: false, expectedRevision: 1 });
  assert.equal(saved.config.paidEnabled, false); assert.equal(saved.config.intervalDays, 14); assert.equal(saved.config.depth, 100);
  assert.equal(saved.config.nextDueAt, null); assert.equal(fetches.length, 0);
  assert.ok(!JSON.stringify(saved).includes("fictional-ciphertext"));
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
  assert.equal(quote.maxCostMicros, 12000); assert.equal(quote.annual24RunsMicros, 288000);
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
  assert.equal(first.run.taskCounts.QUEUED, 100); assert.equal(first.run.taskCounts.PLANNED, 1);
  assert.equal(fetches.length, 1); assert.equal(state.runs.length, 1); assert.deepEqual(state.runs[0].cohortJson, original);
  assert.equal(state.tasks.length, 101); assert.ok(state.tasks.filter(task => task.state === "QUEUED").every(task => task.submissionRaw));
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
  const first = await start(); assert.equal(first.run.status, "UNKNOWN"); assert.equal(first.run.taskCounts.UNKNOWN, 2);
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
  assert.equal(result.run.status, "COMPLETED"); assert.equal(result.run.taskCounts.COMPLETE, 2);
  assert.equal(fetches.filter(row => row.method === "POST").length, 1); assert.equal(fetches.filter(row => row.method === "GET").length, 2);
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

test("successful short captures are explicitly INCOMPLETE and a local replay never makes a second paid request", async () => {
  process.env.DATAFORSEO_SERP_PAID_ENABLED = "true"; state.config.paidEnabled = true;
  await start(); respond = async url => new Response(JSON.stringify(advanced(state.tasks.find(task => url.endsWith(task.providerTaskId)), 10)));
  const resumed = await mutateSerpMonitor({ action: "resume", runId: "fictional-serp-run-1" });
  assert.equal(resumed.run.status, "PARTIAL"); assert.equal(resumed.run.taskCounts.INCOMPLETE, 2);
  const count = fetches.length;
  const replayed = await mutateSerpMonitor({ action: "replay", runId: "fictional-serp-run-1" });
  assert.equal(replayed.run.taskCounts.INCOMPLETE, 2); assert.equal(fetches.length, count);
  assert.ok(state.tasks.every(task => !task.normalizedJson.completeDepth));
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
  assert.equal(result.paidRequests, 2); assert.equal(state.runs.length, 1);
  assert.equal(fetches.filter(row => row.method === "POST").length, 2);
  assert.ok(state.tasks.every(task => task.state === "COMPLETE"));
  assert.equal((await runSerpMonitorCron()).status, "NOT_DUE");
  assert.equal(fetches.filter(row => row.method === "POST").length, 2);
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
  assert.equal(gets.length, 101); assert.equal(new Set(gets.map(row => row.url)).size, 101);
  assert.equal(state.tasks.filter(task => task.state === "COMPLETE").length, 61);
  assert.equal(state.tasks.filter(task => task.state === "QUEUED").length, 40);
  assert.equal(fetches.filter(row => row.method === "POST").length, 2);
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
  assert.equal(first.run.taskCounts.QUEUED, 100); assert.equal(first.run.taskCounts.PLANNED, 1);
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
  assert.equal(result.run.reservedCostMicros, 700000);
  assert.equal((await start()).duplicate, true);
  assert.equal((await runSerpMonitorCron()).status, "NEEDS_REVIEW");
  assert.equal(fetches.length, 1);
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
