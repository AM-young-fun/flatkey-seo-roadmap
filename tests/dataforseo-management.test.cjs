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

let state, transactionQueue, inTransaction, committedRuns, sessionToken, fetched, events, ledgerUpdates, importAttempts, importedIds, failImports, failOnImportAttempt, failPlanReads, beforeImport, respond;
const clone = value => structuredClone(value);
const fictional = { apiLogin: "fictional-management@example.invalid", apiPassword: "fictional-management-password" };
function matches(row, where = {}) {
  return Object.entries(where).every(([key, expected]) => {
    const actual = row?.[key];
    if (expected && typeof expected === "object" && !(expected instanceof Date)) {
      if (Object.hasOwn(expected, "in")) return expected.in.includes(actual);
      if (Object.hasOwn(expected, "not")) return actual !== expected.not;
      return matches(actual, expected);
    }
    return actual === expected;
  });
}
function seedRun(overrides = {}) {
  const run = { requestId: "previous-completed-run", siteDomain: "flatkey.ai", status: "COMPLETED", requestHash: "fictional-hash", requestJson: [],
    connectionVersion: 1, estimatedCostMicros: 132000, budgetCostMicros: 132000, actualCostMicros: null, rawResponse: null, normalized: null,
    importPayload: null, importedBatches: 0, candidates: null, summary: null, collectedAt: null, errorCode: null, completedAt: null, createdAt: new Date(), ...overrides };
  state.runs.push(run);
  return run;
}
const db = {
  $transaction: async callback => {
    const previous = transactionQueue;
    let release;
    transactionQueue = new Promise(resolve => { release = resolve; });
    await previous;
    const before = clone(state);
    inTransaction = true;
    try {
      const result = await callback(db);
      for (const run of state.runs) committedRuns.add(run.requestId);
      events.push("transaction:commit");
      return result;
    }
    catch (error) { state = before; throw error; }
    finally { inTransaction = false; release(); }
  },
  $executeRaw: async () => 0,
  seoSite: { findUnique: async () => ({ domain: "flatkey.ai", active: state.siteActive }) },
  dataForSeoConnection: {
    findUnique: async ({ where }) => state.connection && matches(state.connection, where) ? clone(state.connection) : null,
    upsert: async ({ create, update }) => {
      if (!state.connection) state.connection = { connectionVersion: 1, scheduleEnabled: false, createdAt: new Date(), ...clone(create) };
      else {
        const { connectionVersion, ...rest } = update;
        Object.assign(state.connection, clone(rest));
        state.connection.connectionVersion += connectionVersion?.increment ?? 0;
      }
      return clone(state.connection);
    },
    deleteMany: async () => { const count = Number(Boolean(state.connection)); state.connection = null; return { count }; },
  },
  dataForSeoRun: {
    findUnique: async ({ where }) => clone(state.runs.find(run => matches(run, where)) ?? null),
    findUniqueOrThrow: async ({ where }) => {
      const run = state.runs.find(run => matches(run, where));
      if (!run) throw new Error("fictional missing ledger");
      return clone(run);
    },
    findFirst: async ({ where, orderBy = [] }) => {
      const rows = state.runs.filter(run => matches(run, where));
      rows.sort((a, b) => {
        for (const order of Array.isArray(orderBy) ? orderBy : [orderBy]) {
          const [key, direction] = Object.entries(order)[0], left = a[key], right = b[key];
          const delta = left < right ? -1 : left > right ? 1 : 0;
          if (delta) return direction === "desc" ? -delta : delta;
        }
        return 0;
      });
      return clone(rows[0] ?? null);
    },
    findMany: async ({ where }) => state.runs.filter(run => matches(run, where)).map(clone),
    aggregate: async ({ where }) => ({ _sum: { budgetCostMicros: state.runs.filter(run => matches(run, where)).reduce((sum, run) => sum + run.budgetCostMicros, 0) } }),
    create: async ({ data }) => {
      assert.equal(inTransaction, true, "paid reservations must be inside the budget transaction");
      assert.ok(!state.runs.some(run => run.requestId === data.requestId));
      events.push("reserve:PENDING");
      return clone(seedRun({ ...clone(data), status: data.status }));
    },
    update: async ({ where, data }) => {
      const run = state.runs.find(run => matches(run, where));
      assert.ok(run, "updating an existing ledger");
      ledgerUpdates.push({ where: clone(where), data: clone(data) });
      if (Object.hasOwn(data, "rawResponse")) events.push("persist:raw");
      if (Object.hasOwn(data, "normalized")) events.push("persist:normalized");
      if (Object.hasOwn(data, "importPayload")) events.push("persist:import-plan");
      Object.assign(run, clone(data));
      return clone(run);
    },
    updateMany: async ({ where, data }) => {
      ledgerUpdates.push({ where: clone(where), data: clone(data) });
      const matchesWhere = state.runs.filter(run => matches(run, where));
      for (const run of matchesWhere) Object.assign(run, clone(data));
      return { count: matchesWhere.length };
    },
  },
  siteKeyword: { findMany: async ({ where }) => {
    if (failPlanReads > 0) { failPlanReads--; throw new Error("fictional transient plan read failure"); }
    return state.memberships.filter(row => matches(row, where)).map(clone);
  } },
};
const prismaPath = path.join(root, "src/lib/prisma.ts");
require.cache[prismaPath] = { id: prismaPath, filename: prismaPath, loaded: true, exports: { prisma: db } };
const importPath = path.join(root, "src/lib/services/seo-import.ts");
require.cache[importPath] = { id: importPath, filename: importPath, loaded: true, exports: { importSeo: async payload => {
  const run = state.runs.find(run => Array.isArray(run.importPayload) && run.importPayload.some(batch => batch.requestId === payload.requestId));
  assert.ok(run?.rawResponse, "raw paid response must be cached before import");
  assert.ok(run.normalized, "normalized paid response must be cached before import");
  events.push("import");
  importAttempts.push(clone(payload));
  if (beforeImport) await beforeImport(payload);
  if (failImports > 0) { failImports--; throw new Error("fictional import failure"); }
  if (failOnImportAttempt === importAttempts.length) { failOnImportAttempt = 0; throw new Error("fictional partial import failure"); }
  const duplicate = importedIds.has(payload.requestId);
  importedIds.add(payload.requestId);
  return { imported: payload.observations.length + payload.pages.length, duplicate };
} } };
const headersPath = require.resolve("next/headers");
require.cache[headersPath] = { id: headersPath, filename: headersPath, loaded: true, exports: {
  cookies: async () => ({ get: name => name === "seo_rank_auth" && sessionToken ? { value: sessionToken } : undefined }),
} };

