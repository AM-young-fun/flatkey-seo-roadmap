const assert = require("node:assert/strict");
const { test, beforeEach } = require("node:test");
const fs = require("node:fs"), path = require("node:path"), Module = require("node:module"), ts = require("typescript");
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
require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText, filename);
const mock = (relative, exports) => { const filename = path.join(root, relative); require.cache[filename] = { id: filename, filename, loaded: true, exports }; };
let session, loginEnabled, secret, imports, observations, site, reads, failure;
mock("src/lib/auth.ts", { AUTH_COOKIE_NAME: "auth", isAuthEnabled: () => loginEnabled, isValidAuthToken: async () => session });
const headersPath = require.resolve("next/headers");
require.cache[headersPath] = { id: headersPath, filename: headersPath, loaded: true, exports: { cookies: async () => ({ get: () => undefined }) } };
mock("src/lib/import-credential.ts", { getRankingImportSecret: () => secret });
const db = {
  dailySeoTrafficImport: { findUnique: async ({ where }) => imports.find(row => row.requestId === where.requestId) ?? null,
    create: async ({ data }) => {
      const { points, ...row } = data;
      row.importedAt = new Date(); imports.push(row);
      observations.push(...points.create.map(point => ({ ...point, importBatch: row })));
      return row;
    } },
  dailySeoTrafficPoint: { findMany: async ({ where }) => {
    reads++; if (failure) throw failure;
    return observations.filter(row => row.date >= where.date.gte && row.date <= where.date.lte && Object.entries(where.importBatch).every(([key, value]) => row.importBatch[key] === value));
  } },
  seoSite: { findUnique: async () => site },
  $executeRaw: async () => 0,
  $transaction: async callback => callback(db),
};
mock("src/lib/prisma.ts", { prisma: db });
const { DAILY_SEO_TRAFFIC_DEFAULTS: defaults } = require("../src/lib/daily-seo-traffic.ts");
const { GET, POST } = require("../src/app/api/traffic/daily/route.ts");
const sample = () => ({ kind: "daily-seo-traffic", requestId: "ga4-daily-seo-2026-10-30-v1", ...defaults,
  collectedAt: "2026-10-31T08:00:00Z", sources: ["https://analytics.google.com/report"],
  points: [{ date: "2026-10-29", newUsers: 9, newRegistrations: 2 }, { date: "2026-10-30", newUsers: 0, newRegistrations: null }] });
const post = (body, bearer = false) => new Request("https://example.com/api/traffic/daily", { method: "POST", headers: { "Content-Type": "application/json", ...(bearer ? { Authorization: "Bearer fictional-daily-import-secret" } : {}) }, body: JSON.stringify(body) });
const get = (query = "start=2026-10-29&end=2026-10-31", bearer = false) => new Request(`https://example.com/api/traffic/daily?${query}`, { headers: bearer ? { Authorization: "Bearer fictional-daily-import-secret" } : {} });
beforeEach(() => { session = false; loginEnabled = true; secret = "fictional-daily-import-secret"; imports = []; observations = []; reads = 0; failure = null; site = { active: true, ga4PropertyId: "541304395" }; });

test("daily history and writes require a real session or the existing import Bearer even when page login is disabled", async () => {
  assert.equal((await GET(get())).status, 401);
  assert.equal((await POST(post(sample()))).status, 401);
  loginEnabled = false;
  assert.equal((await GET(get())).status, 401);
  assert.equal((await POST(post(sample()))).status, 401);
  assert.equal(reads, 0); assert.equal(imports.length, 0);
  assert.equal((await POST(post(sample(), true))).status, 201);
  assert.equal((await GET(get(undefined, true))).status, 200);
});

test("stable request IDs replay atomically, reject changed content and never duplicate saved daily observations", async () => {
  session = true;
  const original = sample();
  const first = await POST(post(original)), body = await first.json();
  assert.equal(first.status, 201); assert.equal(body.kind, "daily-seo-traffic"); assert.equal(body.imported, 2); assert.equal(body.duplicate, false);
  const reordered = structuredClone(original); reordered.points.reverse();
  const repeated = await POST(post(reordered));
  assert.equal(repeated.status, 200); assert.equal((await repeated.json()).duplicate, true);
  assert.equal(imports.length, 1); assert.equal(observations.length, 2);
  original.points[0].newUsers++;
  assert.equal((await POST(post(original))).status, 409);
  assert.equal(imports.length, 1); assert.equal(observations.length, 2);
});

