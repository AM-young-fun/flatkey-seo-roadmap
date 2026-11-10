const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const ts = require("typescript");
require.extensions[".ts"] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, file);
const { analyticsObservationSchema, analyticsView, landingTrafficDays, observedPageUrls, pageDailyView, pageQueryView, rangeDays, safeAnalyticsUrl } = require("../src/lib/seo-analytics.ts");
const range = { start: "2026-10-04", end: "2026-10-05" };
const observedAt = "2026-11-04T03:00:00.000Z";
const ga4 = { observedAt, source: "browser-export", property: "541304395", scope: "session-organic-search" };
const gsc = { observedAt, source: "browser-export", property: "sc-domain:flatkey.ai" };
const url = "https://flatkey.ai/zh/models";
const day = (date, sessions, registrations) => ({ ...ga4, kind: "ga4-site", date, sessions, registrations, complete: sessions !== null && registrations !== null });

test("long GSC queries survive import and aggregation without dropping the day's report", () => {
  const query = "long search query ".repeat(160);
  const report = analyticsObservationSchema.parse({ ...gsc, kind: "gsc-page-queries", date: range.start,
    complete: true, rows: [{ url, query, clicks: 1, impressions: 4, position: 3 }] });
  assert.equal(pageQueryView(range, [report], url).rows[0].query, query);
  assert.equal(pageQueryView(range, [report], url).rows[0].clicks, 1);
});

test("session reports preserve a measured zero and never fill a missing date", () => {
  const response = analyticsView(range, [], [day(range.start, 0, 0)]);
  assert.equal(response.ga4.status, "partial");
  assert.deepEqual(response.daily, [
    { date: range.start, sessions: 0, registrations: 0 },
    { date: range.end, sessions: null, registrations: null },
  ]);
  assert.equal(response.ga4.through, range.start);
});

test("GA4 evidence cannot accept first-user scope or claim a partial site day is complete", () => {
  assert.equal(analyticsObservationSchema.safeParse({ ...day(range.start, 1, 1), scope: "first-user" }).success, false);
  assert.equal(analyticsObservationSchema.safeParse({ ...day(range.start, 1, null), complete: true }).success, false);
});

test("GA4 joins the entry path, GSC keeps canonical URLs and weights its aggregates by impressions", () => {
  const data = [
    { ...ga4, kind: "ga4-pages", date: range.start, complete: true, rows: [{ hostname: "flatkey.ai", path: "/zh/models", sessions: 2, registrations: 1 }] },
    { ...ga4, kind: "ga4-pages", date: range.end, complete: false, rows: [{ hostname: "flatkey.ai", path: "/zh/models", sessions: 6, registrations: null }] },
    { ...gsc, kind: "gsc-pages", date: range.start, complete: true, rows: [{ url, clicks: 2, impressions: 10, position: 12 }] },
    { ...gsc, kind: "gsc-pages", date: range.end, complete: false, rows: [{ url, clicks: 4, impressions: 30, position: 4 }] },
  ].map(row => analyticsObservationSchema.parse(row));
  const tagged = url + "?utm_source=example";
  const response = analyticsView(range, [url, tagged, "https://flatkey.ai/models"], data);
  assert.deepEqual(response.pages[0], { url, ga4: { sessions: 8, registrations: null, days: 2 }, gsc: { clicks: 6, impressions: 40, ctr: 0.15, position: 6, days: 2 } });
  assert.equal(response.pages[1].url, tagged);
  assert.equal(response.pages[1].gsc, null);
  assert.equal(response.pages[2].ga4, null);
  assert.equal(response.ga4.status, "partial");
  assert.equal(response.gsc.status, "partial");
});

test("Analytics refuses external or credential-bearing URL filters and invalid calendar dates", () => {
  assert.equal(safeAnalyticsUrl("https://flatkey.ai.evil.test/models"), false);
  assert.equal(safeAnalyticsUrl("https://name:secret@flatkey.ai/models"), false);
  assert.throws(() => rangeDays({ start: "2026-02-30", end: "2026-03-01" }));
});

