const assert = require("node:assert/strict");
const { test } = require("node:test");
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

// Fail on any database access: the disabled path must stop before creating or
// resuming a run, even when an existing deployment has provider credentials.
const forbiddenDatabase = new Proxy({}, { get() { throw new Error("database must not be touched"); } });
const prismaPath = require.resolve("../src/lib/prisma.ts");
require.cache[prismaPath] = { id: prismaPath, filename: prismaPath, loaded: true, exports: { prisma: forbiddenDatabase } };
const { isSerpMonitoringEnabled } = require("../src/lib/env.ts");
const { runDailyRankingSync } = require("../src/lib/services/sync-rankings.ts");
const { fetchGoogleRanking } = require("../src/lib/providers/google.ts");

test("SERP remains disabled with credentials and cannot create a run or make a provider request", async (t) => {
  const saved = { ...process.env };
  t.after(() => { process.env = saved; });
  delete process.env.SERP_MONITORING_ENABLED;
  process.env.DATABASE_URL = "postgresql://unused.invalid/db";
  process.env.SERPAPI_API_KEY = "test-only-placeholder";
  t.mock.method(globalThis, "fetch", async () => { throw new Error("provider must not be contacted"); });
  assert.equal(isSerpMonitoringEnabled(), false);
  const result = await runDailyRankingSync();
  assert.equal(result.status, "DISABLED");
  assert.equal(result.runId, null);
  await assert.rejects(fetchGoogleRanking("new model api", "US", "flatkey.ai"), /尚未启用/);
  assert.equal(globalThis.fetch.mock.callCount(), 0);
});

test("enabling requires the explicit flag and respects the external-fetch stop switch", (t) => {
  const saved = { ...process.env };
  t.after(() => { process.env = saved; });
  delete process.env.DISABLE_EXTERNAL_FETCH;
  process.env.SERP_MONITORING_ENABLED = "1";
  assert.equal(isSerpMonitoringEnabled(), false);
  process.env.SERP_MONITORING_ENABLED = "true";
  assert.equal(isSerpMonitoringEnabled(), true);
  process.env.DISABLE_EXTERNAL_FETCH = "true";
  assert.equal(isSerpMonitoringEnabled(), false);
});
