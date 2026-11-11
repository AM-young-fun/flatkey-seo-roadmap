const assert = require("node:assert/strict"), { test, beforeEach } = require("node:test"), fs = require("node:fs"), path = require("node:path"), Module = require("node:module"), ts = require("typescript");
// Next.js supplies this boundary marker; the route tests still load the real token authenticator.
const loadWithServerOnly = Module._load;
Module._load = function (name, ...args) {
  if (name === "server-only") return {};
  return loadWithServerOnly.call(this, name, ...args);
};
const root = path.resolve(__dirname, ".."), resolve = Module._resolveFilename;
Module._resolveFilename = function (name, parent, ...rest) { return resolve.call(this, name.startsWith("@/") ? path.join(root, "src", name.slice(2)) : name, parent, ...rest); };
// Production-route tests isolate the development-only preview adapter.
const previewModule = path.join(root, "src/lib/seo-preview.ts");
require.cache[previewModule] = { id: previewModule, filename: previewModule, loaded: true, exports: { previewRead: async () => null } };
require.extensions[".ts"] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, file);
const mock = (relative, exports) => { const file = path.join(root, relative); require.cache[file] = { id: file, filename: file, loaded: true, exports }; };
let session, login, imports, points, site, failure;
mock("src/lib/auth.ts", { AUTH_COOKIE_NAME: "auth", isAuthEnabled: () => login, isValidAuthToken: async () => session });
mock("src/lib/import-credential.ts", { getRankingImportSecret: () => "fictional-group-import-secret" });
const headerPath = require.resolve("next/headers"); require.cache[headerPath] = { id: headerPath, filename: headerPath, loaded: true, exports: { cookies: async () => ({ get: () => undefined }) } };
const db = {
  dailySeoPageGroupImport: { findUnique: async ({ where }) => imports.find(row => row.requestId === where.requestId) ?? null,
    create: async ({ data }) => { const { points: nested, ...row } = data; row.importedAt = new Date(); imports.push(row); points.push(...nested.create.map(point => ({ ...point, importBatch: row }))); return row; } },
  dailySeoPageGroupPoint: { findMany: async ({ where }) => { if (failure) throw failure; return points.filter(row => row.date >= where.date.gte && row.date <= where.date.lte && Object.entries(where.importBatch).every(([key, value]) => row.importBatch[key] === value)); } },
  seoSite: { findUnique: async () => site }, $executeRaw: async () => 0, $transaction: async fn => fn(db),
  dailySeoTrafficImport: { create: () => assert.fail("page-group evidence must never replace or write whole-site imports") },
};
mock("src/lib/prisma.ts", { prisma: db });
const { DAILY_SEO_TRAFFIC_DEFAULTS: defaults } = require("../src/lib/daily-seo-traffic.ts");
const { POST, GET } = require("../src/app/api/traffic/daily/groups/route.ts");
const source = "https://analytics.google.com/analytics/web/";
const sample = () => ({ ...defaults, kind: "daily-seo-page-groups", ruleVersion: 1, requestId: "fictional-page-group-import-v1", collectedAt: "2026-11-03T03:00:00Z", sources: [source],
  groups: [{ key: "model_list", points: [{ date: "2026-11-01", totalUsers: 12, pageViews: 20, funnel: { entrants: 12, registrations: 2, collectedAt: "2026-11-03T02:00:00Z", sources: [source] } }] }] });
const post = (body, { bearer = false, origin = undefined } = {}) => new Request("https://example.com/api/traffic/daily/groups", { method: "POST", headers: { "Content-Type": "application/json", ...(bearer ? { Authorization: "Bearer fictional-group-import-secret" } : {}), ...(origin ? { origin } : {}) }, body: JSON.stringify(body) });
const get = (params = "start=2026-10-31&end=2026-11-01", bearer = false) => new Request(`https://example.com/api/traffic/daily/groups?${params}`, { headers: bearer ? { Authorization: "Bearer fictional-group-import-secret" } : {} });
beforeEach(() => { session = false; login = true; imports = []; points = []; site = { active: true, ga4PropertyId: "541304395" }; failure = null; });
test("group APIs enforce session or Bearer, reject foreign Origins and remain protected when page login is disabled", async () => {
  assert.equal((await POST(post(sample()))).status, 401); assert.equal((await GET(get())).status, 401);
  login = false; assert.equal((await POST(post(sample()))).status, 401);
  assert.equal((await POST(post(sample(), { bearer: true, origin: "https://foreign.example" }))).status, 403);
  assert.equal((await POST(post(sample(), { bearer: true }))).status, 201);
  assert.equal((await GET(get(undefined, true))).status, 200);
});
test("independent group batches replay idempotently and conflicting corrections require a new request ID", async () => {
  session = true;
  const payload = sample(); payload.groups.push({ key: "prompts", points: [{ date: "2026-11-01", totalUsers: 0, pageViews: null, funnel: null }] });
  const first = await POST(post(payload)), result = await first.json();
  assert.equal(first.status, 201); assert.equal(result.imported, 2); assert.equal(result.kind, "daily-seo-page-groups");
  payload.groups.reverse(); const replay = await POST(post(payload));
  assert.equal(replay.status, 200); assert.equal((await replay.json()).duplicate, true); assert.equal(points.length, 2);
  payload.groups[0].points[0].totalUsers = 1;
  assert.equal((await POST(post(payload))).status, 409); assert.equal(imports.length, 1);
});
test("group-only revisions preserve untouched groups and select traffic and funnel evidence separately without provider calls", async () => {
  session = true; const originalFetch = global.fetch; global.fetch = () => assert.fail("no server GA4 collection");
  try {
    assert.equal((await POST(post(sample()))).status, 201);
    const update = sample(); update.requestId = "fictional-page-group-import-v2";
    update.groups[0].points[0] = { date: "2026-11-01", totalUsers: null, pageViews: 30, funnel: null };
    update.collectedAt = "2026-11-03T04:00:00Z";
    assert.equal((await POST(post(update))).status, 201);
    const response = await GET(get()), history = await response.json(), point = history.groups.find(group => group.key === "model_list").points[1];
    assert.equal(response.status, 200); assert.equal(history.groups.length, 4);
    assert.equal(point.totalUsers, 12); assert.equal(point.pageViews, 30); assert.equal(point.funnel.registrations, 2);
    assert.equal(point.revisions, 2); assert.equal(points.length, 2);
    assert.equal(history.groups[0].points[1].totalUsers, null);
    assert.equal((await GET(get("channelDimension=firstUserDefaultChannelGroup"))).status, 400);
  } finally { global.fetch = originalFetch; }
});
test("invalid funnel evidence, inactive sites and data failures cannot produce a successful saved/read receipt", async () => {
  session = true; const invalid = sample(); invalid.groups[0].points[0].funnel.registrations = 13;
  assert.equal((await POST(post(invalid))).status, 400); assert.equal(points.length, 0);
  site.active = false; assert.equal((await POST(post(sample()))).status, 400);
  failure = Object.assign(new Error("private database address"), { code: "P2021" });
  const response = await GET(get()), result = await response.json();
  assert.equal(response.status, 503); assert.equal(result.code, "P2021"); assert.equal("groups" in result, false);
  assert.ok(!JSON.stringify(result).includes("private database"));
});
