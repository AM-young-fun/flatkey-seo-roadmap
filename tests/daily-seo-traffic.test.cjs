const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs"), ts = require("typescript");
require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText, filename);
const { DAILY_SEO_TRAFFIC_DEFAULTS: defaults, dailySeoTrafficSchema, parseDailySeoTrafficQuery, buildDailySeoTrafficHistory } = require("../src/lib/daily-seo-traffic.ts");
const sample = () => ({
  kind: "daily-seo-traffic", requestId: "daily-seo-2026-10-30-v1", ...defaults,
  collectedAt: "2026-10-31T08:00:00Z", sources: ["https://analytics.google.com/analytics/web/"],
  points: [{ date: "2026-10-30", newUsers: 0, newRegistrations: null, missingReason: "注册成功事件用户数尚未核对" }],
});

test("daily evidence keeps zero and missing metrics distinct and accepts only the explicit Organic Search cohort", () => {
  assert.deepEqual(dailySeoTrafficSchema.parse(sample()).points, sample().points);
  for (const patch of [
    { trafficScope: "all_users" }, { channelName: "Direct" }, { channelName: "Organic Search " },
    { channelDimension: "sessionDefaultChannelGroup" }, { ga4PropertyId: "12345" }, { timezone: "Asia/Shanghai" },
    { registrationMetric: "sign_up_event_count" },
  ]) assert.equal(dailySeoTrafficSchema.safeParse({ ...sample(), ...patch }).success, false, JSON.stringify(patch));
  for (const value of [-1, 1.5, 2_147_483_648]) {
    const input = sample(); input.points[0].newUsers = value;
    assert.equal(dailySeoTrafficSchema.safeParse(input).success, false);
  }
});

test("property-local day closure applies across DST and cannot accept today's unfinished traffic", () => {
  const input = sample(); input.collectedAt = "2026-10-31T06:59:00Z";
  assert.equal(dailySeoTrafficSchema.safeParse(input).success, false); // Still 10/30 in LA.
  input.points[0].date = "2026-10-29";
  assert.equal(dailySeoTrafficSchema.safeParse(input).success, true);
  input.collectedAt = "2026-11-02T07:30:00Z";
  input.points[0].date = "2026-11-01";
  assert.equal(dailySeoTrafficSchema.safeParse(input).success, false); // Still 11/01 after DST ends.
  input.points[0].date = "2026-10-31";
  assert.equal(dailySeoTrafficSchema.safeParse(input).success, true);
  input.points[0].date = "2026-02-30";
  assert.equal(dailySeoTrafficSchema.safeParse(input).success, false);
  input.points[0].date = "2026-10-29";
  input.collectedAt = new Date(Date.now() + 360_000).toISOString();
  assert.equal(dailySeoTrafficSchema.safeParse(input).success, false);
});

test("duplicate dates, oversize batches and untrusted source links are rejected before persistence", () => {
  const input = sample(); input.points.push({ ...input.points[0] });
  assert.equal(dailySeoTrafficSchema.safeParse(input).success, false);
  input.points = Array.from({ length: 367 }, () => ({ ...input.points[0] }));
  assert.equal(dailySeoTrafficSchema.safeParse(input).success, false);
  for (const url of ["invalid-url", "http://analytics.google.com/", "https://analytics.google.com.evil.example/", "https://secret@analytics.google.com/", "https://analytics.google.com:8443/"]) {
    assert.equal(dailySeoTrafficSchema.safeParse({ ...sample(), sources: [url] }).success, false);
  }
  assert.equal(dailySeoTrafficSchema.safeParse({ ...sample(), collectedAt: "invalid-date" }).success, false);
});

test("default history is exactly thirty closed property-local days and validates explicit ranges", () => {
  const now = new Date("2026-11-03T03:00:00Z");
  const query = parseDailySeoTrafficQuery(new URLSearchParams("site=flatkey.ai"), now);
  assert.equal(query.start, "2026-10-03"); assert.equal(query.end, "2026-11-01");
  const history = buildDailySeoTrafficHistory(query, []);
  assert.equal(history.points.length, 30);
  assert.equal(history.points[0].date, "2026-10-03"); assert.equal(history.points.at(-1).date, "2026-11-01");
  assert.ok(history.points.every(point => point.newUsers === null && point.newRegistrations === null));
  assert.deepEqual(history.coverage, { days: 30, newUsersDays: 0, registrationDays: 0, completeDays: 0 });
  for (const params of ["start=2026-10-01", "start=2026-10-30&end=2026-10-29", "start=2025-01-01&end=2026-10-01", "start=2026-11-01&end=2026-11-02", "channelDimension=sessionDefaultChannelGroup"]) {
    assert.throws(() => parseDailySeoTrafficQuery(new URLSearchParams(params), now), params);
  }
});

test("daily corrections remain ordered by collection time, preserve zero, and do not let partial observations erase valid metrics", () => {
  const query = { ...defaults, start: "2026-10-29", end: "2026-10-31" };
  const observation = (requestId, collectedAt, newUsers, newRegistrations, extra = {}) => ({
    date: "2026-10-30", newUsers, newRegistrations,
    importBatch: { ...defaults, requestId, collectedAt, importedAt: collectedAt, sources: [`https://analytics.google.com/${requestId}`], ...extra },
  });
  const observations = [
    observation("original", "2026-10-31T08:00:00Z", 8, 5),
    observation("correction", "2026-11-01T08:00:00Z", 0, 4),
    observation("partial", "2026-11-02T08:00:00Z", null, 6),
    observation("late-import", "2026-10-31T09:00:00Z", 99, 99, { importedAt: "2026-11-03T08:00:00Z" }),
    observation("other-dimension", "2026-11-03T08:00:00Z", 999, 999, { channelDimension: "firstUserDefaultChannelGroup" }),
    observation("paid", "2026-11-03T08:00:00Z", 999, 999, { trafficScope: "all_users" }),
  ];
  const history = buildDailySeoTrafficHistory(query, observations), point = history.points[1];
  assert.equal(point.newUsers, 0); assert.equal(point.newRegistrations, 6);
  assert.equal(point.newUsersCollectedAt, "2026-11-01T08:00:00.000Z");
  assert.equal(point.newRegistrationsCollectedAt, "2026-11-02T08:00:00.000Z");
  assert.equal(point.revisions, 4);
  assert.deepEqual(history.sources, ["https://analytics.google.com/correction", "https://analytics.google.com/partial"]);
  assert.equal(history.points[0].newUsers, null); assert.equal(history.points[2].newRegistrations, null);
  assert.deepEqual(history.coverage, { days: 3, newUsersDays: 1, registrationDays: 1, completeDays: 1 });
});
