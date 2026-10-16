const assert = require("node:assert/strict");
const { test, beforeEach } = require("node:test");
const fs = require("node:fs"), path = require("node:path"), Module = require("node:module"), ts = require("typescript");
const root = path.resolve(__dirname, ".."), resolve = Module._resolveFilename;
Module._resolveFilename = function (name, parent, ...rest) { return resolve.call(this, name.startsWith("@/") ? path.join(root, "src", name.slice(2)) : name, parent, ...rest); };
require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, filename);
let state;
const db = {
  $transaction: async callback => { const before = structuredClone(state); try { return await callback(db); } catch (error) { state = before; throw error; } },
  $executeRaw: async query => {
    if (!query.sql?.includes("keyword-page-tasks:merge-existing")) return 0;
    if (state.concurrentEdit) return 0;
    const rows = JSON.parse(query.values.find(value => typeof value === "string" && value.startsWith("[{")));
    for (const row of rows) {
      const prior = state.tasks.find(task => task.id === row.id);
      const { expectedUpdatedAt, dueAt, ...changes } = row;
      assert.equal(prior.updatedAt.toISOString(), expectedUpdatedAt);
      Object.assign(prior, changes, { dueAt: dueAt ? new Date(dueAt) : null, updatedAt: new Date("2026-10-16T09:01:00.000Z") });
    }
    return rows.length;
  },
  seoSite: { findUnique: async () => ({ active: true }) },
  siteKeyword: { findMany: async () => state.members },
  keywordSourceRow: { findMany: async () => state.snapshots, create: async ({ data }) => { if (state.failSnapshot) throw new Error("snapshot failure"); state.receipts.push(structuredClone(data)); } },
  keywordContentTask: { findMany: async () => state.tasks, createMany: async ({ data }) => { state.tasks.push(...data.map(row => ({ ...row, updatedAt: new Date("2026-10-16T09:01:00.000Z") }))); } },
};
const prismaPath = path.join(root, "src/lib/prisma.ts");
require.cache[prismaPath] = { id: prismaPath, filename: prismaPath, loaded: true, exports: { prisma: db } };
const { mergeKeywordPageTasks } = require("../src/lib/services/keyword-page-tasks.ts");
const { POST } = require("../src/app/api/keywords/okr/tasks/route.ts");
beforeEach(() => {
  process.env.DATABASE_URL = "postgresql://test.invalid/tasks";
  const workPlan = { originalVerdict: "CONTENT_GAP", action: "EXPAND", pageUrls: ["https://flatkey.ai/current"], previousPageUrl: "https://flatkey.ai/old", proposedTitle: "Current page setup and costs",
    requirements: ["Explain exact setup and conditions.", "Show runnable request and response.", "Include dated primary source links."], acceptance: ["All examples reproduce the requested behavior.", "The intended model has a separate price row."] };
  state = { members: [{ keywordId: "word", keyword: { text: "model API pricing" } }],
    snapshots: [{ rowKey: "keyword:word", snapshot: { keywordId: "word", keyword: "model API pricing", verdict: "CONTENT_GAP", checkedAt: "2026-10-16T09:00:00.000Z", workPlan } }],
    tasks: [{ id: "old-task", plannedUrl: "https://flatkey.ai/old", type: "NEW", status: "IN_PROGRESS", title: "Manual title", reason: "Manual reason", keywords: ["model API pricing"], targetUrls: [], owner: "Alice", dueAt: new Date("2026-11-01T00:00:00.000Z"), updatedAt: new Date("2026-10-16T09:00:00.000Z") }], receipts: [] };
});

test("preview is read-only; apply reuses the task and preserves manual fields; identical replay writes nothing", async () => {
  const before = structuredClone(state);
  const preview = await mergeKeywordPageTasks({ siteDomain: "flatkey.ai", action: "preview" });
  assert.deepEqual(state, before);
  assert.equal(preview.summary.reused, 1);
  assert.deepEqual(preview.conflicts, []);
  await mergeKeywordPageTasks({ siteDomain: "flatkey.ai", action: "apply", expectedStateHash: preview.stateHash });
  assert.equal(state.tasks.length, 1);
  assert.equal(state.tasks[0].plannedUrl, "https://flatkey.ai/current");
  assert.equal(state.tasks[0].owner, "Alice");
  assert.equal(state.tasks[0].status, "IN_PROGRESS");
  assert.equal(state.tasks[0].title, "Manual title");
  assert.equal(state.tasks[0].reason, "Manual reason");
  assert.equal(state.tasks[0].dueAt.toISOString(), "2026-11-01T00:00:00.000Z");
  assert.equal(state.receipts.length, 1);
  assert.deepEqual(state.receipts[0].snapshot.before[0].keywords, ["model API pricing"]);
  assert.deepEqual(state.members, before.members);
  assert.deepEqual(state.snapshots, before.snapshots);
  const after = structuredClone(state);
  const replay = await mergeKeywordPageTasks({ siteDomain: "flatkey.ai", action: "apply", expectedStateHash: preview.stateHash });
  assert.equal(replay.summary.updated, 0);
  assert.equal(replay.summary.created, 0);
  assert.deepEqual(state, after);
});

test("changed manual state invalidates preview and concurrent updates roll back creates and snapshots", async () => {
  const preview = await mergeKeywordPageTasks({ siteDomain: "flatkey.ai", action: "preview" });
  state.tasks[0].owner = "Bob";
  await assert.rejects(mergeKeywordPageTasks({ siteDomain: "flatkey.ai", action: "apply", expectedStateHash: preview.stateHash }), /重新预览/);
  assert.equal(state.tasks[0].owner, "Bob");
  assert.equal(state.receipts.length, 0);
  const fresh = await mergeKeywordPageTasks({ siteDomain: "flatkey.ai", action: "preview" });
  state.concurrentEdit = true;
  const before = structuredClone(state);
  await assert.rejects(mergeKeywordPageTasks({ siteDomain: "flatkey.ai", action: "apply", expectedStateHash: fresh.stateHash }), /其他操作修改/);
  assert.deepEqual(state, before);
});

test("failure writing the recovery snapshot rolls back task mutations", async () => {
  state.failSnapshot = true;
  const before = structuredClone(state);
  const preview = await mergeKeywordPageTasks({ siteDomain: "flatkey.ai", action: "preview" });
  await assert.rejects(mergeKeywordPageTasks({ siteDomain: "flatkey.ai", action: "apply", expectedStateHash: preview.stateHash }), /snapshot failure/);
  assert.deepEqual(state, before);
});

test("invalid identities, mismatched verdicts and arbitrary task payloads cannot change tasks", async () => {
  state.snapshots[0].snapshot.verdict = "VERIFIED";
  await assert.rejects(mergeKeywordPageTasks({ siteDomain: "flatkey.ai", action: "preview" }), /核验和工作清单不一致/);
  for (const body of [{ siteDomain: "rackrate.org", action: "apply" }, { siteDomain: "flatkey.ai", action: "apply", tasks: [{ title: "unreviewed" }] }]) {
    const result = await POST(new Request("http://localhost/api/keywords/okr/tasks", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }));
    assert.equal(result.status, 400);
  }
  assert.equal(state.receipts.length, 0);
});
