const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const ts = require("typescript");
require.extensions[".ts"] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText, file);
const { buildWeeklySeoTrafficReport } = require("../src/lib/weekly-seo-report.ts");

const periods = {
  current: { start: "2026-10-06", end: "2026-10-12" },
  previous: { start: "2026-09-29", end: "2026-10-05" },
};
const counts = (newUsers, newRegistrations) => ({ newUsers, newRegistrations });
function evidence({ current = counts(1000, 200), previous = counts(800, 100),
  organicCurrent = counts(317, 50), organicPrevious = counts(238, 56),
  channelDimension = "firstUserPrimaryChannelGroup" } = {}) {
  return {
    complete: true, trafficScope: "all_users", channelDimension,
    totals: { current, previous },
    channels: [
      { name: "Organic Search", newUsers: { current: organicCurrent.newUsers, previous: organicPrevious.newUsers },
        registrations: { current: organicCurrent.newRegistrations, previous: organicPrevious.newRegistrations } },
      { name: "Paid Search", newUsers: { current: current.newUsers - organicCurrent.newUsers, previous: previous.newUsers - organicPrevious.newUsers },
        registrations: { current: current.newRegistrations - organicCurrent.newRegistrations, previous: previous.newRegistrations - organicPrevious.newRegistrations } },
    ],
    sources: ["https://analytics.google.com/analytics/web/"],
  };
}
function row(period = "current", analysis = evidence(), overrides = {}) {
  return {
    siteDomain: "flatkey.ai", periodStart: new Date(periods[period].start), periodEnd: new Date(periods[period].end),
    collectedAt: new Date(period === "current" ? "2026-10-14T03:00:00Z" : "2026-10-07T03:00:00Z"),
    ...analysis.totals.current, timezone: "America/Los_Angeles", ga4PropertyId: "541304395",
    registrationMetric: "sign_up_success_distinct_users", analysis, ...overrides,
  };
}
const priorEvidence = (overrides = {}) => evidence({ current: counts(800, 100), previous: counts(600, 80),
  organicCurrent: counts(238, 56), organicPrevious: counts(180, 30), ...overrides });
function archive() {
  return { ...evidence(), siteDomain: "flatkey.ai", timezone: "America/Los_Angeles", propertyId: "541304395",
    collectedAt: "2026-10-14T03:00:00Z" };
}

test("all-channel imports produce only organic card totals, site totals and week-over-week changes", () => {
  const rows = [row("previous", priorEvidence()), row()];
  const original = structuredClone(rows);
  const result = buildWeeklySeoTrafficReport(rows, periods);
  assert.equal(result.traffic.current.newUsers, 317);
  assert.equal(result.traffic.current.newRegistrations, 50);
  assert.equal(result.traffic.previous.newUsers, 238);
  assert.equal(result.traffic.previous.newRegistrations, 56);
  assert.equal(result.traffic.current.registrationRate, 50 / 317);
  assert.equal(result.traffic.changes.newUsers, 79 / 238);
  assert.equal(result.traffic.changes.newRegistrations, -6 / 56);
  assert.equal(result.traffic.changes.ratePoints, (50 / 317 - 56 / 238) * 100);
  assert.equal(result.traffic.comparable, true);
  const flatkey = result.traffic.siteTraffic.find(site => site.siteDomain === "flatkey.ai");
  assert.equal(flatkey.current.newUsers, 317);
  assert.equal(flatkey.previous.newRegistrations, 56);
  assert.deepEqual(result.evidence.channels.map(channel => channel.name), ["Organic Search"]);
  assert.deepEqual(result.evidence.totals, { current: counts(317, 50), previous: counts(238, 56) });
  assert.deepEqual(rows, original);
});

test("the current analysis supplies its verified preceding week without requiring a duplicate prior import", () => {
  const result = buildWeeklySeoTrafficReport([row()], periods);
  assert.equal(result.traffic.previous.newUsers, 238);
  assert.equal(result.traffic.previous.newRegistrations, 56);
  assert.equal(result.traffic.comparable, true);
  assert.ok(result.evidence);
});

test("a new explicitly organic pair can reuse prior SEO counts alongside an old unsegmented all-channel import", () => {
  const seo = evidence();
  seo.trafficScope = "organic_search";
  seo.channels = [seo.channels[0]];
  seo.totals = { current: counts(317, 50), previous: counts(238, 56) };
  const oldRaw = row("previous", priorEvidence(), { analysis: null });
  const result = buildWeeklySeoTrafficReport([row("current", seo), oldRaw], periods);
  assert.equal(result.traffic.previous.newUsers, 238);
  assert.equal(result.traffic.previous.newRegistrations, 56);
  assert.equal(result.traffic.comparable, true);
  assert.ok(result.evidence);
});

