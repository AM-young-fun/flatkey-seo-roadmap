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
const sample = require("../src/lib/serp-sample.ts");
const credentials = require("../src/lib/dataforseo-credentials.ts");
const { SERP_DEFAULT_CONFIG } = require("../src/lib/dataforseo-serp.ts");
let state, queue, inTransaction, balance, balanceResponse, calls, commits, committedIds, submits, resumes, cohort;
function matches(row, where = {}) {
  return Object.entries(where).every(([key, value]) => {
    if (key === "OR") return value.some(part => matches(row, part));
    if (value && typeof value === "object") {
      if (Object.hasOwn(value, "in")) return value.in.includes(row?.[key]);
      return matches(row?.[key], value);
    }
    return row?.[key] === value;
  });
}
const db = {
  $transaction: async callback => {
    const prior = queue; let release; queue = new Promise(resolve => { release = resolve; }); await prior;
    const before = clone(state); inTransaction = true;
    try { const result = await callback(db); commits++; for (const run of state.runs) committedIds.add(run.id); return result; }
    catch (error) { state = before; throw error; }
    finally { inTransaction = false; release(); }
  },
  $executeRaw: async () => 0,
  serpMonitorConfig: { findUnique: async () => clone(state.config) },
  dataForSeoConnection: { findUnique: async () => clone(state.connection) },
  serpMonitorRun: {
    findUnique: async ({ where }) => clone(state.runs.find(row => matches(row, where)) ?? null),
    findFirst: async ({ where }) => clone(state.runs.find(row => matches(row, where)) ?? null),
    create: async ({ data }) => {
      assert.equal(inTransaction, true);
      assert.ok(!state.runs.some(row => row.id === data.id || row.sampleAuthorizationHash === data.sampleAuthorizationHash));
      const row = { startedAt: new Date(), actualCostMicros: null, ...clone(data) }; state.runs.push(row); return clone(row);
    },
  },
  serpMonitorTask: { createMany: async ({ data }) => { assert.equal(inTransaction, true); state.tasks.push(...clone(data)); return { count: data.length }; },
    findMany: async ({ where, take }) => clone(state.tasks.filter(row => matches(row, where)).slice(0, take)),
  },
};
const key = target => `${target.siteDomain}:${target.keywordId}`;
const target = (keyword, id = keyword.replaceAll(" ", "-")) => ({ keywordId: id, keyword, siteDomain: "flatkey.ai", targetUrls: ["https://flatkey.ai/models/example"] });
function dto(run) { return { id: run.id, scope: run.scope, targetCount: run.targetCount, queryCount: run.queryCount, status: run.status,
  actualCostMicros: run.actualCostMicros, estimatedCostMicros: run.estimatedCostMicros, reservedCostMicros: run.reservedCostMicros,
  periodKey: run.periodKey, periodLabel: run.periodLabel, taskCounts: {} }; }
function mockFile(relative, exports) { const name = path.join(root, relative); require.cache[name] = { id: name, filename: name, loaded: true, exports }; }
mockFile("src/lib/prisma.ts", { prisma: db });
mockFile("src/lib/services/serp-targets.ts", { loadSerpTargetCohort: async () => clone(cohort) });
mockFile("src/lib/serp-sample-selection.ts", { selectSerpSampleTargets: targets => ({
  targets: targets.filter(target => ["flatkey", "model price"].includes(target.keyword)),
  categories: Object.fromEntries(targets.map(target => [key(target), target.keyword === "flatkey" ? "BRAND" : "MODEL_PRICE"])),
}) });
mockFile("src/lib/services/serp-monitor.ts", {
  submitSerpSampleBatch: async (id, authorizationHash) => {
    assert.ok(committedIds.has(id) && commits > 0, "this run's reservation committed before any paid submission");
    assert.equal(authorizationHash, sample.SERP_SAMPLE_AUTHORIZATION_HASH);
    const run = state.runs.find(row => row.id === id); assert.equal(run.scope, "SAMPLE");
    assert.ok(state.tasks.every(task => task.runId === id && task.state === "PLANNED"));
    for (const task of state.tasks) task.state = "QUEUED";
    run.status = "RUNNING"; submits++;
  },
  resumeSerpMonitorRun: async id => { resumes++; return dto(state.runs.find(row => row.id === id)); },
});
const { previewSerpSample, startSerpSample, loadSerpSampleEvidence, mutateSerpSample } = require("../src/lib/services/serp-sample.ts");
const start = (preview, id = "fictional-sample-request-1") => startSerpSample({ action: "startSample", idempotencyKey: id,
  expectedSubsetHash: preview.subsetHash, authorizationToken: preview.authorizationToken, maxBudgetMicros: preview.maxBudgetMicros });
