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
    const page = query.dimensions.some(({ name }) => name === "landingPage");
    const registration = query.metrics.some(({ name }) => name === "totalUsers");
    const dimensions = page ? ["20251020", "/models"] : ["20251020"];
    if (registration) {
      assert.deepEqual(query.dimensionFilter.andGroup.expressions, [channel, {
        filter: { fieldName: "eventName", stringFilter: { matchType: "EXACT", value: "sign_up_success", caseSensitive: true } },
      }]);
      return { rows: page ? [] : [[dimensions, [2, 3]]], metadata: { timeZone: "America/Los_Angeles", subjectToThresholding: true } };
    }
    assert.deepEqual(query.dimensionFilter, channel);
    return { rows: [[dimensions, [19]]], metadata: { timeZone: "America/Los_Angeles" } };
  });
  const report = await fetchGa4Organic({ start: "2025-10-20", end: "2025-10-21" });
  assert.deepEqual(report.daily, [
    { date: "2025-10-20", sessions: 19, registrations: 2, registrationEvents: 3 },
    { date: "2025-10-21", sessions: 0, registrations: null, registrationEvents: null },
  ]);
  assert.deepEqual(report.pages, [
    { date: "2025-10-20", path: "/models", sessions: 19, registrations: null, registrationEvents: null },
  ]);
  assert.deepEqual(report.quality.pageRegistrations, { complete: false, reasons: ["thresholding"] });
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