const { encryptDataForSeoCredentials, decryptDataForSeoCredentials, signDataForSeoPreview, verifyDataForSeoPreview } = require("../src/lib/dataforseo-credentials.ts");
const { dataForSeoMutationSchema } = require("../src/lib/dataforseo-management.ts");
const { buildDataForSeoImportPlan } = require("../src/lib/dataforseo-import-plan.ts");
const { normalizeRankedKeywords } = require("../src/lib/dataforseo-labs.cjs");
const { mutateDataForSeo, loadDataForSeoStatus } = require("../src/lib/services/dataforseo.ts");
const { GET, POST } = require("../src/app/api/dataforseo/route.ts");
const { getAuthToken } = require("../src/lib/auth.ts");

function providerItem(keyword = "claude api", rank = 17, url = "https://flatkey.ai/models/claude") {
  return { keyword_data: { keyword, location_code: 2840, language_code: "en", keyword_info: { search_volume: 0, last_updated_time: "2026-10-01 04:00:00 +00:00" } },
    ranked_serp_element: { last_updated_time: "2026-10-14 03:00:00 +00:00", is_lost: false, serp_item: { type: "organic", rank_group: rank, rank_absolute: rank + 5, url } } };
}
function providerResponse(items = [providerItem()], cost = 0.01212) {
  return { status_code: 20000, tasks_count: 1, tasks_error: 0, cost, tasks: [{ id: "fictional-paid-task", status_code: 20000,
    result: [{ target: "flatkey.ai", se_type: "google", location_code: 2840, language_code: "en", total_count: items.length, items_count: items.length, items }] }] };
}
function addMembership(keywordId = "known", text = "claude api", overrides = {}) {
  const membership = { keywordId, siteDomain: "flatkey.ai", active: true, pool: "FORMAL", protected: true, targetUrls: ["https://flatkey.ai/manual-target"],
    keyword: { text, active: true }, ...overrides };
  state.memberships.push(membership);
  return membership;
}
const connect = () => mutateDataForSeo({ action: "connect", ...fictional });
const preview = requestId => mutateDataForSeo({ action: "preview", requestId });
const update = (requestId, previewToken) => mutateDataForSeo({ action: "update", requestId, previewToken });
const request = (body, bearer) => new Request("https://flatkey.test/api/dataforseo", { method: "POST", headers: { "Content-Type": "application/json", ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}) }, body: JSON.stringify(body) });

beforeEach(t => {
  process.env.LOGIN_PWD = "fictional-dataforseo-management-login-password";
  process.env.DATABASE_URL = "postgresql://unused.invalid/dataforseo-management";
  state = { connection: null, runs: [], memberships: [], siteActive: true };
  transactionQueue = Promise.resolve(); inTransaction = false; committedRuns = new Set(); sessionToken = null; fetched = []; events = []; ledgerUpdates = []; importAttempts = []; importedIds = new Set(); failImports = 0; failOnImportAttempt = 0; failPlanReads = 0; beforeImport = null;
  respond = async () => new Response(JSON.stringify(providerResponse()), { status: 200 });
  t.mock.method(globalThis, "fetch", async (url, init) => {
    const body = JSON.parse(init.body), run = state.runs.find(run => run.requestId === body[0].tag);
    assert.equal(run?.status, "PENDING");
    assert.ok(committedRuns.has(run.requestId), "this request's PENDING reservation must commit before its paid network call");
    assert.ok(events.includes("transaction:commit"));
    fetched.push({ url, method: init.method, redirect: init.redirect, body });
    events.push("fetch");
    return respond(url, init);
  });
});

test("AES-GCM credentials use randomized encryption, contain no plaintext and reject tampering or login-password rotation", () => {
  const first = encryptDataForSeoCredentials(fictional.apiLogin, fictional.apiPassword);
  const second = encryptDataForSeoCredentials(fictional.apiLogin, fictional.apiPassword);
  assert.notEqual(first, second);
  assert.ok(!first.includes(fictional.apiLogin) && !first.includes(fictional.apiPassword));
  assert.deepEqual(decryptDataForSeoCredentials(first), fictional);
  const parts = first.split("."), tampered = Buffer.from(parts[3], "base64url"); tampered[0] ^= 1; parts[3] = tampered.toString("base64url");
  assert.throws(() => decryptDataForSeoCredentials(parts.join(".")), error => error.status === 409);
  process.env.LOGIN_PWD = "fictional-rotated-login-password";
  assert.throws(() => decryptDataForSeoCredentials(first), error => error.status === 409);
  assert.equal(fetched.length, 0);
});

