const { test } = require("node:test");
const assert = require("node:assert/strict");
require("./register-ui-modules.cjs");
const { mergeTrafficSummaryDay, closedTrafficSummaryDay, trafficSummaryDaySchema, TRAFFIC_SUMMARY_MODULES } = require("../src/lib/seo-traffic-summary.ts");
const { trafficJobs } = require("../scripts/server-seo-traffic-summary.cjs");
const { PILLAR_PAGE_GROUPS } = require("../src/lib/weekly-page-visitors.ts");
const { DAILY_SEO_PAGE_GROUPS } = require("../src/lib/daily-seo-page-groups.ts");
const { FLATKEY_ENTRY_HOSTS } = require("../src/lib/ga4-host-scope.ts");

test("traffic and acquisition use distinct GA4 dimensions with equivalent all-channel cohorts", () => {
  const date = "2026-11-24", now = new Date("2026-11-25T20:00:00Z");
  const jobs = trafficJobs(date, { pillars: PILLAR_PAGE_GROUPS, pageGroups: DAILY_SEO_PAGE_GROUPS, entryHosts: FLATKEY_ENTRY_HOSTS }, now);
  const site = key => jobs.find(row => !row.module && row.key === key);
  assert.equal(jobs.length, 14);
  assert.equal(site("totalRegistrations").metric, "totalUsers");
  assert.match(JSON.stringify(site("totalRegistrations").request), /sign_up_success/);
  assert.doesNotMatch(JSON.stringify(site("totalRegistrations").request), /ChannelGroup|hostName/);
  assert.match(JSON.stringify(site("organicRegistrations").request), /firstUserPrimaryChannelGroup/);
  assert.doesNotMatch(JSON.stringify(site("organicRegistrations").request), /hostName/);
  assert.match(JSON.stringify(site("organicSessions").request), /sessionDefaultChannelGroup/);
  for (const [module] of TRAFFIC_SUMMARY_MODULES) {
    const rows = jobs.filter(row => row.module === module);
    assert.equal(rows.length, 2);
    assert.match(JSON.stringify(rows), /landingPage/);
    assert.ok(rows.every(row => row.request.dimensionFilter.andGroup.expressions.some(expression =>
      expression.filter?.fieldName === "hostName" && expression.filter.inListFilter.values.join() === "flatkey.ai,www.flatkey.ai")));
  }
  assert.equal(closedTrafficSummaryDay(new Date("2026-11-25T07:59:59Z")), "2026-11-23");
});

test("partial and stale reads never erase a known count and verified zero survives", () => {
  const evidence = (value, observedAt) => ({ value, observedAt, sourceSha256: "a".repeat(64) });
  const dates = ["2026-11-25T08:00:30Z", "2026-11-25T09:00:00Z"];
  const day = {
    kind: "flatkey-traffic-summary-v1", date: "2026-11-24", property: "541304395", timezone: "America/Los_Angeles",
    site: { totalSessions: evidence(30, dates[1]), organicSessions: evidence(12, dates[1]), totalRegistrations: null, organicRegistrations: null },
    modules: Object.fromEntries(TRAFFIC_SUMMARY_MODULES.map(([key]) => [key, { totalSessions: null, organicSessions: null }])),
  };
  const update = structuredClone(day);
  update.site = { totalSessions: evidence(5, dates[0]), organicSessions: null, totalRegistrations: evidence(0, dates[1]), organicRegistrations: null };
  const merged = trafficSummaryDaySchema.parse(mergeTrafficSummaryDay(day, update));
  assert.equal(merged.site.totalSessions.value, 30);
  assert.equal(merged.site.organicSessions.value, 12);
  assert.equal(merged.site.totalRegistrations.value, 0);
  assert.equal(merged.site.organicRegistrations, null);
});
