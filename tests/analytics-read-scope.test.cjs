const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const Module = require("node:module");
const ts = require("typescript");

require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, filename);

const range = { start: "2026-10-04", end: "2026-10-05" };
const base = { date: range.start, observedAt: "2026-11-04T03:00:00.000Z", source: "browser-export", complete: true };
const url = "https://flatkey.ai/models/example";
const fixtures = [
  { ...base, property: "541304395", hostScope: "production-hosts-v1", scope: "session-organic-search", kind: "ga4-site", sessions: 0, registrations: 0 },
  { ...base, property: "sc-domain:flatkey.ai", kind: "gsc-site", clicks: 2, impressions: 10, position: 5 },
  { ...base, property: "541304395", hostScope: "production-hosts-v1", scope: "session-organic-search", kind: "ga4-pages",
    rows: Array.from({ length: 1000 }, (_, i) => ({ hostname: "flatkey.ai", path: i ? `/models/example-${i}` : "/models/example", sessions: i + 1, registrations: 0 })) },
  { ...base, property: "sc-domain:flatkey.ai", kind: "gsc-pages",
    rows: [{ url, clicks: 2, impressions: 10, position: 5 }] },
  { ...base, property: "sc-domain:flatkey.ai", kind: "gsc-page-queries",
    rows: [{ url, query: "example model", clicks: 2, impressions: 10, position: 5 }] },
];
const storedKind = row => [row.kind, row.country,
  row.property === "558899190" || row.property === "https://rackrate.org/" ? "rackrate.org" : null].filter(Boolean).join(":");
let query, returnedBytes, trafficQuery, trafficPeriodQuery, data = fixtures, localPreview = false, priorityWorkspaceReads = 0;
const load = Module._load;
Module._load = function (name, ...args) {
  if (name === "@/lib/seo-analytics-access") return {
    authorizeAnalyticsRead: async () => true,
    analyticsLocalPreview: () => localPreview,
    privateAnalyticsHeaders: { "Cache-Control": "private, no-store" },
  };
  if (name === "@/lib/prisma") return { prisma: { seoAnalyticsDay: { findMany: async input => {
    query = input;
    if (input.where.kind?.in.includes("flatkey-traffic-summary-v1")) trafficQuery = input;
    if (input.where.kind?.in.some(kind => kind.startsWith("flatkey-traffic-summary-period-v1:"))) {
      trafficPeriodQuery = input;
      return data.filter(row=>row.kind === "flatkey-traffic-summary-period-v1" && input.where.date.in.includes(row.end))
        .map(payload => ({ payload, date: payload.end }));
    }
    const rows = data.filter(row => (input.where.OR ?? [input.where]).some(where => where.kind.in.includes(storedKind(row))
      && row.date >= where.date.gte && row.date <= where.date.lte))
      .map(payload => ({ payload, kind: storedKind(payload), date: payload.date }));
    returnedBytes = Buffer.byteLength(JSON.stringify(rows));
    return rows;
  } } } };
  if (name === "@/lib/services/ranking-coverage-access") return { authorizeSavedRankingCoverage: async () => false };
  if (name === "@/lib/services/seo-workflow") return { loadWorkflowSnapshot: async () => ({ tasks: [], publications: [] }) };
  if (name === "@/lib/services/growth-workspace") return { loadGrowthDashboardWorkspace: async (_local, now, site) => {
    priorityWorkspaceReads++;
    return { targets: Array.from({ length: 12 }, (_, index) => ({ id: `target-${index}`, site, country: "JP", language: "ja", keyword: `GPU価格 ${index}`,
      publishedUrls: [url], maintenancePublishedUrls: [url], languageStatus: "match", observationEligible: index < 11,
      rank: null, rankSource: "serp", rankUrl: null, checkedAt: now.toISOString(), captureState: "outside100" })) };
  } };
  return load.call(this, name.startsWith("@/") ? path.resolve(__dirname, "../src", name.slice(2)) + ".ts" : name, ...args);
};
const { GET } = require("../src/app/api/seo/analytics/route.ts");
Module._load = load;
const { analyticsView, analyticsObservationSchema, observedPageUrls, pageDailyView, pageQueryView } = require("../src/lib/seo-analytics.ts");
const { overviewModuleAnalytics } = require("../src/lib/seo-overview-analytics.ts");
const request = extra => new Request("https://workspace.invalid/api/seo/analytics?" + new URLSearchParams(range) + extra);
const read = async extra => {
  const response = await GET(request(extra));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "private, no-store");
  return response.json();
};
const view = (rows = fixtures, urls = []) => ({ ...analyticsView(range, urls, rows), country: "all", site: "flatkey.ai" });

