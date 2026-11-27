const assert = require("node:assert/strict"), { test, beforeEach, afterEach } = require("node:test"), fs = require("node:fs"), path = require("node:path"), os = require("node:os"), Module = require("node:module"), ts = require("typescript");
const originalLoad = Module._load; let session = false;
Module._load = function (name, ...args) {
  if (name === "server-only") return {};
  if (name === "next/headers") return { cookies: async () => ({ get: () => undefined }) };
  if (name === "./auth") return { AUTH_COOKIE_NAME: "auth", isAuthEnabled: () => true, isValidAuthToken: async () => session };
  if (name === "@/lib/prisma") return { prisma: {} };
  if (name === "./import-credential" || name === "@/lib/import-credential") return { getRankingImportSecret: () => "test-workflow-secret" };
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

test("explicit list format is scoped to the list and full/task-detail reads preserve the original graph", async () => {
  const record = { ...task, weekStart: "2026-11-23", dueAt: "2026-11-23T09:00:00Z" };
  assert.equal((await post(mutation({ record }))).status, 200);
  const response = await GET(new Request(url + "?operational=1&workList=1&format=list"));
  assert.equal(response.status, 200);
  const list = await response.json();
  assert.equal(list.format, "list"); assert.equal(list.tasks[0].displayStatus, "scheduled");
  assert.equal(list.tasks[0].id, record.id); assert.equal(list.tasks[0].review, null);
  for (const key of ["approvals", "publications", "issues", "runs", "plan", "historicalImports", "optimizations"]) assert.equal(Object.hasOwn(list, key), false);
  for (const phase of ["authorize", "local", "snapshot", "list", "serialize", "workflow"]) assert.match(response.headers.get("server-timing"), new RegExp(`${phase};dur=\\d`));
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  const full = await (await GET(new Request(url + "?operational=1&workList=1"))).json();
  assert.ok(Array.isArray(full.approvals)); assert.ok(Array.isArray(full.tasks[0].evidence));
  assert.deepEqual(list.summary, full.summary);
  const { asOf: listReadAt, ...listWindow } = list.workWeek, { asOf: fullReadAt, ...fullWindow } = full.workWeek;
  assert.ok(Date.parse(listReadAt) <= Date.parse(fullReadAt)); assert.deepEqual(listWindow, fullWindow);
  const detail = await (await GET(new Request(url + "?taskId=" + record.id))).json();
  assert.ok(Array.isArray(detail.task.acceptanceCriteria));
  for (const query of ["format=list", "operational=1&format=list", "workList=1&format=list", "operational=1&workList=1&format=other", "operational=1&workList=1&format=list&releaseQueue=1", "operational=1&workList=1&format=list&taskId=task-1"]) {
    const invalid = await GET(new Request(url + "?" + query)); assert.equal(invalid.status, 400, query);
  }
});

test("workflow diagnostics expose aggregate sizes and durations without rows or connection credentials", async () => {
  const response = await GET(new Request(url + "?operational=1&workList=1&format=list&profile=1"));
  const profile = await response.json();
  assert.equal(response.status, 200); assert.ok(profile.payloadBytes > 0); assert.ok(profile.durationMs >= 0);
  assert.ok(profile.phases.some(phase => phase.phase === "snapshot"));
  assert.ok(profile.phases.some(phase => phase.phase === "serialize"));
  for (const key of ["tasks", "approvals", "evidence", "payload", "query", "sql"]) assert.equal(Object.hasOwn(profile, key), false);
  assert.equal(JSON.stringify(profile).includes("postgresql://"), false);
  const denied = await GET(new Request("https://production.test/api/seo/workflow?profile=1"));
  assert.equal(denied.status, 401); assert.equal(Object.hasOwn(await denied.json(), "phases"), false);
});

test("work task list filters matching content records before returning fixed ten-row pages", async () => {
  const weekStart = "2026-11-23", dueAt = "2026-11-23T09:00:00Z";
  for (let index = 0; index < 26; index++) {
    const id = `page-task-${String(index).padStart(2, "0")}`;
    const matching = index > 1 && index < 24;
    const record = { ...task, id, weekStart, dueAt, kind: "landing", pageType: "landing", country: "US", language: "en",
      keyword: `gpu directory ${index}`, title: matching ? `Matching landing ${index}` : `Other task ${index}` };
    assert.equal((await post(mutation({ requestId: `add-${id}`, record }))).status, 200);
  }
  const technical = { ...task, id: "matching-technical", weekStart, dueAt, title: "Matching technical check" };
  assert.equal((await post(mutation({ requestId: "add-matching-technical", record: technical }))).status, 200);
  const base = `${url}?operational=1&workList=1&format=list`;
  const filtered = `${base}&q=matching&status=scheduled&site=flatkey.ai&range=all`;
  for (const [page, count, first] of [[1, 10, "02"], [2, 10, "12"], [3, 2, "22"], [9, 2, "22"]]) {
    const response = await GET(new Request(`${filtered}&page=${page}`));
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.deepEqual(result.pagination, { page: Math.min(page, 3), pageSize: 10, total: 22, pageCount: 3 });
    assert.equal(result.tasks.length, count);
    assert.equal(result.tasks[0].id, `page-task-${first}`);
    assert.equal(Object.hasOwn(result, "workWeek"), false, "a page does not carry global task ID arrays");
  }
  const landing = await (await GET(new Request(`${filtered}&page=1&taskType=landing-create`))).json();
  assert.equal(landing.pagination.total, 22);
  const technicalList = await (await GET(new Request(`${filtered}&page=1&taskType=technical`))).json();
  assert.equal(technicalList.pagination.total, 0);
  const noMatches = await (await GET(new Request(`${base}&page=2&site=rackrate.org&range=all`))).json();
  assert.deepEqual(noMatches.pagination, { page: 1, pageSize: 10, total: 0, pageCount: 1 });
  assert.deepEqual(noMatches.tasks, []);
  const legacy = await (await GET(new Request(base))).json();
  assert.equal(legacy.tasks.length, 27, "legacy callers keep their full list");
  assert.ok(legacy.tasks.some(row => row.id === technical.id));
  for (const query of ["page=0", "page=-1", "page=2&page=3", "page=1&pageSize=100", "page=1&site=bad", "page=1&status=bogus", "page=1&range=custom"]) {
    assert.equal((await GET(new Request(`${base}&${query}`))).status, 400, query);
  }
  assert.equal((await GET(new Request(`${url}?taskId=task-1&page=1`))).status, 400);
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
