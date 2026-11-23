const assert = require("node:assert/strict"), { test, beforeEach, afterEach } = require("node:test");
const fs = require("node:fs"), path = require("node:path"), Module = require("node:module"), ts = require("typescript");
const root = path.resolve(__dirname, ".."), originalLoad = Module._load;
let rows, calls, databaseFailure, beforeRead, session, cookieReads, forbiddenWrites;
const table = {
  async findFirst(args) {
    calls.push({ method: "findFirst", args });
    if (databaseFailure) throw Error("mock database unavailable");
    if (beforeRead) { const hook = beforeRead; beforeRead = null; hook(args); }
    const row = rows.find(row => row.tokenHash === args.where.tokenHash && row.revokedAt === null
      && (row.expiresAt === null || row.expiresAt > args.where.OR[1].expiresAt.gt));
    return row ? { id: row.id } : null;
  },
};
for (const method of ["create", "createMany", "update", "updateMany", "upsert", "delete", "deleteMany"]) {
  table[method] = () => { forbiddenWrites++; throw Error("authentication must never write"); };
}
Module._load = function (name, ...args) {
  if (name === "server-only") return {};
  if (name === "next/headers") return { cookies: async () => {
    cookieReads++;
    return { get: name => name === "seo_rank_auth" && session ? { value: session } : undefined };
  } };
  if (name === "@/lib/prisma") return { prisma: { seoImportToken: table } };
  if (name.startsWith("@/")) return originalLoad.call(this, path.join(root, "src", name.slice(2)) + ".ts", ...args);
  return originalLoad.call(this, name, ...args);
};
require.extensions[".ts"] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText, file);
const { authorizeSavedRankingCoverage } = require("../src/lib/services/ranking-coverage-access.ts");
const { createImportTokenSecret, hashImportToken } = require("../src/lib/import-token.ts");
const { getRankingImportSecret } = require("../src/lib/import-credential.ts");
const { getAuthToken } = require("../src/lib/auth.ts");
Module._load = originalLoad;
const envKeys = ["DATABASE_URL", "LOGIN_PWD", "CRON_SECRET", "RANKING_IMPORT_SECRET", "SEO_PREVIEW_UPSTREAM_TOKEN", "NODE_ENV"];
const saved = Object.fromEntries(envKeys.map(key => [key, process.env[key]]));
beforeEach(() => {
  rows = []; calls = []; databaseFailure = false; beforeRead = null; session = null; cookieReads = 0; forbiddenWrites = 0;
  process.env.DATABASE_URL = "postgresql://unused.invalid/test";
  process.env.LOGIN_PWD = "test-password-only";
  process.env.RANKING_IMPORT_SECRET = "test-legacy-only";
  delete process.env.CRON_SECRET; delete process.env.SEO_PREVIEW_UPSTREAM_TOKEN;
});
afterEach(() => {
  assert.equal(forbiddenWrites, 0, "read authentication must not call updateMany or any write method");
  for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
});
const request = headers => new Request("https://platform.test/api/seo/ranked-keyword-coverage", { headers });
const bearer = (secret, headers = {}) => request({ authorization: "Bearer " + secret, ...headers });
function managed(patch = {}) {
  const generated = createImportTokenSecret();
  const row = { id: "managed-test", tokenHash: generated.tokenHash, revokedAt: null, expiresAt: null, lastUsedAt: null, ...patch };
  rows.push(row);
  return { secret: generated.secret, row };
}

test("enabled login and a valid cookie authorize before bearer lookup without database writes", async () => {
  session = await getAuthToken(); databaseFailure = true;
  assert.equal(await authorizeSavedRankingCoverage(bearer(managed().secret, { origin: "https://platform.test" })), true);
  assert.equal(cookieReads, 1); assert.equal(calls.length, 0);
});

