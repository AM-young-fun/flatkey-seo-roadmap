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

let sessionToken, groups, reads, failure;
const db = { keywordSourceRow: { groupBy: async query => {
  reads++;
  assert.deepEqual(query, {
    by: ["sourceId"], where: { siteDomain: "flatkey.ai", sourceId: { in: ["api_main", "cloud_main", "optimization"] } },
    _count: { _all: true }, _max: { observedAt: true, updatedAt: true },
  }, "status must read only aggregate metadata for the three known sources");
  if (failure) throw failure;
  return structuredClone(groups);
} } };
const prismaPath = path.join(root, "src/lib/prisma.ts");
require.cache[prismaPath] = { id: prismaPath, filename: prismaPath, loaded: true, exports: { prisma: db } };
const headersPath = require.resolve("next/headers");
require.cache[headersPath] = { id: headersPath, filename: headersPath, loaded: true, exports: {
  cookies: async () => ({ get: name => name === "seo_rank_auth" && sessionToken ? { value: sessionToken } : undefined }),
} };
const { buildSourceSyncHealth } = require("../src/lib/source-sync-health.ts");
const { loadSourceSyncHealth } = require("../src/lib/services/source-sync-health.ts");
const { GET } = require("../src/app/api/keywords/source-sync/route.ts");
const { getAuthToken } = require("../src/lib/auth.ts");
beforeEach(t => {
  process.env.LOGIN_PWD = "fictional-source-health-session";
  process.env.DATABASE_URL = "postgresql://unused.invalid/source-health";
  process.env.RANKING_IMPORT_SECRET = "fictional-source-health-collector";
  sessionToken = null; groups = []; reads = 0; failure = null;
  t.mock.method(globalThis, "fetch", async () => assert.fail("source health cannot read DingTalk or a paid provider"));
});

test("source health always distinguishes missing baselines from stored rows without claiming a completed daily check", () => {
  const metadata = [{ sourceId: "api_main", rowCount: 17, lastChangedAt: new Date("2026-10-16T03:00:00Z"), lastChangedSourceReadAt: "2026-10-15T02:30:00Z" },
    { sourceId: "page_audit", rowCount: 900, lastChangedAt: new Date(), lastChangedSourceReadAt: new Date() }];
  const before = structuredClone(metadata), result = buildSourceSyncHealth(metadata);
  assert.deepEqual(result.connection, { mode: "EXTERNAL_COLLECTOR", serverPullConfigured: false, needsDingTalkAuthorization: false });
  assert.deepEqual(result.dailyCheck, { timezone: "Asia/Shanghai", expectedLocalTime: "10:30", confirmed: false, lastCompletedAt: null });
  assert.equal(result.sources.length, 3);
  assert.equal(result.sources[0].storedRows, 17);
  assert.equal(result.sources[0].status, "BASELINE_AVAILABLE");
  assert.equal(result.sources[0].lastChangedAt, "2026-10-16T03:00:00.000Z");
  assert.equal(result.sources[0].lastChangedSourceReadAt, "2026-10-15T02:30:00.000Z", "source read dates must not be replaced by import time");
  for (const source of result.sources.slice(1)) {
    assert.equal(source.status, "NO_BASELINE"); assert.equal(source.storedRows, 0);
    assert.equal(source.lastChangedAt, null); assert.equal(source.lastChangedSourceReadAt, null);
  }
  assert.deepEqual(metadata, before);
});

test("undated or invalid source metadata cannot manufacture a recent check or successful connection", () => {
  const result = buildSourceSyncHealth([
    { sourceId: "cloud_main", rowCount: 3, lastChangedAt: "invalid", lastChangedSourceReadAt: null },
    { sourceId: "optimization", rowCount: 0, lastChangedAt: "2026-10-16T03:00:00Z", lastChangedSourceReadAt: "2026-10-16T02:30:00Z" },
  ]);
  assert.equal(result.sources[1].status, "BASELINE_AVAILABLE");
  assert.equal(result.sources[1].lastChangedAt, null);
  assert.equal(result.sources[1].lastChangedSourceReadAt, null);
  assert.equal(result.sources[2].lastChangedAt, null);
  assert.equal(result.dailyCheck.confirmed, false);
});

test("the service performs one metadata read, never pulls documents, and exposes no snapshots or credentials", async () => {
  groups = [{ sourceId: "api_main", _count: { _all: 12 }, _max: { updatedAt: new Date("2026-10-16T03:00:00Z"), observedAt: new Date("2026-10-15T02:30:00Z") } }];
  const before = structuredClone(groups), result = await loadSourceSyncHealth();
  assert.equal(reads, 1); assert.equal(result.sources[0].storedRows, 12); assert.deepEqual(groups, before);
  for (const forbidden of ["snapshot", "encryptedCredentials", "apiPassword", "rowKey"]) assert.ok(!JSON.stringify(result).includes(forbidden));
});

test("GET requires an enabled administrator cookie session and private cache; an import bearer is insufficient", async () => {
  assert.equal((await GET(new Request("https://flatkey.test/api/keywords/source-sync", { headers: { Authorization: "Bearer fictional-source-health-collector" } }))).status, 401);
  assert.equal(reads, 0);
  sessionToken = "incorrect";
  assert.equal((await GET()).status, 401); assert.equal(reads, 0);
  sessionToken = await getAuthToken();
  const response = await GET();
  assert.equal(response.status, 200); assert.match(response.headers.get("Cache-Control"), /private, no-store/);
  assert.equal((await response.json()).dailyCheck.confirmed, false);
  delete process.env.LOGIN_PWD;
  assert.equal((await GET()).status, 401);
});

test("database errors remain unavailable and never produce an all-clear daily sync status", async t => {
  sessionToken = await getAuthToken();
  delete process.env.DATABASE_URL;
  assert.equal((await GET()).status, 503); assert.equal(reads, 0);
  process.env.DATABASE_URL = "postgresql://unused.invalid/source-health";
  failure = Object.assign(new Error("postgresql://secret:credential@internal.invalid sensitive query"), { code: "P1001" });
  t.mock.method(console, "error", () => {});
  const response = await GET(), value = await response.json();
  assert.equal(response.status, 503); assert.equal(value.code, "P1001");
  assert.ok(!JSON.stringify(value).includes("credential"));
  assert.equal(value.dailyCheck, undefined);
});