beforeEach(t => {
  delete process.env.DATAFORSEO_SERP_PAID_ENABLED; delete process.env.DISABLE_EXTERNAL_FETCH;
  process.env.LOGIN_PWD = "fictional-sample-only-login-password";
  state = { config: { id: "default", ...SERP_DEFAULT_CONFIG }, runs: [], tasks: [],
    connection: { siteDomain: "flatkey.ai", connectionVersion: 1, encryptedCredentials: credentials.encryptDataForSeoCredentials("fictional@example.invalid", "fictional-password") } };
  cohort = { hash: "a".repeat(64), targets: [target("flatkey"), target("model price"), target("unselected formal word")] };
  balance = 0.97828; balanceResponse = null; calls = []; commits = 0; committedIds = new Set(); submits = 0; resumes = 0; queue = Promise.resolve(); inTransaction = false;
  t.mock.method(globalThis, "fetch", async (url, init) => {
    assert.equal(inTransaction, false); assert.equal(url, sample.SERP_USER_DATA_URL); assert.equal(init.method, "GET");
    assert.equal(init.redirect, "error"); calls.push({ url, method: init.method });
    return new Response(JSON.stringify(balanceResponse ?? { status_code: 20000, cost: 0, tasks: [{ status_code: 20000, cost: 0,
      result: [{ login: "never-expose-provider-login", money: { balance }, rates: { sensitive: "never-expose-provider-usage" } }] }] }));
  });
});

test("free balance parser fails closed on invalid, negative, mismatched or unexpectedly charged receipts", () => {
  const valid = { status_code: 20000, cost: 0, tasks: [{ status_code: 20000, cost: 0, result: [{ money: { balance: 0.97828 } }] }] };
  assert.equal(sample.parseSerpSampleBalance(valid), 978280);
  for (const raw of [{}, { ...valid, cost: 0.001 }, { ...valid, tasks: [] },
    { ...valid, tasks: [{ ...valid.tasks[0], result: [{ money: { balance: -1 } }] }] },
    { ...valid, tasks: [{ ...valid.tasks[0], result: [{ money: { balance: "1" } }] }] }]) assert.throws(() => sample.parseSerpSampleBalance(raw));
});

test("free account verification remains usable during an authorized schedule without starting or pausing jobs", async () => {
  state.config.paidEnabled = true; state.config.authorizationVersion = 1;
  const result = await mutateSerpSample({ action: "sampleBalance" });
  assert.equal(result.balanceMicros, 978280); assert.equal(result.scheduledPaidEnabled, true);
  assert.equal(calls.length, 1); assert.equal(submits, 0); assert.equal(state.runs.length, 0); assert.equal(state.config.paidEnabled, true);
});

test("sample budget always leaves a safety reserve and deduplicates shared query targets", () => {
  const targets = [target("flatkey"), target("model price"), { ...target("ｍｏｄｅｌ  price", "shared"), siteDomain: "rackrate.org" }];
  const selection = { targets, categories: Object.fromEntries(targets.map(target => [key(target), target.keyword === "flatkey" ? "BRAND" : "MODEL_PRICE"])) };
  assert.equal(sample.affordableSerpSample(selection, 20000).targets.length, 0);
  assert.equal(sample.affordableSerpSample(selection, 44000).targets.length, 1);
  assert.equal(sample.affordableSerpSample(selection, 68000).targets.length, 3);
  const many = Array.from({ length: 80 }, (_, index) => target(`model ${index} price`));
  assert.equal(sample.affordableSerpSample({ targets: many, categories: Object.fromEntries(many.map(target => [key(target), "MODEL_PRICE"])) }, 5_000_000).targets.length, 39);
});

test("sample schema cannot raise the fixed one-time budget or accept arbitrary target IDs", () => {
  assert.equal(sample.serpSampleMutationSchema.safeParse({ action: "previewSample", targets: ["anything"] }).success, false);
  assert.equal(sample.serpSampleMutationSchema.safeParse({ action: "startSample", idempotencyKey: "fictional-request", expectedSubsetHash: "a".repeat(64), authorizationToken: "x".repeat(50), maxBudgetMicros: 950001 }).success, false);
});