test("connect and preview are offline and expose masked connection and bounded signed preview only", async () => {
  const connected = await connect();
  const ready = await preview("offline-preview");
  assert.equal(fetched.length, 0);
  assert.equal(state.runs.length, 0);
  assert.equal(connected.connection.configured, true);
  assert.equal(connected.connection.canDecrypt, true);
  assert.equal(connected.connection.scheduleEnabled, false);
  assert.equal(ready.quote.maxCostMicros, 132000);
  assert.equal(ready.trialBudget.limitMicros, 1000000);
  const claims = verifyDataForSeoPreview(ready.previewToken);
  assert.equal(claims.requestId, "offline-preview");
  assert.equal(claims.connectionVersion, 1);
  assert.equal(claims.usedMicros, 0);
  assert.equal(typeof claims.requestHash, "string");
  assert.equal(typeof claims.connectionHash, "string");
  assert.ok(claims.expiresAt > Date.now());
  for (const value of [connected, ready, state.connection]) {
    const text = JSON.stringify(value);
    assert.ok(!text.includes(fictional.apiLogin) && !text.includes(fictional.apiPassword));
  }
});

test("preview token binds request identity, signature, connection and expiry before reserving money", async t => {
  await connect();
  const p = await preview("token-bound");
  await assert.rejects(update("different-request", p.previewToken), error => error.status === 409);
  const signatureParts = p.previewToken.split("."), signature = Buffer.from(signatureParts[1], "base64url"); signature[0] ^= 1; signatureParts[1] = signature.toString("base64url");
  await assert.rejects(update("token-bound", signatureParts.join(".")), error => error.status === 409);
  const claims = verifyDataForSeoPreview(p.previewToken);
  await assert.rejects(update("token-bound", signDataForSeoPreview({ ...claims, requestHash: "changed-request" })), error => error.status === 409);
  t.mock.method(Date, "now", () => claims.expiresAt + 1);
  await assert.rejects(update("token-bound", p.previewToken), error => error.status === 409);
  assert.equal(fetched.length, 0);
  assert.equal(state.runs.length, 0);
});

test("reconnecting after disconnect cannot revive a preview even if the connection version resets", async () => {
  await connect();
  const original = await preview("reconnected-run");
  await mutateDataForSeo({ action: "disconnect" });
  await connect();
  assert.equal(state.connection.connectionVersion, 1);
  await assert.rejects(update("reconnected-run", original.previewToken), error => error.status === 409);
  assert.equal(fetched.length, 0);
});

test("budget drift and inactive site invalidate a preview without a provider request", async () => {
  await connect();
  const original = await preview("budget-drift");
  seedRun({ budgetCostMicros: 1 });
  await assert.rejects(update("budget-drift", original.previewToken), error => error.status === 409);
  const fresh = await preview("disabled-site");
  state.siteActive = false;
  await assert.rejects(update("disabled-site", fresh.previewToken), error => error.status === 409);
  assert.equal(fetched.length, 0);
});

test("PENDING commits before one fixed POST, cached raw and plan precede import, and same request never posts twice", async () => {
  await connect(); addMembership();
  const before = clone(state.memberships), p = await preview("single-paid-request");
  const result = await update("single-paid-request", p.previewToken);
  assert.equal(result.status, "RECEIVED");
  assert.equal(result.duplicate, false);
  assert.equal(importAttempts.length, 0, "the paid POST request must never perform database import");
  assert.equal((await mutateDataForSeo({ action: "replay", requestId: p.requestId })).status, "COMPLETED");
  assert.equal(fetched.length, 1);
  assert.equal(fetched[0].url, "https://api.dataforseo.com/v3/dataforseo_labs/google/ranked_keywords/live");
  assert.equal(fetched[0].method, "POST"); assert.equal(fetched[0].redirect, "error");
  assert.equal(fetched[0].body.length, 1);
  assert.equal(fetched[0].body[0].location_code, 2840);
  assert.equal(fetched[0].body[0].language_code, "en");
  const rawWrite = ledgerUpdates.find(entry => Object.hasOwn(entry.data, "rawResponse"));
  assert.equal(rawWrite.data.status, "RECEIVED", "the durable raw cache must already be eligible for zero-fee recovery");
  assert.ok(rawWrite.data.collectedAt instanceof Date, "the original receipt time must be persisted in the same write as the raw response");
  assert.equal(rawWrite.data.collectedAt.toISOString(), state.runs[0].collectedAt.toISOString());
  assert.ok(events.indexOf("persist:raw") < events.indexOf("persist:normalized"));
  assert.ok(events.indexOf("persist:normalized") < events.indexOf("persist:import-plan"));
  assert.ok(events.indexOf("persist:import-plan") < events.indexOf("import"));
  assert.deepEqual(state.memberships, before);
  assert.equal(importAttempts[0].allowNewKeywords, false);
  assert.equal(importAttempts[0].observations[0].source, "dataforseo_labs");
  assert.equal(importAttempts[0].observations[0].rank, 17);
  assert.equal(importAttempts[0].observations[0].volume, 0);
  assert.equal((await update("single-paid-request", "unused-replay-token")).duplicate, true);
  assert.equal((await mutateDataForSeo({ action: "replay", requestId: "single-paid-request" })).status, "COMPLETED");
  assert.equal(fetched.length, 1);
  assert.equal(importAttempts.length, 1);
});

test("two concurrent approved requests cannot reserve more than the one-dollar trial budget", async () => {
  await connect(); seedRun({ budgetCostMicros: 868000 });
  const a = await preview("concurrent-budget-a"), b = await preview("concurrent-budget-b");
  respond = async () => new Response(JSON.stringify(providerResponse([], 0.132)), { status: 200 });
  const results = await Promise.allSettled([update(a.requestId, a.previewToken), update(b.requestId, b.previewToken)]);
  assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
  assert.equal(fetched.length, 1);
  assert.equal(state.runs.reduce((sum, run) => sum + run.budgetCostMicros, 0), 1000000);
  await assert.rejects(preview("over-budget"), error => error.status === 409);
  assert.equal(fetched.length, 1);
});

