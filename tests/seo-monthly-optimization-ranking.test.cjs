const { test } = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), ts = require("typescript");
require.extensions[".ts"] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, file);
const { recentPublishedPages, bestMonthlyOptimizations } = require("../src/lib/seo-digest-recent-pages.ts");
const now = new Date("2026-11-24T02:00:00Z");
const page = (id, day = "2026-11-01", extra = {}) => ({ id, pageUrl: "https://flatkey.ai/" + id, siteDomain: "flatkey.ai", title: id,
 kind: "optimization", publishedAt: day + "T16:00:00Z", verifiedAt: day + "T16:01:00Z", verificationRecordedAt: day + "T16:02:00Z", status: "verified", ...extra });
const point = (id, day, clicks, impressions, extra = {}) => ({ kind: "gsc-pages", property: "sc-domain:flatkey.ai", date: day,
 complete: true, observedAt: "2026-11-24T01:00:00Z", rows: [{ url: "https://flatkey.ai/" + id, clicks, impressions }], ...extra });
const rank = (publications, observations, extra = {}) => recentPublishedPages({ approvals: [], publications, ...extra }, observations, "2026-11-24", now, true);

test("monthly best optimizations rank actual click gains before impression gains and omit regressions or missing baselines", () => {
 const publications = [page("large"), page("high-percent"), page("exposure-only"), page("regression"), page("flat"), page("missing"),
  page("created", "2026-11-01", { kind: "landing", automaticWrite: { operation: "create" } }),
  page("updated", "2026-11-01", { kind: "source_blog", automaticWrite: { operation: "update" } })];
 const before = { large: [100, 1000], "high-percent": [0, 10], "exposure-only": [0, 10], regression: [10, 10], flat: [1, 10], created: [0, 0], updated: [1, 10] };
 const after = { large: [110, 1100], "high-percent": [2, 20], "exposure-only": [0, 1000], regression: [9, 1000], flat: [1, 10], missing: [30, 300], created: [100, 1000], updated: [2, 30] };
 const observations = [...Object.entries(before).map(([id, values]) => point(id, "2026-10-31", ...values)),
  ...Object.entries(after).map(([id, values]) => point(id, "2026-11-22", ...values))];
 assert.deepEqual(rank(publications, observations).map(row => row.title), ["large", "high-percent", "updated", "exposure-only"]);
});

test("monthly ranking includes exactly thirty release dates and caps at ten verified improvements", () => {
 const ids = Array.from({ length: 12 }, (_, i) => "rank-" + i);
 const publications = [...ids.map((id, i) => page(id, i === 0 ? "2026-10-25" : "2026-11-01")), page("old", "2026-10-24"),
  page("future", "2026-11-24"), page("unverified", "2026-11-01", { status: "published" })];
 const observations = publications.flatMap(row => [point(row.id, "2026-10-23", 0, 0), point(row.id, "2026-11-23", ids.indexOf(row.id) + 1 || 100, 100)]);
 const ranked = rank(publications, observations);
 assert.equal(ranked.length, 10);
 assert.deepEqual(ranked.map(row => row.title), ids.slice(2).reverse());
 assert.equal(rank([publications[0]], observations)[0].day, "2026-10-25");
});

test("monthly ranking compares the latest optimization with the same search property and never treats missing data as zero", () => {
 const publications = [page("again", "2026-10-28"), page("again", "2026-11-10"), page("mixed"), page("not-yet-verified", "2026-11-01", { verifiedAt: "2026-11-25T01:00:00Z" })];
 const observations = [point("again", "2026-10-27", 0, 0), point("again", "2026-11-09", 9, 90), point("again", "2026-11-23", 10, 100),
  point("mixed", "2026-10-31", 0, 0, { property: "https://flatkey.ai/" }), point("mixed", "2026-11-23", 100, 1000),
  point("not-yet-verified", "2026-10-31", 0, 0), point("not-yet-verified", "2026-11-23", 100, 1000)];
 const ranked = rank(publications, observations);
 assert.deepEqual(ranked.map(row => row.title), ["again"]);
 assert.equal(ranked[0].before.clicks, 9);
});

test("legacy frozen rows are ranked without mutating their order or original content", () => {
 const row = (id, change, before, latest) => Object.freeze({ url: "https://flatkey.ai/" + id, title: id, day: "2026-11-01", change, cohort: "previous",
  before: { date: "2026-10-31", property: "sc-domain:flatkey.ai", clicks: before, impressions: 10 },
  latest: { date: "2026-11-22", property: "sc-domain:flatkey.ai", clicks: latest, impressions: 20 }, beforeVisits: null, latestVisits: null });
 const input = Object.freeze([row("new", "new", 0, 100), row("small", "optimization", 1, 2), row("large", "optimization", 10, 30), row("down", "optimization", 10, 0)]);
 const saved = JSON.stringify(input);
 assert.deepEqual(bestMonthlyOptimizations(input).map(row => row.title), ["large", "small"]);
 assert.equal(JSON.stringify(input), saved);
});
