const assert = require("node:assert/strict"), { test } = require("node:test");
const fs = require("node:fs"), path = require("node:path"), os = require("node:os"), Module = require("node:module"), ts = require("typescript");
const root = path.resolve(__dirname, ".."), resolve = Module._resolveFilename, load = Module._load;
Module._resolveFilename = function (name, parent, ...rest) { return resolve.call(this, name.startsWith("@/") ? path.join(root, "src", name.slice(2)) : name, parent, ...rest); };
Module._load = function (name, ...rest) { if (name === "server-only") return {}; return load.call(this, name, ...rest); };
require.extensions[".ts"] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, file);
const { parseWorkflowWorkPageQuery, workflowWorkList, workflowWorkPage } = require("../src/lib/seo-workflow-list.ts");
const baseline = require("./fixtures/workflow-list-reference.ts");
const { workTaskHref } = require("../src/lib/seo-workspace-routes.ts");
const { workflowSnapshot } = require("../src/lib/seo-workflow-state.ts");
const now = new Date("2026-11-23T03:00:00Z"), at = "2026-11-20T03:00:00Z";
const evidence = [{ label: "Desktop screenshot", url: "https://staging-website.flatkey.ai/desktop.png", observedAt: at }, { label: "Mobile screenshot", url: "https://staging-website.flatkey.ai/mobile.png", observedAt: at }];
const stored = { version: 3, recordedAt: at, updatedAt: at };
const task = (patch = {}) => ({ id: "task-main", weekStart: "2026-11-23", title: "模型页面更新", kind: "optimization", siteDomain: "flatkey.ai", business: "API", channel: "website", country: "US", language: "en", keyword: "model api", pageType: "landing", pageUrl: "https://flatkey.ai/models/test", status: "review_pending", owner: "Codex", source: "human", dueAt: "2026-11-23T07:00:00Z", contentVersion: "v3", nextAction: "等待审核", dependencies: [], evidence, research: { volume: 20, kd: 10, businessValue: 3, exceptionReason: null, intent: "核对模型参数", observedAt: at, evidence }, brief: { reason: "原因".repeat(1500), plan: "实施".repeat(1500) }, approval: null, acceptanceCriteria: ["正式页面验证"], progress: [{ id: "progress-main", sessionId: "session-main", observedAt: at, summary: "制作完成", nextAction: "等待审核", evidence }], ...stored, ...patch });
const approval = (patch = {}) => ({ id: "approval-main", weekStart: "2026-11-23", title: "待审页面", siteDomain: "flatkey.ai", submittedAt: at, status: "pending", supersedesApprovalIds: [], decisions: [], evidence, items: [{ id: "item-main", taskId: "task-main", pageUrl: "https://flatkey.ai/models/test", language: "en", contentVersion: "v3", operation: "update", previewUrl: "https://staging-website.flatkey.ai/models/test", previewContentVersion: "v3", evidence, reviewContent: "稿件".repeat(60000), beforeContent: "改前".repeat(60000), changeSummary: "更正模型参数" }], ...stored, ...patch });
const record = (kind, record) => ({ kind, record });
const sourceRows = () => [record("task", task()), record("approval", approval())];
const list = rows => workflowSnapshot(rows, { operational: true, workList: true }, "database", now);

function equalDisplay(snapshot, dto) {
  const reviews = baseline.multilingualReviews(snapshot);
  assert.deepEqual(dto.summary, snapshot.summary);
  assert.deepEqual(dto.workWeek, snapshot.workWeek);
  assert.deepEqual(dto.tasks.map(row => row.id), snapshot.tasks.map(row => row.id));
  const filters = new URLSearchParams({ country: "JP", taskType: "landing-update", status: "all", range: "week", q: "api" });
  for (const task of snapshot.tasks) {
    const row = dto.tasks.find(row => row.id === task.id), review = reviews.get(task.id);
    assert.equal(row.displayStatus, baseline.workTaskStatus(task, snapshot));
    assert.deepEqual(row.review, review ? { id: review.approval.id, title: review.approval.title, key: review.key, languages: review.languages } : null);
    assert.equal(workTaskHref(row, filters), workTaskHref(task, filters));
    for (const key of ["id", "weekStart", "title", "siteDomain", "business", "country", "language", "kind", "pageType", "pageUrl", "keyword", "owner", "dueAt", "nextAction", "failureReason"]) assert.deepEqual(row[key], task[key]);
  }
  for (const state of ["active", "all", "scheduled", "accepted", "review", "rejected", "failed", "completed"]) {
    const before = snapshot.tasks.filter(task => state === "all" || (state === "active" ? baseline.workTaskStatus(task, snapshot) !== "completed" : baseline.workTaskStatus(task, snapshot) === state)).map(row => row.id);
    const after = dto.tasks.filter(task => state === "all" || (state === "active" ? task.displayStatus !== "completed" : task.displayStatus === state)).map(row => row.id);
    assert.deepEqual(after, before);
  }
  // Review-title search and language grouping must retain the exact old rows.
  for (const query of ["", "待审", "api", "Codex"]) {
    const before = snapshot.tasks.filter(task => [task.title, task.keyword, task.pageUrl, task.owner, reviews.get(task.id)?.approval.title].some(value => value?.toLowerCase().includes(query.toLowerCase())));
    const after = dto.tasks.filter(task => [task.title, task.keyword, task.pageUrl, task.owner, task.review?.title].some(value => value?.toLowerCase().includes(query.toLowerCase())));
    const merge = (tasks, reviewFor) => { const seen = new Set(); return tasks.filter(task => { const key = reviewFor(task)?.key; if (!key) return true; if (seen.has(key)) return false; seen.add(key); return true; }).map(task => task.id); };
    assert.deepEqual(merge(after, task => task.review), merge(before, task => reviews.get(task.id)));
  }
}

