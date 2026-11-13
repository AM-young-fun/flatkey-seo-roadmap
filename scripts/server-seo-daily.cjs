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
const { collectionDateRange, seoToday, shiftDay } = require("../src/lib/seo-date-range.ts");
const { CLUSTER_SITES, clusterDomainForProperty } = require("../src/lib/seo-cluster-sites.ts");
const { fetchGa4Organic, fetchGa4SiteSessions, fetchGa4SitePages } = require("../src/lib/services/ga4-organic.ts");
const { fetchGscDateCoverage, fetchGscDailyPages, fetchGscDailyPageQueries } = require("../src/lib/gsc-source.ts");
const { saveCollectionReceipt } = require("./server-seo-receipt.cjs");
const collectionStartedAt = new Date().toISOString();
let receiptAttempted = false;

const endpoint = "https://flatkey-seo-roadmap.vercel.app/api/seo/analytics/import";
const credential = process.env.SEO_IMPORT_TOKEN;
const sites = [{ domain: "flatkey.ai", ga4: "541304395", gsc: "sc-domain:flatkey.ai", ga4TimeZone: "America/Los_Angeles" }, ...CLUSTER_SITES];
const SAVE_CONCURRENCY = 3;
const QUALITY_REASONS = new Set(["thresholding", "other_row", "sampling", "data_truncation", "restricted_metrics", "empty_reason", "unknown_hostname", "incomplete_pagination", "landing_host_attribution_unverified", "cluster_registration_event_unverified"]);
let failures = 0;
let imported = 0;
let unavailable = 0;
const expected = new Set();
const scopes = [];
const qualityIssues = [];
function expectDay(base, kind, date) { expected.add(recordKey({ ...base, kind }) + ":" + date); }