test("a later incomplete archive cannot displace verified complete evidence", async t => {
  const os = require("node:os");
  const path = require("node:path");
  const { writeAnalyticsEvidence, readAnalyticsEvidence } = require("../src/lib/seo-analytics-files.ts");
  const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), "seo-evidence-test-"));
  const previous = process.env.SEO_ANALYTICS_STORE_DIR;
  process.env.SEO_ANALYTICS_STORE_DIR = directory;
  t.after(async () => {
    if (previous === undefined) delete process.env.SEO_ANALYTICS_STORE_DIR;
    else process.env.SEO_ANALYTICS_STORE_DIR = previous;
    await fs.promises.rm(directory, { recursive: true });
  });
  await writeAnalyticsEvidence(day(range.start, 7, 1));
  await writeAnalyticsEvidence({ ...day(range.start, 9, null), observedAt: "2026-11-04T04:00:00.000Z" });
  assert.deepEqual(await readAnalyticsEvidence(range), [day(range.start, 7, 1)]);
  await writeAnalyticsEvidence({ ...day(range.start, 8, 1), observedAt: "2026-11-04T05:00:00.000Z" });
  assert.equal((await readAnalyticsEvidence(range))[0].sessions, 8);
  await writeAnalyticsEvidence({ ...day(range.start, 2, 0), country: "US" });
  assert.equal((await readAnalyticsEvidence(range))[0].sessions, 8);
  assert.equal((await readAnalyticsEvidence(range, "US"))[0].sessions, 2);
  assert.deepEqual(await readAnalyticsEvidence(range, "JP"), []);
});


test("all-page enumeration includes later-ranked pages without a pagination window", () => {
  const rows = Array.from({ length: 40 }, (_, index) => ({ hostname: "flatkey.ai", path: `/page-${index}`, sessions: index, registrations: 0 }));
  const observations = [{ ...ga4, kind: "ga4-pages", date: range.start, complete: true, rows }];
  const urls = observedPageUrls(observations);
  assert.equal(urls.length, 40);
  const response = analyticsView(range, urls, observations);
  const ranked = [...response.pages].sort((a, b) => b.ga4.sessions - a.ga4.sessions);
  assert.equal(ranked[0].url, "https://flatkey.ai/page-39");
  assert.equal(ranked[0].ga4.sessions, 39);
});

test("single-page daily trends use landing-page evidence, preserving zeros and gaps", () => {
  const observations = [day(range.start, 999, 99),
    { ...ga4, kind: "ga4-pages", date: range.start, complete: true, rows: [{ hostname: "flatkey.ai", path: "/zh/models", sessions: 3, registrations: 0 }] },
    { ...gsc, kind: "gsc-pages", date: range.end, complete: true, rows: [{ url, clicks: 0, impressions: 10, position: 8 }] },
  ];
  assert.deepEqual(pageDailyView(range, url, observations), [
    { date: range.start, sessions: 3, registrations: 0, clicks: null, impressions: null, position: null },
    { date: range.end, sessions: null, registrations: null, clicks: 0, impressions: 10, position: 8 },
  ]);
});

test("landing URL variants add sessions without double-counting distinct registrants", () => {
  const observations = [
    { ...ga4, kind: "ga4-pages", date: range.start, complete: true, rows: [
      { hostname: "flatkey.ai", path: "/zh/models", sessions: 3, registrations: 1 },
      { hostname: "flatkey.ai", path: "/zh/models?campaign=x", sessions: 4, registrations: 1 },
      { hostname: "flatkey.ai", path: "//evil.test/", sessions: 99, registrations: 99 },
    ] },
    { ...gsc, kind: "gsc-pages", date: range.start, complete: true, rows: [
      { url: "https://evil.test/", clicks: 90, impressions: 100, position: 1 },
      { url, clicks: 1, impressions: 2, position: 5 },
    ] },
  ];
  assert.deepEqual(observedPageUrls(observations), [url]);
  const daily = pageDailyView(range, url, observations)[0];
  assert.equal(daily.sessions, 7);
  assert.equal(daily.registrations, null);
  assert.deepEqual(landingTrafficDays(range, observations)[0].paths, [["https://flatkey.ai/zh/models", 7, null]]);
});

test("catalog session totals can use verified sessions without counting missing registrations as zero", () => {
  const reports = [
    { ...ga4, kind: "ga4-pages", date: range.start, complete: true, rows: [{ hostname: "flatkey.ai", path: "/zh/models", sessions: 5, registrations: 0 }] },
    { ...ga4, kind: "ga4-pages", date: range.end, complete: false, sessionsComplete: true, rows: [{ hostname: "flatkey.ai", path: "/zh/models", sessions: 6, registrations: null }] },
  ].map(row => analyticsObservationSchema.parse(row));
  assert.deepEqual(landingTrafficDays(range, reports), [
    { date: range.start, paths: [["https://flatkey.ai/zh/models", 5, 0]], registrationsComplete: true },
    { date: range.end, paths: [["https://flatkey.ai/zh/models", 6, null]], registrationsComplete: false },
  ]);
});

