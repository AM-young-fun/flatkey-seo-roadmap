const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const { test } = require("node:test");
const ts = require("typescript");

const originalLoad = Module._load;
Module._load = function (name, ...args) {
  return name === "server-only" ? {} : originalLoad.call(this, name, ...args);
};
require.extensions[".ts"] = (module, file) => {
  const source = ts.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  module._compile(source.outputText, file);
};
const { ga4HostFilter, FLATKEY_ENTRY_HOSTS, ga4RegistrationFilter } = require("../src/lib/ga4-host-scope.ts");
const host = ga4HostFilter(FLATKEY_ENTRY_HOSTS);
const { fetchGa4Organic, fetchGa4Realtime } = require("../src/lib/services/ga4-organic.ts");

function useMockGoogle(t, respond) {
  const previous = process.env.SEO_GA4_ACCESS_TOKEN;
  process.env.SEO_GA4_ACCESS_TOKEN = "fictional-analytics-read-credential";
  t.after(() => {
    if (previous === undefined) delete process.env.SEO_GA4_ACCESS_TOKEN;
    else process.env.SEO_GA4_ACCESS_TOKEN = previous;
  });
  t.mock.method(globalThis, "fetch", async (url, options) => {
    assert.equal(new URL(url).origin, "https://analyticsdata.googleapis.com");
    assert.equal(options.redirect, "error");
    const query = JSON.parse(options.body);
    const { rows, ...extra } = respond(query, new URL(url).pathname);
    return Response.json({
      dimensionHeaders: query.dimensions ?? [],
      metricHeaders: query.metrics,
      rowCount: rows.length,
      rows: rows.map(([dimensions, metrics]) => ({
        dimensionValues: dimensions.map(value => ({ value })),
        metricValues: metrics.map(value => ({ value: String(value) })),
      })),
      ...extra,
    });
  });
}

test("organic GA4 queries preserve a clean sessions denominator, and thresholded gaps remain unknown", async t => {
  useMockGoogle(t, (query, path) => {
    assert.match(path, /:runReport$/);
    const channel = {
      filter: { fieldName: "sessionDefaultChannelGroup", stringFilter: { matchType: "EXACT", value: "Organic Search", caseSensitive: true } },
    };
    if (!query.dimensions) {
      assert.deepEqual(query.dimensionFilter.andGroup.expressions[0].andGroup.expressions, [channel, host]);
      assert.deepEqual(query.dimensionFilter.andGroup.expressions[1].filter.inListFilter.values, ["20251021"]);
      return { rows: [[[], [0]]], rowCount: 1, metadata: { timeZone: "America/Los_Angeles" } };
    }
    const page = query.dimensions.some(({ name }) => name === "landingPage");
    const registration = query.metrics.some(({ name }) => name === "totalUsers");
    const dimensions = page ? ["20251020", "/models", "flatkey.ai"] : ["20251020"];
    if (registration) {
      assert.deepEqual(query.dimensionFilter.andGroup.expressions, [channel, host, ga4RegistrationFilter()]);
      assert.deepEqual(query.dimensionFilter.andGroup.expressions.at(-1).filter.inListFilter.values,["sign_up","sign_up_success"]);
      return { rows: page ? [] : [[dimensions, [2, 3]]], metadata: { timeZone: "America/Los_Angeles", subjectToThresholding: true } };
    }
    if (page) assert.deepEqual(query.dimensionFilter.andGroup.expressions, [channel, host, {
      filter: { fieldName: "eventName", stringFilter: { matchType: "EXACT", value: "session_start", caseSensitive: true } },
    }]);
    else assert.deepEqual(query.dimensionFilter.andGroup.expressions, [channel, host]);
    return { rows: [[dimensions, [19]]], metadata: { timeZone: "America/Los_Angeles" } };
  });
  const report = await fetchGa4Organic({ start: "2025-10-20", end: "2025-10-21" });
  assert.deepEqual(report.daily, [
    { date: "2025-10-20", sessions: 19, registrations: 2, registrationEvents: 3 },
    { date: "2025-10-21", sessions: 0, registrations: null, registrationEvents: null },
  ]);
  assert.deepEqual(report.pages, [
    { date: "2025-10-20", hostname: "flatkey.ai", path: "/models", sessions: 19, registrations: null, registrationEvents: null },
  ]);
  assert.deepEqual(report.quality.pageRegistrations, { complete: false, reasons: ["landing_host_attribution_unverified"] });
});