test("session writes reject foreign or opaque Origins before reading a body, while same-origin and non-browser imports work", async () => {
  session = true;
  for (const origin of ["https://other.example", "null", "https://example.com.evil.example"]) {
    const request = post(sample()); request.headers.set("origin", origin);
    assert.equal((await POST(request)).status, 403);
  }
  assert.equal(imports.length, 0);
  const request = post(sample()); request.headers.set("origin", "https://example.com");
  assert.equal((await POST(request)).status, 201);
  const form = new Request("https://example.com/api/traffic/daily", { method: "POST", headers: { "Content-Type": "text/plain", origin: "https://example.com" }, body: JSON.stringify(sample()) });
  assert.equal((await POST(form)).status, 415);
});

test("an import appearing after the first replay lookup is rechecked under the transaction lock", async t => {
  session = true;
  assert.equal((await POST(post(sample()))).status, 201);
  const original = db.dailySeoTrafficImport.findUnique;
  let lookups = 0;
  t.mock.method(db.dailySeoTrafficImport, "findUnique", async args => ++lookups === 1 ? null : original(args));
  const response = await POST(post(sample()));
  assert.equal(response.status, 200); assert.equal((await response.json()).duplicate, true);
  assert.equal(lookups, 2); assert.equal(imports.length, 1); assert.equal(observations.length, 2);
});

test("explicit Primary and Default history queries never borrow the other attribution cohort", async () => {
  session = true;
  assert.equal((await POST(post(sample()))).status, 201);
  const other = sample(); other.requestId = "ga4-default-dimension-v1"; other.channelDimension = "firstUserDefaultChannelGroup";
  other.points = [{ date: "2026-10-29", newUsers: 77, newRegistrations: 33 }];
  assert.equal((await POST(post(other))).status, 201);
  const primary = await (await GET(get("start=2026-10-29&end=2026-10-29&channelDimension=firstUserPrimaryChannelGroup"))).json();
  const secondary = await (await GET(get("start=2026-10-29&end=2026-10-29&channelDimension=firstUserDefaultChannelGroup"))).json();
  assert.equal(primary.points[0].newUsers, 9); assert.equal(primary.points[0].newRegistrations, 2);
  assert.equal(secondary.points[0].newUsers, 77); assert.equal(secondary.points[0].newRegistrations, 33);
  assert.equal(primary.points[0].revisions, 1); assert.equal(secondary.points[0].revisions, 1);
});

test("daily revisions append history and read complete date axes without replacing missing values with zero", async () => {
  session = true;
  const oldFetch = global.fetch;
  global.fetch = () => assert.fail("daily evidence storage must not call a GA4 or supplier API");
  try {
    assert.equal((await POST(post(sample()))).status, 201);
    const revision = sample(); revision.requestId = "ga4-daily-seo-2026-10-30-v2"; revision.collectedAt = "2026-11-01T08:00:00Z";
    revision.points = [{ date: "2026-10-29", newUsers: null, newRegistrations: 0 }];
    assert.equal((await POST(post(revision))).status, 201);
    const response = await GET(get()), result = await response.json();
    assert.equal(response.status, 200); assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.equal(result.points.length, 3);
    assert.deepEqual(result.points.map(point => [point.date, point.newUsers, point.newRegistrations]), [["2026-10-29", 9, 0], ["2026-10-30", 0, null], ["2026-10-31", null, null]]);
    assert.equal(result.points[0].revisions, 2); assert.equal(imports.length, 2); assert.equal(observations.length, 3);
    assert.deepEqual(result.coverage, { days: 3, newUsersDays: 2, registrationDays: 1, completeDays: 1 });
    const anotherDimension = await GET(get("start=2026-10-29&end=2026-10-31&channelDimension=firstUserDefaultChannelGroup"));
    assert.ok((await anotherDimension.json()).points.every(point => point.newUsers === null && point.newRegistrations === null));
  } finally { global.fetch = oldFetch; }
});

test("invalid cohorts and inactive or misconfigured sites cannot save a daily batch", async () => {
  session = true;
  assert.equal((await POST(post({ ...sample(), channelName: "Paid Search" }))).status, 400);
  assert.equal((await GET(get("trafficScope=all_users"))).status, 400);
  site.active = false;
  assert.equal((await POST(post(sample()))).status, 400);
  site.active = true; site.ga4PropertyId = "another-property";
  assert.equal((await POST(post(sample()))).status, 400);
  assert.equal(imports.length, 0);
});

test("daily read failures expose only safe codes and do not fabricate an empty successful history", async () => {
  session = true; failure = Object.assign(new Error("private database connection details"), { code: "P2021" });
  const response = await GET(get()), result = await response.json();
  assert.equal(response.status, 503); assert.equal(result.code, "P2021");
  assert.equal("points" in result, false); assert.ok(!JSON.stringify(result).includes("private database"));
});
