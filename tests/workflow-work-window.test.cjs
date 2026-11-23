const assert = require("node:assert/strict"), { test } = require("node:test"), fs = require("node:fs"), ts = require("typescript");
require.extensions[".ts"] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText, file);
const { workflowSnapshot } = require("../src/lib/seo-workflow-state.ts");
const { nextSeoWorkdayDate, seoCatchUpDate } = require("../src/lib/seo-workday.ts");

function task(id, weekStart, day, patch = {}) {
  return { kind: "task", record: { id, weekStart, dueAt: day + "T14:00:00+08:00", title: id,
    kind: "landing", siteDomain: "modelfit.cc", status: "ready", source: "automation", dependencies: [],
    contentVersion: id + "-v1", language: "en", evidence: [], version: 1, ...patch } };
}
function scheduled(...tasks) {
  const weeks = [...new Set(tasks.map(row => row.record.weekStart))];
  return [...tasks, ...weeks.map(weekStart => ({ kind: "plan", record: { id: "plan-" + weekStart,
    weekStart, status: "scheduled", version: 1, updatedAt: weekStart + "T00:00:00Z",
    taskIds: tasks.filter(row => row.record.weekStart === weekStart).map(row => row.record.id) } }))];
}
const read = (rows, now, workList = false) => workflowSnapshot(rows, { operational: true, workList }, "database", new Date(now));

test("Friday business window reads both Monday plans and excludes the following Friday", () => {
  const rows = scheduled(task("friday", "2026-11-16", "2026-11-20"),
    task("monday", "2026-11-23", "2026-11-23"), task("thursday", "2026-11-23", "2026-11-26"),
    task("next-friday", "2026-11-23", "2026-11-27"));
  const before = structuredClone(rows);
  const friday = read(rows, "2026-11-20T02:15:00Z");
  assert.equal(friday.weekStart, "2026-11-16", "persistent plan key remains Monday");
  assert.deepEqual(friday.workWeek.range, { start: "2026-11-20", end: "2026-11-26" });
  assert.deepEqual(friday.tasks.map(row => row.id), ["friday", "monday", "thursday"]);
  assert.deepEqual(friday.workWeek.overdueTaskIds, []);
  assert.deepEqual(read(rows, "2026-11-23T02:15:00Z").workWeek.overdueTaskIds, ["friday"]);
  assert.deepEqual(read(rows, "2026-11-23T02:15:00Z", true).tasks.map(row => row.id), ["friday", "monday", "thursday", "next-friday"]);
  assert.deepEqual(rows, before, "reading the delivery window never reschedules or copies original tasks");
});

test("unfinished work becomes overdue on the next Beijing day within the same stored week", () => {
  const rows = scheduled(task("monday", "2026-11-23", "2026-11-23"),
    task("tuesday", "2026-11-23", "2026-11-24"),
    task("review", "2026-11-23", "2026-11-23", { status: "review_pending" }),
    task("release", "2026-11-23", "2026-11-23", { status: "approved" }),
    task("done", "2026-11-23", "2026-11-23", { status: "verified" }),
    task("observing", "2026-11-23", "2026-11-23", { status: "observing" }));
  const monday = read(rows, "2026-11-23T15:59:59Z");
  assert.deepEqual(monday.workWeek.overdueTaskIds, []);
  const tuesday = read(rows, "2026-11-23T16:00:00Z");
  assert.deepEqual(tuesday.workWeek.overdueTaskIds, ["monday", "release", "review"]);
  assert.equal(tuesday.workWeek.catchUpDate, "2026-11-24");
  assert.equal(tuesday.workWeek.timeZone, "Asia/Shanghai");
  assert.equal(tuesday.workWeek.asOf, "2026-11-23T16:00:00.000Z");
  assert.equal(tuesday.tasks.find(row => row.id === "review").status, "review_pending");
  assert.equal(tuesday.tasks.find(row => row.id === "release").status, "approved");
  assert.ok(!tuesday.tasks.some(row => ["done", "observing"].includes(row.id)));
});

