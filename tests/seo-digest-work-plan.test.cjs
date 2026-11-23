const { test } = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), ts = require("typescript");
require.extensions[".ts"] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, file);
const { digestExecutionWeek, digestReportExecutionWeek, digestExecutionPeriod, summarizeDigestWorkPlan } = require("../src/lib/seo-digest-work-plan.ts");
const { buildSeoDigest, digestWindow } = require("../src/lib/seo-digest.ts");
const task = (id, weekStart, dueAt, patch = {}) => ({ id, weekStart, dueAt, siteDomain: "flatkey.ai", kind: "blog", title: id,
  pageUrl: null, keyword: id, country: "US", language: "en", owner: "AI", status: "ready", nextAction: "核对原任务后执行", ...patch });
const snapshot = (weekStart, tasks, taskIds) => ({ weekStart, tasks, approvals: [], plan: { weekStart, taskIds, status: "scheduled",
  targets: { apiBlogs: 10, gpuBlogs: 15, landing: 0, optimizedPages: 10, clusterLanding: 7 } } });

test("execution cycles use Friday and Monday–Thursday without changing the LA traffic week", () => {
  assert.equal(digestExecutionWeek("2026-11-19", "weekly"), "2026-11-16");
  assert.equal(digestExecutionWeek("2026-11-20", "weekly"), "2026-11-16");
  assert.equal(digestExecutionWeek("2026-11-20", "daily"), "2026-11-23");
  assert.equal(digestExecutionWeek("2026-11-23", "daily"), "2026-11-23");
  assert.deepEqual(digestExecutionPeriod("2026-11-23"), { start: "2026-11-20", end: "2026-11-26",
    workdays: ["2026-11-20", "2026-11-23", "2026-11-24", "2026-11-25", "2026-11-26"] });
  const window = digestWindow("2026-11-19", "weekly");
  assert.equal(window.trafficStart, "2026-11-12"); assert.equal(window.trafficEnd, "2026-11-18");
  assert.equal(window.executionStart, "2026-11-13T00:00:00+08:00");
  assert.equal(window.executionEnd, "2026-11-20T00:00:00+08:00");
});

test("daily plans follow their actual source day across the Thursday-to-Friday cycle boundary", () => {
  assert.equal(digestReportExecutionWeek("2026-11-20", "daily"), "2026-11-16", "Friday collection reports Thursday's cycle");
  assert.equal(digestReportExecutionWeek("2026-11-21", "daily"), "2026-11-23", "Saturday archive reports Friday's new cycle");
  assert.equal(digestReportExecutionWeek("2026-11-23", "daily"), "2026-11-23", "Sunday remains its own source day in the new cycle");
  assert.equal(digestReportExecutionWeek("2026-11-19", "weekly"), "2026-11-16");
});

test("plans include prior Friday, preserve original links and distinguish real candidates", () => {
  const friday = task("friday", "2026-11-16", "2026-11-20T10:15:00+08:00");
  const monday = task("monday", "2026-11-23", "2026-11-23T10:15:00+08:00");
  const mfBlog = task("mf-blog", "2026-11-23", "2026-11-24T10:15:00+08:00", { siteDomain: "modelfit.cc" });
  const mfOptimization = task("mf-optimization", "2026-11-23", "2026-11-25T10:15:00+08:00", { siteDomain: "modelfit.cc", kind: "optimization" });
  const nextFriday = task("next-friday", "2026-11-23", "2026-11-27T10:15:00+08:00");
  const unplanned = task("unplanned", "2026-11-23", "2026-11-26T10:15:00+08:00");
  const candidate = task("candidate", "2026-11-23", "2026-11-26T10:15:00+08:00", { kind: "research", status: "researching" });
  const product = task("product", "2026-11-23", "2026-11-26T10:15:00+08:00", { channel: "product" });
  const weekend = task("weekend", "2026-11-16", "2026-11-22T10:15:00+08:00", { kind: "research", status: "planned" });
  const tasks = [friday, monday, mfBlog, mfOptimization, nextFriday, unplanned, candidate, product, weekend];
  const plan = summarizeDigestWorkPlan([snapshot("2026-11-16", tasks, ["friday"]),
    snapshot("2026-11-23", tasks, ["monday", "mf-blog", "mf-optimization", "next-friday", "product"])], "2026-11-23");
  assert.deepEqual(plan.tasks.map(task => task.id), ["friday", "monday", "mf-blog", "mf-optimization", "candidate"]);
  assert.equal(plan.tasks[0].weekStart, "2026-11-16"); assert.equal(plan.tasks[0].scheduled, true);
  assert.equal(plan.tasks.at(-1).scheduled, false);
  assert.equal(plan.tasks[2].kind, "blog"); assert.equal(plan.tasks[3].kind, "optimization");
  assert.equal(plan.periodStart, "2026-11-20"); assert.equal(plan.periodEnd, "2026-11-26");
  assert.equal(plan.targets.blogs, 25);
});

