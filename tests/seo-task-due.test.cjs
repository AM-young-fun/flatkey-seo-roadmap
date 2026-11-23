const assert = require("node:assert/strict");
const { test } = require("node:test");
const { dueTasks } = require("../scripts/lib/seo-task-due.cjs");
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
const scopeFixtures = [
  ["blog", {}],
  ["modelfit_blog", { siteDomain: "modelfit.cc" }],
  ["optimization", { kind: "optimization", pageType: "comparison" }],
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
