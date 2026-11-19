const { test } = require("node:test");
const assert = require("node:assert/strict");
const { reportWindows } = require("../scripts/server-seo-business.cjs");

test("business collection refreshes the same full Thu–Wed report on Thursday and Friday", () => {
  const weekly = (last, date) => reportWindows(last, date).filter(range => range.start !== range.end);
  const expected = [{ start: "2026-11-12", end: "2026-11-18" }, { start: "2026-11-05", end: "2026-11-11" }];
  assert.deepEqual(weekly("2026-11-18", "2026-11-19"), expected);
  assert.deepEqual(weekly("2026-11-19", "2026-11-20"), expected);
  assert.deepEqual(weekly("2026-11-25", "2026-11-26"), [
    { start: "2026-11-19", end: "2026-11-25" }, { start: "2026-11-12", end: "2026-11-18" },
  ]);
});

test("business report queries do not request an unclosed source day", () => {
  const windows = reportWindows("2026-11-17", "2026-11-19");
  assert.equal(windows.every(range => range.end <= "2026-11-17"), true);
  assert.equal(windows.some(range => range.start === "2026-11-05" && range.end === "2026-11-11"), true);
});

test("historical business collection retains Friday-through-Thursday report windows", () => {
  assert.deepEqual(reportWindows("2026-11-12", "2026-11-13").slice(-2), [
    { start: "2026-11-06", end: "2026-11-12" }, { start: "2026-10-30", end: "2026-11-05" },
  ]);
});