test("weekly delivery counts use the Beijing execution cycle while traffic retains LA dates", () => {
  const publication = (id, stamp) => ({ id, title: id, url: "https://flatkey.ai/blog/" + id, kind: "source", publishedAt: stamp, verifiedAt: stamp, recordedAt: stamp });
  const report = buildSeoDigest({ date: "2026-11-19", kind: "weekly", now: new Date("2026-11-20T00:00:00+08:00"),
    publications: [publication("before", "2026-11-12T15:59:59Z"), publication("first", "2026-11-12T16:00:00Z"),
      publication("last", "2026-11-19T15:59:59Z"), publication("after", "2026-11-19T16:00:00Z")],
    optimizations: [], observations: [], effects: [], priorities: [], issues: [], runNotes: [], publicationCoverage: "verified", optimizationCoverage: "verified" });
  assert.equal(report.counts.originals, 2);
  assert.deepEqual(report.executionWindow, { start: "2026-11-13T00:00:00+08:00", end: "2026-11-20T00:00:00+08:00", timezone: "Asia/Shanghai" });
  const expected = digestWindow("2026-11-19", "weekly");
  assert.deepEqual(report.workWindow, { start: expected.workStart, end: expected.workEnd }, "preserve the original weekly claim and archive binding");
  assert.deepEqual(report.reportPeriod, { start: "2026-11-12", end: "2026-11-18", timezone: "America/Los_Angeles" });
});

test("unplanned research stays visible as a candidate when no formal plan exists", () => {
  const candidate = task("candidate-only", "2026-11-23", "2026-11-24T10:15:00+08:00", { kind: "research", status: "planned" });
  const plan = summarizeDigestWorkPlan([{ ...snapshot("2026-11-23", [candidate], []), plan: null }], "2026-11-23");
  assert.equal(plan.status, "draft"); assert.equal(plan.targets, undefined);
  assert.equal(plan.tasks[0].scheduled, false);
});

test("daily archive identity retains separate weekend source days and Beijing 00–24 work windows", () => {
  const saturday = digestWindow("2026-11-22", "daily"), sunday = digestWindow("2026-11-23", "daily");
  assert.equal(saturday.trafficStart, "2026-11-21"); assert.equal(saturday.trafficEnd, "2026-11-21");
  assert.equal(sunday.trafficStart, "2026-11-22"); assert.equal(sunday.trafficEnd, "2026-11-22");
  assert.equal(saturday.executionStart, "2026-11-21T00:00:00+08:00");
  assert.equal(saturday.executionEnd, "2026-11-22T00:00:00+08:00");
  assert.equal(sunday.executionStart, "2026-11-22T00:00:00+08:00");
  assert.equal(sunday.executionEnd, "2026-11-23T00:00:00+08:00");
  assert.equal(sunday.readyAfter, "2026-11-23T10:00:00.000Z", "keep the original sender/archive binding");
  const report = buildSeoDigest({ date: "2026-11-23", kind: "daily", now: new Date("2026-11-23T10:00:00Z"), publications: [],
    optimizations: [], observations: [], effects: [], priorities: [], issues: [], runNotes: [], publicationCoverage: "verified", optimizationCoverage: "verified" });
  assert.deepEqual(report.workWindow, { start: sunday.workStart, end: sunday.workEnd }, "preserve the original daily claim and frozen-source binding");
  assert.deepEqual(report.executionWindow, { start: "2026-11-22T00:00:00+08:00", end: "2026-11-23T00:00:00+08:00", timezone: "Asia/Shanghai" });
});
