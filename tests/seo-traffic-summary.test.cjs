const { test } = require("node:test");
const assert = require("node:assert/strict");
require("./register-ui-modules.cjs");
const { mergeTrafficSummaryDay, closedTrafficSummaryDay, trafficSummaryDaySchema, TRAFFIC_SUMMARY_MODULES } = require("../src/lib/seo-traffic-summary.ts");
const { trafficJobs, trafficPeriodJobs } = require("../scripts/server-seo-traffic-summary.cjs");
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

test("the latest complete seven-day window moves back across a gap and retains observed zeros", () => {
  const { trafficOverview } = require("../src/lib/seo-traffic-overview.ts");
  const { rangeDays } = require("../src/lib/seo-analytics.ts");
  const scan = {start:"2026-11-14",end:"2026-11-24"};
  const dates = rangeDays(scan);
  const metric = {value:0, observedAt:"2026-11-25T10:00:00Z", sourceSha256:"a".repeat(64)};
  const site = dates.map(date => ({
    date, site:{totalSessions:metric,organicSessions:metric,totalRegistrations:metric,organicRegistrations:metric},
    modules:Object.fromEntries(TRAFFIC_SUMMARY_MODULES.map(([key])=>[key,{totalSessions:metric,organicSessions:metric}])),
  }));
  const pages = dates.filter(date=>date!=="2026-11-22").map(date=>({
    date, property:"541304395", kind:"ga4-pages", sessionsComplete:true,
    rows:[{hostname:"flatkey.ai",path:"/blog/example",sessions:1,registrations:null}],
  }));
  const automatic = trafficOverview(scan,null,site,pages);
  assert.equal(automatic.start,"2026-11-15");
  assert.equal(automatic.end,"2026-11-21");
  assert.equal(automatic.daily.length,7);
  assert.ok(automatic.daily.every(row=>row.site.organicSessions===0));
  assert.deepEqual(automatic.modules,{sessions:{blog:7},complete:true});
  assert.equal(automatic.moduleDays[0].sessions.blog,1);
  const custom = trafficOverview(scan,{start:"2026-11-22",end:scan.end},site,pages);
  assert.equal(custom.start,"2026-11-22");
  assert.equal(custom.end,scan.end);
  assert.equal(custom.modules.complete,false);
  assert.equal(trafficOverview(scan,null,[],pages).completeWeekEnd,null);
});

test("period comparison uses two exact windows and GA4 dimensionless registration totals", () => {
  const { trafficPeriodComparison } = require("../src/lib/seo-traffic-overview.ts");
  const { mergeTrafficSummaryPeriod } = require("../src/lib/seo-traffic-summary.ts");
  const current = {start:"2026-11-18",end:"2026-11-24"};
  const prior = {start:"2026-11-11",end:"2026-11-17"};
  const metric = (value,observedAt="2026-11-25T10:00:00Z") => ({value,observedAt,sourceSha256:"a".repeat(64)});
  const jobs = trafficPeriodJobs(current, FLATKEY_ENTRY_HOSTS);
  assert.deepEqual(jobs.map(job => job.request.dateRanges), [[{startDate:current.start,endDate:current.end}],[{startDate:current.start,endDate:current.end}]]);
  assert.deepEqual(jobs.map(job => job.metric), ["sessions","totalUsers"]);
  assert.ok(jobs.every(job=>!job.request.dimensions));
  assert.match(JSON.stringify(jobs[1].request), /sign_up_success/);
  assert.doesNotMatch(JSON.stringify(jobs[1].request), /hostName|channel/i);
  const currentRecord = {...current,totalSessions:metric(10),totalRegistrations:metric(4)};
  const old = {...prior,totalSessions:metric(0),totalRegistrations:metric(3)};
  const falsePrevious = {...prior,end:"2026-11-16",totalRegistrations:metric(100)};
  assert.deepEqual(trafficPeriodComparison(current,[falsePrevious,currentRecord,old]),
    {previous:prior,sessions:{current:10,previous:0},registrations:{current:4,previous:3}});
  assert.equal(trafficPeriodComparison(current,[falsePrevious,currentRecord]).registrations.previous, null);
  assert.deepEqual(mergeTrafficSummaryPeriod(currentRecord,{...currentRecord,totalSessions:metric(8,"2026-11-25T09:00:00Z"),totalRegistrations:null}), currentRecord);
});