test("sample preview uses only free balance GET, includes exact subset, and never leaks account data or enables scheduling", async () => {
  const preview = await previewSerpSample();
  assert.equal(preview.quote.queryCount, 8); assert.equal(preview.maxBudgetMicros, 48000); assert.equal(preview.liveBalanceMicros, 978280);
  assert.deepEqual(preview.targets.map(target => target.keyword), ["flatkey", "model price"]);
  assert.equal(calls.length, 1); assert.equal(submits, 0); assert.equal(state.runs.length, 0);
  assert.equal(state.config.paidEnabled, false); assert.equal(state.config.nextDueAt, null);
  const serialized = JSON.stringify(preview);
  assert.ok(!serialized.includes("never-expose")); assert.ok(!serialized.includes(state.connection.encryptedCredentials));
  assert.ok(!serialized.includes("fictional-password"));
});

test("single sample freezes full denominator and subset tasks before submit while full flags remain off", async () => {
  const preview = await previewSerpSample(), result = await start(preview);
  assert.equal(result.duplicate, false); assert.equal(result.run.scope, "SAMPLE"); assert.equal(result.run.queryCount, 8);
  const run = state.runs[0]; assert.equal(run.cohortJson.length, 3); assert.equal(run.targetCount, 2); assert.equal(run.reservedCostMicros, 48000);
  assert.equal(run.sampleAuthorizationHash, sample.SERP_SAMPLE_AUTHORIZATION_HASH);
  assert.deepEqual(run.configJson.selectedTargetIds, ["flatkey.ai:flatkey", "flatkey.ai:model-price"]);
  assert.equal(state.tasks.length, 8); assert.equal(submits, 1); assert.equal(calls.length, 2);
  assert.equal(process.env.DATAFORSEO_SERP_PAID_ENABLED, undefined); assert.equal(state.config.paidEnabled, false); assert.equal(state.config.nextDueAt, null);
});

test("fresh previews, new request identities and concurrent starts reuse one spending authorization", async () => {
  const preview = await previewSerpSample();
  const results = await Promise.all([start(preview, "fictional-concurrent-a"), start(preview, "fictional-concurrent-b")]);
  assert.equal(results.filter(result => !result.duplicate).length, 1); assert.equal(state.runs.length, 1); assert.equal(submits, 1);
  const fresh = await previewSerpSample(), repeated = await start(fresh, "fictional-different-request");
  assert.equal(repeated.duplicate, true); assert.equal(repeated.run.id, state.runs[0].id); assert.equal(submits, 1);
  assert.ok(resumes >= 3, "repeat attempts can collect the original task results for free");
});

test("a lower balance, changed cohort or connection, invalid signature and changed budget stop before reservation", async () => {
  const preview = await previewSerpSample(); balance = 0.031;
  await assert.rejects(start(preview), /余额已减少/); assert.equal(submits, 0); assert.equal(state.runs.length, 0);
  balance = 1; cohort.hash = "b".repeat(64); await assert.rejects(start(preview), /目标词或API连接/);
  cohort.hash = "a".repeat(64); state.connection.connectionVersion = 2; await assert.rejects(start(preview), /目标词或API连接/);
  state.connection.connectionVersion = 1;
  await assert.rejects(start({ ...preview, maxBudgetMicros: 18000 }), /变化或过期/);
  await assert.rejects(start({ ...preview, authorizationToken: `${preview.authorizationToken}x` }), /费用预览/);
  assert.equal(state.runs.length, 0); assert.equal(submits, 0);
});

test("full scheduling gates or external stop switch reject sample before balance checks or reservation", async () => {
  state.config.paidEnabled = true; await assert.rejects(previewSerpSample(), /全量定时/);
  state.config.paidEnabled = false; process.env.DATAFORSEO_SERP_PAID_ENABLED = "true"; await assert.rejects(previewSerpSample(), /全量定时/);
  delete process.env.DATAFORSEO_SERP_PAID_ENABLED; process.env.DISABLE_EXTERNAL_FETCH = "true"; await assert.rejects(previewSerpSample(), /外部请求已暂停/);
  assert.equal(calls.length, 0); assert.equal(submits, 0); assert.equal(state.runs.length, 0);
});