test("concurrent reuse of one request ID creates one ledger and only one paid POST", async () => {
  await connect();
  const p = await preview("same-request-race");
  const results = await Promise.all([update(p.requestId, p.previewToken), update(p.requestId, p.previewToken)]);
  assert.equal(state.runs.length, 1);
  assert.equal(fetched.length, 1);
  assert.equal(results.filter(result => result.duplicate).length, 1);
});

test("UNKNOWN outcome keeps its budget reservation and blocks fresh IDs as well as duplicate POSTs", async () => {
  await connect();
  const p = await preview("lost-response");
  respond = async () => { throw new TypeError(`fictional network loss ${fictional.apiPassword}`); };
  const result = await update(p.requestId, p.previewToken);
  assert.equal(result.status, "UNKNOWN");
  assert.equal(result.run.errorCode, "OUTCOME_UNKNOWN");
  assert.equal(state.runs[0].budgetCostMicros, 132000);
  await assert.rejects(preview("new-id-after-loss"), error => error.status === 409);
  await assert.rejects(update("new-id-after-loss", p.previewToken), error => error.status === 409);
  assert.equal((await update(p.requestId, p.previewToken)).duplicate, true);
  assert.equal((await mutateDataForSeo({ action: "replay", requestId: p.requestId })).status, "UNKNOWN");
  assert.equal(fetched.length, 1);
  assert.equal(importAttempts.length, 0);
  assert.ok(!JSON.stringify([result, state.runs]).includes(fictional.apiPassword));
});

test("a response-body read failure is UNKNOWN and cannot trigger a paid retry", async () => {
  await connect(); const p = await preview("incomplete-response");
  respond = async () => ({ status: 200, ok: true, text: async () => { throw new Error("fictional lost response body"); } });
  const result = await update(p.requestId, p.previewToken);
  assert.equal(result.status, "UNKNOWN"); assert.equal(result.run.errorCode, "RESPONSE_INCOMPLETE");
  assert.equal((await update(p.requestId, p.previewToken)).duplicate, true);
  assert.equal(fetched.length, 1);
});

test("failed inventory import replays immutable cached batches without another paid request", async () => {
  await connect(); addMembership(); failImports = 1;
  const p = await preview("import-failed");
  assert.equal((await update(p.requestId, p.previewToken)).status, "RECEIVED");
  assert.equal(importAttempts.length, 0);
  const first = await mutateDataForSeo({ action: "replay", requestId: p.requestId });
  assert.equal(first.status, "IMPORT_FAILED");
  assert.equal(fetched.length, 1);
  await assert.rejects(preview("new-paid-id-after-import-failure"), error => error.status === 409);
  await assert.rejects(update("new-paid-id-after-import-failure", p.previewToken), error => error.status === 409);
  const frozenPayload = clone(state.runs[0].importPayload);
  state.memberships.push({ keywordId: "later", siteDomain: "flatkey.ai", active: true, pool: "FORMAL", keyword: { text: "later model api", active: true } });
  const replay = await mutateDataForSeo({ action: "replay", requestId: p.requestId });
  assert.equal(replay.status, "COMPLETED");
  assert.equal(fetched.length, 1);
  assert.equal(importAttempts.length, 2);
  assert.deepEqual(importAttempts[0], importAttempts[1]);
  assert.deepEqual(state.runs[0].importPayload, frozenPayload);
  assert.equal(importedIds.size, 1);
});

test("partial multi-batch import resumes stable cached IDs without extra provider calls or repeated observation writes", async () => {
  await connect(); addMembership();
  for (let index = 0; index < 500; index++) addMembership(`formal-${index}`, `formal model ${index} api`);
  failOnImportAttempt = 2;
  const p = await preview("partial-import");
  assert.equal((await update(p.requestId, p.previewToken)).status, "RECEIVED");
  assert.equal(importAttempts.length, 0);
  const initialImport = await mutateDataForSeo({ action: "replay", requestId: p.requestId });
  assert.equal(initialImport.status, "RECEIVED");
  assert.equal(initialImport.run.errorCode, "IMPORT_CONTINUE_FROM_CACHE");
  assert.equal(state.runs[0].importedBatches, 1);
  assert.equal(importAttempts.length, 1);
  const first = await mutateDataForSeo({ action: "replay", requestId: p.requestId });
  assert.equal(first.status, "IMPORT_FAILED");
  assert.equal(importAttempts.length, 2);
  assert.equal(importedIds.size, 1);
  assert.equal(state.runs[0].importedBatches, 1, "a failed batch must not advance the durable cursor");
  const frozen = clone(state.runs[0].importPayload);
  assert.equal(frozen.length, 2);
  assert.ok(frozen.every(batch => batch.observations.length + batch.pages.length <= 500));
  assert.equal(frozen[0].capture.complete, false);
  assert.equal(frozen[1].capture.complete, true);
  const replay = await mutateDataForSeo({ action: "replay", requestId: p.requestId });
  assert.equal(replay.status, "COMPLETED");
  assert.equal(fetched.length, 1);
  assert.equal(importAttempts.length, 3);
  assert.equal(importedIds.size, 2);
  assert.notEqual(importAttempts[0].requestId, importAttempts[2].requestId, "the successful first batch must not be replayed");
  assert.deepEqual(importAttempts[1], importAttempts[2]);
  assert.equal(state.runs[0].importedBatches, 2);
  assert.deepEqual(state.runs[0].importPayload, frozen);
  assert.equal(replay.run.summary.importedObservations, 502);
});

test("failed import planning can recover solely from the stored provider response", async () => {
  await connect(); addMembership(); failPlanReads = 1;
  const p = await preview("plan-failed");
  const first = await update(p.requestId, p.previewToken);
  assert.equal(first.status, "IMPORT_FAILED"); assert.equal(first.run.errorCode, "IMPORT_PLAN_FAILED");
  assert.ok(state.runs[0].rawResponse && state.runs[0].normalized);
  assert.equal(importAttempts.length, 0);
  const replay = await mutateDataForSeo({ action: "replay", requestId: p.requestId });
  assert.equal(replay.status, "COMPLETED");
  assert.equal(fetched.length, 1);
  assert.equal(importAttempts.length, 1);
});

