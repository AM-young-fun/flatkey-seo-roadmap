const { test } = require("node:test");
const assert = require("node:assert/strict");
const { growingPages, pageSessions, propertyWindow } = require("../scripts/server-seo-weekly-report-sources.cjs");

test("weekly growth uses only matching measured landing pages and sorts by absolute change", () => {
  const row = (path, value, host = "flatkey.ai") => ({
    dimensionValues: [{ value: host }, { value: path }], metricValues: [{ value: String(value) }],
  });
  const pages = (...rows) => pageSessions({ rowCount: rows.length, rows });
  const previous = pages(row("/pricing", 110), row("/compare", 12), row("/free", 45), row("/newly-measured", 0));
  const current = pages(row("/free", 76), row("/compare", 45), row("/pricing", 180), row("/newly-measured", 2),
    row("/missing-baseline", 1000), row("(not set)", 300), row("/pricing", 500, "console.flatkey.ai"));
  assert.deepEqual(growingPages(previous, current).map(row => [new URL(row.url).pathname, row.delta]),
    [["/pricing", 70], ["/compare", 33], ["/free", 31], ["/newly-measured", 2]]);
  assert.equal(pageSessions({ rowCount: 2, rows: [row("/partial", 32)] }), null);
  assert.deepEqual(growingPages(null, current), []);
});

test("cross-timezone report covers every actual hour through LA fall DST", () => {
  const range = { startDate: "2026-10-29", endDate: "2026-11-04" };
  const local = propertyWindow(range, "Asia/Shanghai");
  const hours = local.filters[0].filter.inListFilter.values;
  assert.equal(hours.length, 169);
  assert.equal(hours[0], "2026102915");
  assert.equal(hours.at(-1), "2026110515");
  assert.deepEqual(local.dates, { startDate: "2026-10-29", endDate: "2026-11-05" });
  assert.deepEqual(propertyWindow(range, "America/Los_Angeles"), { dates: range, filters: [] });
});
