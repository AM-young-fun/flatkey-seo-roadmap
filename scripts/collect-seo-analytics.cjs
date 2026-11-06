// This runs on the authorized collector machine, outside the web request lifecycle.
const fs = require("node:fs");
const { readFile } = require("node:fs/promises");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");
const root = path.resolve(__dirname, "..");
require("@next/env").loadEnvConfig(root, true);
const priorLoad = Module._load;
Module._load = function (name, ...args) {
  return name === "server-only" ? {} : priorLoad.call(this, name, ...args);
};
require.extensions[".ts"] = (module, file) => {
  if (!file.startsWith(path.join(root, "src") + path.sep)) throw new Error("Unexpected TypeScript module");
  const result = ts.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: file,
  });
  module._compile(result.outputText, file);
};

const { analyticsKinds, analyticsObservationSchema, rangeDays } = require("../src/lib/seo-analytics.ts");
const { writeAnalyticsEvidence, readAnalyticsEvidence } = require("../src/lib/seo-analytics-files.ts");
const { defaultRange, propertyToday, shiftDay } = require("../src/lib/seo-date-range.ts");
const { REGION_CODES } = require("../src/lib/seo.ts");
const { clusterDomainForProperty, siteReportToday } = require("../src/lib/seo-cluster-sites.ts");

function validEvidence(input) {
  const row = analyticsObservationSchema.parse(input);
  const today = row.kind === "ga4-site" ? siteReportToday(clusterDomainForProperty(row.property)) : propertyToday();
  if (row.date >= today || Date.parse(row.observedAt) > Date.now() + 300_000) {
    throw new Error("报表包含尚未结束的日期或无效采集时间");
  }
  return row;
}

async function run() {
  const args = process.argv.slice(2);
  if (args[0] === "--import" && args.length === 2) {
    const input = JSON.parse(await readFile(args[1], "utf8"));
    if (!Array.isArray(input) || input.length > analyticsKinds.length * 366 * (REGION_CODES.length + 1) || !input.length) throw new Error("请提供有效的逐日证据数组");
    const records = input.map(validEvidence);
    for (const row of records) await writeAnalyticsEvidence(row);
    const byKind = Object.groupBy(records, row => row.kind);
    console.log(JSON.stringify(Object.fromEntries(Object.entries(byKind).map(([kind, rows]) => [
      kind, { saved: rows.length, complete: rows.filter(row => row.complete).length },
    ]))));
    return;
  }
  const countryFlag = args.indexOf("--country");
  const country = countryFlag === -1 ? undefined : args.splice(countryFlag, 2)[1];
  if (args[0] !== "--api" || ![1, 3].includes(args.length) || countryFlag !== -1 && !REGION_CODES.includes(country)) {
    throw new Error("用法：node scripts/collect-seo-analytics.cjs --import <证据 JSON> 或 --api [起始 结束] [--country US|JP|ES|BR]");
  }
  const range = args.length === 3 ? { start: args[1], end: args[2] } : defaultRange();
  const dates = rangeDays(range);
  if (range.end >= propertyToday()) throw new Error("仅采集已结束的属性日");
  const saved = await readAnalyticsEvidence(range, country);
  const already = new Set(saved.filter(row => row.complete).map(row => `${row.kind}:${row.date}`));
  const ga4Days = dates.filter(date => !already.has(`ga4-site:${date}`) || !already.has(`ga4-pages:${date}`) || date >= shiftDay(range.end, -2));
  const gscDays = dates.filter(date => !already.has(`gsc-pages:${date}`) || !already.has(`gsc-page-queries:${date}`));
  const { fetchGa4Organic } = require("../src/lib/services/ga4-organic.ts");
  const { fetchGscDateCoverage, fetchGscDailyPages, fetchGscDailyPageQueries } = require("../src/lib/gsc-source.ts");

  async function ga4() {
    if (!ga4Days.length) return;
    const report = await fetchGa4Organic({ start: ga4Days[0], end: ga4Days.at(-1) }, country);
    const pagesByDate = Object.groupBy(report.pages, row => row.date);
    const pageComplete = report.quality.pageSessions.complete && report.quality.pageRegistrations.complete;
    for (const date of ga4Days) {
      const base = { date, country, observedAt: report.fetchedAt, source: "google-api", property: report.propertyId, scope: "session-organic-search" };
      const day = report.daily.find(day => day.date === date);
      const sessions = report.quality.siteSessions.complete ? day.sessions : null;
      const registrations = report.quality.siteRegistrations.complete ? day.registrations : null;
      if (sessions !== null || registrations !== null) await writeAnalyticsEvidence(validEvidence({
        ...base, kind: "ga4-site", sessions, registrations, complete: sessions !== null && registrations !== null,
      }));
      const rows = (pagesByDate[date] ?? []).map(({ path, sessions, registrations }) => ({ path, sessions, registrations }));
      if (rows.length || pageComplete) await writeAnalyticsEvidence(validEvidence({
        ...base, kind: "ga4-pages", rows, complete: pageComplete,
      }));
    }
  }
  async function gsc() {
    if (!gscDays.length) return;
    const coverage = await fetchGscDateCoverage(gscDays[0], gscDays.at(-1), { country });
    for (const date of gscDays) {
      if (!coverage[date]) continue;
      if (!already.has(`gsc-pages:${date}`)) {
        const day = await fetchGscDailyPages(date, { totals: coverage[date], country });
        if (day.state !== "unavailable") await writeAnalyticsEvidence(validEvidence({
          kind: "gsc-pages", date, country, property: day.property, observedAt: day.fetchedAt, source: "google-api",
          complete: day.state === "final", rows: day.pages.map(({ url, clicks, impressions, position }) => ({ url, clicks, impressions, position })),
        }));
      }
      if (!already.has(`gsc-page-queries:${date}`)) {
        const report = await fetchGscDailyPageQueries(date, { country });
        await writeAnalyticsEvidence(validEvidence({ kind: "gsc-page-queries", date, country, source: "google-api", ...report }));
      }
    }
  }

  const outcomes = await Promise.allSettled([ga4(), gsc()]);
  const after = await readAnalyticsEvidence(range, country);
  const coverage = Object.fromEntries(analyticsKinds.map(kind =>
    [kind, { expected: dates.length, complete: after.filter(row => row.kind === kind && row.complete).length }]));
  console.log(JSON.stringify({ ...range, country: country ?? "all", coverage, sources: outcomes.map((result, index) => ({
    source: index === 0 ? "GA4" : "GSC", ok: result.status === "fulfilled",
    reason: result.status === "rejected" ? result.reason?.code ?? "collection_error" : null,
  })) }));
  if (Object.values(coverage).some(value => value.complete !== value.expected)) process.exitCode = 2;
}

run().catch(() => {
  console.error("采集未完成：请核对日期、源报表格式与本机只读授权。");
  process.exitCode = 1;
});