test("keyword metrics join exact page and query, use the selected dates and weight position by impressions", () => {
  const query = "models";
  const samePage = { url, query, clicks: 0, impressions: 10, position: 12 };
  const reports = [
    { ...gsc, kind: "gsc-page-queries", date: range.start, complete: false, rows: [samePage, { ...samePage, url: "https://flatkey.ai/models" }] },
    { ...gsc, kind: "gsc-page-queries", date: range.end, complete: true, rows: [{ ...samePage, clicks: 6, impressions: 30, position: 4 }] },
    { ...gsc, kind: "gsc-page-queries", date: "2026-10-06", complete: true, rows: [samePage] },
  ].map(row => analyticsObservationSchema.parse(row));
  assert.deepEqual(pageQueryView(range, reports, url), {
    recordedDays: 2, partial: true, rows: [{ url, query, clicks: 6, impressions: 40, position: 6 }],
  });
  assert.equal(pageQueryView(range, reports).rows.length, 2);
  assert.equal(analyticsObservationSchema.safeParse({ ...reports[0], rows: [samePage, samePage] }).success, false);
});

test("the same landing path on website, www and console is never copied across hostnames; legacy unknown-host rows remain unassigned", () => {
  const legacy = { ...ga4, kind: "ga4-pages", date: range.start, complete: true, rows: [{ path: "/models", sessions: 99, registrations: 9 }] };
  const hosts = ["flatkey.ai", "www.flatkey.ai", "console.flatkey.ai"];
  const urls = hosts.map(host => `https://${host}/models`);
  assert.deepEqual(analyticsView(range, urls, [legacy]).pages.map(row => row.ga4), [null, null, null]);
  assert.equal(analyticsView(range, urls, [legacy]).ga4.status, "partial");
  assert.deepEqual(observedPageUrls([legacy]), []);
  const current = analyticsObservationSchema.parse({ ...legacy, hostnameDimension: "hostName", rows: hosts.map((hostname, index) => ({ hostname, path: "/models", sessions: index + 1, registrations: 0 })) });
  assert.deepEqual(analyticsView(range, urls, [current]).pages.map(row => row.ga4.sessions), [1, 2, 3]);
  assert.deepEqual(landingTrafficDays(range, [current])[0].paths.map(row => row[0]), urls);
});

test("cluster and main GSC totals/queries validate their own registered property, including sc-domain properties", () => {
  const properties = ["sc-domain:flatkey.ai", "sc-domain:mochichatbot.com", "sc-domain:jev-llm.com", "https://rackrate.org/", "https://modelfit.cc/"];
  for (const property of properties) assert.equal(analyticsObservationSchema.safeParse({ ...gsc, kind: "gsc-site", property, date: range.start, complete: true, clicks: 1, impressions: 8, position: 4 }).success, true);
  const cluster = { ...gsc, kind: "gsc-page-queries", property: "sc-domain:jev-llm.com", date: range.start, complete: true,
    rows: [{ url: "https://jev-llm.com/models", query: "AI model", clicks: 1, impressions: 8, position: 4 }] };
  assert.equal(analyticsObservationSchema.safeParse(cluster).success, true);
  assert.equal(analyticsObservationSchema.safeParse({ ...cluster, property: "sc-domain:flatkey.ai" }).success, false);
  const ga = { ...ga4, property: "558899190", kind: "ga4-pages", date: range.start, complete: false, sessionsComplete: true,
    rows: [{ hostname: "rackrate.org", path: "/", sessions: 4, registrations: null }] };
  assert.equal(analyticsObservationSchema.safeParse(ga).success, true);
  assert.equal(analyticsObservationSchema.safeParse({ ...ga, property: "541304395" }).success, false);
  assert.equal(analyticsView(range, ["https://rackrate.org/"], [analyticsObservationSchema.parse(ga)]).pages[0].ga4.sessions, 4);
});

test("a period never adds per-day distinct registrants into a fake unique-user total", () => {
  const rows = [range.start, range.end].map(date => ({ ...ga4, kind: "ga4-pages", date, complete: true,
    rows: [{ hostname: "flatkey.ai", path: "/", sessions: 4, registrations: 1 }] }));
  const result = analyticsView(range, ["https://flatkey.ai/"], rows).pages[0].ga4;
  assert.equal(result.sessions, 8); assert.equal(result.registrations, null);
});