test("a raw-only RECEIVED ledger recovers normalization, actual cost and import without any provider request", async () => {
  addMembership();
  const collectedAt = new Date(), response = providerResponse([providerItem()], 0.01875);
  const run = seedRun({ requestId: "raw-only-recovery", status: "RECEIVED", rawResponse: JSON.stringify(response), collectedAt,
    normalized: null, importPayload: null, actualCostMicros: null, budgetCostMicros: 132000 });
  const recovered = await mutateDataForSeo({ action: "replay", requestId: run.requestId });
  assert.equal(recovered.status, "COMPLETED");
  assert.equal(fetched.length, 0, "crash recovery must not issue another paid POST or require a connection");
  assert.equal(importAttempts.length, 1);
  assert.equal(state.runs[0].actualCostMicros, 18750);
  assert.equal(state.runs[0].budgetCostMicros, 18750);
  assert.equal(recovered.run.actualCostMicros, 18750);
  assert.equal(state.runs[0].collectedAt.toISOString(), collectedAt.toISOString());
  assert.equal(state.runs[0].normalized.collectedAt, collectedAt.toISOString());
  assert.deepEqual(JSON.parse(state.runs[0].rawResponse), response);
  assert.ok(Array.isArray(state.runs[0].importPayload));
  assert.equal(importAttempts[0].observations[0].rank, 17);
  assert.equal(importAttempts[0].observations[0].collectedAt, collectedAt.toISOString());
  assert.equal((await mutateDataForSeo({ action: "replay", requestId: run.requestId })).status, "COMPLETED");
  assert.equal(importAttempts.length, 1);
  assert.equal(fetched.length, 0);
});

for (const additionalMembers of [0, 500]) {
  test(`a stale failed replay cannot regress a ${additionalMembers ? "progressed" : "completed"} import ledger`, { timeout: 10000 }, async () => {
    await connect(); addMembership();
    for (let index = 0; index < additionalMembers; index++) addMembership(`race-formal-${index}`, `race formal model ${index} api`);
    const p = await preview(`stale-cursor-${additionalMembers}`);
    assert.equal((await update(p.requestId, p.previewToken)).status, "RECEIVED");
    let entered, release;
    const firstEntered = new Promise(resolve => { entered = resolve; });
    const firstRelease = new Promise(resolve => { release = resolve; });
    let calls = 0;
    beforeImport = async () => {
      if (++calls !== 1) return;
      entered();
      await firstRelease;
      throw new Error("fictional stale cursor import failure");
    };
    const stale = mutateDataForSeo({ action: "replay", requestId: p.requestId });
    await firstEntered;
    try {
      const winner = await mutateDataForSeo({ action: "replay", requestId: p.requestId });
      assert.equal(winner.status, additionalMembers ? "RECEIVED" : "COMPLETED");
      assert.equal(state.runs[0].importedBatches, 1);
    } finally {
      release();
    }
    const afterWinner = clone(state.runs[0]), staleResult = await stale;
    assert.equal(staleResult.status, afterWinner.status);
    assert.equal(state.runs[0].status, afterWinner.status);
    assert.equal(state.runs[0].importedBatches, 1);
    assert.deepEqual(state.runs[0].summary, afterWinner.summary);
    assert.deepEqual(state.runs[0].completedAt, afterWinner.completedAt);
    assert.equal(state.runs[0].errorCode, afterWinner.errorCode);
    assert.equal(importedIds.size, 1);
    assert.equal(fetched.length, 1, "both racing replays must use the same cached response");
  });
}

test("wholly rejected or contradictory empty paid responses preserve their cost and raw evidence without blanking formal ranks", async () => {
  await connect(); addMembership();
  const paid = providerItem(); paid.ranked_serp_element.serp_item.type = "paid";
  const foreign = providerItem("claude api", 4, "https://foreign.example/page");
  const rejected = providerResponse([paid, foreign], 0.02);
  const contradictory = providerResponse([], 0.02); contradictory.tasks[0].result[0].total_count = 19;
  const baseline = clone(state);
  for (const [index, response] of [rejected, contradictory].entries()) {
    state = clone(baseline); fetched = []; importAttempts = []; events = []; committedRuns.clear();
    const requestId = `unusable-response-${index}`, p = await preview(requestId);
    respond = async () => new Response(JSON.stringify(response), { status: 200 });
    const result = await update(requestId, p.previewToken);
    assert.equal(result.status, "IMPORT_FAILED");
    assert.equal(result.run.errorCode, "IMPORT_PLAN_FAILED");
    assert.equal(importAttempts.length, 0);
    assert.equal(fetched.length, 1);
    assert.deepEqual(state.memberships, baseline.memberships);
    const ledger = state.runs[0];
    assert.deepEqual(JSON.parse(ledger.rawResponse), response);
    assert.equal(ledger.actualCostMicros, 20000);
    assert.equal(ledger.budgetCostMicros, 20000);
    assert.ok(ledger.normalized);
    assert.equal(ledger.normalized.rows.length, 0);
    assert.equal(ledger.importPayload, null);
    assert.throws(() => buildDataForSeoImportPlan(ledger.normalized, state.memberships, requestId));
    assert.equal((await mutateDataForSeo({ action: "replay", requestId })).status, "IMPORT_FAILED");
    assert.equal(fetched.length, 1);
    assert.equal(importAttempts.length, 0);
  }
});