test("explicit list DTO keeps all display rules and drops the graph only after the canonical snapshot", t => {
  const rows = sourceRows(), original = structuredClone(rows), snapshot = list(rows), dto = workflowWorkList(snapshot);
  equalDisplay(snapshot, dto);
  assert.equal(dto.format, "list");
  for (const key of ["approvals", "publications", "runs", "issues", "optimizations", "historicalImports", "plan"]) assert.equal(Object.hasOwn(dto, key), false);
  for (const key of ["research", "brief", "progress", "evidence", "approval", "acceptanceCriteria"]) assert.equal(Object.hasOwn(dto.tasks[0], key), false);
  assert.deepEqual(rows, original);
  const beforeBytes = Buffer.byteLength(JSON.stringify(snapshot)), afterBytes = Buffer.byteLength(JSON.stringify(dto));
  assert.ok(afterBytes < beforeBytes * 0.02);
  t.diagnostic(`Synthetic body-heavy full snapshot -> list DTO: ${beforeBytes} -> ${afterBytes} bytes; not a production timing measurement.`);
});

test("all statuses, cross-week carry, future tasks, deleted records, dependencies and rollback retain the original display", () => {
  const publication = { id: "pub-main", taskId: "task-main", weekStart: "2026-11-16", siteDomain: "rackrate.org", kind: "landing", pageUrl: "https://rackrate.org/gpu/test", language: "en", contentVersion: "v3", publicationPolicy: "cluster_post_review", status: "verified", publishedAt: at, clusterRelease: { repository: "owned/repo", commitSha: "a".repeat(40) }, ...stored };
  const postReview = approval({ siteDomain: "rackrate.org", decisions: [{ itemIds: ["item-main"], decision: "changes_requested", recordedAt: at, note: "修正参数" }] });
  postReview.items[0] = { ...postReview.items[0], pageUrl: publication.pageUrl, postPublicationId: publication.id };
  const rows = [record("task", task({ weekStart: "2026-11-16", siteDomain: "rackrate.org", pageUrl: publication.pageUrl, status: "verified" })), record("approval", postReview), record("publication", publication), record("task", task({ id: "future", weekStart: "2026-11-30", dueAt: "2026-11-30T07:00:00Z", dependencies: ["task-main"] })), record("task", task({ id: "deleted", deletedAt: at }))];
  for (const [id, status, extra] of [["planned", "planned", { progress: [], evidence: [], contentVersion: null }], ["failed", "failed", {}], ["observing", "observing", {}], ["research-empty", "researching", { kind: "research", progress: [], evidence: [], contentVersion: null }], ["technical-progress", "researching", { kind: "technical", progress: [], contentVersion: null, evidence: [{ label: "核对", artifact: "check", observedAt: "2026-11-21T03:00:00Z" }] }]]) rows.push(record("task", task({ id, status, ...extra })));
  const snapshot = list(rows), dto = workflowWorkList(snapshot);
  equalDisplay(snapshot, dto);
  assert.deepEqual(snapshot.workWeek.pendingRollbackTaskIds, ["task-main"]);
  assert.ok(dto.tasks.find(row => row.id === "future"));
  assert.equal(dto.tasks.some(row => row.id === "deleted"), false);
});

