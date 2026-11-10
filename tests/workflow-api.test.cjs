const assert = require("node:assert/strict"), { test, beforeEach, afterEach } = require("node:test"), fs = require("node:fs"), path = require("node:path"), os = require("node:os"), Module = require("node:module"), ts = require("typescript");
const originalLoad = Module._load; let session = false;
Module._load = function (name, ...args) {
  if (name === "server-only") return {};
  if (name === "next/headers") return { cookies: async () => ({ get: () => undefined }) };
  if (name === "./auth") return { AUTH_COOKIE_NAME: "auth", isAuthEnabled: () => true, isValidAuthToken: async () => session };
  if (name === "@/lib/prisma") return { prisma: {} };
  if (name === "./import-credential") return { getRankingImportSecret: () => "test-workflow-secret" };
  if (name === "./ranking-import") return { importSecretMatches: (value, secret) => value === `Bearer ${secret}` };
  if (name.startsWith("@/")) return originalLoad.call(this, path.resolve(__dirname, "../src", name.slice(2)) + ".ts", ...args);
  return originalLoad.call(this, name, ...args);
};
require.extensions[".ts"] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, file);
const { GET, POST } = require("../src/app/api/seo/workflow/route.ts");
const history = require("../src/app/api/seo/workflow/history/route.ts");
const approvalCheck = require("../src/app/api/seo/workflow/approval-check/route.ts");
const saved = Object.fromEntries(["NODE_ENV", "SEO_PREVIEW_UPSTREAM_TOKEN", "SEO_WORKFLOW_PREVIEW_DIR", "DATABASE_URL"].map(key => [key, process.env[key]]));
let directory;
beforeEach(async () => { session = false; directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), "workflow-api-")); process.env.NODE_ENV = "development"; process.env.SEO_PREVIEW_UPSTREAM_TOKEN = "test-preview"; process.env.SEO_WORKFLOW_PREVIEW_DIR = directory; delete process.env.DATABASE_URL; });
afterEach(async () => { for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } await fs.promises.rm(directory, { recursive: true, force: true }); });
const url = "http://localhost:3104/api/seo/workflow";
const task = { id: "task-1", weekStart: "2026-11-09", title: "检查 canonical", siteDomain: "flatkey.ai", kind: "technical", country: null, language: null, business: "API", pageType: "technical", keyword: null, pageUrl: "https://flatkey.ai/docs", owner: "AI", dueAt: "2026-11-10T09:00:00Z", status: "planned", dependencies: [], evidence: [], nextAction: "读取正式页", contentVersion: null, acceptanceCriteria: ["canonical 正确"], source: "human" };
const mutation = patch => ({ requestId: "req-1", action: "save_task", expectedVersion: 0, record: task, ...patch });
const post = (body, headers = { origin: "http://localhost:3104" }, target = url) => POST(new Request(target, { method: "POST", headers, body: typeof body === "string" ? body : JSON.stringify(body) }));

test("workflow API denies unauthenticated production and foreign browser origins", async () => {
  assert.equal((await GET(new Request("https://production.test/api/seo/workflow"))).status, 401);
  assert.equal((await post(mutation(), {}, "https://production.test/api/seo/workflow")).status, 401);
  assert.equal((await post(mutation(), { origin: "https://evil.test" })).status, 403);
  assert.equal((await GET(new Request(url, { headers: { origin: "https://evil.test" } }))).status, 403);
  assert.equal((await post(mutation(), { authorization: "Bearer test-workflow-secret", origin: "http://localhost:3104" })).status, 403);
});
test("local preview persists real user input, replays identical id and rejects changed replay", async () => {
  const first = await post(mutation()); assert.equal(first.status, 200); assert.equal((await first.json()).record.version, 1);
  const replay = await post(mutation()); assert.equal(replay.status, 200); assert.equal((await replay.json()).replay, true);
  const conflict = await post(mutation({ record: { ...task, owner: "someone else" } })); assert.equal(conflict.status, 409);
  const response = await GET(new Request(url + "?week=2026-11-09")), data = await response.json();
  assert.equal(data.tasks.length, 1); assert.equal(data.tasks[0].owner, "AI"); assert.equal(data.storage, "local_preview"); assert.equal(data.plan, null);
  assert.equal(response.headers.get("cache-control"), "private, no-store"); assert.equal(JSON.stringify(data).includes("test-workflow-secret"), false);
});
test("versions preserve history and stale updates do not overwrite newer data", async () => {
  await post(mutation());
  assert.equal((await post(mutation({ requestId: "req-2", expectedVersion: 1, record: { ...task, status: "researching" } }))).status, 200);
  assert.equal((await post(mutation({ requestId: "req-3", expectedVersion: 1, record: { ...task, status: "ready" } }))).status, 409);
  const response = await history.GET(new Request(url + "/history?kind=task&id=task-1")), data = await response.json();
  assert.deepEqual(data.records.map(row => row.version), [1, 2]); assert.equal(data.records[0].status, "planned");
});
test("invalid week, non-owned page and oversized bodies never write", async () => {
  assert.equal((await GET(new Request(url + "?week=2026-11-13"))).status, 400);
  assert.equal((await GET(new Request(url + "?pageUrl=https://other.test/x"))).status, 400);
  assert.equal((await post("x".repeat(512 * 1024 + 1))).status, 413);
  assert.equal((await post("bad json")).status, 400);
  assert.equal((await GET(new Request(url + "?week=2026-11-09"))).status, 200);
});
test("production never falls back to a local file without a database", async () => {
  process.env.NODE_ENV = "production";
  const response = await post(mutation(), { authorization: "Bearer test-workflow-secret" }, "https://production.test/api/seo/workflow");
  assert.equal(response.status, 503); assert.match((await response.json()).message, /未写入/);
  assert.equal(fs.existsSync(path.join(directory, "workflow.json")), false);
});


test("approval preflight is authenticated, read-only and fails closed for absent approvals", async () => {
 const request = (headers={},target="https://production.test/api/seo/workflow/approval-check")=>new Request(target,{method:"POST",headers,body:JSON.stringify({approvalId:"missing",itemId:"missing",taskId:task.id,pageUrl:task.pageUrl,language:"en",contentVersion:"v1"})});
 assert.equal((await approvalCheck.POST(request())).status,401);
 assert.equal((await approvalCheck.POST(request({authorization:"Bearer test-workflow-secret",origin:"https://evil.test"}))).status,403);
 const local=await approvalCheck.POST(request({origin:"http://localhost:3104"},url+"/approval-check"));
 assert.equal(local.status,409);assert.match((await local.json()).code,/publication_unapproved/);
 assert.equal(fs.existsSync(path.join(directory,"workflow.json")),false);
 process.env.NODE_ENV="production";
 assert.equal((await approvalCheck.POST(request({authorization:"Bearer test-workflow-secret"}))).status,503);
});