test("a genuine zero-item zero-total paid result records formal no_data without inventing outside-top100 evidence", async () => {
  await connect(); addMembership(); addMembership("other-formal", "other model api");
  const p = await preview("genuine-empty-response");
  respond = async () => new Response(JSON.stringify(providerResponse([])), { status: 200 });
  assert.equal((await update(p.requestId, p.previewToken)).status, "RECEIVED");
  assert.equal(importAttempts.length, 0);
  const result = await mutateDataForSeo({ action: "replay", requestId: p.requestId });
  assert.equal(result.status, "COMPLETED");
  assert.equal(fetched.length, 1);
  assert.equal(importAttempts.length, 1);
  assert.equal(result.run.summary.missingFormal, 2);
  assert.equal(result.run.summary.normalizedRows, 0);
  assert.equal(result.run.summary.returnedItems, 0);
  assert.equal(result.run.summary.totalMatchingCount, 0);
  const observations = importAttempts.flatMap(batch => batch.observations);
  assert.equal(observations.length, 2);
  assert.ok(observations.every(row => row.rank === null && row.rankStatus === "no_data"));
  assert.ok(!observations.some(row => row.rankStatus === "outside_top100"));
});

test("HTTP and provider errors remain cached failed ledgers and are never automatically re-posted", async () => {
  await connect();
  const p = await preview("failed-provider");
  respond = async () => new Response(JSON.stringify({ ...providerResponse(), status_code: 40200 }), { status: 200 });
  const result = await update(p.requestId, p.previewToken);
  assert.equal(result.status, "FAILED"); assert.equal(result.run.errorCode, "PROVIDER_40200");
  assert.ok(state.runs[0].rawResponse);
  assert.equal((await update(p.requestId, p.previewToken)).duplicate, true);
  assert.equal(fetched.length, 1);
});

test("a cached non-2xx response cannot be replayed as success even when its JSON resembles a valid paid result", async () => {
  await connect(); addMembership();
  const p = await preview("http-failure-valid-body"), response = providerResponse();
  respond = async () => new Response(JSON.stringify(response), { status: 503 });
  const failed = await update(p.requestId, p.previewToken);
  assert.equal(failed.status, "FAILED");
  assert.equal(failed.run.errorCode, "HTTP_503");
  assert.deepEqual(JSON.parse(state.runs[0].rawResponse), response);
  assert.equal(state.runs[0].normalized, null);
  const replayed = await mutateDataForSeo({ action: "replay", requestId: p.requestId });
  assert.equal(replayed.status, "FAILED");
  assert.equal(replayed.run.errorCode, "HTTP_503");
  assert.equal((await update(p.requestId, p.previewToken)).duplicate, true);
  assert.equal(importAttempts.length, 0);
  assert.equal(fetched.length, 1);
});

test("import planning uses existing business memberships only, preserves settings and marks absent formal terms no_data", () => {
  const formal = addMembership(), missing = addMembership("missing", "missing model api"), research = addMembership("research", "router model api", { pool: "RESEARCH" });
  addMembership("unrelated", "yes"); addMembership("inactive", "inactive api", { active: false });
  const before = clone(state.memberships);
  const snapshot = normalizeRankedKeywords(providerResponse([
    providerItem("claude api", 32), providerItem("claude api", 7, "https://flatkey.ai/blog/claude-api"),
    providerItem("router model api", 12), providerItem("unknown business model api", 8), providerItem("yes", 1),
  ]), { runId: "plan-only", collectedAt: new Date().toISOString(), limit: 1000 });
  const plan = buildDataForSeoImportPlan(snapshot, [formal, missing, research, ...state.memberships.slice(3)], "plan-only");
  const observations = plan.batches.flatMap(batch => batch.observations);
  assert.deepEqual(state.memberships, before);
  assert.equal(plan.summary.unknownCandidates, 1); assert.equal(plan.summary.unrelatedFiltered, 1); assert.equal(plan.summary.missingFormal, 1);
  assert.equal(plan.candidates[0].keyword, "unknown business model api");
  assert.ok(!observations.some(row => ["unknown business model api", "yes", "inactive api"].includes(row.keyword)));
  const ranked = observations.find(row => row.keyword === "claude api");
  assert.equal(ranked.rank, 7); assert.equal(ranked.url, "https://flatkey.ai/blog/claude-api");
  const absent = observations.find(row => row.keyword === "missing model api");
  assert.equal(absent.rankStatus, "no_data"); assert.equal(absent.rank, null);
  assert.ok(!observations.some(row => row.rankStatus === "outside_top100"));
  assert.ok(plan.batches.every(batch => !batch.allowNewKeywords && batch.inventory.length === 0 && batch.topics.length === 0));
});

test("only previously captured active research terms receive no_data when absent, without deleting candidates or changing page associations", () => {
  const formal = addMembership(), previous = addMembership("previous", "prior model api", { pool: "RESEARCH" });
  addMembership("never", "never captured model api", { pool: "RESEARCH" });
  addMembership("inactive", "inactive model api", { pool: "RESEARCH", active: false });
  addMembership("global-inactive", "inactive global model api", { pool: "RESEARCH", keyword: { text: "inactive global model api", active: false } });
  addMembership("archived", "archived model api", { pool: "ARCHIVED" });
  const before = clone(state.memberships), snapshot = normalizeRankedKeywords(providerResponse([]), { runId: "missing-research", collectedAt: new Date().toISOString() });
  const plan = buildDataForSeoImportPlan(snapshot, state.memberships, "missing-research", ["ＰＲＩＯＲ   MODEL API", "inactive model api", "inactive global model api", "archived model api"]);
  const observations = plan.batches.flatMap(batch => batch.observations);
  assert.deepEqual(observations.map(row => row.keyword).sort(), [formal.keyword.text, previous.keyword.text].sort());
  assert.ok(observations.every(row => row.rankStatus === "no_data" && row.rank === null && row.url === undefined));
  assert.equal(plan.summary.missingFormal, 1); assert.equal(plan.summary.missingResearch, 1);
  assert.equal(plan.batches.flatMap(batch => batch.pages).length, 0);
  assert.deepEqual(state.memberships, before);
});

