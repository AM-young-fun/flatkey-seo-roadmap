const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs"), path = require("node:path"), os = require("node:os"), ts = require("typescript");
require.extensions[".ts"] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, file);
const { optimizationPlanInputSchema, optimizationPlanId, optimizationPlansDirectory, readOptimizationPlans, writeOptimizationPlan } = require("../src/lib/seo-optimization-plans.ts");
const fixture = () => ({ country: "US", keyword: "model api", pageUrl: "https://flatkey.ai/zh/models", role: "primary", targetRank: "10", ctr: "", notes: "Check intent", optimizedAt: null, changes: "", baseline: { siteRank: 15, pageRank: null, rankUrl: null, volume: 1000, snapshotGeneratedAt: "2026-10-30T03:45:20.000Z", savedAt: "2026-11-04T00:00:00.000Z" } });

test("strict optimization schema rejects unsafe pages, future dates, invented page ranks and bad CTR", () => {
 assert.equal(optimizationPlanInputSchema.safeParse(fixture()).success, true);
 for (const pageUrl of ["https://flatkey.ai.evil.test/", "https://user:pass@flatkey.ai/", "http://flatkey.ai/", "https://flatkey.ai/#x"]) assert.equal(optimizationPlanInputSchema.safeParse({ ...fixture(), pageUrl }).success, false);
 for (const ctr of ["101", "-1", "NaN", "Infinity"]) assert.equal(optimizationPlanInputSchema.safeParse({ ...fixture(), ctr }).success, false);
 assert.equal(optimizationPlanInputSchema.safeParse({ ...fixture(), optimizedAt: "2099-01-01" }).success, false);
 assert.equal(optimizationPlanInputSchema.safeParse({ ...fixture(), extra: true }).success, false);
 assert.equal(optimizationPlanInputSchema.safeParse({ ...fixture(), baseline: { ...fixture().baseline, pageRank: 15 } }).success, false);
});

test("plan identity isolates country and page and normalizes duplicate keyword spelling", () => {
 assert.equal(optimizationPlanId(fixture()), optimizationPlanId({ ...fixture(), keyword: " MODEL   API " }));
 assert.notEqual(optimizationPlanId(fixture()), optimizationPlanId({ ...fixture(), country: "JP" }));
 assert.notEqual(optimizationPlanId(fixture()), optimizationPlanId({ ...fixture(), pageUrl: "https://flatkey.ai/models" }));
});

test("persistent revisions retain the first baseline and survive browser-independent rereading", async t => {
 const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), "optimization-plan-test-"));
 t.after(() => fs.promises.rm(directory, { recursive: true }));
 assert.deepEqual(await readOptimizationPlans(directory), []);
 const first = await writeOptimizationPlan(fixture(), directory);
 const second = await writeOptimizationPlan({ ...fixture(), optimizedAt: "2026-11-02", changes: "Updated title", baseline: { ...fixture().baseline, siteRank: 9, volume: 2000 } }, directory);
 assert.notEqual(first.revision, second.revision);
 assert.deepEqual(second.baseline, first.baseline);
 assert.deepEqual(await readOptimizationPlans(directory), [second]);
 assert.equal((await readOptimizationPlans(directory, true)).length, 2);
 assert.equal(second.optimizedAt, "2026-11-02");
 const names = await fs.promises.readdir(directory);
 assert.equal(names.length, 2);
 assert.equal((await fs.promises.stat(path.join(directory, names[0]))).mode & 0o777, 0o600);
 const jp = await writeOptimizationPlan({ ...fixture(), country: "JP" }, directory);
 assert.equal((await readOptimizationPlans(directory)).length, 2);
 assert.notEqual(jp.id, first.id);
});

test("production optimization storage requires an explicit absolute durable directory", () => {
 const previous = process.env.SEO_OPTIMIZATION_PLANS_STORE_DIR;
 try {
  delete process.env.SEO_OPTIMIZATION_PLANS_STORE_DIR;
  assert.equal(optimizationPlansDirectory(false), null);
  assert.match(optimizationPlansDirectory(true), /\.local[/]seo-analytics[/]optimization-plans$/);
  process.env.SEO_OPTIMIZATION_PLANS_STORE_DIR = "relative"; assert.throws(() => optimizationPlansDirectory(false));
 } finally { if (previous === undefined) delete process.env.SEO_OPTIMIZATION_PLANS_STORE_DIR; else process.env.SEO_OPTIMIZATION_PLANS_STORE_DIR = previous; }
});

test("optimization API enforces authorization, same-origin writes and the streaming body limit", async () => {
 let authorized = true, writes = 0;
 const routeFile = path.join(__dirname, "../src/app/api/seo/optimization-plans/route.ts");
 const code = ts.transpileModule(fs.readFileSync(routeFile, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
 const module = { exports: {} };
 const stubs = {
  "@/lib/seo-analytics-access": { analyticsLocalPreview: () => true, authorizeAnalyticsRead: async () => authorized, privateAnalyticsHeaders: { "Cache-Control": "private, no-store" } },
  "@/lib/import-credential": { getRankingImportSecret: () => "unit-secret" },
  "@/lib/ranking-import": { importSecretMatches: (header, secret) => header === `Bearer ${secret}` },
  "@/lib/preview-origin": { isLocalPreviewOrigin: request => request.headers.get("origin") === "http://127.0.0.1:3104" },
  "@/lib/seo-optimization-plans": { optimizationPlansDirectory: () => "/unit-test-only", readOptimizationPlans: async () => [], writeOptimizationPlan: async input => { writes++; return input; } },
 };
 new Function("require", "module", "exports", code)(name => { if (!(name in stubs)) throw Error(name); return stubs[name]; }, module, module.exports);
 const { GET, POST } = module.exports;
 const url = "http://127.0.0.1:3104/api/seo/optimization-plans";
 authorized = false;
 assert.equal((await GET(new Request(url))).status, 401);
 assert.equal((await POST(new Request(url, { method: "POST", body: "{}" }))).status, 401);
 authorized = true;
 assert.equal((await POST(new Request(url, { method: "POST", body: "{}" }))).status, 403);
 assert.equal((await POST(new Request(url, { method: "POST", headers: { Origin: "https://evil.test" }, body: "{}" }))).status, 403);
 assert.equal((await POST(new Request(url, { method: "POST", headers: { Origin: "http://127.0.0.1:3104" }, body: "x".repeat(65537) }))).status, 413);
 assert.equal(writes, 0);
 const result = await POST(new Request(url, { method: "POST", headers: { Origin: "http://127.0.0.1:3104" }, body: JSON.stringify(fixture()) }));
 assert.equal(result.status, 200); assert.equal(writes, 1);
 assert.equal((await GET(new Request(url, { headers: { Authorization: "Bearer unit-secret", Origin: "http://127.0.0.1:3104" } }))).status, 403);
 const list = await GET(new Request(url)); assert.equal(list.status, 200); assert.equal(list.headers.get("Cache-Control"), "private, no-store");
});