test("realtime counts remain all-channel and use an independently deduplicated five-minute window", async t => {
  useMockGoogle(t, (query, path) => {
    assert.match(path, /:runRealtimeReport$/);
    assert.equal(query.dimensions, undefined);
    if (query.dimensionFilter) {
      assert.equal(query.dimensionFilter.filter.fieldName, "eventName");
      assert.equal(query.dimensionFilter.filter.stringFilter.value, "sign_up_success");
      return { rows: [[[], [2]]] };
    }
    return { rows: [[[], query.minuteRanges[0].startMinutesAgo === 4 ? [5] : [21, 38]]] };
  });
  const report = await fetchGa4Realtime();
  assert.equal(report.scope, "all-channels");
  assert.equal(report.organicSearchAvailable, false);
  assert.equal(report.activeUsersLast5Minutes, 5);
  assert.equal(report.activeUsers, 21);
  assert.equal(report.pageViews, 38);
  assert.equal(report.registrationEvents, 2);
});

test("cluster sessions respect the property timezone and leave absent dates unknown", async t => {
  const { fetchGa4SiteSessions } = require("../src/lib/services/ga4-organic.ts");
  useMockGoogle(t, (query, path) => {
    assert.match(path, /558899190:runReport$/);
    assert.deepEqual(query.metrics, [{ name: "sessions" }]);
    assert.equal(query.dimensionFilter.filter.stringFilter.value, "Organic Search");
    return { rows: [[["20251020"], [3]]], metadata: { timeZone: "Asia/Shanghai" } };
  });
  const result = await fetchGa4SiteSessions({ start: "2025-10-20", end: "2025-10-21" }, "558899190", "Asia/Shanghai");
  assert.deepEqual(result.daily, [{ date: "2025-10-20", sessions: 3 }, { date: "2025-10-21", sessions: null }]);
  assert.equal(result.quality.complete, false);
  await assert.rejects(() => fetchGa4SiteSessions({ start: "2025-10-20", end: "2025-10-21" }, "558899190", "America/Los_Angeles"));
});

test("omitted session dates are persisted as zero only after a scoped explicit zero total", async t => {
  const { fetchGa4SiteSessions } = require("../src/lib/services/ga4-organic.ts");
  const queries = [];
  useMockGoogle(t, (query, path) => {
    queries.push(query);
    assert.match(path, /561876347:runReport$/);
    assert.deepEqual(query.metrics, [{ name: "sessions" }]);
    const metadata = { timeZone: "America/Los_Angeles" };
    if (query.dimensions) return { rows: [[["20261109"], [2]], [["20261110"], [2]], [["20261112"], [1]]], metadata };
    assert.equal(query.keepEmptyRows, true);
    assert.deepEqual(query.dateRanges, [{ startDate: "2026-11-09", endDate: "2026-11-15" }]);
    assert.deepEqual(query.dimensionFilter.andGroup.expressions, [queries[0].dimensionFilter, {
      filter: { fieldName: "date", inListFilter: { values: ["20261111", "20261113", "20261114", "20261115"], caseSensitive: true } },
    }]);
    return { rows: [[[], [0]]], metadata };
  });
  const report = await fetchGa4SiteSessions({ start: "2026-11-09", end: "2026-11-15" }, "561876347", "America/Los_Angeles", "BR");
  assert.equal(queries.length, 2, "one confirmation covers all omitted dates");
  assert.deepEqual(queries[0].dimensionFilter.andGroup.expressions.map(x => x.filter.stringFilter.value), ["Organic Search", "BR"]);
  assert.deepEqual(report.daily.map(x => x.sessions), [2, 2, 0, 1, 0, 0, 0]);
  assert.deepEqual(report.quality, { complete: true, reasons: [] });
});