test("cached planning compares only the latest completed snapshot and never an older or failed research capture", async () => {
  addMembership(); addMembership("previous", "prior model api", { pool: "RESEARCH" });
  addMembership("older", "older model api", { pool: "RESEARCH" });
  addMembership("failed", "failed model api", { pool: "RESEARCH" });
  addMembership("never", "never captured model api", { pool: "RESEARCH" });
  const oldDate = "2026-10-14T12:00:00.000Z", priorDate = "2026-10-15T12:00:00.000Z", failedDate = "2026-10-16T00:00:00.000Z";
  seedRun({ requestId: "older-completed", collectedAt: new Date(oldDate), normalized: normalizeRankedKeywords(providerResponse([providerItem("older model api")]), { runId: "older-completed", collectedAt: oldDate }) });
  seedRun({ requestId: "latest-completed", collectedAt: new Date(priorDate), normalized: normalizeRankedKeywords(providerResponse([providerItem("prior model api")]), { runId: "latest-completed", collectedAt: priorDate }) });
  seedRun({ requestId: "failed-later", status: "FAILED", collectedAt: new Date(failedDate), normalized: normalizeRankedKeywords(providerResponse([providerItem("failed model api")]), { runId: "failed-later", collectedAt: failedDate }) });
  const collectedAt = new Date(), raw = JSON.stringify(providerResponse([]));
  seedRun({ requestId: "next-empty-snapshot", status: "RECEIVED", collectedAt, rawResponse: raw });
  const before = clone(state.memberships), result = await mutateDataForSeo({ action: "replay", requestId: "next-empty-snapshot" });
  assert.equal(result.status, "COMPLETED");
  assert.equal(result.run.summary.missingResearch, 1);
  assert.deepEqual(importAttempts.flatMap(batch => batch.observations).map(row => row.keyword).sort(), ["claude api", "prior model api"]);
  assert.equal(fetched.length, 0);
  assert.deepEqual(state.memberships, before);
});

test("an already frozen paid import plan never gains new research placeholders on replay", async (t) => {
  addMembership(); addMembership("previous", "prior model api", { pool: "RESEARCH" });
  const collectedAt = new Date(), current = normalizeRankedKeywords(providerResponse([]), { runId: "frozen-prior-contract", collectedAt: collectedAt.toISOString() });
  const plan = buildDataForSeoImportPlan(current, state.memberships, "frozen-prior-contract");
  const priorDate = "2026-10-15T12:00:00.000Z";
  seedRun({ requestId: "prior-positive", collectedAt: new Date(priorDate), normalized: normalizeRankedKeywords(providerResponse([providerItem("prior model api")]), { runId: "prior-positive", collectedAt: priorDate }) });
  seedRun({ requestId: "frozen-prior-contract", status: "RECEIVED", collectedAt, rawResponse: JSON.stringify(providerResponse([])), normalized: current, importPayload: clone(plan.batches), summary: clone(plan.summary) });
  const memberships = t.mock.method(db.siteKeyword, "findMany");
  const frozen = clone(plan.batches), result = await mutateDataForSeo({ action: "replay", requestId: "frozen-prior-contract" });
  assert.equal(result.status, "COMPLETED");
  assert.equal(memberships.mock.calls.length, 0, "cached replay must not rebuild eligibility or the import plan");
  assert.deepEqual(state.runs.find(run => run.requestId === "frozen-prior-contract").importPayload, frozen);
  assert.deepEqual(importAttempts.flatMap(batch => batch.observations).map(row => row.keyword), ["claude api"]);
  assert.equal(fetched.length, 0);
});

test("a full next snapshot with prior research misses stays within ten bounded import batches", () => {
  for (let index = 0; index < 1512; index++) addMembership(`formal-${index}`, `formal model api ${index}`);
  const previous = [];
  for (let index = 0; index < 1000; index++) {
    previous.push(`prior model api ${index}`);
    addMembership(`prior-${index}`, previous[index], { pool: "RESEARCH" });
    addMembership(`current-${index}`, `current model api ${index}`, { pool: "RESEARCH" });
  }
  const items = Array.from({ length: 1000 }, (_, index) => providerItem(`current model api ${index}`, index % 100 + 1, `https://flatkey.ai/models/current-${index}`));
  const snapshot = normalizeRankedKeywords(providerResponse(items, 0.132), { runId: "maximum-next-snapshot", collectedAt: new Date().toISOString() });
  const plan = buildDataForSeoImportPlan(snapshot, state.memberships, "maximum-next-snapshot", previous);
  assert.equal(plan.summary.missingFormal, 1512); assert.equal(plan.summary.missingResearch, 1000);
  assert.equal(plan.summary.matchedExisting, 1000); assert.equal(plan.summary.matchedPages, 1000);
  assert.equal(plan.batches.length, 10);
  assert.equal(plan.batches.reduce((sum, batch) => sum + batch.observations.length + batch.pages.length, 0), 4512);
  assert.ok(plan.batches.every(batch => batch.observations.length + batch.pages.length <= 500));
  assert.ok(plan.batches.slice(0, -1).every(batch => !batch.capture.complete));
  assert.equal(plan.batches.at(-1).capture.complete, true);
});