test("priority validates filters and serves paginated only-published keyword suggestions", async () => {
  const count = priorityWorkspaceReads;
  for (const extra of ["&rank=invalid", "&rank=pending&rank=all", "&page=0", "&site=rougecue.org"]) {
    assert.equal((await GET(request("&priority=1&country=JP" + extra))).status, 400);
  }
  assert.equal(priorityWorkspaceReads, count);
  const first = await read("&priority=1&country=JP&rank=outside100");
  assert.deepEqual(first.pagination, { page: 1, pageCount: 2, total: 11 });
  assert.equal(first.rows.length, 10);
  assert.ok(first.rows.every(row => row.rankStatus === "outside100" && row.rank === null));
  assert.deepEqual(first.counts, { outside100: 11, ranked: 0, pending: 1 });
  assert.deepEqual(query.where.kind.in, ["gsc-pages:JP"]);
  const second = await read("&priority=1&country=JP&rank=outside100&page=2");
  assert.equal(second.rows.length, 1);
  assert.equal(second.pagination.page, 2);
});

test("site totals exclude landing/search page payloads while preserving every response field, zeros and missing dates", async () => {
  const actual = await read("");
  assert.deepEqual(actual, view());
  assert.deepEqual(actual.daily, [{ date: range.start, sessions: 0, registrations: 0 }, { date: range.end, sessions: null, registrations: null }]);
  assert.deepEqual(query.where.kind.in, ["ga4-site", "gsc-site"]);
  assert.ok(returnedBytes < Buffer.byteLength(JSON.stringify(fixtures)) / 50);
});

test("country and cluster totals keep their original storage identity and output", async () => {
  try {
    data = fixtures.map(row => ({ ...row, country: "JP" }));
    const country = await read("&country=JP");
    assert.deepEqual(country, { ...analyticsView(range, [], data), country: "JP", site: "flatkey.ai" });
    assert.deepEqual(query.where.kind.in, ["ga4-site:JP", "gsc-site:JP"]);
    data = fixtures.filter(row => row.kind.endsWith("-site")).map(row => ({ ...row,
      property: row.kind === "ga4-site" ? "558899190" : "https://rackrate.org/" }));
    const cluster = await read("&site=rackrate.org");
    assert.deepEqual(query.where.kind.in, ["ga4-site:rackrate.org", "gsc-site:rackrate.org"]);
    assert.deepEqual(cluster, { site: "rackrate.org", country: "all", daily: analyticsView(range, [], data).daily.map(day => ({ ...day,
      clicks: day.date === range.start ? 2 : null, impressions: day.date === range.start ? 10 : null, searchFinal: day.date === range.start })) });
  } finally { data = fixtures; }
});

test("page lists, individual daily evidence, module metadata and query reports retain their full original data", async () => {
  const fullKinds = ["ga4-site", "gsc-site", "ga4-pages", "gsc-pages"];
  assert.deepEqual(await read("&url=" + encodeURIComponent(url)), view(fixtures, [url]));
  assert.deepEqual(query.where.kind.in, fullKinds);
  assert.deepEqual(await read("&pages=all"), view(fixtures, observedPageUrls(fixtures)));
  assert.deepEqual(query.where.kind.in, fullKinds);
  assert.deepEqual(await read("&pageDaily=1&url=" + encodeURIComponent(url)), { ...view(fixtures, [url]), pageDaily: pageDailyView(range, url, fixtures) });
  assert.deepEqual(query.where.kind.in, fullKinds);
  assert.deepEqual(await read("&module=models"), { ...overviewModuleAnalytics(range, "models", fixtures), country: "all", site: "flatkey.ai" });
  assert.deepEqual(query.where.kind.in, fullKinds);
  assert.deepEqual(await read("&pageQueries=1&url=" + encodeURIComponent(url)), { ...pageQueryView(range, fixtures, url), country: "all", site: "flatkey.ai" });
  assert.deepEqual(query.where.kind.in, ["gsc-page-queries"]);
  await read("&priority=1&country=JP");
  assert.deepEqual(query.where.kind.in, ["gsc-pages:JP"]);
});

