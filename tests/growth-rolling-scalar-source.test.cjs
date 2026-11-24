const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), Module = require("node:module"), crypto = require("node:crypto"), ts = require("typescript");
const load = Module._load;
Module._load = function(name, ...args) { return name === "server-only" ? {} : load.call(this, name, ...args); };
require.extensions[".ts"] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, file);
const { fetchGa4RollingOrganicWeek } = require("../src/lib/services/ga4-organic.ts");
const { growthExactTrafficSchema } = require("../src/lib/growth-exact-traffic.ts");
const { reportDayStart } = require("../src/lib/seo-report-time.cjs");
const { shiftDay } = require("../src/lib/seo-date-range.ts");
const period = { start: "2026-11-17", end: "2026-11-23" }, closed = new Date("2026-11-24T08:00:00Z");
const hosts = ["flatkey.ai", "www.flatkey.ai", "console.flatkey.ai"];
const scalarRow = value => ({ metricValues: [{ value }] });
const report = (overrides = {}) => ({ metricHeaders: [{ name: "sessions" }], rowCount: 1, rows: [scalarRow("1558")], metadata: { timeZone: "America/Los_Angeles" }, ...overrides });
function mockGoogle(t, responder) {
 const previous = process.env.SEO_GA4_ACCESS_TOKEN;
 process.env.SEO_GA4_ACCESS_TOKEN = "fictional-rolling-read-credential";
 t.after(() => previous === undefined ? delete process.env.SEO_GA4_ACCESS_TOKEN : process.env.SEO_GA4_ACCESS_TOKEN = previous);
 const calls = [];
 t.mock.method(globalThis, "fetch", async (url, init) => {
  calls.push({ url, init, query: JSON.parse(init.body) });
  assert.equal(url, "https://analyticsdata.googleapis.com/v1beta/properties/541304395:runReport");
  assert.equal(init.method, "POST"); assert.equal(init.cache, "no-store"); assert.equal(init.redirect, "error");
  const result = responder(calls.at(-1), calls.length);
  if (result instanceof Error) throw result;
  return result instanceof Response ? result : Response.json(result);
 });
 return calls;
}
const collect = (range = period, now = closed, site = "flatkey.ai", property = "541304395", zone = "America/Los_Angeles") => fetchGa4RollingOrganicWeek(site, property, zone, range, now);
function evidence(method = "whole_interval_scalar") {
 const observedAt = "2026-11-24T12:00:00Z", reference = "https://example.test/actual-fixture-receipt.json";
 return { id: "fixture-exact", site: "flatkey.ai", propertyId: "541304395", ...period, timezone: "America/Los_Angeles", sourceTimezone: "America/Los_Angeles",
  metadata: { timeZone: "America/Los_Angeles", propertyId: "541304395", observedAt, reference }, source: "google-api", observedAt, reference,
  scope: "session-organic-search", channelDimension: "sessionDefaultChannelGroup", channelValue: "Organic Search", hostScope: "production-hosts-v1", hostnames: hosts,
  complete: true, sessions: 7, intervalStart: "2026-11-17T08:00:00Z", intervalEnd: "2026-11-24T08:00:00Z", method,
  ...(method === "whole_interval_scalar" ? { wholeIntervalScalar: { version: "ga4-whole-interval-v1", queryHash: "a".repeat(64), observedAt, reference } }
   : { days: Array.from({ length: 7 }, (_, index) => ({ date: shiftDay(period.start, index), sessions: 1, complete: true })) }) };
}

test("one dimensionless whole-interval sessions query retains the exact production-host and session-channel scope", async t => {
 const calls = mockGoogle(t, () => report());
 const started = Date.now(), result = await collect();
 assert.equal(calls.length, 1); const { query, init } = calls[0];
 assert.equal(Object.hasOwn(query, "dimensions"), false);
 assert.deepEqual(query.metrics, [{ name: "sessions" }]);
 assert.deepEqual(query.dateRanges, [{ startDate: period.start, endDate: period.end }]);
 assert.deepEqual(query.dimensionFilter, { andGroup: { expressions: [
  { filter: { fieldName: "sessionDefaultChannelGroup", stringFilter: { matchType: "EXACT", value: "Organic Search", caseSensitive: true } } },
  { filter: { fieldName: "hostName", inListFilter: { values: hosts, caseSensitive: false } } },
 ] } });
 assert.equal(query.limit, "1"); assert.equal(query.keepEmptyRows, true);
 assert.equal(result.sessions, 1558); assert.equal(result.method, "whole_interval_scalar");
 assert.equal(Object.hasOwn(result, "days"), false); assert.equal(Object.hasOwn(result, "hours"), false);
 assert.equal(result.intervalStart, "2026-11-17T08:00:00.000Z"); assert.equal(result.intervalEnd, "2026-11-24T08:00:00.000Z");
 const digest = crypto.createHash("sha256").update(init.body).digest("hex");
 assert.deepEqual(result.wholeIntervalScalar, { version: "ga4-whole-interval-v1", queryHash: digest, observedAt: result.observedAt, reference: result.reference });
 assert.equal(result.reference, calls[0].url + "#sha256=" + digest);
 assert.ok(Date.parse(result.observedAt) >= started); assert.ok(Date.parse(result.observedAt) <= Date.now());
 assert.equal(growthExactTrafficSchema.safeParse(result).success, true);
});

