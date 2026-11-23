const assert = require("node:assert/strict"), { test } = require("node:test");
const fs = require("node:fs"), path = require("node:path"), os = require("node:os"), Module = require("node:module"), ts = require("typescript");
const root = path.resolve(__dirname, ".."), resolve = Module._resolveFilename, load = Module._load;
Module._resolveFilename = function (name, parent, ...rest) { return resolve.call(this, name.startsWith("@/") ? path.join(root, "src", name.slice(2)) : name, parent, ...rest); };
Module._load = function (name, ...rest) { if (name === "server-only") return {}; return load.call(this, name, ...rest); };
require.extensions[".ts"] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, file);
const { workflowListRecords, WORK_LIST_TASK_DETAIL_KEYS, WORK_LIST_APPROVAL_ITEM_DETAIL_KEYS } = require("../src/lib/seo-workflow-list.ts");
const { workflowSnapshot } = require("../src/lib/seo-workflow-state.ts");
const { workflowTaskHasProgress, approvalReviewReadiness } = require("../src/lib/seo-workflow.ts");
const { pendingTaskApproval } = require("../src/lib/seo-approval-display.ts");
const now = new Date("2026-11-23T03:00:00Z"), at = "2026-11-20T03:00:00Z";
const evidence = [{ label: "Desktop screenshot", url: "https://staging-website.flatkey.ai/desktop.png", observedAt: at }, { label: "Mobile screenshot", url: "https://staging-website.flatkey.ai/mobile.png", observedAt: at }];
const stored = { version: 3, recordedAt: at, updatedAt: at };
const task = (patch = {}) => ({ id: "task-main", weekStart: "2026-11-23", title: "模型页面更新", kind: "optimization", siteDomain: "flatkey.ai", business: "API", channel: "website", country: "US", language: "en", keyword: "model api", pageType: "landing", pageUrl: "https://flatkey.ai/models/test", status: "review_pending", owner: "Codex", source: "human", dueAt: "2026-11-23T07:00:00Z", contentVersion: "v3", nextAction: "等待审核", dependencies: [], evidence, research: { volume: 20, kd: 10, businessValue: 3, exceptionReason: null, intent: "核对模型参数", observedAt: at, evidence }, brief: { reason: "原因".repeat(1500), plan: "实施".repeat(1500) }, approval: null, acceptanceCriteria: ["正式页面验证"], progress: [{ id: "progress-main", sessionId: "session-main", observedAt: at, summary: "制作完成", nextAction: "等待审核", evidence }], ...stored, ...patch });
const approval = (patch = {}) => ({ id: "approval-main", weekStart: "2026-11-23", title: "待审页面", siteDomain: "flatkey.ai", submittedAt: at, status: "pending", supersedesApprovalIds: [], decisions: [], evidence, items: [{ id: "item-main", taskId: "task-main", pageUrl: "https://flatkey.ai/models/test", language: "en", contentVersion: "v3", operation: "update", previewUrl: "https://staging-website.flatkey.ai/models/test", previewContentVersion: "v3", evidence, reviewContent: "稿件".repeat(60000), beforeContent: "改前".repeat(60000), changeSummary: "更正模型参数" }], ...stored, ...patch });
const record = (kind, record) => ({ kind, record });
const sourceRows = () => [record("task", task()), record("approval", approval())];
const list = rows => workflowSnapshot(rows, { operational: true, workList: true }, "database", now);

test("list projection removes large detail bodies while keeping review readiness, progress and every list summary", t => {
  const rows = sourceRows(), original = structuredClone(rows), projected = workflowListRecords(rows);
  const full = list(rows), compact = list(projected);
  assert.deepEqual(compact.summary, full.summary);
  assert.deepEqual(compact.workWeek, full.workWeek);
  for (const key of ["tasks", "approvals"]) assert.deepEqual(compact[key].map(row => row.id), full[key].map(row => row.id));
  assert.equal(workflowTaskHasProgress(compact.tasks[0]), workflowTaskHasProgress(full.tasks[0]));
  const before = pendingTaskApproval(full.tasks[0], full.approvals), after = pendingTaskApproval(compact.tasks[0], compact.approvals);
  assert.equal(after.item.id, before.item.id);
  assert.deepEqual(approvalReviewReadiness(after.item), approvalReviewReadiness(before.item));
  for (const key of WORK_LIST_TASK_DETAIL_KEYS) assert.equal(Object.hasOwn(compact.tasks[0], key), false);
  for (const key of WORK_LIST_APPROVAL_ITEM_DETAIL_KEYS) assert.equal(Object.hasOwn(after.item, key), false);
  assert.deepEqual(rows, original, "projection must never mutate the canonical input graph");
  const beforeBytes = Buffer.byteLength(JSON.stringify(full)), afterBytes = Buffer.byteLength(JSON.stringify(compact));
  assert.ok(afterBytes < beforeBytes * 0.02);
  t.diagnostic(`Synthetic body-heavy task and approval snapshot: ${beforeBytes} -> ${afterBytes} bytes (${(100 * (1 - afterBytes / beforeBytes)).toFixed(2)}% smaller); not a production timing measurement.`);
});

