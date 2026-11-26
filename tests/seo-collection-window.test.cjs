const assert = require("node:assert/strict");
const { test } = require("node:test");
const { seoCollectionWindow } = require("../scripts/lib/seo-collection-window.cjs");

test("one closed Los Angeles weekday plus one eligible retry, with report after collection", () => {
  assert.deepEqual(seoCollectionWindow(new Date("2026-11-26T07:59:00Z")).scheduledSourceDates, []);
  const result = seoCollectionWindow(new Date("2026-11-26T08:00:00Z"));
  assert.deepEqual(result.scheduledSourceDates, ["2026-11-25"]);
  assert.equal(result.retrySourceDate, "2026-11-24");
  assert.equal(result.patrolDate, "2026-11-26");
  assert.deepEqual(result.dailyReportDates, []);
  const report = seoCollectionWindow(new Date("2026-11-26T10:00:00Z"));
  assert.deepEqual(report.dailyReportDates, ["2026-11-26"]);
  assert.equal(report.retryReportDate, "2026-11-25");
});

test("weekend collection moves to one Monday batch, preserving original source and report days", () => {
  for (const day of ["2026-11-28", "2026-11-29"]) {
    const weekend = seoCollectionWindow(new Date(day + "T10:00:00Z"));
    assert.deepEqual(weekend.scheduledSourceDates, []);
    assert.deepEqual(weekend.dailyReportDates, []);
    assert.equal(weekend.patrolDate, day);
  }
  for (const [now, first, last, patrol] of [
    ["2026-11-30T10:00:00Z", "2026-11-27", "2026-11-29", "2026-11-30"],
    ["2026-07-13T10:00:00Z", "2026-07-10", "2026-07-12", "2026-07-13"],
  ]) {
    const monday = seoCollectionWindow(new Date(now));
    assert.equal(monday.scheduledSourceDates[0], first);
    assert.equal(monday.scheduledSourceDates.at(-1), last);
    assert.equal(monday.scheduledSourceDates.length, 3);
    assert.deepEqual(monday.dailyReportDates, [...monday.scheduledSourceDates.slice(1), patrol]);
    assert.equal(monday.retrySourceDate, null);
    assert.equal(monday.retryReportDate, null);
    assert.equal(monday.patrolDate, patrol);
  }
});