test("an explicit measured zero is valid without fabricating daily zeros", async t => {
 const calls = mockGoogle(t, () => report({ rows: [{ dimensionValues: [], metricValues: [{ value: "0" }] }] }));
 const result = await collect(); assert.equal(result.sessions, 0); assert.equal(calls.length, 1); assert.equal(result.days, undefined);
});

test("rolling scalar LA date boundaries include exact 167/169-hour DST weeks", async t => {
 const calls = mockGoogle(t, () => report());
 for (const [start, end, hours] of [["2026-03-05", "2026-03-11", 167], ["2026-10-29", "2026-11-04", 169]]) {
  const result = await collect({ start, end });
  assert.equal((Date.parse(result.intervalEnd) - Date.parse(result.intervalStart)) / 3600000, hours);
  assert.equal(result.wholeIntervalScalar.version, "ga4-whole-interval-v1");
 }
 assert.equal(calls.length, 2);
});

test("wrong site, property, source timezone, malformed dates and an open LA interval fail before any Google read", async t => {
 const calls = mockGoogle(t, () => { throw Error("must not call"); });
 const bad = [
  [period, closed, "rackrate.org"], [period, closed, "flatkey.ai", "1"], [period, closed, "flatkey.ai", "541304395", "UTC"],
  [{ start: "2026-11-18", end: "2026-11-23" }, closed], [{ start: "2026-11-16", end: "2026-11-23" }, closed],
  [{ start: "2026-02-30", end: "2026-03-08" }, closed], [period, new Date("2026-11-24T07:59:59.999Z")], [period, new Date("invalid")],
 ];
 for (const args of bad) await assert.rejects(collect(...args));
 assert.equal(calls.length, 0);
});

test("missing, empty, duplicated or malformed scalar rows never become a measured zero or a summed total", async t => {
 const cases = [
  { rows: [], rowCount: 0 }, { rows: undefined, rowCount: undefined }, { rows: [scalarRow("0")], rowCount: undefined },
  { rows: [scalarRow("2"), scalarRow("3")], rowCount: 2 }, { rowCount: 2 },
  { rows: [null] }, { rows: [scalarRow("3")], dimensionHeaders: [{ name: "date" }] },
  { rows: [{ dimensionValues: [{ value: "20261117" }], metricValues: [{ value: "3" }] }] },
  { rows: [{ dimensionValues: "", metricValues: [{ value: "3" }] }] },
  { rows: [{ dimensionValues: null, metricValues: [{ value: "3" }] }] },
  { rows: [{ metricValues: [{ value: "3" }, { value: "4" }] }] },
  { rows: [{}] }, { metricHeaders: [{ name: "totalUsers" }] },
 ];
 let index = 0; const calls = mockGoogle(t, () => report(cases[index]));
 for (index = 0; index < cases.length; index++) await assert.rejects(collect(), error => error.code === "invalid_response");
 assert.equal(calls.length, cases.length, "exactly one read per failure, no confirmation or retry");
});

test("scalar sessions must be exactly one nonnegative safe integer string", async t => {
 const bad = ["", "-1", "1.5", "1e3", " 0", "NaN", "9007199254740992", 0, null, undefined];
 let value; const calls = mockGoogle(t, () => report({ rows: [scalarRow(value)] }));
 for (value of bad) await assert.rejects(collect(), error => error.code === "invalid_response");
 assert.equal(calls.length, bad.length);
});

