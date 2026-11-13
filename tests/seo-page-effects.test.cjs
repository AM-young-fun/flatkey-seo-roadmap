const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const ts = require("typescript");

require.extensions[".ts"] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText, file);

const { optimizationEffect, optimizationTrendDays, optimizationWeekComparison } = require("../src/lib/seo-page-effects.ts");
const { pageOptimizationPriorities } = require("../src/lib/seo-page-priority.ts");
const { buildSeoDigest } = require("../src/lib/seo-digest.ts");

const url = "https://flatkey.ai/es/blog/gpu-server";
const now = new Date("2026-11-20T09:00:00Z");
const day = (date, clicks, impressions, options = {}) => ({
  date, complete: true, kind: "gsc-pages", country: "ES", property: "sc-domain:flatkey.ai",
  observedAt: "2026-11-20T08:00:00Z", rows: [{ url, clicks, impressions, position: 8 }], ...options,
});
const run = (observations, end = "2026-11-19") => optimizationEffect({
  url, site: "flatkey.ai", country: "ES", publishedAt: "2026-11-15T06:00:00Z", end, now, observations,
});

test("uses the last complete day before launch and latest same-country, same-property complete day after", () => {
  const effect = run([day("2026-11-12", 3, 100), day("2026-11-13", 9, 100, { complete: false }),
    day("2026-11-14", 80, 100), day("2026-11-17", 5, 100), day("2026-11-18", 9, 100, { property: "https://flatkey.ai/" }),
    day("2026-11-18", 8, 100, { country: "US" }), day("2026-11-19", 9, 100, { observedAt: "2026-11-20T10:00:00Z" })]);
  assert.equal(effect.launchDay, "2026-11-14");
  assert.equal(effect.before.date, "2026-11-12");
  assert.equal(effect.latest.date, "2026-11-17");
  assert.equal(effect.latest.ctr, 0.05);
  assert.equal(effect.series.find(point => point.date === "2026-11-18").clicks, null);
  assert.equal(effect.series.find(point => point.date === "2026-11-14").clicks, 80);
  assert.equal(effect.series.find(point => point.date === "2026-11-14").position, 8);
});

test("a reported zero stays zero, a missing page stays null, and the chart can mark the launch date", () => {
  const effect = run([day("2026-11-13", 0, 0), day("2026-11-14", 0, 10, { rows: [] })], "2026-11-13");
  assert.equal(effect.before.clicks, 0);
  assert.equal(effect.before.ctr, null);
  assert.equal(effect.latest, null);
  assert.equal(effect.status, "waiting");
  assert.deepEqual(effect.series.at(-1), { date: "2026-11-14", clicks: null, impressions: null, ctr: null, position: null });
});

test("partial optimization windows compare matching weekdays and weight CTR by impressions", () => {
  const days = [
    { date: "2026-11-06", value: 0, weight: 90 },
    { date: "2026-11-07", value: 0.2, weight: 10 },
    { date: "2026-11-10", value: 0.8, weight: 50 },
    { date: "2026-11-12", value: 0.9, weight: 90 },
    { date: "2026-11-13", value: 0.1, weight: 20 },
    { date: "2026-11-14", value: 0.3, weight: 80 },
    { date: "2026-11-17", value: null, weight: null },
  ];
  assert.deepEqual(optimizationWeekComparison(days, "2026-11-12"), {
    beforeValue: 0.02, afterValue: 0.26, paired: 2, beforeDays: 2, afterDays: 2,
  });
  assert.deepEqual(optimizationWeekComparison(days.slice(0, 1), "2026-11-12"), {
    beforeValue: 0, afterValue: null, paired: 0, beforeDays: 1, afterDays: 0,
  });
});

test("multiple comparable signals produce high priority; a verified recent edit moves the page to observation", () => {
  const rows = [];
  for (let i = 1; i <= 14; i++) {
    const previous = i <= 7;
    rows.push(day("2026-11-" + String(i + 4).padStart(2, "0"), 0, 0, {
      rows: [{ url, clicks: previous ? 12 : 2, impressions: previous ? 100 : 65, position: previous ? 5 : 11 }],
    }));
  }
  const task = { id: "x", siteDomain: "flatkey.ai", pageUrl: url, country: "ES", kind: "optimization", status: "ready",
    weekStart: "2026-11-16", evidence: [], research: { businessValue: 3 } };
  const priorities = publications => pageOptimizationPriorities(rows, { tasks: [task], publications }, "flatkey.ai", "ES", now).rows;
  assert.equal(priorities([])[0].priority, "高");
  assert.equal(priorities([])[0].comparable, 7);
  assert.match(priorities([])[0].reasons.join(" "), /曝光下降.*平均排名后退/);
  assert.equal(priorities([{ siteDomain: "flatkey.ai", country: "ES", pageUrl: url, status: "verified", publishedAt: "2026-11-18T09:00:00Z" }])[0].priority, "观察中");
});

test("daily and weekly report variants agree with the two points and show CTR change in percentage points", () => {
  const { series: _series, ...effect } = run([day("2026-11-13", 3, 100), day("2026-11-17", 5, 100)]);
  const row = { ...effect, id: "published-es", url, title: "Servidor GPU", country: "ES", publishedAt: "2026-11-15T06:00:00Z", change: "修改标题" };
  for (const kind of ["daily", "weekly"]) {
    const report = buildSeoDigest({ kind, now, date: "2026-11-20", notificationCompact: true, observations: [], publications: [], optimizations: [],
      effects: [], optimizationMonitoring: [row], priorities: [], issues: [], runNotes: [], publicationCoverage: "verified", optimizationCoverage: "verified" });
    assert.match(report.text, /2026-11-13 → 2026-11-17 · 点击 3 → 5 · 曝光 100 → 100 · CTR 3.00% → 5.00%/);
    assert.match(report.detailText, /CTR 3.00% → 5.00%（\+2 个百分点）/);
    assert.match(report.detailText, /optimization-effects\?publication=published-es&country=ES/);
  }
});


test("trend starts at the first measured date across both sources and keeps zero, missing days and the launch marker", () => {
  const points = [
    { date: "2026-10-23", clicks: null, impressions: null, ctr: null, position: null },
    { date: "2026-10-24", clicks: null, impressions: null, ctr: null, position: null },
    { date: "2026-10-25", clicks: null, impressions: null, ctr: null, position: null },
    { date: "2026-10-26", clicks: 2, impressions: 5, ctr: 0.4, position: 3 },
  ];
  const days = optimizationTrendDays(points, [{ date: "2026-10-24", sessions: 0, registrations: null }], "2026-10-27");
  assert.deepEqual(days.map(row => row.date), ["2026-10-24", "2026-10-25", "2026-10-26", "2026-10-27"]);
  assert.equal(days[0].sessions, 0);
  assert.equal(days[1].clicks, null);
  assert.deepEqual(optimizationTrendDays(points.slice(0, 2), [], "2026-10-27"), []);
});
