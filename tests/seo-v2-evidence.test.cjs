const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs"), ts = require("typescript");
require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, filename);
const { isLocalPreviewOrigin, isLocalPreviewRequest } = require("../src/lib/preview-origin.ts");
const { classifyPage, normalizePageUrl, parseSitemap, mergeInventory } = require("../src/lib/seo-page-inventory.ts");
const { dailyMetrics, reportPayload } = require("../src/lib/seo-report.ts");
const { closedPreset, yearAgoRange } = require("../src/lib/seo-date-range.ts");

test("preview accepts loopback host normalization but rejects foreign hosts and origins", () => {
  const request = (host, origin) => new Request("http://localhost:3104/api/reports/versions", { headers: { host, origin } });
  assert.equal(isLocalPreviewOrigin(request("127.0.0.1:3104", "http://127.0.0.1:3104")), true);
  assert.equal(isLocalPreviewOrigin(request("localhost:3104", "https://attacker.example")), false);
  assert.equal(isLocalPreviewRequest(request("attacker.example", "http://attacker.example")), false);
  assert.equal(isLocalPreviewOrigin(request("localhost:3104", "http://localhost:3105")), false);
});

test("presets follow Friday business weeks and calendar leap years", () => {
  assert.equal(closedPreset("week", "2026-11-06"), null);
  assert.deepEqual(closedPreset("lastWeek", "2026-11-06"), { start: "2026-10-30", end: "2026-11-05" });
  assert.deepEqual(yearAgoRange({ start: "2024-02-29", end: "2024-03-02" }), { start: "2023-02-28", end: "2023-03-02" });
  assert.equal(closedPreset("month", "2026-11-01"), null);
});

test("inventory preserves first discovery and never equates missing sitemap URLs to offline", () => {
  const page = { url: "https://flatkey.ai/models", category: "models", sourceUrl: "https://flatkey.ai/sitemaps/sitemap/en.xml", sitemapLastmod: null };
  const baseline = mergeInventory([], [page], "2026-11-01T10:00:00Z");
  assert.equal(baseline[0].baseline, true);
  const next = mergeInventory(baseline, [{ ...page, url: "https://flatkey.ai/models/new" }], "2026-11-02T10:00:00Z");
  assert.equal(next.length, 2);
  assert.equal(next.find(row => row.url === page.url).lastSeen, "2026-11-01T10:00:00Z");
  assert.equal(next[0].baseline, false);
  const again = mergeInventory(next, [page], "2026-11-03T10:00:00Z");
  assert.equal(again.find(row => row.url === page.url).firstSeen, baseline[0].firstSeen);
});

test("sitemap parser rejects cross-domain indexes and partial or entity-bearing XML", () => {
  assert.throws(() => parseSitemap('<sitemapindex><sitemap><loc>https://bad.example/a.xml</loc></sitemap></sitemapindex>', "source"));
  assert.throws(() => parseSitemap('<urlset><url><loc>https://flatkey.ai/</loc></url>', "source"));
  assert.throws(() => parseSitemap('<!DOCTYPE x><urlset></urlset>', "source"));
  const result = parseSitemap('<urlset><url><loc>https://flatkey.ai/models?x=1&amp;y=2</loc><lastmod>2026-11-01</lastmod></url></urlset>', "source");
  assert.equal(result.pages[0].url, "https://flatkey.ai/models?x=1&y=2");
  assert.equal(normalizePageUrl("https://flatkey.ai.evil.com/models"), null);
  assert.equal(classifyPage("https://flatkey.ai/pt/blog/gpu"), "blog");
  assert.equal(classifyPage("https://flatkey.ai/zh"), "home");
});

test("report averages preserve zero, suppress partial days, and keep comparison evidence", () => {
  const daily = { points: [{ newUsers: 10, newRegistrations: 0 }, { newUsers: 20, newRegistrations: 4 }], coverage: { completeDays: 2, days: 2 } };
  assert.deepEqual(dailyMetrics(daily), { newUsersAverage: 15, registrationsAverage: 2 });
  assert.equal(dailyMetrics({ ...daily, points: [{ newUsers: null, newRegistrations: 0 }] }).newUsersAverage, null);
  const evidence = { daily, groups: { groups: [] } };
  const input = { start: "2026-10-01", end: "2026-10-02", comparison: { start: "2026-09-01", end: "2026-09-02" } };
  const report = reportPayload(input, evidence, evidence);
  assert.equal(report.changes.newUsersAverage, 0);
  assert.equal(report.intervalRegistrations, null);
  assert.deepEqual(report.comparisonRange, input.comparison);
  assert.equal(report.comparison, evidence);
});
