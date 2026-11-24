const assert = require("node:assert/strict"), { test, beforeEach } = require("node:test"), fs = require("node:fs"), path = require("node:path"), Module = require("node:module"), ts = require("typescript");
const root = path.resolve(__dirname, ".."), resolve = Module._resolveFilename;
Module._resolveFilename = function (name, parent, ...rest) { return resolve.call(this, name.startsWith("@/") ? path.join(root, "src", name.slice(2)) : name, parent, ...rest); };
require.extensions[".ts"] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, file);
const mock = (relative, exports) => { const filename = path.join(root, relative); require.cache[filename] = { id: filename, filename, loaded: true, exports }; };
let authorized, reads, run, taskRows;
const runId = "sample-111563ab-3ccd-48b8-9751-929786947c62";
mock("src/lib/services/ranking-coverage-access.ts", { authorizeSavedRankingCoverage: async () => authorized });
mock("src/lib/database-read.ts", { retryDatabaseRead: action => action() });
mock("src/lib/prisma.ts", { prisma: {
  serpMonitorRun: { findUnique: async query => { reads.push({ kind: "run", query }); return run; } },
  $queryRaw: async query => { reads.push({ kind: "sql", text: query.strings.join("?"), values: query.values }); return query.strings.join("").includes("cohort-markets") ? [{ region: "US" }, { region: "JP" }] : taskRows; },
} });
const route = require("../src/app/api/seo/trends/history-export/route.ts");
const { historicalExportSelection, historicalExportTargets } = require("../src/lib/ranking-history-export.ts");
const request = query => new Request(`https://flatkey.test/api/seo/trends/history-export?runId=${runId}${query ?? ""}`);
beforeEach(t => {
  authorized = true; reads = []; taskRows = [];
  run = { id: runId, scope: "SAMPLE", periodKey: "2026-10-2", periodLabel: "2026年10月第2期 · 品牌与模型价格验证", periodStart: "2026-10-15T16:00:00Z", periodEnd: "2026-10-31T15:59:59Z", createdAt: "2026-10-16T07:16:02Z", cohortHash: "original-hash", targetCount: 38, queryCount: 152, status: "COMPLETED", cohortJson: [{ keywordId: "original-id", keyword: "gpu rental prices", siteDomain: "flatkey.ai", targetUrls: ["https://flatkey.ai/blog/real-page"] }] };
  t.mock.method(globalThis, "fetch", async () => { throw new Error("saved exports must never call providers"); });
});
test("history export requires the existing saved-ranking read authorization before database access", async () => {
  authorized = false;
  const response = await route.GET(request());
  assert.equal(response.status, 401); assert.deepEqual(reads, []); assert.equal(globalThis.fetch.mock.callCount(), 0);
  assert.equal(route.POST, undefined, "the export has no write handler");
});
test("only the fixed original three runs and bounded task pages can be selected", async () => {
  for (const query of ["runId=serp-cycle-2026-11-17", `runId=${runId}&limit=201`, `runId=${runId}&offset=-1`, `runId=${runId}&kind=cohort&offset=1`, `runId=${runId}&poll=1`]) {
    assert.throws(() => historicalExportSelection(new URLSearchParams(query)));
  }
  const response = await route.GET(request("&limit=10000")); assert.equal(response.status, 400); assert.deepEqual(reads, []);
});
test("the initial sample keeps its original key and snapshot while exposing its established first-issue label", async () => {
  const before = JSON.stringify(run), response = await route.GET(request("&kind=cohort")), body = await response.json();
  assert.equal(response.status, 200); assert.equal(body.run.displayLabel, "2026年10月第1期");
  assert.equal(body.cohorts[0].periodKey, "2026-10-2"); assert.equal(body.cohorts[0].runId, runId);
  assert.deepEqual(body.cohorts[0].targets, run.cohortJson); assert.deepEqual(body.cohorts[0].regions, ["US", "JP"]);
  assert.equal(body.run.originalQueryCount, 152); assert.equal(body.partial, false); assert.equal(body.newQueries, 0);
  assert.equal(JSON.stringify(run), before); assert.equal(globalThis.fetch.mock.callCount(), 0);
  assert.equal(Object.hasOwn(body.run, "cohortJson"), false);
});
test("saved task pages retain original period facts and a deterministic next offset without replaying captures", async () => {
  taskRows = [{ id: "task-a", runId, periodKey: "2026-10-2", region: "US", targetsJson: [], normalizedJson: { queryStatus: "EXACT" } }, { id: "task-b", runId }];
  const response = await route.GET(request("&limit=1")), body = await response.json();
  assert.equal(response.status, 200); assert.deepEqual(body.tasks, taskRows.slice(0, 1));
  assert.deepEqual(body.pagination, { offset: 0, limit: 1, nextOffset: 1 }); assert.equal(body.partial, true);
  const sql = reads.find(read => read.kind === "sql");
  assert.match(sql.text, /SELECT[\s\S]+ORDER BY t\.id LIMIT \? OFFSET \?/);
  assert.doesNotMatch(sql.text, /\b(?:INSERT|UPDATE|DELETE)\b/i); assert.equal(sql.values.at(-2), 2); assert.equal(sql.values.at(-1), 0);
  assert.match(sql.text, /language_code/); assert.match(sql.text, /depth/); assert.doesNotMatch(sql.text, /rawResponse|encryptedCredentials/);
  assert.equal(globalThis.fetch.mock.callCount(), 0);
});
test("cohort and task exports whitelist target fields without exposing saved JSON extensions or mutating their sources", async () => {
  const allowed = { keywordId: "original-id", keyword: "gpu rental prices", siteDomain: "flatkey.ai", targetUrls: ["https://flatkey.ai/blog/real-page"] };
  const saved = [{ ...allowed, targetUrls: [...allowed.targetUrls, { privateFixture: "nested-value" }, 123], privateFixture: "top-level-value", nested: { privateFixture: "nested-value" } },
    { ...allowed, siteDomain: "outside.example", privateFixture: "other-site-value" }, null, []];
  const before = JSON.stringify(saved);
  assert.deepEqual(historicalExportTargets(saved), [allowed]); assert.equal(JSON.stringify(saved), before);
  run = { ...run, cohortJson: saved };
  const cohort = await (await route.GET(request("&kind=cohort"))).json();
  assert.deepEqual(cohort.cohorts[0].targets, [allowed]);
  taskRows = [{ id: "task-a", runId, targetsJson: saved, normalizedJson: { queryStatus: "EXACT" } }];
  const tasks = await (await route.GET(request())).json();
  assert.deepEqual(tasks.tasks[0].targetsJson, [allowed]); assert.deepEqual(tasks.tasks[0].normalizedJson, { queryStatus: "EXACT" });
  assert.doesNotMatch(JSON.stringify({ cohort, tasks }), /privateFixture|top-level-value|nested-value|other-site-value/);
  assert.equal(JSON.stringify(saved), before); assert.equal(globalThis.fetch.mock.callCount(), 0);
});
test("a saved ledger identity mismatch fails closed and does not query its tasks", async () => {
  run = { ...run, periodKey: "2026-11-17" };
  const response = await route.GET(request()); assert.equal(response.status, 503);
  assert.equal(reads.length, 1); assert.equal(globalThis.fetch.mock.callCount(), 0);
});
