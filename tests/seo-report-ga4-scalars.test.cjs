const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs/promises"), os = require("node:os"), path = require("node:path");
const { jobsFor, validate, collectDailyReportScalars, scalarCollectionScope } = require("../scripts/lib/seo-report-ga4-scalars.cjs");
const { bootstrap } = require("../scripts/server-seo-report-scalars.cjs"); bootstrap();
const { PILLAR_PAGE_GROUPS } = require("../src/lib/weekly-page-visitors.ts"), { DAILY_SEO_PAGE_GROUPS } = require("../src/lib/daily-seo-page-groups.ts"), { FLATKEY_ENTRY_HOSTS } = require("../src/lib/ga4-host-scope.ts");
const definitions = { pillars: PILLAR_PAGE_GROUPS, pageGroups: DAILY_SEO_PAGE_GROUPS, entryHosts: FLATKEY_ENTRY_HOSTS }, now = new Date("2026-11-24T12:00:00Z");
const make = (job, value = "0") => ({ propertyId: "541304395", request: job.request, status: 200, observedAt: "2026-11-23T16:02:46.099Z", data: { metadata: { timeZone: "America/Los_Angeles" }, metricHeaders: [{ name: job.metric }], rowCount: 1, rows: [{ metricValues: [{ value }] }] } });
async function directory(fn) { const dir = await fs.mkdtemp(path.join(os.tmpdir(), "seo-scalars-test-")); try { await fn(dir); } finally { await fs.rm(dir, { recursive: true, force: true }); } }
test("six unique-user and ten module scalars keep cohort and event definitions separate", () => {
  const jobs = jobsFor("2026-11-22", definitions, now); assert.equal(jobs.length, 16);
  assert.equal(jobs.filter(job => job.metric === "totalUsers").length, 6);
  for (const job of jobs) { const e = job.request.dimensionFilter.andGroup.expressions; assert.ok(e.some(row => row.filter?.fieldName === "sessionDefaultChannelGroup")); assert.ok(!e.some(row => row.filter?.fieldName === "firstUserPrimaryChannelGroup")); assert.equal(job.request.dimensions, undefined); assert.ok(e.some(row => row.filter?.fieldName === "eventName" && row.filter.stringFilter.value === (job.kind === "share" ? "page_view" : "session_start"))); }
});
test("explicit native zero is valid; metadata-only, wrong timezone/property and sampling are not", () => {
  const job = jobsFor("2026-11-22", definitions, now)[0]; assert.equal(validate(job, make(job), now).value, 0);
  for (const mutate of [r => { r.data.rows = []; r.data.rowCount = 0; }, r => { r.data.metadata.timeZone = "Asia/Shanghai"; }, r => { r.propertyId = "999"; }, r => { r.data.metadata.subjectToThresholding = true; }, r => { r.data.metadata.samplingMetadatas = [{ samplesReadCount: "1", samplingSpaceSize: "2" }]; }]) { const record = make(job); mutate(record); assert.equal(validate(job, record, now).value, null); }
});
test("scope guard preserves original comma scopes, JSON arrays and historical partial runs", () => {
  assert.equal(scalarCollectionScope({}).collect, true);
  assert.equal(scalarCollectionScope({ SEO_LOCAL_SCOPES: "flatkey.ai/all/GA4,rackrate.org/US/GSC" }).collect, true);
  assert.equal(scalarCollectionScope({ SEO_LOCAL_SCOPES: '["flatkey.ai/all/GA4"]' }).collect, true);
  assert.equal(scalarCollectionScope({ SEO_LOCAL_SCOPES: "flatkey.ai/US/GA4" }).collect, false);
  assert.equal(scalarCollectionScope({ SEO_LOCAL_START: "2026-10-01", SEO_LOCAL_END: "2026-10-02" }).collect, false);
  assert.equal(scalarCollectionScope({ SEO_LOCAL_SCOPES: '["flatkey.ai/all/GA4"' }).invalid, true);
});
test("a current/open source day is rejected before reading a provider", async () => {
  await directory(async outputDirectory => { let calls = 0; await assert.rejects(collectDailyReportScalars({ sourceDate: "2026-11-24", definitions, outputDirectory, now, requestReport: async () => { calls++; } }), /not_closed/); assert.equal(calls, 0); });
});
test("complete exact-scope cache makes no provider call and retains source time and zero", async () => {
  await directory(async dir => { const cache = path.join(dir, "cache"); await fs.mkdir(cache); for (const job of jobsFor("2026-11-22", definitions, now)) await fs.writeFile(path.join(cache, job.queryHash + "-source.json"), JSON.stringify(make(job)));
    const options = { sourceDate: "2026-11-22", definitions, outputDirectory: path.join(dir, "out"), cacheDirectories: [cache], now, requestReport: async () => { throw Error("must_not_query"); } };
    const first = await collectDailyReportScalars(options), second = await collectDailyReportScalars(options); assert.equal(first.requests, 0); assert.equal(first.cacheHits, 16); assert.equal(first.complete, true); assert.equal(first.moduleShares.current.all, 0); assert.equal(first.observedAt, "2026-11-23T16:02:46.099Z"); assert.equal(first.sourceEvidenceSha256, second.sourceEvidenceSha256);
  });
});
test("only one failed cache scalar is refetched; the original invalid source remains", async () => {
  await directory(async dir => { const cache = path.join(dir, "cache"); await fs.mkdir(cache); const jobs = jobsFor("2026-11-22", definitions, now); for (const [index, job] of jobs.entries()) { const record = make(job); if (!index) record.data.metadata.emptyReason = "not_ready"; await fs.writeFile(path.join(cache, job.queryHash + "-source.json"), JSON.stringify(record)); }
    let calls = 0; const result = await collectDailyReportScalars({ sourceDate: "2026-11-22", definitions, outputDirectory: path.join(dir, "out"), cacheDirectories: [cache], now, clock: () => now, requestReport: async request => { calls++; return make(jobs.find(job => JSON.stringify(job.request) === JSON.stringify(request)), "7"); } }); assert.equal(calls, 1); assert.equal(result.cacheHits, 15); assert.equal(result.complete, true); assert.match(await fs.readFile(path.join(cache, jobs[0].queryHash + "-source.json"), "utf8"), /not_ready/);
  });
});
test("a metadata-only fresh response stays null and incomplete", async () => {
  await directory(async outputDirectory => { const result = await collectDailyReportScalars({ sourceDate: "2026-11-22", definitions, outputDirectory, now, clock: () => now, requestReport: async request => ({ propertyId: "541304395", request, status: 200, observedAt: "2026-11-23T16:02:46.099Z", data: { metadata: { timeZone: "America/Los_Angeles" } } }) }); assert.equal(result.complete, false); assert.equal(result.moduleShares.current.all, null); assert.equal(result.missing.length, 16); });
});
test("response time may be later than frozen window selection without accepting future source time", async () => {
  await directory(async outputDirectory => { const received = new Date(now.getTime() + 250), jobs = jobsFor("2026-11-22", definitions, now); const result = await collectDailyReportScalars({ sourceDate: "2026-11-22", definitions, outputDirectory, now, clock: () => received, requestReport: async request => ({ ...make(jobs.find(job => JSON.stringify(job.request) === JSON.stringify(request)), "3"), observedAt: received.toISOString() }) }); assert.equal(result.complete, true); assert.equal(result.observedAt, received.toISOString()); const future = make(jobs[0]); future.observedAt = new Date(received.getTime() + 1).toISOString(); assert.equal(validate(jobs[0], future, received).value, null); });
});
test("cached future timestamp is rejected even when its scalar and metadata are otherwise valid", async () => {
  await directory(async dir => { const cache = path.join(dir, "cache"); await fs.mkdir(cache); const jobs = jobsFor("2026-11-22", definitions, now); for (const [i, job] of jobs.entries()) { const record = make(job); if (!i) record.observedAt = new Date(now.getTime() + 1000).toISOString(); await fs.writeFile(path.join(cache, job.queryHash + "-source.json"), JSON.stringify(record)); } let calls = 0; const result = await collectDailyReportScalars({ sourceDate: "2026-11-22", definitions, outputDirectory: path.join(dir, "out"), cacheDirectories: [cache], now, clock: () => now, requestReport: async request => { calls++; return make(jobs.find(job => JSON.stringify(job.request) === JSON.stringify(request))); } }); assert.equal(calls, 1); assert.equal(result.cacheHits, 15); assert.equal(result.complete, true); });
});