test("missing or invalid cookies and disabled login never grant access through preview settings", async () => {
  assert.equal(await authorizeSavedRankingCoverage(request()), false);
  session = "invalid-cookie";
  assert.equal(await authorizeSavedRankingCoverage(request()), false);
  session = await getAuthToken(); delete process.env.LOGIN_PWD;
  process.env.NODE_ENV = "development"; process.env.SEO_PREVIEW_UPSTREAM_TOKEN = "test-preview-only";
  assert.equal(await authorizeSavedRankingCoverage(new Request("http://localhost:3000/api/seo/ranked-keyword-coverage")), false);
  assert.equal(calls.length, 0);
});

test("legacy bearer keeps existing override and derived-secret semantics without a database", async () => {
  delete process.env.DATABASE_URL; databaseFailure = true;
  assert.equal(await authorizeSavedRankingCoverage(bearer("test-legacy-only")), true);
  assert.equal(await authorizeSavedRankingCoverage(bearer("test-legacy-only-wrong")), false);
  delete process.env.RANKING_IMPORT_SECRET; process.env.CRON_SECRET = "test-cron-only";
  assert.equal(await authorizeSavedRankingCoverage(bearer(getRankingImportSecret())), true);
  assert.equal(calls.length, 0);
});

test("managed bearer reads only a hash-bound unrevoked unexpired identity and leaves lastUsedAt unchanged", async () => {
  const { secret, row } = managed({ expiresAt: new Date(Date.now() + 60_000) });
  assert.equal(await authorizeSavedRankingCoverage(bearer(secret)), true);
  assert.deepEqual(calls.map(call => call.method), ["findFirst"]);
  assert.deepEqual(calls[0].args.select, { id: true });
  assert.equal(calls[0].args.where.tokenHash, hashImportToken(secret));
  assert.equal(calls[0].args.where.revokedAt, null); assert.equal(calls[0].args.where.OR[0].expiresAt, null);
  assert.ok(calls[0].args.where.OR[1].expiresAt.gt instanceof Date);
  assert.equal(row.lastUsedAt, null);
  assert.equal(JSON.stringify(calls).includes(secret), false);
});

test("revocation is checked on every read and permanent tokens remain valid until revoked", async () => {
  const { secret, row } = managed();
  assert.equal(await authorizeSavedRankingCoverage(bearer(secret)), true);
  row.revokedAt = new Date();
  assert.equal(await authorizeSavedRankingCoverage(bearer(secret)), false);
  assert.equal(calls.length, 2); assert.equal(row.lastUsedAt, null);
});

test("expired, exactly-expiring, unknown and malformed managed bearer credentials fail closed", async () => {
  const { secret, row } = managed({ expiresAt: new Date(0) });
  assert.equal(await authorizeSavedRankingCoverage(bearer(secret)), false);
  beforeRead = args => { row.expiresAt = args.where.OR[1].expiresAt.gt; };
  assert.equal(await authorizeSavedRankingCoverage(bearer(secret)), false);
  assert.equal(await authorizeSavedRankingCoverage(bearer(createImportTokenSecret().secret)), false);
  calls.length = 0;
  for (const authorization of ["Bearer malformed", "bearer " + secret, "Basic " + secret, "Bearer seo_import_" + "A".repeat(42) + "B"]) {
    assert.equal(await authorizeSavedRankingCoverage(request({ authorization })), false);
  }
  assert.equal(calls.length, 0); assert.equal(row.lastUsedAt, null);
});

test("all Origin headers including an empty value reject bearer before any database lookup", async () => {
  const { secret } = managed();
  for (const origin of ["https://platform.test", "https://other.test", "null", ""]) {
    assert.equal(await authorizeSavedRankingCoverage(bearer(secret, { origin })), false);
    assert.equal(await authorizeSavedRankingCoverage(bearer("test-legacy-only", { origin })), false);
  }
  assert.equal(calls.length, 0);
});

test("database failure or missing configuration denies managed access without changing authentication state", async () => {
  const { secret, row } = managed(); databaseFailure = true;
  assert.equal(await authorizeSavedRankingCoverage(bearer(secret)), false);
  assert.equal(calls.length, 1); assert.equal(row.lastUsedAt, null);
  delete process.env.DATABASE_URL; calls.length = 0;
  assert.equal(await authorizeSavedRankingCoverage(bearer(secret)), false);
  assert.equal(calls.length, 0);
});