test("multilingual pending reviews, missing materials, superseded/rejected versions and verified publications match the old UI", () => {
  const en = task(), ja = task({ id: "task-ja", pageUrl: "https://flatkey.ai/ja/models/test", country: "JP", language: "ja" });
  const review = approval(); review.items.push({ ...review.items[0], id: "item-ja", taskId: ja.id, pageUrl: ja.pageUrl, language: "ja" });
  const rows = [record("task", en), record("task", ja), record("approval", review)];
  let snapshot = list(rows), dto = workflowWorkList(snapshot);
  equalDisplay(snapshot, dto);
  assert.deepEqual(dto.tasks[0].review.languages, ["en", "ja"]);
  assert.equal(dto.tasks[0].review.key, dto.tasks[1].review.key);
  for (const decision of ["rejected", "approved", "changes_requested"]) {
    review.decisions = [{ itemIds: ["item-main"], decision }]; snapshot = list(rows); dto = workflowWorkList(snapshot); equalDisplay(snapshot, dto);
  }
  review.decisions = []; review.items[0].evidence = [];
  snapshot = list(rows); dto = workflowWorkList(snapshot); equalDisplay(snapshot, dto);
  assert.notEqual(dto.tasks.find(row => row.id === en.id).displayStatus, "review");
  rows.push(record("publication", { id: "pub-verified", weekStart: en.weekStart, taskId: en.id, siteDomain: en.siteDomain, status: "verified", kind: "source_blog", contentVersion: en.contentVersion, pageUrl: en.pageUrl, publishedAt: at }));
  rows.push(record("approval", { ...approval({ id: "replacement", status: "approved", supersedesApprovalIds: [review.id] }), decisions: [{ itemIds: ["item-main"], decision: "approved" }] }));
  snapshot = list(rows); dto = workflowWorkList(snapshot); equalDisplay(snapshot, dto);
  assert.equal(dto.tasks.find(row => row.id === en.id).displayStatus, "completed");
});

test("paginated work list groups a multilingual review once across pages and searches its title", () => {
  const en = task(), ja = task({ id: "task-ja", pageUrl: "https://flatkey.ai/ja/models/test", country: "JP", language: "ja" });
  const review = approval();
  review.items.push({ ...review.items[0], id: "item-ja", taskId: ja.id, pageUrl: ja.pageUrl, language: "ja" });
  const other = Array.from({ length: 12 }, (_, index) => record("task", task({ id: `separate-${index}`, title: "另一个任务", contentVersion: null, status: "planned" })));
  const snapshot = list([record("task", en), record("task", ja), record("approval", review), ...other]);
  const page = query => workflowWorkPage(snapshot, parseWorkflowWorkPageQuery(new URLSearchParams(query)));
  const first = page("page=1&range=all"), second = page("page=2&range=all");
  assert.equal(first.pagination.total, 13);
  assert.deepEqual([first.tasks.length, second.tasks.length], [10, 3]);
  assert.equal([...first.tasks, ...second.tasks].filter(row => row.review).length, 1);
  const matching = page("page=1&range=all&q=待审页面&status=review&country=JP&language=ja&business=API&taskType=landing-update");
  assert.deepEqual(matching.tasks.map(row => row.id), [ja.id]);
  assert.deepEqual(matching.tasks[0].review.languages, ["en", "ja"]);
  assert.equal(page("page=1&range=custom&rangeStart=2026-11-24&rangeEnd=2026-11-24").pagination.total, 0);
});

test("next business-week board shows actual cross-bucket tasks and only the saved plan's gaps", () => {
  const friday = task({ id: "original-friday", source: "automation", status: "ready", dueAt: "2026-11-27T11:00:00+08:00" });
  const thursday = task({ id: "new-thursday", weekStart: "2026-11-30", source: "automation", status: "ready", dueAt: "2026-12-03T11:00:00+08:00" });
  const overdue = task({ id: "overdue", source: "automation", status: "ready" });
  const previousPlan = record("plan", { ...stored, id: "old-plan", weekStart: "2026-11-23", status: "scheduled",
    targets: { cadence: "workdays" }, taskIds: [friday.id, overdue.id], gaps: [{ category: "optimizedPages", count: 99 }] });
  const range = { start: "2026-11-27", end: "2026-12-03" };
  const nextPlan = record("plan", { ...stored, id: "next-plan", version: 1, weekStart: "2026-11-30", status: "scheduled",
    targets: { cadence: "growth", executionRange: range }, taskIds: [friday.id, thursday.id], notes: "11/30 核对证据\n12/01 补证后安排", gaps: [
      { category: "modelFitBlogs", date: "2026-12-01", count: 1, siteDomain: "modelfit.cc" },
      { category: "modelFitBlogs", date: "2026-11-30", count: 1, siteDomain: "modelfit.cc" },
      { category: "optimizedPages", count: 10 },
    ] });
  const rows = [previousPlan, nextPlan, ...[friday, thursday, overdue].map(value => record("task", value))];
  const page = (query, records = rows) => {
    const filter = parseWorkflowWorkPageQuery(new URLSearchParams(query));
    const snapshot = workflowSnapshot(records, { operational: true, workList: true, boardDates: filter }, "database", now);
    return workflowWorkPage(snapshot, filter);
  };
  const next = page("page=1&range=nextWeek");
  assert.deepEqual(next.tasks.map(row => row.id), [friday.id, thursday.id]);
  assert.deepEqual(next.workBoardPlan, { range, plan: { id: "next-plan", version: 1, taskIds: [friday.id, thursday.id],
    gaps: [{ category: "modelFitBlogs", count: 2 }, { category: "optimizedPages", count: 10 }], notes: nextPlan.record.notes,
    datedGaps: ["2026-11-30", "2026-12-01"].map(date => ({ date, gaps: [{ category: "modelFitBlogs", count: 1, siteDomain: "modelfit.cc" }] })) } });
  assert.deepEqual(page("page=1&range=custom&rangeStart=2026-11-27&rangeEnd=2026-12-03").workBoardPlan, next.workBoardPlan);
  assert.deepEqual(page("page=1&range=nextWeek&q=none").workBoardPlan, next.workBoardPlan);
  assert.equal(page("page=1&range=month").workBoardPlan, undefined);
  assert.deepEqual(page("page=1&range=nextWeek", rows.filter(row => row !== nextPlan)).workBoardPlan, { range, plan: null });
  assert.equal(workflowSnapshot(rows, { operational: true }, "database", now).tasks.some(row => row.id === friday.id), false);
});