test("missing or wrong LA metadata and every known incomplete-quality flag reject the whole scalar", async t => {
 const bad = [undefined, {}, { timeZone: "UTC" },
  { timeZone: "America/Los_Angeles", subjectToThresholding: true }, { timeZone: "America/Los_Angeles", dataLossFromOtherRow: true },
  { timeZone: "America/Los_Angeles", samplingMetadatas: [{ samplesReadCount: "1", samplingSpaceSize: "2" }] },
  { timeZone: "America/Los_Angeles", dataTruncationReasons: ["fixture"] },
  { timeZone: "America/Los_Angeles", schemaRestrictionResponse: { activeMetricRestrictions: ["fixture"] } },
  { timeZone: "America/Los_Angeles", emptyReason: "NO_DATA" }];
 let metadata; const calls = mockGoogle(t, () => report({ metadata }));
 for (metadata of bad) await assert.rejects(collect(), error => error.code === "source_quality_incomplete");
 assert.equal(calls.length, bad.length);
});

test("transport errors and non-success responses have exactly one attempt", async t => {
 let response; const calls = mockGoogle(t, () => response);
 for (const [status, code] of [[401, "auth_failed"], [403, "forbidden"], [429, "rate_limited"], [500, "unavailable"]]) {
  response = new Response("", { status }); await assert.rejects(collect(), error => error.code === code);
 }
 response = Error("fixture timeout"); await assert.rejects(collect(), error => error.code === "unavailable");
 assert.equal(calls.length, 5);
});

test("whole-interval evidence requires a real-shaped receipt in its exact closed interval and original scope", () => {
 const base = evidence(); assert.equal(growthExactTrafficSchema.safeParse(base).success, true);
 for (const patch of [
  { wholeIntervalScalar: undefined }, { days: [] }, { hours: [] },
  { site: "rackrate.org", hostnames: ["rackrate.org", "www.rackrate.org"] },
  { propertyId: "2", metadata: { ...base.metadata, propertyId: "2" } },
  { sourceTimezone: "UTC", metadata: { ...base.metadata, timeZone: "UTC" } },
  { hostnames: hosts.slice(0, 2) }, { hostnames: [...hosts, hosts[0]] },
  { wholeIntervalScalar: { ...base.wholeIntervalScalar, queryHash: "bad" } },
  { wholeIntervalScalar: { ...base.wholeIntervalScalar, observedAt: "2026-11-24T07:59:59.999Z" } },
  { wholeIntervalScalar: { ...base.wholeIntervalScalar, observedAt: "2026-11-24T12:00:00.001Z" } },
  { wholeIntervalScalar: { ...base.wholeIntervalScalar, reference: "" } },
  { intervalEnd: "2026-11-24T00:00:00Z" },
 ]) assert.equal(growthExactTrafficSchema.safeParse({ ...base, ...patch }).success, false, JSON.stringify(patch));
 assert.equal(growthExactTrafficSchema.safeParse({ ...base, wholeIntervalScalar: { ...base.wholeIntervalScalar, observedAt: base.intervalEnd } }).success, true);
});

test("old native-day receipts still parse unchanged, and discontinuity or false sums remain rejected", () => {
 const legacy = evidence("native_days"); legacy.propertyId = "1"; legacy.metadata.propertyId = "1";
 assert.deepEqual(growthExactTrafficSchema.parse(legacy), legacy);
 assert.equal(growthExactTrafficSchema.safeParse({ ...legacy, sessions: 8 }).success, false);
 const days = structuredClone(legacy.days); days[1].date = days[0].date;
 assert.equal(growthExactTrafficSchema.safeParse({ ...legacy, days }).success, false);
});

test("old hourly receipts remain exact across LA boundaries, without new scalar requirements", () => {
 const legacy = evidence(); delete legacy.wholeIntervalScalar;
 Object.assign(legacy, { site: "rackrate.org", hostnames: ["rackrate.org", "www.rackrate.org"], propertyId: "2", sourceTimezone: "UTC", method: "utc_hours", sessions: 168 });
 legacy.metadata = { ...legacy.metadata, timeZone: "UTC", propertyId: "2" };
 const start = Date.parse(reportDayStart(period.start));
 legacy.hours = Array.from({ length: 168 }, (_, index) => { const at = new Date(start + index * 3600000).toISOString(); return { utcStart: at, sourceDateHour: at.replace(/[-:T]/g, "").slice(0, 10), sessions: 1, complete: true }; });
 assert.deepEqual(growthExactTrafficSchema.parse(legacy), legacy);
 assert.equal(growthExactTrafficSchema.safeParse({ ...legacy, hours: legacy.hours.slice(1) }).success, false);
 assert.equal(growthExactTrafficSchema.safeParse({ ...legacy, sessions: 167 }).success, false);
});
