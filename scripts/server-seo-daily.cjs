// This runs on the authorized collector machine, outside the web request lifecycle.
const fs = require("node:fs");
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


const { analyticsObservationSchema, analyticsStorageKind } = require("../src/lib/seo-analytics.ts");
const { propertyToday, shiftDay } = require("../src/lib/seo-date-range.ts");
const { CLUSTER_SITES, clusterDomainForProperty } = require("../src/lib/seo-cluster-sites.ts");
const { fetchGa4Organic, fetchGa4SiteSessions } = require("../src/lib/services/ga4-organic.ts");
const { fetchGscDateCoverage, fetchGscDailyPages, fetchGscDailyPageQueries } = require("../src/lib/gsc-source.ts");

const endpoint = "https://flatkey-seo-roadmap.vercel.app/api/seo/analytics/import";
const credential = process.env.SEO_IMPORT_TOKEN;
const sites = [{ domain: "flatkey.ai", ga4: "541304395", gsc: "sc-domain:flatkey.ai", ga4TimeZone: "America/Los_Angeles" }, ...CLUSTER_SITES];
const start = shiftDay(propertyToday(), -90);
let failures = 0;
let imported = 0;

async function api(suffix = "", record) {
  const response = await fetch(endpoint + suffix, {
    method: record ? "POST" : "GET",
    headers: { authorization: "Bearer " + credential, "content-type": "application/json" },
    ...(record ? { body: JSON.stringify(record) } : {}),
    signal: AbortSignal.timeout(60000), redirect: "error",
  });
  if (!response.ok) throw new Error("production_" + response.status);
  return response.json();
}
function recordKey(row) {
  return analyticsStorageKind(row.kind, row.country, clusterDomainForProperty(row.property));
}
async function save(input) {
  const record = analyticsObservationSchema.parse(input);
  const receipt = await api("", record);
  if (typeof receipt.stored !== "boolean") throw new Error("invalid_import_receipt");
  const params = new URLSearchParams({ start: record.date, end: record.date, kind: recordKey(record) });
  const readback = (await api("?" + params)).rows?.[0];
  if (!readback || !readback.payload || readback.complete < record.complete
      || (readback.complete === record.complete && Date.parse(readback.observedAt) < Date.parse(record.observedAt))) {
    throw new Error("production_readback_failed");
  }
  if (Date.parse(readback.observedAt) === Date.parse(record.observedAt)) {
    // The complete payload is compared recursively through canonical JSON below.
    const normalize = value => Array.isArray(value) ? value.map(normalize)
      : value && typeof value === "object" ? Object.fromEntries(Object.keys(value).sort().map(key => [key, normalize(value[key])])) : value;
    if (JSON.stringify(normalize(readback.payload)) !== JSON.stringify(normalize(JSON.parse(JSON.stringify(record))))) {
      throw new Error("production_values_differ");
    }
  }
  imported += Number(receipt.stored);
}
async function run() {
  if (!credential || !process.env.SEO_GOOGLE_SERVICE_ACCOUNT_JSON) throw new Error("missing_server_credentials");
  const coverage = (await api("?" + new URLSearchParams({ start, end: propertyToday() }))).rows;
  if (!Array.isArray(coverage)) throw new Error("invalid_coverage");
  const saved = new Map(coverage.map(row => [row.kind + ":" + row.date, row]));
  for (const site of sites) for (const country of [undefined, "US", "JP", "ES", "BR"]) {
    const flatkey = site.domain === "flatkey.ai";
    const end = shiftDay(propertyToday(site.ga4TimeZone), -1);
    const range = { start, end };
    for (const source of ["GA4", "GSC"]) {
      try {
        let sourceDates = 0;
        const common = { country, source: "google-api" };
        if (source === "GA4") {
          const report = flatkey ? await fetchGa4Organic(range, country)
            : await fetchGa4SiteSessions(range, site.ga4, site.ga4TimeZone, country);
          if (!report.daily.length) throw new Error("source_has_no_data");
          const base = { ...common, property: site.ga4, scope: "session-organic-search", observedAt: report.fetchedAt };
          for (const day of report.daily) {
            const sessions = flatkey ? (report.quality.siteSessions.complete ? day.sessions : null) : day.sessions;
            const registrations = flatkey && report.quality.siteRegistrations.complete ? day.registrations : null;
            if (sessions === null && registrations === null) continue;
            const old = saved.get(recordKey({ ...base, kind: "ga4-site" }) + ":" + day.date);
            if (old?.complete && day.date < shiftDay(end, -6)) continue;
            await save({ ...base, kind: "ga4-site", date: day.date, sessions, registrations, complete: sessions !== null && registrations !== null });
            sourceDates++;
          }
          if (flatkey) {
            const pages = Object.groupBy(report.pages, row => row.date);
            const complete = report.quality.pageSessions.complete && report.quality.pageRegistrations.complete;
            for (const day of report.daily) {
              const old = saved.get(recordKey({ ...base, kind: "ga4-pages" }) + ":" + day.date);
              if (old?.complete && day.date < shiftDay(end, -6)) continue;
              const rows = (pages[day.date] ?? []).map(({ path, sessions, registrations }) => ({ path, sessions, registrations }));
              if (rows.length || complete) await save({ ...base, kind: "ga4-pages", date: day.date, complete, rows });
            }
          }
        } else {
          const gscEnd = shiftDay(propertyToday(), -1);
          const options = { country, property: site.gsc, ...(flatkey ? {} : { aggregation: "byProperty" }) };
          const dates = await fetchGscDateCoverage(start, gscEnd, options);
          for (const date of Object.keys(dates).sort().reverse()) {
            const base = { ...common, property: site.gsc, date };
            const kind = flatkey ? "gsc-pages" : "gsc-site";
            const old = saved.get(recordKey({ ...base, kind }) + ":" + date);
            if (!old?.complete || date >= shiftDay(gscEnd, -6)) {
              if (flatkey) {
                const report = await fetchGscDailyPages(date, { ...options, totals: dates[date] });
                if (report.state !== "unavailable") await save({ ...base, kind, observedAt: report.fetchedAt,
                  complete: report.state === "final", rows: report.pages.map(({ url, clicks, impressions, position }) => ({ url, clicks, impressions, position })) });
              } else {
                const { clicks, impressions, position } = dates[date];
                await save({ ...base, kind, observedAt: new Date().toISOString(), complete: true, clicks, impressions, position });
              }
              sourceDates++;
            }
            if (flatkey) {
              const oldQueries = saved.get(recordKey({ ...base, kind: "gsc-page-queries" }) + ":" + date);
              if (!oldQueries?.complete || date >= shiftDay(gscEnd, -6)) {
                const report = await fetchGscDailyPageQueries(date, options);
                await save({ ...base, kind: "gsc-page-queries", ...report });
              }
            }
          }
          if (!Object.keys(dates).length) throw new Error("source_has_no_final_dates");
        }
        console.log(JSON.stringify({ site: site.domain, country: country ?? "all", source, registrationVerified: flatkey, status: sourceDates ? "checked" : "no_new_observations", dates: sourceDates }));
      } catch (error) {
        failures++;
        const reason = error?.code ?? (/^(production_|missing_|invalid_|source_)/.test(error?.message) ? error.message : "collection_failed");
        console.error(JSON.stringify({ site: site.domain, country: country ?? "all", source, status: "failed", reason }));
      }
    }
  }
  console.log(JSON.stringify({ imported, failures }));
  if (failures) process.exitCode = 1;
}
run().catch(() => { console.error("Server SEO collection failed. Check configured read-only Google credentials and production access."); process.exitCode = 1; });
