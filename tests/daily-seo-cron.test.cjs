const assert = require("node:assert/strict");
const { test } = require("node:test");
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
function mockFile(relative, exports) { const filename = path.join(root, relative); require.cache[filename] = { id: filename, filename, loaded: true, exports }; }
let checks = 0, ledgerReads = [], schedulerReceipts = [];
// A paid pause still inspects the scheduled ledger to drain previously paid
// known IDs. This fixture has no open ledger; credentials and all other DB
// operations remain forbidden rather than accidentally reaching a real DB.
mockFile("src/lib/prisma.ts", { prisma: new Proxy({
  schedulerCheck: {
    create: async ({ data }) => { schedulerReceipts.push({ ...data, status: "RUNNING" }); return data; },
    update: async ({ where, data }) => { Object.assign(schedulerReceipts.find(row => row.id === where.id), data); return data; },
  },
  serpMonitorConfig: { findUnique: async input => { ledgerReads.push(["config", input]); return { paidEnabled: false }; } },
  serpMonitorRun: { findFirst: async input => { ledgerReads.push(["run", input]); return null; } },
}, { get(target, key) {
  if (Object.hasOwn(target, key)) return target[key];
  throw new Error(`paused empty ledger must not access ${String(key)}`);
} }) });
mockFile("src/lib/services/source-sync-health.ts", { loadSourceSyncHealth: async () => { checks++; return { dailyCheck: { confirmed: false, lastCompletedAt: null }, sources: [{ sourceId: "api_main" }, { sourceId: "cloud_main" }, { sourceId: "optimization" }] }; } });
const { POST: legacy, GET: legacyGet } = require("../src/app/api/sync/run/route.ts");
const { GET, POST } = require("../src/app/api/cron/daily-rankings/route.ts");
const request = token => new Request("https://flatkey.test/api/cron/daily-rankings", { headers: token ? { Authorization: `Bearer ${token}` } : {} });

test("legacy SerpApi endpoint remains retired even with legacy enable flags and provider credentials", async t => {
  const saved = { ...process.env }; t.after(() => { process.env = saved; });
  process.env.SERP_MONITORING_ENABLED = "true"; process.env.SERPAPI_API_KEY = "fictional-legacy-key";
  t.mock.method(globalThis, "fetch", async () => { throw new Error("no provider call allowed"); });
  assert.equal((await legacy()).status, 410); assert.equal((await legacyGet()).status, 410);
  assert.equal(globalThis.fetch.mock.callCount(), 0);
});
test("the single daily coordinator requires CRON_SECRET in all environments and paused execution makes zero provider requests", async t => {
  const saved = { ...process.env }; t.after(() => { process.env = saved; });
  delete process.env.DATAFORSEO_SERP_PAID_ENABLED; delete process.env.DISABLE_EXTERNAL_FETCH; delete process.env.CRON_SECRET; checks = 0; ledgerReads = []; schedulerReceipts = [];
  t.mock.method(globalThis, "fetch", async () => { throw new Error("no provider call allowed"); });
  assert.equal((await GET(request())).status, 401); assert.equal(checks, 0); assert.equal(ledgerReads.length, 0);
  assert.equal(schedulerReceipts.length, 0);
  process.env.CRON_SECRET = "fictional-daily-secret";
  assert.equal((await POST(request("wrong"))).status, 401); assert.equal(checks, 0); assert.equal(ledgerReads.length, 0);
  const response = await GET(request("fictional-daily-secret")), body = await response.json();
  assert.equal(response.status, 200); assert.equal(body.status, "DISABLED"); assert.equal(body.serp.paidRequests, 0);
  assert.equal(body.sourceSync.executed, false); assert.equal(body.sourceSync.dailyCheck.confirmed, false);
  assert.equal(body.sourceSync.sources.length, 3); assert.equal(checks, 1); assert.equal(globalThis.fetch.mock.callCount(), 0);
  assert.equal(schedulerReceipts.length, 1); assert.equal(schedulerReceipts[0].status, "COMPLETED");
  assert.equal(schedulerReceipts[0].paidRequests, 0); assert.equal(schedulerReceipts[0].serpStatus, "DISABLED");
  assert.deepEqual(ledgerReads.map(([kind]) => kind), ["config", "config", "run"]);
  assert.equal(ledgerReads[2][1].where.scope, "SCHEDULED", "the coordinator must not continue the separately authorized sample");
});
test("Vercel has one resumable coordinator; paid starts are gated by the biweekly cycle", () => {
  const config = JSON.parse(fs.readFileSync(path.join(root, "vercel.json"), "utf8"));
  assert.deepEqual(config.crons, [{ path: "/api/cron/daily-rankings", schedule: "*/5 * * * *" }]);
});