test("carried, future, deleted, dependent and post-publication rollback tasks retain their original list membership", () => {
  const publication = { id: "pub-main", taskId: "task-main", weekStart: "2026-11-16", siteDomain: "rackrate.org", kind: "landing", pageUrl: "https://rackrate.org/gpu/test", language: "en", contentVersion: "v3", publicationPolicy: "cluster_post_review", status: "verified", publishedAt: at, clusterRelease: { repository: "owned/repo", commitSha: "a".repeat(40) }, ...stored };
  const postReview = approval({ siteDomain: "rackrate.org", decisions: [{ itemIds: ["item-main"], decision: "rejected", recordedAt: at, note: "修正参数" }] });
  postReview.items[0] = { ...postReview.items[0], pageUrl: publication.pageUrl, postPublicationId: publication.id };
  const rows = [record("task", task({ weekStart: "2026-11-16", siteDomain: "rackrate.org", pageUrl: publication.pageUrl, status: "verified" })), record("approval", postReview), record("publication", publication), record("task", task({ id: "future", weekStart: "2026-11-30", dueAt: "2026-11-30T07:00:00Z", dependencies: ["task-main"] })), record("task", task({ id: "deleted", deletedAt: at }))];
  const full = list(rows), compact = list(workflowListRecords(rows));
  assert.deepEqual(compact.workWeek, full.workWeek);
  assert.deepEqual(compact.summary, full.summary);
  assert.deepEqual(compact.tasks.map(row => row.id), ["task-main", "future"]);
  assert.deepEqual(compact.tasks.map(row => row.id), full.tasks.map(row => row.id));
  assert.deepEqual(compact.publications, full.publications);
  assert.deepEqual(compact.workWeek.pendingRollbackTaskIds, ["task-main"]);
});

test("database list reads project JSON before transfer; full snapshots retain their complete payloads", async t => {
  const calls = [], rows = sourceRows();
  const prismaPath = require.resolve("../src/lib/prisma.ts");
  require.cache[prismaPath] = { id: prismaPath, filename: prismaPath, loaded: true, exports: { prisma: {
    $queryRaw: async query => { calls.push(query); return workflowListRecords(rows).map(row => ({ kind: row.kind, payload: row.record })); },
    seoWorkflowRecord: { findMany: async options => { calls.push(options); return rows.map(row => ({ kind: row.kind, payload: row.record })); } },
  } } };
  const saved = process.env.DATABASE_URL; process.env.DATABASE_URL = "postgresql://test.invalid/test";
  t.after(() => { if (saved === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = saved; });
  const { loadWorkflowSnapshot } = require("../src/lib/services/seo-workflow.ts");
  const compact = await loadWorkflowSnapshot({ operational: true, workList: true });
  assert.match(calls[0].sql, /workflow:work-list/);
  assert.match(calls[0].sql, /payload - \?::text\[\]/);
  assert.match(calls[0].sql, /jsonb_agg\(item - \?::text\[\] ORDER BY position\)/);
  assert.deepEqual(calls[0].values, [WORK_LIST_TASK_DETAIL_KEYS, WORK_LIST_APPROVAL_ITEM_DETAIL_KEYS]);
  assert.equal(compact.tasks[0].research, undefined);
  const full = await loadWorkflowSnapshot({ allHistory: true });
  assert.deepEqual(calls[1].select, { kind: true, payload: true });
  assert.deepEqual(full.tasks[0].research, rows[0].record.research);
  assert.equal(full.approvals[0].items[0].reviewContent, rows[1].record.items[0].reviewContent);
});

test("local-preview list matches the lean contract while task detail remains complete for review and editing", async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "workflow-list-")), rows = sourceRows();
  fs.writeFileSync(path.join(directory, "workflow.json"), JSON.stringify({ records: rows, events: [] }));
  const saved = process.env.SEO_WORKFLOW_PREVIEW_DIR; process.env.SEO_WORKFLOW_PREVIEW_DIR = directory;
  t.after(() => { fs.rmSync(directory, { recursive: true, force: true }); if (saved === undefined) delete process.env.SEO_WORKFLOW_PREVIEW_DIR; else process.env.SEO_WORKFLOW_PREVIEW_DIR = saved; });
  const { loadWorkflowSnapshot, loadWorkflowTaskDetail } = require("../src/lib/services/seo-workflow.ts");
  const compact = await loadWorkflowSnapshot({ operational: true, workList: true }, true);
  assert.equal(compact.tasks[0].brief, undefined);
  const detail = await loadWorkflowTaskDetail("task-main", true);
  assert.equal(detail.task.brief.reason, rows[0].record.brief.reason);
  assert.equal(detail.approvals[0].items[0].reviewContent, rows[1].record.items[0].reviewContent);
});
