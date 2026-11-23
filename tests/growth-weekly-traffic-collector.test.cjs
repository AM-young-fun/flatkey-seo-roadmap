const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), Module = require("node:module"), ts = require("typescript");
const load = Module._load;
Module._load = function(name, ...args) { return name === "server-only" ? {} : load.call(this, name, ...args); };
require.extensions[".ts"] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, file);
const { fetchGa4ExactOrganicWeek } = require("../src/lib/services/ga4-organic.ts");
const { collectGrowthWeeklyTraffic } = require("../scripts/lib/seo-growth-weekly-traffic.cjs");
const period = { start: "2026-11-12", end: "2026-11-18" };
const sites = ["flatkey.ai", "rackrate.org", "modelfit.cc", "rougecue.org"].map((domain, index) => ({ domain, ga4: String(index + 1), ga4TimeZone: "Asia/Shanghai" }));
function google(t, responder) {
 const prior = process.env.SEO_GA4_ACCESS_TOKEN; process.env.SEO_GA4_ACCESS_TOKEN = "test-read-only";
 t.after(() => prior === undefined ? delete process.env.SEO_GA4_ACCESS_TOKEN : process.env.SEO_GA4_ACCESS_TOKEN = prior);
 t.mock.method(globalThis, "fetch", async (url, init) => {
  assert.equal(new URL(url).origin, "https://analyticsdata.googleapis.com"); assert.equal(init.redirect, "error");
  const query = JSON.parse(init.body), result = responder(query);
  return Response.json({ dimensionHeaders: query.dimensions ?? [], metricHeaders: query.metrics, rows: result.rows ?? [], rowCount: (result.rows ?? []).length, ...result });
 });
}
const row = (bucket, count = 1) => ({ dimensionValues: bucket === null ? [] : [{ value: bucket }], metricValues: [{ value: String(count) }] });
test("Shanghai source uses exact UTC hours, real metadata and corresponding production host/channel filters", async t => {
 google(t, query => {
  assert.deepEqual(query.dimensions, [{ name: "dateHour" }]);
  assert.deepEqual(query.dateRanges, [{ startDate: "2026-11-12", endDate: "2026-11-19" }]);
  const filters = query.dimensionFilter.andGroup.expressions;
  assert.equal(filters[0].filter.fieldName, "sessionDefaultChannelGroup"); assert.equal(filters[0].filter.stringFilter.value, "Organic Search");
  assert.deepEqual(filters[1].filter.inListFilter.values, ["rackrate.org", "www.rackrate.org"]);
  const hours = filters[2].filter.inListFilter.values;
  assert.equal(hours.length, 168); assert.equal(hours[0], "2026111216"); assert.equal(hours.at(-1), "2026111915");
  return { rows: hours.map(hour => row(hour)), metadata: { timeZone: "Asia/Shanghai" } };
 });
 const result = await fetchGa4ExactOrganicWeek("rackrate.org", "2", "Asia/Shanghai", period);
 assert.equal(result.sessions, 168); assert.equal(result.hours.length, 168); assert.equal(result.intervalStart, "2026-11-12T08:00:00.000Z");
 assert.equal(result.intervalEnd, "2026-11-19T08:00:00.000Z"); assert.equal(result.metadata.timeZone, "Asia/Shanghai");
});
test("native LA DST weeks use seven real days over 167 or 169 hours", async t => {
 google(t, query => ({ rows: query.dimensionFilter.andGroup.expressions[2].filter.inListFilter.values.map(day => row(day, 3)), metadata: { timeZone: "America/Los_Angeles" } }));
 for (const [start, end, expected] of [["2026-03-05", "2026-03-11", 167], ["2026-10-29", "2026-11-04", 169]]) {
  const result = await fetchGa4ExactOrganicWeek("flatkey.ai", "1", "America/Los_Angeles", { start, end });
  assert.equal(result.method, "native_days"); assert.equal(result.days.length, 7); assert.equal(result.sessions, 21);
  assert.equal((Date.parse(result.intervalEnd) - Date.parse(result.intervalStart)) / 3600000, expected);
  assert.deepEqual(result.hostnames, ["flatkey.ai", "www.flatkey.ai", "console.flatkey.ai"]);
 }
});
test("sparse hours require an explicit same-scope scalar zero receipt", async t => {
 let calls = 0;
 google(t, query => {
  calls++;
  const values = query.dimensionFilter.andGroup.expressions[2].filter.inListFilter.values;
  if (query.dimensions) return { rows: [row(values[0], 2)], metadata: { timeZone: "Asia/Shanghai" } };
  assert.equal(values.length, 167); assert.deepEqual(query.dimensionFilter.andGroup.expressions[1].filter.inListFilter.values, ["modelfit.cc", "www.modelfit.cc"]);
  return { rows: [row(null, 0)], metadata: { timeZone: "Asia/Shanghai" } };
 });
 const result = await fetchGa4ExactOrganicWeek("modelfit.cc", "3", "Asia/Shanghai", period);
 assert.equal(calls, 2); assert.equal(result.sessions, 2); assert.equal(result.hours.filter(hour => hour.sessions === 0).length, 167);
});
test("metadata-only missing hours, different timezone and thresholded data never become complete zeros", async t => {
 let mode = "empty";
 google(t, query => ({ rows: query.dimensions ? [row(query.dimensionFilter.andGroup.expressions[2].filter.inListFilter.values[0])] : [], metadata: { timeZone: mode === "timezone" ? "UTC" : "Asia/Shanghai", ...(mode === "threshold" ? { subjectToThresholding: true } : {}) } }));
 for (mode of ["empty", "timezone", "threshold"]) await assert.rejects(fetchGa4ExactOrganicWeek("rackrate.org", "2", "Asia/Shanghai", period), error => /source_buckets_unverified|source_quality_incomplete/.test(error.code));
});
test("an empty rowCount-omitted bucket response still requires and can use an explicit scalar zero", async t => {
 let calls = 0;
 google(t, query => {
  calls++;
  return query.dimensions ? { rows: [], rowCount: undefined, metadata: { timeZone: "Asia/Shanghai" } }
   : { rows: [row(null, 0)], metadata: { timeZone: "Asia/Shanghai" } };
 });
 const result = await fetchGa4ExactOrganicWeek("rackrate.org", "2", "Asia/Shanghai", period);
 assert.equal(calls, 2); assert.equal(result.sessions, 0); assert.equal(result.hours.length, 168);
});
test("parallel source reads retain missing Rouge data; an ambiguous successful write is verified without repost", async () => {
 let active = 0, maximum = 0, posts = 0; const state = { version: 0, trafficEvidence: [] };
 const result = await collectGrowthWeeklyTraffic({ sites, period, credential: "test", fetchWeek: async site => {
  active++; maximum = Math.max(maximum, active); await new Promise(resolve => setTimeout(resolve, 1)); active--;
  if (site === "rougecue.org") throw Object.assign(Error("no source"), { code: "forbidden" });
  return { id: site, site, sessions: 5, metadata: { timeZone: "Asia/Shanghai", propertyId: "2" } };
 }, fetcher: async (url, init) => {
  assert.equal(url, "https://flatkey-seo-roadmap.vercel.app/api/seo/growth/strategy"); assert.equal(init.redirect, "error");
  if (init.method === "POST") { posts++; const command = JSON.parse(init.body); assert.equal(command.expectedVersion, state.version); state.version++; state.trafficEvidence.push(command.evidence); throw Error("timeout after saved"); }
  return Response.json({ state });
 } });
 assert.equal(maximum, 4); assert.equal(posts, 3); assert.equal(result.complete, false); assert.equal(result.paidRequests, 0);
 assert.equal(result.results.filter(row => row.status === "read_back").length, 3); assert.equal(result.results.find(row => row.site === "rougecue.org").reason, "forbidden");
});
test("failed writes without matching readback are not retried or reported complete", async () => {
 let posts = 0;
 const result = await collectGrowthWeeklyTraffic({ sites: sites.slice(0, 1), period, credential: "test", fetchWeek: async site => ({ id: site, site, sessions: 3 }), fetcher: async (_url, init) => {
  if (init.method === "POST") { posts++; throw Error("timeout before save"); }
  return Response.json({ state: { version: 0, trafficEvidence: [] } });
 } });
 assert.equal(posts, 1); assert.equal(result.results[0].status, "save_unavailable"); assert.equal(result.complete, false);
});
test("four duplicate site entries cannot stand in for four distinct verified sites", async () => {
 let reads = 0;
 await assert.rejects(collectGrowthWeeklyTraffic({ sites: Array(4).fill(sites[0]), period, credential: "test", fetchWeek: async () => { reads++; } }), /growth_duplicate_source_site/);
 assert.equal(reads, 0);
});