test("one keyword retains both actual pages with their own source dates and ranks while its summary uses the latest dated result", () => {
  const member = addMembership(), before = clone(member);
  const older = providerItem("claude api", 3, "https://flatkey.ai/models/claude");
  older.ranked_serp_element.last_updated_time = "2026-10-12 03:00:00 +00:00";
  const newer = providerItem("claude api", 11, "https://flatkey.ai/blog/claude-api");
  newer.ranked_serp_element.last_updated_time = "2026-10-14 03:00:00 +00:00";
  const collectedAt = new Date().toISOString();
  const snapshot = normalizeRankedKeywords(providerResponse([older, newer, clone(older)]), { runId: "multi-page-evidence", collectedAt, limit: 1000 });
  const plan = buildDataForSeoImportPlan(snapshot, [member], "multi-page-evidence");
  const observations = plan.batches.flatMap(batch => batch.observations), pages = plan.batches.flatMap(batch => batch.pages);
  assert.equal(plan.summary.matchedExisting, 1);
  assert.equal(new Set(observations.map(row => row.keyword)).size, 1);
  assert.equal(observations.length, 1);
  assert.equal(observations[0].rank, 11, "an older better rank must not replace the newer provider result");
  assert.equal(observations[0].url, "https://flatkey.ai/blog/claude-api");
  assert.equal(observations[0].dataUpdatedAt, "2026-10-14T03:00:00.000Z");
  assert.equal(pages.length, 2);
  const byUrl = new Map(pages.map(row => [row.url, row]));
  assert.equal(byUrl.get("https://flatkey.ai/models/claude").rank, 3);
  assert.equal(byUrl.get("https://flatkey.ai/models/claude").dataUpdatedAt, "2026-10-12T03:00:00.000Z");
  assert.equal(byUrl.get("https://flatkey.ai/blog/claude-api").rank, 11);
  assert.equal(byUrl.get("https://flatkey.ai/blog/claude-api").dataUpdatedAt, "2026-10-14T03:00:00.000Z");
  assert.ok(pages.every(row => row.source === "dataforseo_labs" && row.collectedAt === collectedAt && !Object.hasOwn(row, "volume")));
  assert.ok(plan.batches.every(batch => batch.observations.length + batch.pages.length <= 500));
  if (plan.summary.matchedPages !== undefined) assert.equal(plan.summary.matchedPages, 2);
  assert.deepEqual(member, before);
});

test("rotating the login password reports a disconnected encryption state without exposing or fetching credentials", async () => {
  await connect();
  process.env.LOGIN_PWD = "fictional-rotated-password";
  const status = await loadDataForSeoStatus();
  assert.equal(status.connection.configured, true); assert.equal(status.connection.canDecrypt, false);
  await assert.rejects(preview("password-rotated"), error => error.status === 409);
  assert.equal(fetched.length, 0);
  assert.ok(!JSON.stringify(status).includes(fictional.apiPassword));
});

test("management endpoints require a real enabled cookie session and never accept collector or cron bearer credentials", async () => {
  for (const bearer of [undefined, "fictional-collector-key", "fictional-cron-key"]) {
    assert.equal((await POST(request({ action: "connect", ...fictional }, bearer))).status, 401);
  }
  assert.equal((await GET()).status, 401);
  sessionToken = await getAuthToken();
  const connected = await POST(request({ action: "connect", ...fictional }));
  assert.equal(connected.status, 200);
  assert.match(connected.headers.get("Cache-Control"), /private, no-store/);
  const dto = await connected.json();
  assert.ok(!JSON.stringify(dto).includes(fictional.apiPassword));
  assert.equal((await GET()).status, 200);
  assert.equal((await POST(request({ action: "preview", requestId: "route-preview" }))).status, 200);
  assert.equal((await POST(request({ action: "update", requestId: "retired-labs-paid", previewToken: "obsolete-preview" }))).status, 410);
  assert.equal(fetched.length, 0);
  delete process.env.LOGIN_PWD;
  assert.equal((await GET()).status, 401);
  assert.equal((await POST(request({ action: "disconnect" }))).status, 401);
});

test("mutation schemas forbid arbitrary endpoints, schedules, limits and credential reads", () => {
  for (const value of [
    { action: "connect", ...fictional, scheduleEnabled: true }, { action: "preview", requestId: "safe", limit: 10000 },
    { action: "update", requestId: "safe", previewToken: "token", endpoint: "https://other.example" },
    { action: "credentials" }, { action: "preview", requestId: "../unsafe" }, { action: "connect", apiLogin: "user:password", apiPassword: "fictional" },
  ]) assert.equal(dataForSeoMutationSchema.safeParse(value).success, false);
});

test("cached ranking exports require the management cookie and exclude raw responses and credentials", async () => {
  await connect();
  const run = seedRun({ requestId: "export-cached-run", normalized: { rows: [{ keyword: "claude api", url: "https://flatkey.ai/models/claude", rank_group: 9 }] },
    candidates: [{ keyword: "new model api" }], rawResponse: "raw-private-test-value" });
  const url = `https://flatkey.test/api/dataforseo?requestId=${run.requestId}`;
  assert.equal((await GET(new Request(url))).status, 401);
  sessionToken = await getAuthToken();
  const response = await GET(new Request(url));
  assert.equal(response.status, 200);
  assert.match(response.headers.get("Cache-Control"), /private, no-store/);
  assert.match(response.headers.get("Content-Disposition"), /attachment/);
  const value = await response.json();
  assert.deepEqual(value.snapshot, run.normalized);
  assert.deepEqual(value.candidates, run.candidates);
  for (const privateValue of ["raw-private-test-value", fictional.apiPassword, state.connection.encryptedCredentials, "requestJson", "connectionVersion"])
    assert.ok(!JSON.stringify(value).includes(privateValue));
  assert.equal((await GET(new Request("https://flatkey.test/api/dataforseo?requestId=../unsafe"))).status, 400);
  seedRun({ requestId: "other-site-export", siteDomain: "other.example" });
  assert.equal((await GET(new Request("https://flatkey.test/api/dataforseo?requestId=other-site-export"))).status, 404);
  assert.equal(fetched.length, 0);
  assert.equal(importAttempts.length, 0);
});