test("summary aggregation never touches unused page rows, including when called outside the route", () => {
  const unreadPages = fixtures.filter(row => row.kind.endsWith("-pages")).map(row => ({ ...row, get rows() { throw Error("unused page rows were indexed"); } }));
  assert.deepEqual(analyticsView(range, [], [...fixtures.filter(row => row.kind.endsWith("-site")), ...unreadPages]), analyticsView(range, [], fixtures));
});

test("one bounded overview traffic read combines both windows and module totals without sending raw URLs", async () => {
  const previous = { start: "2025-10-04", end: "2025-10-05" };
  try {
    data = [...fixtures, { ...fixtures[0], date: previous.start, sessions: 82 }, { ...fixtures[2], date: previous.start }, { ...fixtures[0], date: "2026-02-04", sessions: 999 }];
    const view = await read(`&view=overview-traffic&compareStart=${previous.start}&compareEnd=${previous.end}`);
    assert.deepEqual(query.where.OR, [
      { date: { gte: range.start, lte: range.end }, kind: { in: ["ga4-site", "ga4-pages"] } },
      { date: { gte: previous.start, lte: previous.end }, kind: { in: ["ga4-site"] } },
    ]);
    assert.deepEqual(view.current.map(day => day.sessions), [0, null]);
    assert.deepEqual(view.previous.map(day => day.sessions), [82, null]);
    assert.deepEqual(view.modules, { sessions: { models: 500500 }, complete: false });
    assert.doesNotMatch(JSON.stringify(view), /example-|landingDaily|pages/);
    const legacy = await read("&pages=all&landingDaily=1");
    assert.ok(Buffer.byteLength(JSON.stringify(view)) < Buffer.byteLength(JSON.stringify(legacy)) / 100);
    const module = await read(`&view=overview-traffic&module=models&compareStart=${previous.start}&compareEnd=${previous.end}`);
    assert.deepEqual(query.where.OR.map(row => row.kind.in), [["ga4-pages", "gsc-pages"], ["ga4-pages", "gsc-pages"]]);
    assert.equal(module.current[0].sessions, 500500);
    assert.equal(module.current[0].clicks, 2);
    assert.equal(module.previous[0].clicks, null);
    assert.equal(module.previous[0].sessions, 500500);
  } finally { data = fixtures; }
});

test("overview mode rejects incompatible parameters and incomplete comparisons before reading source records", async () => {
  for (const extra of ["&view=overview-traffic&compareStart=2026-10-01", "&view=overview-traffic&pages=all", "&view=overview-traffic&site=rackrate.org", "&view=overview-traffic&country=JP&country=US", "&view=overview-traffic&module=unavailable"]) {
    query = undefined;
    assert.equal((await GET(request(extra))).status, 400);
    assert.equal(query, undefined);
  }
});

test("local summary preview filters by kind before opening and validating page archive files", async () => {
  const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), "seo-summary-read-"));
  const previous = process.env.SEO_ANALYTICS_STORE_DIR;
  try {
    process.env.SEO_ANALYTICS_STORE_DIR = directory;
    const stamp = Date.parse(base.observedAt);
    for (const row of fixtures.filter(row => row.kind.endsWith("-site"))) {
      analyticsObservationSchema.parse(row);
      await fs.promises.writeFile(path.join(directory, `${row.date}~${row.kind}~1~${stamp}.json`), JSON.stringify(row));
    }
    await fs.promises.writeFile(path.join(directory, `${range.start}~ga4-pages~1~${stamp}.json`), "unread page archive");
    localPreview = true;
    assert.deepEqual(await read(""), view());
    assert.equal((await GET(request("&pages=all"))).status, 503, "page requests still validate the actual page evidence");
  } finally {
    localPreview = false;
    if (previous === undefined) delete process.env.SEO_ANALYTICS_STORE_DIR;
    else process.env.SEO_ANALYTICS_STORE_DIR = previous;
    await fs.promises.rm(directory, { recursive: true, force: true });
  }
});