function logQuality(site, country, range, metric, quality) {
  if (quality?.complete !== false) return;
  const reasons = [...new Set((quality.reasons ?? []).map(reason => QUALITY_REASONS.has(reason) ? reason : "unrecognized_quality_reason"))];
  qualityIssues.push({ site: site.domain, country: country ?? "all", metric, reasons });
  console.log(JSON.stringify({ site: site.domain, country: country ?? "all", source: "GA4", status: "quality_incomplete", metric, dateRange: range, reasons }));
}
/** Bound each scope; drain started writes/readbacks before propagating any error. */
async function newestDays(days, action) {
  const ordered = [...days].sort((a, b) => (typeof b === "string" ? b : b.date).localeCompare(typeof a === "string" ? a : a.date));
  const keys = ordered.map(day => typeof day === "string" ? day : day.date);
  if (new Set(keys).size !== keys.length) throw new Error("invalid_duplicate_dates");
  let cursor = 0, failure;
  async function worker() {
    while (!failure && cursor < ordered.length) {
      const day = ordered[cursor++];
      try { await action(day); } catch (error) { failure ??= error; }
    }
  }
  await Promise.all(Array.from({ length: Math.min(SAVE_CONCURRENCY, ordered.length) }, worker));
  if (failure) throw failure;
}

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
  let receipt, writeError;
  try {
    receipt = await api("", record);
    if (typeof receipt.stored !== "boolean") throw new Error("invalid_import_receipt");
  } catch (error) { writeError = error; }
  // A timed-out write may have reached the server. Read once, never blindly repost.
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
  } else {
    console.log(JSON.stringify({ status: "existing_snapshot_retained", site: clusterDomainForProperty(record.property) ?? "flatkey.ai", country: record.country ?? "all", kind: record.kind, date: record.date,
      reason: readback.complete > record.complete ? "more_complete_existing_snapshot" : "newer_existing_snapshot", collectedComplete: record.complete, retainedComplete: readback.complete,
      collectedAt: record.observedAt, retainedAt: readback.observedAt }));
  }
  if (writeError) throw writeError;
  imported += Number(receipt.stored);
}
async function run() {
  const requestedDays = process.env.SEO_COLLECTION_LOOKBACK_DAYS ?? "14";
  if (!["14", "90"].includes(requestedDays)) throw new Error("invalid_lookback_days");
  const lookbackDays = Number(requestedDays);
  if (!credential || !process.env.SEO_GOOGLE_SERVICE_ACCOUNT_JSON) throw new Error("missing_server_credentials");
  // Freeze the actual local-day windows for the entire run, including across midnight.
  const collectionNow = new Date(collectionStartedAt);
  const reportingDate = seoToday(collectionNow);
  const gscWindow = collectionDateRange(lookbackDays, collectionNow);
  const windows = sites.map(site => ({ site: site.domain, ga4: collectionDateRange(lookbackDays, collectionNow, site.ga4TimeZone), gsc: gscWindow }));
  const start = windows.flatMap(window => [window.ga4.start, window.gsc.start]).sort()[0];
  const end = windows.flatMap(window => [window.ga4.end, window.gsc.end]).sort().at(-1);
  console.log(JSON.stringify({ status: "collection_windows", reportingDate, reportingTimeZone: "Asia/Shanghai", lookbackDays, concurrency: SAVE_CONCURRENCY, windows }));
  const coverage = (await api("?" + new URLSearchParams({ start, end }))).rows;
  if (!Array.isArray(coverage)) throw new Error("invalid_coverage");
  const saved = new Map(coverage.map(row => [row.kind + ":" + row.date, row]));
  // Get all five global scopes before country slices so cross-site Top pages can be verified first.
  for (const country of [undefined, "US", "JP", "ES", "BR"]) for (const site of sites) {
    const flatkey = site.domain === "flatkey.ai";
    const range = windows.find(window => window.site === site.domain).ga4;
    for (const source of ["GA4", "GSC"]) {
      try {
        let sourceDates = 0;
        const common = { country, source: "google-api" };
        if (source === "GA4") {
          const report = flatkey ? await fetchGa4Organic(range, country)
            : await fetchGa4SiteSessions(range, site.ga4, site.ga4TimeZone, country);
          logQuality(site, country, range, "siteSessions", flatkey ? report.quality?.siteSessions : report.quality);
          if (flatkey) logQuality(site, country, range, "siteRegistrations", report.quality?.siteRegistrations);
          if (!report.daily.length) throw new Error("source_has_no_data");
          const base = { ...common, ...(flatkey ? { hostScope: report.hostScope } : {}), property: site.ga4, scope: "session-organic-search", observedAt: report.fetchedAt };
          await newestDays(report.daily, async day => {
            expectDay(base, "ga4-site", day.date);
            const sessions = flatkey ? (report.quality.siteSessions.complete ? day.sessions : null) : day.sessions;
            const registrations = flatkey && report.quality.siteRegistrations.complete ? day.registrations : null;
            if (sessions === null && registrations === null) return;
            const old = saved.get(recordKey({ ...base, kind: "ga4-site" }) + ":" + day.date);
            if (old?.complete && (!flatkey || old.hostScope === report.hostScope && old.hostScope) && day.date < shiftDay(range.end, -13)) return;
            await save({ ...base, ...(flatkey ? { registrationMetric: report.registrationMetric,
              ...(report.quality.siteRegistrations.complete && day.registrationEvidence ? { registrationEvidence: day.registrationEvidence } : {}) } : {}), kind: "ga4-site", date: day.date, sessions, registrations, complete: sessions !== null && registrations !== null });
            sourceDates++;
          });
          {
            const pageReport = flatkey ? report : await fetchGa4SitePages(range, site.ga4, site.ga4TimeZone, country);
            const pages = Object.groupBy(pageReport.pages, row => row.date);
            const sessionsComplete = flatkey ? report.quality.pageSessions.complete : pageReport.quality.complete;
            const complete = flatkey && sessionsComplete && report.quality.pageRegistrations.complete;
            logQuality(site, country, range, "pageSessions", flatkey ? report.quality.pageSessions : pageReport.quality);
            if (flatkey) logQuality(site, country, range, "pageRegistrations", report.quality.pageRegistrations);
            await newestDays(report.daily, async day => {
              expectDay(base, "ga4-pages", day.date);
              const old = saved.get(recordKey({ ...base, kind: "ga4-pages" }) + ":" + day.date);
              if (old?.complete && (!flatkey || old.hostScope === report.hostScope && old.hostScope) && old.hostnameDimension === "hostName" && day.date < shiftDay(range.end, -13)) return;
              const rows = (pages[day.date] ?? []).filter(row => [site.domain, `www.${site.domain}`, ...(flatkey ? ["console.flatkey.ai"] : [])].includes(row.hostname))
                .map(({ hostname, path, sessions, registrations }) => ({ hostname, path, sessions, registrations }));
              if (rows.length || sessionsComplete) await save({ ...base, observedAt: pageReport.fetchedAt, kind: "ga4-pages", date: day.date,
                hostnameDimension: "hostName", registrationMissingReason: flatkey ? "landing_host_attribution_unverified" : "cluster_registration_event_unverified", sessionsComplete, complete, rows });
            });
          }
        } else {
          const gscEnd = gscWindow.end;
          const options = { country, property: site.gsc, aggregation: "byPage" };
          // Site totals and page totals use different GSC aggregation semantics.
          const dates = await fetchGscDateCoverage(gscWindow.start, gscEnd, { ...options, aggregation: "byProperty" });
          const pageDates = await fetchGscDateCoverage(gscWindow.start, gscEnd, options);
          await newestDays(Object.keys(dates), async date => {
            const base = { ...common, property: site.gsc, date };
            expectDay(base, "gsc-site", date);
            if (pageDates[date]) { expectDay(base, "gsc-pages", date); expectDay(base, "gsc-page-queries", date); }
            const old = saved.get(recordKey({ ...base, kind: "gsc-site" }) + ":" + date);
            if (!old?.complete || date >= shiftDay(gscEnd, -13)) {
              const { clicks, impressions, position } = dates[date];
              await save({ ...base, kind: "gsc-site", observedAt: new Date().toISOString(), complete: true, clicks, impressions, position });
              sourceDates++;
            }
            if (pageDates[date]) {
              const oldPages = saved.get(recordKey({ ...base, kind: "gsc-pages" }) + ":" + date);
              if (!oldPages?.complete || date >= shiftDay(gscEnd, -13)) {
                const report = await fetchGscDailyPages(date, { ...options, totals: pageDates[date] });
                if (report.state !== "unavailable") await save({ ...base, kind: "gsc-pages", observedAt: report.fetchedAt,
                  complete: report.state === "final", rows: report.pages.map(({ url, clicks, impressions, position }) => ({ url, clicks, impressions, position })) });
              }
              const oldQueries = saved.get(recordKey({ ...base, kind: "gsc-page-queries" }) + ":" + date);
              if (!oldQueries?.complete || date >= shiftDay(gscEnd, -13)) {
                const report = await fetchGscDailyPageQueries(date, options);
                await save({ ...base, kind: "gsc-page-queries", ...report });
              }
            }
          });
          if (!Object.keys(dates).length) throw new Error("source_has_no_final_dates");
        }
        scopes.push({ site: site.domain, country: country ?? "all", source, status: "checked" });
        console.log(JSON.stringify({ site: site.domain, country: country ?? "all", source, registrationVerified: flatkey, status: sourceDates ? "checked" : "no_new_observations", dates: sourceDates }));
      } catch (error) {
        const reason = error?.code ?? (/^(production_|missing_|invalid_|source_)/.test(error?.message) ? error.message : "collection_failed");
        // A successful Google response with no rows is a source coverage gap,
        // not a transport/auth/import failure. Never invent a zero observation.
        const noSourceData = reason === "source_has_no_data" || reason === "source_has_no_final_dates";
        if (noSourceData) unavailable++;
        else failures++;
        scopes.push({ site: site.domain, country: country ?? "all", source, status: noSourceData ? "no_source_data" : "failed", reason });
        console.error(JSON.stringify({ site: site.domain, country: country ?? "all", source, status: noSourceData ? "no_source_data" : "failed", reason }));
      }
    }
  }
  const finalRows = (await api("?" + new URLSearchParams({ start, end }))).rows;
  if (!Array.isArray(finalRows)) throw new Error("invalid_final_coverage");
  const actual = new Set(finalRows.map(row => row.kind + ":" + row.date));
  const missing = [...expected].filter(key => !actual.has(key));
  if (missing.length) failures++;
  const result = { imported, failures, unavailable, expected: expected.size, missing: missing.length, reportingDate, lookbackDays, windows, concurrency: SAVE_CONCURRENCY, scopes, qualityIssues };
  receiptAttempted = true;
  await saveCollectionReceipt({ startedAt: collectionStartedAt, completedAt: new Date().toISOString(), result });
  if (process.env.SEO_COLLECTION_RESULT) fs.writeFileSync(process.env.SEO_COLLECTION_RESULT, JSON.stringify(result));
  console.log(JSON.stringify({ imported, failures, unavailable, expected: expected.size, missing: missing.length }));
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `imported=${imported}\nunavailable=${unavailable}\n`);
  if (process.env.GITHUB_STEP_SUMMARY) {
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,
      `## SEO collection result\n\n- Window: ${lookbackDays} ended days per property; ${start} through ${end} across timezones\n- Concurrent date pipelines: ${SAVE_CONCURRENCY}\n- Imported and read back: ${imported} observations\n- Failed scopes: ${failures}\n- Source-backed observations expected: ${expected.size}; missing in production: ${missing.length}\n- Scopes without source data: ${unavailable} (left missing; not zero)\n`);
  }
  if (failures) process.exitCode = 1;
}
run().catch(async () => {
  if (!receiptAttempted) await saveCollectionReceipt({ startedAt: collectionStartedAt, completedAt: new Date().toISOString(), error: true }).catch(() => {});
  console.error("Server SEO collection failed. Check configured read-only Google credentials and production access."); process.exitCode = 1;
});