test("list/full service reads use the original simple select and preserve canonical details", async t => {
  const calls = [], rows = sourceRows();
  const prismaPath = require.resolve("../src/lib/prisma.ts");
  require.cache[prismaPath] = { id: prismaPath, filename: prismaPath, loaded: true, exports: { prisma: {
    $queryRaw: async () => assert.fail("list loading must not run full-table JSON rewriting"),
    seoWorkflowRecord: { findMany: async options => { calls.push(options); return rows.map(row => ({ kind: row.kind, payload: row.record })); } },
  } } };
  const saved = process.env.DATABASE_URL; process.env.DATABASE_URL = "postgresql://test.invalid/test";
  t.after(() => { if (saved === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = saved; });
  const { loadWorkflowSnapshot } = require("../src/lib/services/seo-workflow.ts");
  const full = await loadWorkflowSnapshot({ operational: true, workList: true });
  assert.deepEqual(calls[0], { where: { kind: { in: Object.keys(require("../src/lib/seo-workflow.ts").WORKFLOW_SCHEMAS) } }, select: { kind: true, payload: true }, orderBy: { updatedAt: "desc" } });
  assert.deepEqual(full.tasks[0].research, rows[0].record.research);
  assert.equal(full.approvals[0].items[0].reviewContent, rows[1].record.items[0].reviewContent);
  equalDisplay(full, workflowWorkList(full));
  const { withRequestReads } = require("../src/lib/request-read-scope.ts");
  const optionsList = [{}, { week: "next" }, { allHistory: true }, { week: "2026-11-23" }, { operational: true, workList: true }];
  const reference = await Promise.all(optionsList.map(options => loadWorkflowSnapshot(options)));
  const before = calls.length;
  await withRequestReads(async () => {
    const views = await Promise.all(optionsList.map(options => loadWorkflowSnapshot(options)));
    assert.equal(views.length, 5);
    const stable = view => ({ ...view, generatedAt: null, ...(view.workWeek ? { workWeek: { ...view.workWeek, asOf: null } } : {}) });
    assert.deepEqual(views.map(stable), reference.map(stable));
    assert.equal(calls.length, before + 1, "five report projections share one canonical database read");
  });
  await withRequestReads(() => loadWorkflowSnapshot({}));
  assert.equal(calls.length, before + 2, "a new HTTP read never inherits the prior request's snapshot");
});

test("local preview and task detail retain the complete canonical record", async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "workflow-list-")), rows = sourceRows();
  fs.writeFileSync(path.join(directory, "workflow.json"), JSON.stringify({ records: rows, events: [] }));
  const saved = process.env.SEO_WORKFLOW_PREVIEW_DIR; process.env.SEO_WORKFLOW_PREVIEW_DIR = directory;
  t.after(() => { fs.rmSync(directory, { recursive: true, force: true }); if (saved === undefined) delete process.env.SEO_WORKFLOW_PREVIEW_DIR; else process.env.SEO_WORKFLOW_PREVIEW_DIR = saved; });
  const { loadWorkflowSnapshot, loadWorkflowTaskDetail } = require("../src/lib/services/seo-workflow.ts");
  const full = await loadWorkflowSnapshot({ operational: true, workList: true }, true);
  assert.deepEqual(full.tasks[0].brief, rows[0].record.brief);
  const detail = await loadWorkflowTaskDetail("task-main", true);
  assert.equal(detail.task.brief.reason, rows[0].record.brief.reason);
  assert.equal(detail.approvals[0].items[0].reviewContent, rows[1].record.items[0].reviewContent);
});
