const assert = require("node:assert/strict");
const { test, beforeEach } = require("node:test");
const fs = require("node:fs"), path = require("node:path"), Module = require("node:module"), ts = require("typescript");
const root = path.resolve(__dirname, ".."), resolve = Module._resolveFilename;
Module._resolveFilename = function(name, parent, ...rest) { return resolve.call(this, name.startsWith("@/") ? path.join(root, "src", name.slice(2)) : name, parent, ...rest); };
require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, filename);
const mock = (relative, exports) => { const filename = path.join(root, relative); require.cache[filename] = { id: filename, filename, loaded: true, exports }; };
let config, connection, cohort, paidCalls, discoveries, run, liveBalance;
const db = {
  $transaction: async fn => fn(db), $executeRaw: async () => 0,
  serpMonitorConfig: {
    findUnique: async () => structuredClone(config),
    upsert: async ({ create, update }) => { config = config ? { ...config, ...update, revision: config.revision + update.revision.increment } : create; return config; },
    updateMany: async ({ data }) => { if (config) config = { ...config, ...data, revision: config.revision + (data.revision?.increment ?? 0) }; return { count: Number(Boolean(config)) }; },
  },
  dataForSeoConnection: { findUnique: async () => structuredClone(connection), update: async ({ data }) => { Object.assign(connection, data); return connection; }, updateMany: async ({ data }) => { Object.assign(connection, data); return { count: 1 }; } },
  serpMonitorRun: { aggregate: async () => ({ _sum: { reservedCostMicros: 912000 } }), findUnique: async () => run, findUniqueOrThrow: async () => run },
};
mock("src/lib/prisma.ts", { prisma: db });
mock("src/lib/services/serp-targets.ts", { loadScheduledSerpMonitoringCohort: async () => structuredClone(cohort) });
mock("src/lib/services/keyword-cycle.ts", { runKeywordDiscoveryCycle: async () => { discoveries++; paidCalls++; return { status: "COMPLETE", ready: true, paidRequests: 1 }; } });
mock("src/lib/services/serp-monitor.ts", {
  startSerpScheduledPeriod: async (periodKey, hash) => { paidCalls++; run = { id: "stable-period-run", periodKey, cohortHash: hash, status: "RUNNING" }; return run; },
  runSerpMonitorCron: async () => ({ status: "ACTIVE", remainingQueries: 4, paidRequests: 0 }),
});
const { encryptDataForSeoCredentials, verifyDataForSeoPreview, signDataForSeoPreview } = require("../src/lib/dataforseo-credentials.ts");
const { collectionControlSchema } = require("../src/lib/collection-control.ts");
const { previewCollectionSchedule, mutateCollectionControl } = require("../src/lib/services/collection-control.ts");
beforeEach(t => {
  process.env.LOGIN_PWD = "fictional-collection-login"; delete process.env.DISABLE_EXTERNAL_FETCH;
  // No Vercel paid flags: an authenticated, persisted activation is sufficient.
  delete process.env.DATAFORSEO_SERP_PAID_ENABLED; delete process.env.DATAFORSEO_DISCOVERY_PAID_ENABLED;
  config = { id: "default", revision: 1, authorizationVersion: 0, paidEnabled: false, maxRunCostMicros: 12000000, maxMonthCostMicros: 30000000, nextDueAt: new Date("2026-10-20T02:30:00Z") };
  connection = { siteDomain: "flatkey.ai", connectionVersion: 1, encryptedCredentials: encryptDataForSeoCredentials("fictional-user", "fictional-password"), scheduleEnabled: false };
  cohort = { hash: "a".repeat(64), targets: [{ keyword: "flatkey", keywordId: "id-brand", siteDomain: "flatkey.ai", targetUrls: ["https://flatkey.ai/"] }] };
  run = null; paidCalls = 0; discoveries = 0; liveBalance = 200;
  t.mock.method(globalThis, "fetch", async (url, options) => {
    assert.equal(url, "https://api.dataforseo.com/v3/appendix/user_data"); assert.equal(options.method, "GET");
    return new Response(JSON.stringify({ status_code: 20000, cost: 0, tasks: [{ status_code: 20000, cost: 0, result: [{ money: { balance: liveBalance } }] }] }));
  });
});
test("preview is free; explicit activation changes both switches, not provider state", async () => {
  const preview = await previewCollectionSchedule();
  assert.equal(preview.serpMaxCostMicros, 24000); assert.equal(preview.discoveryMaxCostMicros, 528000); assert.equal(preview.queryCount, 4);
  assert.equal(preview.periodKey, "2026-10-20"); assert.equal(paidCalls, 0); assert.equal(config.paidEnabled, false);
  await mutateCollectionControl({ action: "enableSchedule", previewToken: preview.previewToken });
  assert.equal(config.paidEnabled, true); assert.equal(config.authorizationVersion, 1); assert.equal(connection.scheduleEnabled, true); assert.equal(paidCalls, 0);
  const version = config.revision;
  await mutateCollectionControl({ action: "enableSchedule", previewToken: preview.previewToken });
  assert.equal(config.revision, version, "repeated activation is idempotent");
  await mutateCollectionControl({ action: "pauseSchedule" });
  assert.equal(config.paidEnabled, false); assert.equal(connection.scheduleEnabled, false); assert.equal(paidCalls, 0);
});
test("forged, expired, changed connection and changed cohort cannot activate or pay", async () => {
  const preview = await previewCollectionSchedule(), approved = verifyDataForSeoPreview(preview.previewToken);
  for (const token of ["invalid-preview-token", signDataForSeoPreview({ ...approved, expiresAt: Date.now() - 1 })]) await assert.rejects(mutateCollectionControl({ action: "enableSchedule", previewToken: token }));
  connection.connectionVersion++;
  await assert.rejects(mutateCollectionControl({ action: "enableSchedule", previewToken: preview.previewToken }), /API连接/);
  connection.connectionVersion--; cohort.hash = "b".repeat(64);
  await assert.rejects(mutateCollectionControl({ action: "enableSchedule", previewToken: preview.previewToken }), /关键词范围/);
  assert.equal(paidCalls, 0); assert.equal(config.paidEnabled, false);
});
test("insufficient balance, emergency stop, and paused schedule all block collection", async () => {
  liveBalance = 0;
  await assert.rejects(previewCollectionSchedule(), /余额不足/);
  liveBalance = 200; const preview = await previewCollectionSchedule();
  await assert.rejects(mutateCollectionControl({ action: "runCycle", previewToken: preview.previewToken }), /关闭/);
  process.env.DISABLE_EXTERNAL_FETCH = "true";
  await assert.rejects(mutateCollectionControl({ action: "enableSchedule", previewToken: preview.previewToken }), /紧急暂停/);
  assert.equal(paidCalls, 0);
});
test("new discoveries exceeding approved cap pause SERP instead of silently raising it", async () => {
  const preview = await previewCollectionSchedule();
  await mutateCollectionControl({ action: "enableSchedule", previewToken: preview.previewToken });
  cohort.targets.push({ keyword: "new model pricing", keywordId: "id-new", siteDomain: "flatkey.ai", targetUrls: ["https://flatkey.ai/models/new"] });
  await assert.rejects(mutateCollectionControl({ action: "runCycle", previewToken: preview.previewToken }), /超过已确认上限/);
  assert.equal(discoveries, 1); assert.equal(paidCalls, 1, "only discovery, never SERP after price increases"); assert.equal(config.paidEnabled, false);
});
test("existing completed period cannot be recollected and callers cannot pick arbitrary budgets or dates", async () => {
  const preview = await previewCollectionSchedule(); await mutateCollectionControl({ action: "enableSchedule", previewToken: preview.previewToken });
  run = { id: "prior", status: "COMPLETED" };
  assert.equal((await mutateCollectionControl({ action: "runCycle", previewToken: preview.previewToken })).finished, true);
  assert.equal(paidCalls, 0);
  for (const input of [{ action: "runCycle", previewToken: preview.previewToken, periodKey: "2026-11-03" }, { action: "enableSchedule", previewToken: preview.previewToken, maxBudget: 900 }, { action: "configure", paidEnabled: true }]) assert.equal(collectionControlSchema.safeParse(input).success, false);
});
