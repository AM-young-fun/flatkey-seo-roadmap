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
let query, returnedBytes, data = fixtures, localPreview = false;
const load = Module._load;
Module._load = function (name, ...args) {
  if (name === "@/lib/seo-analytics-access") return {
    authorizeAnalyticsRead: async () => true,
    analyticsLocalPreview: () => localPreview,
    privateAnalyticsHeaders: { "Cache-Control": "private, no-store" },
  };
  if (name === "@/lib/prisma") return { prisma: { seoAnalyticsDay: { findMany: async input => {
    query = input;
    const rows = data.filter(row => input.where.kind.in.includes([row.kind, row.country, row.property === "558899190" || row.property === "https://rackrate.org/" ? "rackrate.org" : null].filter(Boolean).join(":")))
      .map(payload => ({ payload }));
    returnedBytes = Buffer.byteLength(JSON.stringify(rows));
    return rows;
  } } } };
  if (name === "@/lib/services/seo-workflow") return { loadWorkflowSnapshot: async () => ({ tasks: [], publications: [] }) };
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
