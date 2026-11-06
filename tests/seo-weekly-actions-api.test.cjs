const assert = require("node:assert/strict"), { test, beforeEach, afterEach } = require("node:test");
const fs = require("node:fs"), path = require("node:path"), os = require("node:os"), Module = require("node:module"), ts = require("typescript");
const originalLoad = Module._load;
Module._load = function (name, ...args) {
  if (name === "server-only") return {};
  if (name === "next/headers") return { cookies: async () => ({ get: () => undefined }) };
  if (name === "./auth") return { AUTH_COOKIE_NAME: "auth", isAuthEnabled: () => true, isValidAuthToken: async () => false };
  if (name === "@/lib/import-credential") return { getRankingImportSecret: () => "test-weekly-secret" };
  if (name === "@/lib/ranking-import") return { importSecretMatches: (value, secret) => value === `Bearer ${secret}` };
  if (name.startsWith("@/")) return originalLoad.call(this, path.resolve(__dirname, "../src", name.slice(2)) + ".ts", ...args);
  return originalLoad.call(this, name, ...args);
};
require.extensions[".ts"] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, file);
const { GET, POST } = require("../src/app/api/seo/weekly-actions/route.ts");
const saved = { NODE_ENV: process.env.NODE_ENV, SEO_PREVIEW_UPSTREAM_TOKEN: process.env.SEO_PREVIEW_UPSTREAM_TOKEN, SEO_WEEKLY_ACTIONS_STORE_DIR: process.env.SEO_WEEKLY_ACTIONS_STORE_DIR };
let directory;
beforeEach(async () => { directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), "weekly-api-test-")); process.env.NODE_ENV = "development"; process.env.SEO_PREVIEW_UPSTREAM_TOKEN = "test-preview"; process.env.SEO_WEEKLY_ACTIONS_STORE_DIR = directory; });
afterEach(async () => { for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } await fs.promises.rm(directory, { recursive: true }); });
const url = "http://localhost:3104/api/seo/weekly-actions";
const body = JSON.stringify({ periodStart: "2026-10-30", preparedAt: "2026-11-04T03:00:00.000Z", status: "draft", sources: [{ name: "snapshot", date: "2026-10-30" }], actions: [{ pageUrl: "https://flatkey.ai/models", country: "US", keyword: "model", role: "primary", currentRank: 12, targetRank: null, monthlySearchVolume: 100, estimatedClicks: null, ctrAssumption: null, reason: "visible rank", action: "review SERP" }] });

test("weekly reads/writes reject unauthenticated production and foreign origins", async () => {
  assert.equal((await GET(new Request("https://production.test/api/seo/weekly-actions"))).status, 401);
  assert.equal((await POST(new Request("https://production.test/api/seo/weekly-actions", { method: "POST", body }))).status, 401);
  assert.equal((await GET(new Request(url, { headers: { origin: "https://evil.test" } }))).status, 403);
  assert.equal((await POST(new Request(url, { method: "POST", headers: { origin: "https://evil.test" }, body }))).status, 403);
  assert.equal((await POST(new Request(url, { method: "POST", headers: { origin: "http://localhost:3104", "sec-fetch-site": "cross-site" }, body }))).status, 401);
});

test("same-origin local plan saves and can be read without exposing credentials", async () => {
  const response = await POST(new Request(url, { method: "POST", headers: { origin: "http://localhost:3104" }, body }));
  assert.equal(response.status, 200);
  const read = await GET(new Request(url + "?week=2026-10-30"));
  assert.equal(read.headers.get("cache-control"), "private, no-store");
  const content = await read.text(); assert.equal(JSON.parse(content).plan.status, "draft"); assert.equal(content.includes("test-preview"), false);
  assert.equal((await GET(new Request(url + "?week=../../secret"))).status, 400);
  assert.equal((await POST(new Request(url, { method: "POST", headers: { origin: "http://localhost:3104" }, body: "x".repeat(65537) }))).status, 413);
});

test("collector import needs no browser origin and production requires explicit durable directory", async () => {
  process.env.NODE_ENV = "production";
  const auth = { authorization: "Bearer test-weekly-secret" };
  assert.equal((await POST(new Request("https://production.test/api/seo/weekly-actions", { method: "POST", headers: { ...auth, origin: "https://production.test" }, body }))).status, 403);
  delete process.env.SEO_WEEKLY_ACTIONS_STORE_DIR;
  assert.equal((await POST(new Request("https://production.test/api/seo/weekly-actions", { method: "POST", headers: auth, body }))).status, 503);
  process.env.SEO_WEEKLY_ACTIONS_STORE_DIR = directory;
  assert.equal((await POST(new Request("https://production.test/api/seo/weekly-actions", { method: "POST", headers: auth, body }))).status, 200);
});
