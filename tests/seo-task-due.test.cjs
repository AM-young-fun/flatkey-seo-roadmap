const assert = require("node:assert/strict");
const { test } = require("node:test");
const { dueTasks, websiteTaskAllowed } = require("../scripts/lib/seo-task-due.cjs");
const { isSeoWorkday } = require("../scripts/lib/seo-workday.cjs");

const instant = day => new Date(day + "T10:15:00+08:00");
function task(id, day, patch = {}) {
  return { id, title: id, kind: "blog", pageType: "blog", siteDomain: "flatkey.ai",
    channel: "website", status: "ready", dueAt: day + "T10:00:00+08:00",
    dependencies: [], country: "US", language: "en", ...patch };
}
function snapshot(tasks, patch = {}) {
  return { tasks, workWeek: { overdueTaskIds: tasks.map(row => row.id),
    reviewOrReleaseTaskIds: [], dependencyStatuses: {}, ...patch } };
}

test("public article terminology cannot turn authorized SEO work into a product task", () => {
  const original = task("seo-finding:e3025377cbc1198150348276f92162b56a3f22e608aced9807258f760492b8c8:task", "2026-11-26", {
    title: "vLLM原页优化：补齐EP后端默认值与版本条件", kind: "optimization", pageType: "blog",
    pageUrl: "https://flatkey.ai/blog/vllm-expert-parallel-deployment", dueAt: "2026-11-26T17:00:00+08:00",
  });
  const before = structuredClone(original);
  assert.equal(websiteTaskAllowed(original), true);
  const result = dueTasks(snapshot([original]), "optimization", new Date("2026-11-26T17:15:00+08:00"));
  assert.deepEqual(result.candidates.map(row => row.task.id), [original.id]);
  assert.equal(result.candidates[0].task, original); assert.deepEqual(original, before);
  for (const title of ["API后端兼容性教程", "GA4与LLM代理日志的区别", "不修改埋点的调用排障说明"]) assert.equal(websiteTaskAllowed({ ...original, title }), true);
  for (const patch of [{ channel: "product" }, { channel: "github" },
    { pageUrl: "https://console.flatkey.ai/models" }, { pageUrl: "https://router.flatkey.ai/docs" },
    { pageUrl: "https://flatkey.ai/api/models" }, { pageUrl: "https://flatkey.ai/router/models" },
    { id: "api-paid-success-evidence-20261118" }, { title: "【用户已取消】原技术任务" },
    { siteDomain: "jev-llm.com", pageUrl: "https://jev-llm.com/blog/example" }]) assert.equal(websiteTaskAllowed({ ...original, ...patch }), false);
});
const scopeFixtures = [
  ["blog", {}],
  ["modelfit_blog", { siteDomain: "modelfit.cc" }],
  ["optimization", { kind: "optimization", pageType: "comparison" }],
  ["refresh", { kind: "optimization", pageType: "blog", workClass: "content_refresh" }],
  ["cluster", { kind: "landing", siteDomain: "rackrate.org", pageType: "landing" }],
  ["cluster", { kind: "research", siteDomain: "modelfit.cc", pageType: "tool" }],
];

test("Friday carryover is selected first on Monday without changing the original task", () => {
  const friday = task("friday", "2026-11-20");
  const monday = task("monday", "2026-11-23");
  const future = task("future", "2026-11-24");
  const input = snapshot([monday, future, friday]);
  const original = structuredClone(input);
  const result = dueTasks(input, "blog", instant("2026-11-23"));
  assert.equal(result.asOf, "2026-11-23");
  assert.deepEqual(result.candidates.map(row => row.task.id), ["friday", "monday"]);
  assert.equal(result.candidates[0].reason, "overdue");
  assert.equal(result.candidates[0].task, friday);
  assert.deepEqual(input, original);
});

test("refresh has one queue and never reclassifies original optimization or satellite work", () => {
  const tasks = [
    task("flatkey-refresh", "2026-11-23", { kind: "optimization", workClass: "content_refresh" }),
    task("modelfit-refresh", "2026-11-23", { kind: "optimization", siteDomain: "modelfit.cc", workClass: "content_refresh" }),
    task("original-flatkey", "2026-11-20", { kind: "optimization" }),
    task("original-modelfit", "2026-11-20", { kind: "optimization", siteDomain: "modelfit.cc" }),
    task("rackrate-not-blog", "2026-11-23", { kind: "optimization", siteDomain: "rackrate.org", workClass: "content_refresh" }),
  ];
  const input = snapshot(tasks), before = structuredClone(input);
  assert.deepEqual(dueTasks(input, "refresh", instant("2026-11-23")).candidates.map(row => row.task.id), ["flatkey-refresh", "modelfit-refresh"]);
  assert.deepEqual(dueTasks(input, "optimization", instant("2026-11-23")).candidates.map(row => row.task.id), ["original-flatkey"]);
  assert.deepEqual(dueTasks(input, "cluster", instant("2026-11-23")).candidates.map(row => row.task.id), ["original-modelfit"]);
  assert.deepEqual(input, before);
});

test("all production scopes pause on ordinary weekends and official weekday holidays", () => {
  for (const day of ["2026-11-21", "2026-11-22", "2027-01-01", "2027-02-08"]) {
    assert.equal(isSeoWorkday(instant(day)), false);
    for (const [scope, patch] of scopeFixtures) {
      const input = snapshot([task("delayed", "2026-11-20", patch)]);
      assert.deepEqual(dueTasks(input, scope, instant(day)).candidates, [], `${scope} on ${day}`);
    }
  }
});

test("official makeup weekends allow overdue work in every authorized production scope", () => {
  for (const day of ["2026-10-10", "2027-01-31", "2027-05-08"]) {
    assert.equal(isSeoWorkday(instant(day)), true);
    for (const [scope, patch] of scopeFixtures) {
      const input = snapshot([task("delayed", "2026-10-09", patch)]);
      assert.deepEqual(dueTasks(input, scope, instant(day)).candidates.map(row => row.task.id), ["delayed"], `${scope} on ${day}`);
    }
  }
});

test("a makeup workday does not bypass future due times, dependencies, approval or paused landing scope", () => {
  const day = "2027-01-31";
  const input = snapshot([
    task("future-day", "2027-02-01"),
    task("future-time", day, { dueAt: day + "T10:16:00+08:00" }),
    task("dependency", day, { dependencies: ["unverified"] }),
    task("review", day, { status: "review_pending" }),
    task("missing-research", day, { status: "researching" }),
    task("allowed", day),
    task("paused-flatkey-landing", day, { kind: "landing", pageType: "landing" }),
    task("product", day, { channel: "product" }),
  ], { reviewOrReleaseTaskIds: ["review"], dependencyStatuses: { unverified: "researching" } });
  assert.deepEqual(dueTasks(input, "blog", instant(day)).candidates.map(row => row.task.id), ["allowed"]);
  assert.deepEqual(dueTasks(input, "landing", instant(day)).candidates, []);
});