test("an archived supplement keeps its own collection timestamp when filling an older database record", () => {
  const oldCurrent = row("current", evidence(), { analysis: null, collectedAt: new Date("2026-10-13T18:00:00Z") });
  const prior = row("previous", priorEvidence(), { analysis: null, collectedAt: new Date("2026-10-14T01:00:00Z") });
  const result = buildWeeklySeoTrafficReport([oldCurrent, prior], periods, archive());
  assert.equal(result.traffic.current.collectedAt, archive().collectedAt);
  assert.equal(result.evidence.collectedAt, archive().collectedAt);
  assert.equal(result.traffic.previous.newUsers, 238);
  assert.equal(result.traffic.comparable, true);
});

test("a corrected prior raw total blocks stale paired evidence, while independently corrected organic evidence wins", () => {
  const corrected = row("previous", priorEvidence(), { newUsers: 900, newRegistrations: 111,
    analysis: null, collectedAt: new Date("2026-10-15T03:00:00Z") });
  const unknown = buildWeeklySeoTrafficReport([row(), corrected], periods);
  assert.equal(unknown.traffic.previous, null);
  assert.equal(unknown.traffic.comparable, false);
  assert.equal(unknown.traffic.changes.newUsers, null);
  assert.equal(unknown.evidence, null);
  corrected.analysis = priorEvidence({ current: counts(900, 111), organicCurrent: counts(240, 60) });
  const verified = buildWeeklySeoTrafficReport([row(), corrected], periods);
  assert.equal(verified.traffic.previous.newUsers, 240);
  assert.equal(verified.traffic.previous.newRegistrations, 60);
  assert.equal(verified.traffic.comparable, true);
  assert.equal(verified.evidence, null); // Its old pair no longer agrees with the corrected prior week.
});

test("analysis whose parent raw totals disagree cannot supply current SEO values", () => {
  const result = buildWeeklySeoTrafficReport([row("current", evidence(), { newUsers: 1001 })], periods);
  assert.equal(result.traffic.current, null);
  assert.equal(result.traffic.complete, false);
  assert.equal(result.traffic.comparable, false);
  assert.equal(result.evidence, null);
});

test("a newer raw import without channel analysis does not fall back to an older archive", () => {
  const result = buildWeeklySeoTrafficReport([row("current", evidence(), {
    analysis: null, collectedAt: new Date("2026-10-15T03:00:00Z"),
  })], periods, archive());
  assert.equal(result.traffic.current, null);
  assert.equal(result.traffic.previous, null);
  assert.equal(result.evidence, null);
});

test("different first-user channel dimensions never produce a comparable change", () => {
  const result = buildWeeklySeoTrafficReport([row(), row("previous", priorEvidence({
    channelDimension: "firstUserDefaultChannelGroup",
  }))], periods);
  assert.equal(result.traffic.current.newUsers, 317);
  assert.equal(result.traffic.previous.newUsers, 238);
  assert.equal(result.traffic.comparable, false);
  assert.deepEqual(result.traffic.changes, { newUsers: null, newRegistrations: null, registrationRate: null, ratePoints: null });
  assert.equal(result.evidence, null);
});

test("an explicit organic zero remains zero, while a missing organic row remains unknown", () => {
  const zero = evidence({ organicCurrent: counts(0, 0) });
  const verified = buildWeeklySeoTrafficReport([row("current", zero)], periods);
  assert.equal(verified.traffic.current.newUsers, 0);
  assert.equal(verified.traffic.current.newRegistrations, 0);
  assert.equal(verified.traffic.current.registrationRate, null);
  assert.equal(verified.traffic.changes.newUsers, -1);
  assert.equal(verified.traffic.comparable, true);
  const missing = evidence({ organicCurrent: counts(0, 0), organicPrevious: counts(0, 0) });
  missing.channels = missing.channels.filter(channel => channel.name !== "Organic Search");
  const unknown = buildWeeklySeoTrafficReport([row("current", missing)], periods);
  assert.equal(unknown.traffic.current, null);
  assert.equal(unknown.traffic.previous, null);
  assert.equal(unknown.traffic.complete, false);
});

test("other sites without segmented analysis never inflate SEO totals or participating site counts", () => {
  const result = buildWeeklySeoTrafficReport([row(),
    row("current", evidence(), { siteDomain: "rackrate.org", analysis: null, newUsers: 90000, newRegistrations: 9000 }),
    row("previous", priorEvidence(), { siteDomain: "modelfit.cc", analysis: null, newUsers: 80000, newRegistrations: 8000 }),
  ], periods);
  assert.equal(result.traffic.current.newUsers, 317);
  assert.equal(result.traffic.previous.newUsers, 238);
  assert.equal(result.traffic.current.sites, 1);
  assert.equal(result.traffic.previous.sites, 1);
  assert.deepEqual(result.traffic.currentSites, ["flatkey.ai"]);
  assert.deepEqual(result.traffic.previousSites, ["flatkey.ai"]);
  assert.equal(result.traffic.comparable, true);
  assert.equal(result.traffic.siteTraffic.find(site => site.siteDomain === "rackrate.org").current, null);
  assert.equal(result.traffic.siteTraffic.find(site => site.siteDomain === "modelfit.cc").previous, null);
});