test("ambiguous open ledger and unreadable balance cannot create a new sample reservation", async () => {
  const preview = await previewSerpSample(); state.runs.push({ id: "old-unknown-ledger", status: "UNKNOWN" });
  await assert.rejects(start(preview), /结果不明/); assert.equal(submits, 0); assert.equal(state.tasks.length, 0);
  state.runs = []; balanceResponse = { status_code: 40501, tasks: [] };
  await assert.rejects(start(preview), /无法确认/); assert.equal(state.runs.length, 0); assert.equal(submits, 0);
});

test("an expired signed preview, insufficient balance or missing category cannot authorize a sample", async () => {
  const preview = await previewSerpSample();
  const claims = credentials.verifyDataForSeoPreview(preview.authorizationToken);
  claims.expiresAt = Date.now() - 1000;
  await assert.rejects(start({ ...preview, authorizationToken: credentials.signDataForSeoPreview(claims) }), /变化或过期/);
  balance = 0.02; await assert.rejects(previewSerpSample(), /余额不足/);
  balance = 1; cohort.targets = cohort.targets.filter(target => target.keyword !== "flatkey");
  await assert.rejects(previewSerpSample(), /同时验证/);
  assert.equal(state.runs.length, 0); assert.equal(submits, 0);
});

test("sample evidence reads cached receipts only and exposes no secrets or unearned related-result ranks", async t => {
  t.mock.method(globalThis, "fetch", async () => assert.fail("cached evidence must never contact a provider"));
  const empty = await loadSerpSampleEvidence(); assert.equal(empty.run, null); assert.equal(empty.taskCount, 0);
  state.runs.push({ id: "fixed-sample", sampleAuthorizationHash: sample.SERP_SAMPLE_AUTHORIZATION_HASH, scope: "SAMPLE",
    periodKey: "2026-10-2", periodLabel: "2026年10月第2期", targetCount: 38, queryCount: 152, status: "PARTIAL",
    configJson: { secret: "never-expose-run-config" } });
  const cached = { account: "never-expose-account", headers: { Authorization: "never-expose-authorization" }, tasks: [{ id: "provider-cached", cost: 0,
    result: [{ keyword: "flatkey ai", se_domain: "google.com", pages_count: 1, items_count: 4,
      spell: { type: "showing_results_for", spell: "flat key ai", secret: "never-expose-spell-object" },
      items: [{ type: "organic", rank_group: 1, url: "https://example.org/", related_result: [{ type: "related_result", rank_group: 77, url: "https://flatkey.ai/" }] },
        { type: "organic", rank_group: 3, url: "https://flatkey.ai/models/example" }, { type: "paid", rank_group: 2, url: "https://flatkey.ai/ad" },
        { type: "organic", rank_group: 4, url: "https://flatkey.ai.attacker.invalid/" }] }] }] };
  state.tasks.push({ runId: "fixed-sample", keyword: "flatkey ai", region: "US", state: "INCOMPLETE", errorCode: "SHORT_SERP",
    checkedAt: new Date("2026-10-16T03:00:00Z"), providerTaskId: "provider-cached", rawResponse: JSON.stringify(cached), submissionRaw: "never-expose-submission" });
  const before = clone(state), result = await loadSerpSampleEvidence();
  assert.equal(result.taskCount, 1); const row = result.tasks[0];
  assert.equal(row.cachedGetTaskCost, 0); assert.equal(row.resultKeyword, "flatkey ai"); assert.equal(row.searchDomain, "google.com");
  assert.equal(row.organicCount, 3); assert.equal(row.maxOrganicRank, 4); assert.deepEqual(row.missingOrganicRanks.slice(0, 3), [2, 5, 6]);
  assert.deepEqual(row.spell, { type: "showing_results_for", spell: "flat key ai" });
  assert.deepEqual(row.flatkeyPages, [{ rankGroup: 3, url: "https://flatkey.ai/models/example" }]);
  assert.deepEqual(row.relatedResults, [{ parentRankGroup: 1, parentUrl: "https://example.org/", url: "https://flatkey.ai/" }]);
  assert.ok(!JSON.stringify(result).includes("never-expose")); assert.ok(!JSON.stringify(result).includes("rawResponse"));
  assert.deepEqual(state, before); assert.equal(calls.length, 0); assert.equal(submits, 0); assert.equal(commits, 0);
});