test("a completely empty daily report can recover a full zero interval from an explicit scalar", async t => {
  const { fetchGa4SiteSessions } = require("../src/lib/services/ga4-organic.ts");
  useMockGoogle(t, query => ({ rows: query.dimensions ? [] : [[[], [0]]], metadata: { timeZone: "Asia/Shanghai" } }));
  const result = await fetchGa4SiteSessions({ start: "2025-10-20", end: "2025-10-21" }, "558899190", "Asia/Shanghai");
  assert.deepEqual(result.daily, [{ date: "2025-10-20", sessions: 0 }, { date: "2025-10-21", sessions: 0 }]);
  assert.equal(result.quality.complete, true);
});

for (const [name, response] of [
  ["metadata-only", { rows: [], metricHeaders: undefined, rowCount: undefined }],
  ["empty rows", { rows: [] }],
  ["missing row count", { rows: [[[], [0]]], rowCount: undefined }],
  ["positive total", { rows: [[[], [1]]] }],
  ["missing timezone", { rows: [[[], [0]]], metadata: {} }],
  ["wrong timezone", { rows: [[[], [0]]], metadata: { timeZone: "Asia/Shanghai" } }],
  ["thresholding", { rows: [[[], [0]]], metadata: { timeZone: "America/Los_Angeles", subjectToThresholding: true } }],
  ["sampling", { rows: [[[], [0]]], metadata: { timeZone: "America/Los_Angeles", samplingMetadatas: [{ samplesReadCount: "1", samplingSpaceSize: "2" }] } }],
  ["other row", { rows: [[[], [0]]], metadata: { timeZone: "America/Los_Angeles", dataLossFromOtherRow: true } }],
]) test(`unverified zero confirmation (${name}) keeps missing dates unknown and preserves observed positives`, async t => {
  const { fetchGa4SiteSessions } = require("../src/lib/services/ga4-organic.ts");
  useMockGoogle(t, query => query.dimensions ? { rows: [[["20251020"], [3]]], metadata: { timeZone: "America/Los_Angeles" } }
    : { metadata: { timeZone: "America/Los_Angeles" }, ...response });
  const result = await fetchGa4SiteSessions({ start: "2025-10-20", end: "2025-10-21" }, "561876347", "America/Los_Angeles");
  assert.deepEqual(result.daily, [{ date: "2025-10-20", sessions: 3 }, { date: "2025-10-21", sessions: null }]);
  assert.equal(result.quality.complete, false);
  assert.ok(result.quality.reasons.includes("missing_dates_unverified"));
});

test("a failed zero confirmation retains known sessions and does not retry or synthesize zero", async t => {
  const { fetchGa4SiteSessions } = require("../src/lib/services/ga4-organic.ts");
  let requests = 0;
  useMockGoogle(t, query => {
    requests++;
    if (!query.dimensions) throw new Error("fixture timeout");
    return { rows: [[["20251020"], [3]]], metadata: { timeZone: "America/Los_Angeles" } };
  });
  const result = await fetchGa4SiteSessions({ start: "2025-10-20", end: "2025-10-21" }, "561876347", "America/Los_Angeles");
  assert.equal(requests, 2);
  assert.deepEqual(result.daily.map(x => x.sessions), [3, null]);
  assert.ok(result.quality.reasons.includes("zero_confirmation_unavailable"));
});

