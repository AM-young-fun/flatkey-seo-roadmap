const assert = require("node:assert/strict"), { test, beforeEach, afterEach } = require("node:test");
const fs = require("node:fs"), path = require("node:path"), Module = require("node:module"), ts = require("typescript");
const root = path.resolve(__dirname, ".."), originalLoad = Module._load;
let rows, calls, databaseFailure, beforeUpdate, cookie;
const projected = (row, select) => Object.fromEntries(Object.keys(select).filter(key => select[key]).map(key => [key, row[key]]));
function databaseCall(method, args) {
  calls.push({ method, args });
  if (databaseFailure) throw Error("private-database-error-and-secret-must-not-leak");
}
const table = {
  async findMany(args) { databaseCall("findMany", args); return [...rows.values()].sort((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id)).map(row => projected(row, args.select)); },
  async create(args) {
    databaseCall("create", args);
    assert.equal([...rows.values()].some(row => row.tokenHash === args.data.tokenHash), false);
    const row = { expiresAt: null, lastUsedAt: null, revokedAt: null, ...args.data };
    rows.set(row.id, row); return projected(row, args.select);
  },
  async findUnique(args) { databaseCall("findUnique", args); const row = rows.get(args.where.id); return row ? projected(row, args.select) : null; },
  async updateMany(args) {
    databaseCall("updateMany", args);
    if (beforeUpdate) { const hook = beforeUpdate; beforeUpdate = null; hook(); }
    let count = 0;
    for (const row of rows.values()) {
      const where = args.where;
      if (where.id && row.id !== where.id || where.tokenHash && row.tokenHash !== where.tokenHash || row.revokedAt !== null) continue;
      if (where.OR && !(row.expiresAt === null || row.expiresAt > where.OR[1].expiresAt.gt)) continue;
      Object.assign(row, args.data); count++;
    }
    return { count };
  },
};
Module._load = function (name, ...args) {
  if (name === "server-only") return {};
  if (name === "@/lib/prisma") return { prisma: { seoImportToken: table } };
  if (name.startsWith("@/")) return originalLoad.call(this, path.join(root, "src", name.slice(2)) + ".ts", ...args);
  return originalLoad.call(this, name, ...args);
};
require.extensions[".ts"] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, file);
const token = require("../src/lib/import-token.ts"), service = require("../src/lib/services/import-tokens.ts");
const route = require("../src/app/api/import-tokens/route.ts"), auth = require("../src/lib/auth.ts");
const envKeys = ["DATABASE_URL", "LOGIN_PWD", "CRON_SECRET", "RANKING_IMPORT_SECRET", "SEO_PREVIEW_UPSTREAM_TOKEN"];
const saved = Object.fromEntries(envKeys.map(key => [key, process.env[key]]));
beforeEach(async () => {
  rows = new Map(); calls = []; databaseFailure = false; beforeUpdate = null;
  process.env.DATABASE_URL = "postgresql://unused.invalid/test";
  process.env.LOGIN_PWD = "test-password-only"; process.env.RANKING_IMPORT_SECRET = "test-legacy-only";
  delete process.env.CRON_SECRET; delete process.env.SEO_PREVIEW_UPSTREAM_TOKEN;
  cookie = await auth.getAuthToken();
});
afterEach(() => { for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
const origin = "https://platform.test", endpoint = origin + "/api/import-tokens";
function request(body, headers = {}, session = cookie) {
  const result = new Request(endpoint, { ...(body === undefined ? {} : { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) }), headers });
  Object.defineProperty(result, "cookies", { value: { get: name => name === auth.AUTH_COOKIE_NAME && session ? { value: session } : undefined } });
  return result;
}
const post = (body, headers = {}, session = cookie) => route.POST(request(body, { origin, "content-type": "application/json", ...headers }, session));
const create = patch => service.mutateImportToken({ action: "create", name: "Collector", expiresInDays: 30, ...patch });
const bearer = secret => new Request(origin + "/api/seo/analytics/import", { headers: { authorization: "Bearer " + secret } });
function privateResponse(response) {
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(response.headers.get("vary"), "Cookie");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
}

test("generated credentials contain 32 random bytes, use canonical encodings, and expose only a short prefix", () => {
  const first = token.createImportTokenSecret(), second = token.createImportTokenSecret();
  assert.notEqual(first.secret, second.secret); assert.equal(Buffer.from(first.secret.slice(11), "base64url").length, 32);
  assert.match(first.secret, /^seo_import_[A-Za-z0-9_-]{43}$/); assert.match(first.tokenHash, /^[a-f0-9]{64}$/);
  assert.equal(first.tokenHash, token.hashImportToken(first.secret)); assert.equal(first.prefix, first.secret.slice(0, 19));
  assert.equal(token.managedImportToken("Bearer " + first.secret), first.secret);
  for (const value of [null, first.secret, "Basic " + first.secret, "bearer " + first.secret, "Bearer " + first.secret + " ", "Bearer seo_import_" + "A".repeat(42) + "B"]) assert.equal(token.managedImportToken(value), null);
});

test("creation stores a digest only; listing returns metadata and never reveals the secret again", async () => {
  const created = await create({ expiresInDays: null });
  assert.deepEqual(Object.keys(created).sort(), ["secret", "token"]);
  assert.equal(created.token.expiresAt, null); assert.equal(created.token.lastUsedAt, null);
  const stored = rows.get(created.token.id);
  assert.equal(stored.tokenHash, token.hashImportToken(created.secret)); assert.equal(JSON.stringify(stored).includes(created.secret), false);
  const listed = await service.listImportTokens();
  assert.deepEqual(listed, { tokens: [created.token], legacy: { configured: true, managed: false }, storage: "database" });
  assert.equal(JSON.stringify(listed).includes("tokenHash"), false); assert.equal(JSON.stringify(listed).includes(created.secret), false);
  assert.equal(JSON.stringify(calls).includes(created.secret), false);
});

test("fixed expiration choices are measured from creation and malformed commands do not create rows", async () => {
  const now = new Date("2026-11-11T00:00:00Z");
  for (const days of [30, 90, 365]) {
    const result = await service.mutateImportToken({ action: "create", name: "  Worker  ", expiresInDays: days }, now);
    assert.equal(result.token.name, "Worker"); assert.equal(result.token.expiresAt, new Date(now.getTime() + days * 86400000).toISOString());
  }
  for (const patch of [{ expiresInDays: 1 }, { expiresInDays: "30" }, { name: " " }, { name: "x\ny" }, { extra: true }]) await assert.rejects(create(patch));
  assert.equal(rows.size, 3);
});

test("managed authentication uses one atomic active/expiry check and records last use without reading a token", async () => {
  const created = await create(); calls.length = 0;
  assert.equal(await service.authenticateImportToken(bearer(created.secret)), true);
  assert.deepEqual(calls.map(call => call.method), ["updateMany"]);
  assert.equal(calls[0].args.where.tokenHash, token.hashImportToken(created.secret));
  assert.equal(calls[0].args.where.revokedAt, null); assert.equal(calls[0].args.where.OR[0].expiresAt, null);
  assert.equal(calls[0].args.where.OR[1].expiresAt.gt, calls[0].args.data.lastUsedAt);
  assert.ok(rows.get(created.token.id).lastUsedAt instanceof Date);
});

test("revocation wins before atomic authentication, remains permanent on retry, and rejects unknown ids", async () => {
  const created = await create();
  beforeUpdate = () => { rows.get(created.token.id).revokedAt = new Date(); };
  assert.equal(await service.authenticateImportToken(bearer(created.secret)), false);
  const firstRevokedAt = rows.get(created.token.id).revokedAt;
  assert.deepEqual(await service.mutateImportToken({ action: "revoke", id: created.token.id }), { revoked: true });
  assert.equal(rows.get(created.token.id).revokedAt, firstRevokedAt);
  assert.equal(await service.authenticateImportToken(bearer(created.secret)), false);
  await assert.rejects(service.mutateImportToken({ action: "revoke", id: "missing" }), error => error.code === "token_not_found");
});

test("expired, unknown and malformed tokens fail closed; a database failure never grants managed access", async () => {
  const created = await create(); rows.get(created.token.id).expiresAt = new Date(0);
  assert.equal(await service.authenticateImportToken(bearer(created.secret)), false);
  assert.equal(await service.authenticateImportToken(bearer(token.createImportTokenSecret().secret)), false);
  calls.length = 0; assert.equal(await service.authenticateImportToken(bearer("malformed")), false); assert.equal(calls.length, 0);
  databaseFailure = true; assert.equal(await service.authenticateImportToken(bearer(created.secret)), false);
  delete process.env.DATABASE_URL; calls.length = 0;
  assert.equal(await service.authenticateImportToken(bearer(created.secret)), false); assert.equal(calls.length, 0);
  await assert.rejects(service.listImportTokens(), error => error.status === 503);
});

test("a token expiring exactly at the atomic check time is rejected", async () => {
  const created = await create();
  beforeUpdate = () => { rows.get(created.token.id).expiresAt = calls.at(-1).args.where.OR[1].expiresAt.gt; };
  assert.equal(await service.authenticateImportToken(bearer(created.secret)), false);
  assert.equal(rows.get(created.token.id).lastUsedAt, null);
});

test("legacy credentials retain compatibility without a database and do not mutate managed tokens", async () => {
  delete process.env.DATABASE_URL; databaseFailure = true;
  assert.equal(await service.authenticateImportToken(bearer("test-legacy-only")), true);
  assert.equal(await service.authenticateImportToken(bearer("test-legacy-only-wrong")), false); assert.equal(calls.length, 0);
});

test("management requires enabled login and a valid cookie, never bearer auth or preview bypass", async () => {
  for (const session of [undefined, "bad-cookie"]) {
    const response = await route.GET(request(undefined, { authorization: "Bearer test-legacy-only" }, session ?? null));
    assert.equal(response.status, 401); privateResponse(response);
  }
  process.env.SEO_PREVIEW_UPSTREAM_TOKEN = "test-preview-only";
  delete process.env.LOGIN_PWD;
  const response = await post({ action: "create", name: "x", expiresInDays: null });
  assert.equal(response.status, 401); privateResponse(response); assert.equal(rows.size, 0);
});

test("management writes require same origin, JSON and bounded bodies before any mutation", async () => {
  const command = { action: "create", name: "Collector", expiresInDays: 30 };
  for (const headers of [{ origin: "https://other.test" }, { origin: "null" }, { "sec-fetch-site": "cross-site" }]) {
    const response = await post(command, headers); assert.equal(response.status, 403); privateResponse(response);
  }
  assert.equal((await route.POST(request(command, { "content-type": "application/json" }))).status, 403);
  assert.equal((await post(command, { "content-type": "text/plain" })).status, 415);
  assert.equal((await post("not JSON")).status, 400);
  assert.equal((await post({ ...command, secret: "do-not-accept-client-secret" })).status, 400);
  const tooLarge = await post('"' + "a".repeat(8192) + '"'); assert.equal(tooLarge.status, 413); privateResponse(tooLarge);
  assert.equal(rows.size, 0); assert.equal(calls.length, 0);
});

test("cross-site reads cannot expose credential metadata", async () => {
  for (const headers of [{ origin: "https://other.test" }, { "sec-fetch-site": "cross-site" }]) {
    const response = await route.GET(request(undefined, headers));
    assert.equal(response.status, 403); privateResponse(response);
  }
  assert.equal(calls.length, 0);
});

test("API create/list/revoke returns one-time plaintext and sanitized private failures", async () => {
  const createdResponse = await post({ action: "create", name: "Collector", expiresInDays: 90 });
  assert.equal(createdResponse.status, 200); privateResponse(createdResponse);
  const created = await createdResponse.json(); assert.match(created.secret, /^seo_import_/);
  const listedResponse = await route.GET(request()); privateResponse(listedResponse);
  const listed = await listedResponse.json(); assert.deepEqual(listed.tokens, [created.token]);
  assert.equal(JSON.stringify(listed).includes(created.secret), false); assert.equal(JSON.stringify(listed).includes("tokenHash"), false);
  const revoked = await post({ action: "revoke", id: created.token.id }); assert.equal(revoked.status, 200); assert.deepEqual(await revoked.json(), { revoked: true });
  const again = await post({ action: "revoke", id: created.token.id }); assert.equal(again.status, 200);
  const absent = await post({ action: "revoke", id: "missing" }); assert.equal(absent.status, 404); privateResponse(absent);
  databaseFailure = true;
  const failed = await route.GET(request()); assert.equal(failed.status, 503); privateResponse(failed);
  assert.equal(JSON.stringify(await failed.json()).includes("private-database-error"), false);
  const failedCreate = await post({ action: "create", name: "x", expiresInDays: null });
  assert.equal(failedCreate.status, 503); privateResponse(failedCreate);
  const failedBody = await failedCreate.json(); assert.equal("secret" in failedBody, false); assert.equal("tokenHash" in failedBody, false);
  delete process.env.DATABASE_URL;
  const unavailable = await post({ action: "create", name: "x", expiresInDays: null }); assert.equal(unavailable.status, 503); privateResponse(unavailable);
});
