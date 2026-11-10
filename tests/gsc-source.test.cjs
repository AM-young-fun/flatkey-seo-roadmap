const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const Module = require("node:module");
const { test } = require("node:test");
const ts = require("typescript");

const originalLoad = Module._load;
Module._load = function (name, ...args) {
  return name === "server-only" ? {} : originalLoad.call(this, name, ...args);
};
require.extensions[".ts"] = (module, file) => module._compile(ts.transpileModule(readFileSync(file, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, file);

const { fetchGscDailyPages, fetchGscDateCoverage } = require("../src/lib/gsc-source.ts");
const date = "2026-10-15";
const property = "sc-domain:flatkey.ai";
const auth = { property, accessToken: "fixture-gsc-token" };
const siteTotal = { clicks: 5, impressions: 60, ctr: 5 / 60, position: 6.7 };

test("finalized daily URL rows reconcile against Search Console by-page totals", async (t) => {
  t.mock.method(globalThis, "fetch", async (url, options) => {
    assert.match(url, /^https:\/\/www\.googleapis\.com\/webmasters\/v3\/sites\/sc-domain%3Aflatkey\.ai\/searchAnalytics\/query$/);
    assert.equal(options.headers.Authorization, "Bearer fixture-gsc-token");
    assert.equal(options.redirect, "error");
    const request = JSON.parse(options.body);
    assert.equal(request.aggregationType, "byPage");
    assert.equal(request.type, "web");
    assert.equal(request.dataState, "final");
    if (request.dimensions[0] === "date") return Response.json({ rows: [{ keys: [date], ...siteTotal }] });
    return Response.json({ rows: [{ keys: ["https://flatkey.ai/models/Example"], ...siteTotal }], responseAggregationType: "byPage" });
  });
  const coverage = await fetchGscDateCoverage(date, "2026-10-16", auth);
  assert.deepEqual(coverage, { [date]: siteTotal });
  const report = await fetchGscDailyPages(date, { ...auth, totals: coverage[date] });
  assert.equal(report.state, "final");
  assert.equal(report.completeness, "reconciled");
  assert.equal(report.timeZone, "America/Los_Angeles");
  assert.deepEqual(report.pages, [{ url: "https://flatkey.ai/models/Example", ...siteTotal }]);
});

test("unfinalized days stay unavailable and an incomplete page export retains only observed rows", async (t) => {
  let pageQueries = 0;
  t.mock.method(globalThis, "fetch", async (_url, options) => {
    const request = JSON.parse(options.body);
    if (request.dimensions[0] === "date") return Response.json({});
    pageQueries += 1;
    return Response.json({ rows: [{ keys: ["https://flatkey.ai/"], clicks: 0, impressions: 3, ctr: 0, position: 2 }] });
  });
  const delayed = await fetchGscDailyPages(date, auth);
  assert.equal(delayed.state, "unavailable");
  assert.equal(delayed.totals, null);
  assert.deepEqual(delayed.pages, []);
  assert.equal(pageQueries, 0);
  const partial = await fetchGscDailyPages(date, { ...auth, totals: siteTotal });
  assert.equal(partial.state, "partial");
  assert.equal(partial.completeness, "totals_mismatch");
  assert.equal(partial.pages[0].clicks, 0);
  assert.equal(partial.pages.length, 1);
});

test("rows beyond the first page are fetched and duplicate URLs mark the report partial", async (t) => {
  const seenOffsets = [];
  const row = (index) => ({ keys: [`https://flatkey.ai/route-${index}`], clicks: 1, impressions: 2, ctr: 0.5, position: 1 });
  t.mock.method(globalThis, "fetch", async (_url, options) => {
    const request = JSON.parse(options.body);
    seenOffsets.push(request.startRow);
    return Response.json({ rows: request.startRow === 0 ? Array.from({ length: 25_000 }, (_, index) => row(index)) : [row(24_999), row(25_000)] });
  });
  const report = await fetchGscDailyPages(date, {
    ...auth,
    totals: { clicks: 25_001, impressions: 50_002, ctr: 0.5, position: 1 },
  });
  assert.deepEqual(seenOffsets, [0, 25_000]);
  assert.equal(report.pages.length, 25_001);
  assert.equal(report.state, "partial");
});

test("cluster site totals request and validate property aggregation", async t => {
  t.mock.method(globalThis, "fetch", async (_url, options) => {
    assert.equal(JSON.parse(options.body).aggregationType, "byProperty");
    return Response.json({ responseAggregationType: "byProperty", rows: [{ keys: [date], ...siteTotal }] });
  });
  const result = await fetchGscDateCoverage(date, date, { ...auth, property: "sc-domain:mochichatbot.com", aggregation: "byProperty" });
  assert.deepEqual(result[date], siteTotal);
});