test("a limited daily session report cannot be repaired into zeros by a scalar", async t => {
  const { fetchGa4SiteSessions } = require("../src/lib/services/ga4-organic.ts");
  let requests = 0;
  useMockGoogle(t, query => {
    requests++;
    assert.ok(query.dimensions, "do not issue a confirmation after a limited report");
    return { rows: [[["20251020"], [3]]], metadata: { timeZone: "America/Los_Angeles", subjectToThresholding: true } };
  });
  const result = await fetchGa4SiteSessions({ start: "2025-10-20", end: "2025-10-21" }, "561876347", "America/Los_Angeles");
  assert.equal(requests, 1);
  assert.ok(result.daily.every(x => x.sessions === null));
  assert.equal(result.quality.complete, false);
});

test("hostName joins page rows without mixing the same landing path across hosts", async t => {
  useMockGoogle(t, query => {
    const page = query.dimensions?.some(({ name }) => name === "landingPage");
    const registration = query.metrics.some(({ name }) => name === "totalUsers");
    if (page) {
      assert.deepEqual(query.dimensions.map(row => row.name), ["date", "landingPage", "hostName"]);
      assert.equal(registration, false, "signup hostname must not be paired with session landing path");
      assert.equal(query.dimensionFilter.andGroup.expressions.at(-1).filter.stringFilter.value, "session_start");
      return { rows: [[['20251020', '/', 'flatkey.ai'], registration ? [1, 1] : [3]], [['20251020', '/', 'console.flatkey.ai'], registration ? [2, 2] : [7]]] };
    }
    return { rows: [[['20251020'], registration ? [2, 3] : [8]]] };
  });
  const report = await fetchGa4Organic({ start: "2025-10-20", end: "2025-10-20" });
  assert.deepEqual(report.pages.map(row => [row.hostname, row.sessions]), [["console.flatkey.ai", 7], ["flatkey.ai", 3]]);
  assert.equal(report.daily[0].sessions, 8, "site sessions are independently queried and never added across hosts");
});

test("period-unique organic users and registrations have no date/page dimensions or sum of daily distinct counts", async t => {
  const { fetchGa4OrganicPeriod } = require("../src/lib/services/ga4-organic.ts");
  let calls = 0;
  useMockGoogle(t, query => {
    calls++; assert.equal(query.dimensions, undefined);
    assert.deepEqual(query.metrics, [{ name: "totalUsers" }]);
    const filters = query.dimensionFilter.andGroup.expressions;
    assert.equal(filters[0].filter.stringFilter.value, "Organic Search");
    assert.equal(filters[2].filter.stringFilter.value, "BR");
    return { rows: [[[], [filters.length === 4 ? 2 : 9]]], metadata: { timeZone: "America/Los_Angeles" } };
  });
  const result = await fetchGa4OrganicPeriod({ start: "2025-10-20", end: "2025-10-26" }, "BR");
  assert.equal(result.registrationMetric, "sign_up_or_legacy_distinct_users");
  assert.equal(calls, 2); assert.equal(result.users, 9); assert.equal(result.registrations, 2); assert.equal(result.quality.complete, true);
});

test("empty interval responses need real headers, row count and property timezone before zero is trusted", async t => {
  const { fetchGa4OrganicPeriod } = require("../src/lib/services/ga4-organic.ts");
  useMockGoogle(t, () => ({ rows: [], rowCount: undefined, metadata: { timeZone: "America/Los_Angeles" } }));
  const result = await fetchGa4OrganicPeriod({ start: "2025-10-20", end: "2025-10-26" });
  assert.equal(result.users, null); assert.equal(result.registrations, null);
  assert.equal(result.quality.complete, false);
  assert.ok(result.quality.reasons.includes("users:empty_response_unverified"));
});

test("interval collection refuses an unverifiable property timezone", async t => {
  const { fetchGa4OrganicPeriod } = require("../src/lib/services/ga4-organic.ts");
  useMockGoogle(t, () => ({ rows: [], metadata: {} }));
  await assert.rejects(fetchGa4OrganicPeriod({ start: "2025-10-20", end: "2025-10-26" }), /属性时区/);
});