test("brand traffic uses final visible queries on the official Flatkey site only and keeps missing days blank", async () => {
  const baseReport = fixtures.find(row => row.kind === "gsc-page-queries");
  const queryRow = baseReport.rows[0];
  data = [...fixtures.filter(row => row !== baseReport), { ...baseReport, rows: [
    queryRow, { ...queryRow, query: "Ｆｌａｔ－Ｋｅｙ router", clicks: 5 },
    { ...queryRow, query: "flatkeyless", clicks: 3 },
    { ...queryRow, query: "nvidia gpu", clicks: 7 },
    { ...queryRow, url: "https://console.flatkey.ai/", query: "Flatkey login", clicks: 100 },
  ] }, { ...baseReport, date: range.end, complete: false }];
  try {
    const result = await read("&view=brand-traffic");
    assert.deepEqual(result.daily, [{ date: range.start, branded: 5, nonBranded: 12 },
      { date: range.end, branded: null, nonBranded: null }]);
    assert.deepEqual(query.where.kind.in, ["gsc-page-queries"]);
    assert.equal((await GET(request("&view=brand-traffic&country=US"))).status, 400);
  } finally { data = fixtures; }
});

test("the traffic overview reads only session sources and retains the exact requested period", async () => {
  const payload = await read("&view=traffic-overview");
  assert.deepEqual(trafficQuery.where.kind.in, ["flatkey-traffic-summary-v1", "ga4-pages"]);
  assert.deepEqual(trafficPeriodQuery.where.kind.in, ["flatkey-traffic-summary-period-v1:2"]);
  assert.deepEqual(trafficPeriodQuery.where.date.in, ["2026-10-03", "2026-10-05"]);
  assert.equal(payload.start, range.start);
  assert.equal(payload.end, range.end);
  assert.equal(payload.automatic, false);
  assert.deepEqual(payload.comparison, { previous: {start:"2026-10-02",end:"2026-10-03"},
    totalSessions:{current:null,previous:null},organicSessions:{current:null,previous:null},
    totalRegistrations:{current:null,previous:null},organicRegistrations:{current:null,previous:null} });
  assert.equal(payload.modules.complete, false);
  assert.equal(payload.moduleDays[0].sessions.models, 500500);
  assert.ok(payload.daily.every(row => row.site.organicSessions === null));
  assert.equal((await GET(new Request("https://workspace.invalid/api/seo/analytics?view=traffic-overview&start=2026-10-04"))).status, 400);
  assert.equal((await GET(request("&view=traffic-overview&country=JP"))).status, 400);
});

test("cluster overview compares equal windows using each property's archived sessions", async () => {
  const rackrate = { ...base, property: "558899190", scope: "session-organic-search", kind: "ga4-site",
    sessions: 0, registrations: null, complete: false };
  data = [...fixtures, rackrate, { ...rackrate, date: range.end, sessions: 17 },
    { ...rackrate, date: "2026-10-02", sessions: 10 }, { ...rackrate, date: "2026-10-03", sessions: 0 },
    { ...rackrate, country: "JP", sessions: 800 }];
  try {
    const result = await read("&view=cluster-traffic");
    assert.deepEqual(query.where.date, { gte: "2026-10-02", lte: range.end });
    assert.equal(query.where.kind.in.length, 5);
    assert.ok(query.where.kind.in.every(kind => kind.startsWith("ga4-site:")));
    assert.deepEqual(result.previous, { start: "2026-10-02", end: "2026-10-03" });
    assert.equal(result.sites.length, 5);
    const site = result.sites.find(site => site.domain === "rackrate.org");
    assert.equal(site.timezone, "Asia/Shanghai");
    assert.deepEqual(site.current, { total: 17, recordedDays: 2 });
    assert.deepEqual(site.previous, { total: 10, recordedDays: 2 });
    assert.deepEqual(site.daily, [{ date: range.start, sessions: 0 }, { date: range.end, sessions: 17 }]);
    const missing = result.sites.find(site => site.domain === "rougecue.org");
    assert.deepEqual(missing.current, { total: null, recordedDays: 0 });
    assert.ok(missing.daily.every(row => row.sessions === null));
    assert.equal((await GET(request("&view=cluster-traffic&country=JP"))).status, 400);
    data = data.filter(row => row.property !== rackrate.property || row.date !== range.end);
    const partial = (await read("&view=cluster-traffic")).sites.find(site => site.domain === "rackrate.org");
    assert.deepEqual(partial.current, { total: null, recordedDays: 1 });
    assert.equal(partial.daily[1].sessions, null);
  } finally { data = fixtures; }
});