test("Friday midnight opens the new window without changing original Monday task keys", () => {
  const rows = scheduled(task("friday", "2026-11-23", "2026-11-27"),
    task("next-monday", "2026-11-30", "2026-11-30"));
  assert.deepEqual(read(rows, "2026-11-26T15:59:59Z").tasks, []);
  const friday = read(rows, "2026-11-26T16:00:00Z");
  assert.deepEqual(friday.tasks.map(row => row.id), ["friday", "next-monday"]);
  assert.deepEqual(friday.workWeek.range, { start: "2026-11-27", end: "2026-12-03" });
  assert.equal(friday.tasks[1].weekStart, "2026-11-30");
});

test("catch-up uses the next actual workday, including holidays and makeup weekends", () => {
  assert.equal(nextSeoWorkdayDate(new Date("2026-11-20T10:00:00+08:00")), "2026-11-23");
  assert.equal(nextSeoWorkdayDate(new Date("2026-11-21T10:00:00+08:00"), true), "2026-11-23");
  assert.equal(nextSeoWorkdayDate(new Date("2026-12-31T10:00:00+08:00")), "2027-01-04");
  assert.equal(nextSeoWorkdayDate(new Date("2027-01-30T10:00:00+08:00"), true), "2027-01-31");
  assert.equal(nextSeoWorkdayDate(new Date("2027-01-31T10:00:00+08:00"), true), "2027-01-31");
  const rows = scheduled(task("late-friday", "2026-11-16", "2026-11-20"));
  const weekend = read(rows, "2026-11-21T10:00:00+08:00");
  assert.deepEqual(weekend.workWeek.overdueTaskIds, ["late-friday"]);
  assert.equal(weekend.workWeek.catchUpDate, "2026-11-23");
  assert.equal(read(rows, "2026-11-23T10:00:00+08:00").workWeek.catchUpDate, "2026-11-23");
});

test("a matching verified publication removes stale task state from the catch-up queue", () => {
  const stale = task("shipped", "2026-11-16", "2026-11-20", { status: "drafting" });
  const rows = [...scheduled(stale), { kind: "publication", record: { id: "published", taskId: "shipped",
    weekStart: "2026-11-16", contentVersion: stale.record.contentVersion, status: "verified", kind: "landing",
    publishedAt: "2026-11-20T06:00:00Z" } }];
  const snapshot = read(rows, "2026-11-23T02:15:00Z");
  assert.deepEqual(snapshot.tasks, []);
  assert.deepEqual(snapshot.workWeek.overdueTaskIds, []);
});

test("catch-up rolls at the exact Beijing 18:30 workday close and honors makeup-day hours", () => {
  for (const at of ["2026-11-23T08:00:00+08:00", "2026-11-23T12:30:00+08:00", "2026-11-23T18:29:59+08:00"])
    assert.equal(seoCatchUpDate(new Date(at)), "2026-11-23", at);
  assert.equal(seoCatchUpDate(new Date("2026-11-23T18:30:00+08:00")), "2026-11-24");
  assert.equal(seoCatchUpDate(new Date("2026-11-20T18:29:59+08:00")), "2026-11-20");
  assert.equal(seoCatchUpDate(new Date("2026-11-20T18:30:00+08:00")), "2026-11-23");
  assert.equal(seoCatchUpDate(new Date("2026-11-20T23:59:59+08:00")), "2026-11-23");
  assert.equal(seoCatchUpDate(new Date("2027-01-01T08:00:00+08:00")), "2027-01-04");
  assert.equal(seoCatchUpDate(new Date("2027-01-31T18:29:59+08:00")), "2027-01-31");
  assert.equal(seoCatchUpDate(new Date("2027-01-31T18:30:00+08:00")), "2027-02-01");
  const rows = scheduled(task("late-friday", "2026-11-16", "2026-11-20"));
  assert.equal(read(rows, "2026-11-20T18:30:00+08:00").workWeek.catchUpDate, "2026-11-23");
});