test("real metadata-only summary is archived as unmeasured while valid user counts survive", async t => {
 const {fetchGa4OrganicPeriod}=require("../src/lib/services/ga4-organic.ts");
 useMockGoogle(t,query=>query.dimensionFilter.andGroup.expressions.length===3 ? {rows:[],dimensionHeaders:undefined,metricHeaders:undefined,rowCount:undefined,metadata:{timeZone:"America/Los_Angeles"}} : {rows:[[[],[42]]],metadata:{timeZone:"America/Los_Angeles"}});
 const result=await fetchGa4OrganicPeriod({start:"2025-10-20",end:"2025-10-26"});
 assert.equal(result.users,42);assert.equal(result.registrations,null);assert.equal(result.quality.complete,false);
 assert.deepEqual(result.quality.reasons,["registrations:empty_response_unverified"]);
});
test("missing summary headers with any nonempty or contradictory row evidence still fails",async t=>{
 const {fetchGa4OrganicPeriod}=require("../src/lib/services/ga4-organic.ts");
 useMockGoogle(t,()=>({rows:[],dimensionHeaders:undefined,metricHeaders:undefined,rowCount:3,metadata:{timeZone:"America/Los_Angeles"}}));
 await assert.rejects(fetchGa4OrganicPeriod({start:"2025-10-20",end:"2025-10-26"}),/报表字段/);
});

// Date rows, unlike a successful HTTP request, are evidence for an observed zero.
test("daily registrations distinguish missing rows, explicit zero, and observed positives", async t => {
  useMockGoogle(t, query => {
    const registration = query.metrics.some(x => x.name === "totalUsers");
    const page = query.dimensions.some(x => x.name === "landingPage");
    return { rows: registration ? [[["20251020"], [0, 0]], [["20251022"], [2, 3]]] : page ? [] : [[["20251020"], [19]]], metadata: { timeZone: "America/Los_Angeles" } };
  });
  const report = await fetchGa4Organic({ start: "2025-10-20", end: "2025-10-22" });
  assert.deepEqual(report.daily.map(({date,registrations,registrationEvidence}) => ({date,registrations,registrationEvidence})), [
    { date:"2025-10-20", registrations:0, registrationEvidence:"reported_daily_row" },
    { date:"2025-10-21", registrations:null, registrationEvidence:"missing_daily_row" },
    { date:"2025-10-22", registrations:2, registrationEvidence:"reported_daily_row" },
  ]);
});
test("a clean empty daily registration response never becomes a week of fake zeros", async t => {
  useMockGoogle(t, query => ({ rows: query.metrics.some(x=>x.name==='totalUsers') || query.dimensions.some(x=>x.name==='landingPage') ? [] : [[["20251020"],[12]]], metadata:{timeZone:"America/Los_Angeles"} }));
  const report = await fetchGa4Organic({start:"2025-10-20",end:"2025-10-26"});
  assert.equal(report.daily.length,7);
  assert.ok(report.daily.every(row=>row.registrations===null && row.registrationEvents===null && row.registrationEvidence==="missing_daily_row"));
  assert.equal(report.daily[0].sessions,12);
});

test("Flatkey omitted dates remain unknown when scalar proof fails, while independently observed sessions survive", async t => {
  useMockGoogle(t, query => {
    if (!query.dimensions) throw new Error("scalar unavailable");
    const page = query.dimensions.some(d => d.name === "landingPage");
    if (query.metrics.some(m => m.name === "totalUsers")) return { rows: [], metadata: { timeZone: "America/Los_Angeles" } };
    return { rows: [[page ? ["20251020", "/models", "flatkey.ai"] : ["20251020"], [19]]], metadata: { timeZone: "America/Los_Angeles" } };
  });
  const report = await fetchGa4Organic({ start: "2025-10-20", end: "2025-10-21" });
  assert.equal(report.daily[0].sessions, 19);
  assert.equal(report.daily[1].sessions, null);
  assert.equal(report.quality.siteSessions.complete, false);
  assert.ok(report.quality.siteSessions.reasons.includes("zero_confirmation_unavailable"));
});
