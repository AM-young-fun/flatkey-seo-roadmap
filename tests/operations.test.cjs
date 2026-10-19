const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");
const root = path.resolve(__dirname, "..");
const resolve = Module._resolveFilename;
Module._resolveFilename = function(name, parent, ...rest) { return resolve.call(this, name.startsWith("@/") ? path.join(root, "src", name.slice(2)) : name, parent, ...rest); };
require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, filename);
const mock = (relative, exports) => { const filename = path.join(root, relative); require.cache[filename] = { id: filename, filename, loaded: true, exports }; };
let calls = 0, session = false;
mock("src/lib/auth.ts", { AUTH_COOKIE_NAME: "seo_rank_auth", isAuthEnabled: () => true, isValidAuthToken: async value => value === "valid-session" });
const headersPath = require.resolve("next/headers");
require.cache[headersPath] = { id: headersPath, filename: headersPath, loaded: true, exports: { cookies: async () => ({ get: () => session ? { value: "valid-session" } : undefined }) } };
mock("src/lib/prisma.ts", { prisma: {
  serpMonitorConfig: { findUnique: async () => { calls++; return { paidEnabled: false, nextDueAt: null }; } },
  dataForSeoConnection: { findUnique: async input => { assert.deepEqual(input.select, { scheduleEnabled: true }); return { scheduleEnabled: false }; } },
  schedulerCheck: { findMany: async () => [] },
  serpMonitorRun: { findMany: async () => [{ id: "existing", scope: "SAMPLE", periodKey: "2026-10-2", periodLabel: "2026年10月第2期", status: "COMPLETED", queryCount: 152, startedAt: new Date("2026-10-16T01:00Z"), completedAt: new Date("2026-10-16T02:00Z") }] },
  dataForSeoRun: { findMany: async () => [] }, weeklyTraffic: { findMany: async () => [] },
} });
const { schedulerState, plannedRankingTime } = require("../src/lib/operations.ts");
const { loadOperationsStatus } = require("../src/lib/services/operations.ts");
const { GET } = require("../src/app/api/operations/route.ts");
test("configured schedule and unfinished heartbeat cannot masquerade as successful execution", () => {
  const now = new Date("2026-10-19T08:00:00Z");
  assert.equal(schedulerState(null, now), "UNCONFIRMED");
  const last = { startedAt: new Date("2026-10-19T07:45:00Z"), completedAt: null, status: "RUNNING" };
  assert.equal(schedulerState(last, now), "UNCONFIRMED");
  assert.equal(schedulerState({ ...last, completedAt: now, status: "COMPLETED" }, now), "HEALTHY");
  assert.equal(schedulerState({ ...last, startedAt: new Date("2026-10-19T06:00:00Z"), completedAt: now, status: "COMPLETED" }, now), "OVERDUE");
  assert.equal(schedulerState({ ...last, status: "NEEDS_REVIEW" }, now), "ERROR");
  assert.equal(plannedRankingTime(now, null), "2026-10-20T02:30:00.000Z");
  assert.equal(plannedRankingTime(now, new Date("2026-11-03T02:30:00Z")), "2026-11-03T02:30:00.000Z");
});
test("operational view reads metadata only and distinguishes online ranking from external collectors", async t => {
  process.env.DATABASE_URL = "postgresql://unused.invalid/operations";
  delete process.env.DATAFORSEO_SERP_PAID_ENABLED; delete process.env.DATAFORSEO_DISCOVERY_PAID_ENABLED;
  t.mock.method(globalThis, "fetch", async () => { throw new Error("opening plans must never call a provider"); });
  const status = await loadOperationsStatus(new Date("2026-10-19T08:00:00Z"));
  assert.equal(status.scheduler.state, "UNCONFIRMED");
  assert.equal(status.plans[0].state, "自动付费未启用");
  assert.equal(status.plans[0].nextAt, "2026-10-20T02:30:00.000Z");
  assert.equal(status.plans[1].state, "未接入线上自动读取");
  assert.equal(status.plans[2].state, "长期自动采集未启用");
  assert.match(status.records[0].name, /第1期/);
  assert.equal(globalThis.fetch.mock.callCount(), 0);
  for (const secret of ["encryptedCredentials", "LOGIN_PWD", "CRON_SECRET", "rawResponse", "configJson"]) assert.ok(!JSON.stringify(status).includes(secret));
});
test("operations API needs a real session; denied reads never touch the database", async () => {
  calls = 0; session = false;
  assert.equal((await GET()).status, 401); assert.equal(calls, 0);
  session = true;
  const response = await GET();
  assert.equal(response.status, 200); assert.match(response.headers.get("cache-control"), /private, no-store/);
});
