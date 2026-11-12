// GA4 event totals are queried independently for each interval, channel and country.
const fs = require("node:fs"), path = require("node:path"), Module = require("node:module"), ts = require("typescript");
const root = path.resolve(__dirname, "..");
require("@next/env").loadEnvConfig(root, true);
const resolve = Module._resolveFilename, load = Module._load;
Module._resolveFilename = function(name, parent, ...rest) { return resolve.call(this, name.startsWith("@/") ? path.join(root, "src", name.slice(2)) : name, parent, ...rest); };
Module._load = function(name, ...rest) { return name === "server-only" ? {} : load.call(this, name, ...rest); };
require.extensions[".ts"] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, file);
const { fetchGa4Journey, fetchGa4Engagement } = require("../src/lib/services/ga4-journeys.ts");
const { fetchGa4Business, fetchGa4RegistrationDays } = require("../src/lib/services/ga4-business.ts");
const { fetchGa4ApiCohorts } = require("../src/lib/services/ga4-api-cohorts.ts");
const { matureCohortWindows, cohortCoverageStart } = require("../src/lib/seo-api-cohorts.ts");
const { resolveCohortCollectionGate, collectOptionalApiCohorts } = require("./seo-cohort-capability.cjs");
const { resolveRegistrationCollectionGate } = require("./seo-registration-capability.cjs");
const { businessAnalyticsSchema, businessAnalyticsId, flatkeyRegistrationCount } = require("../src/lib/seo-business-analytics.ts");
const { organicReportWindows } = require("../src/lib/seo-organic-period.ts");
const { shiftDay, propertyToday, validRange } = require("../src/lib/seo-date-range.ts");
const { enrichGithubReferrals } = require("../src/lib/services/ga4-github-referrals.ts");
const { githubChannelSchema, githubChannelId } = require("../src/lib/seo-github-channel.ts");

const businessOrigin = "https://flatkey-seo-roadmap.vercel.app";
async function platformRead(route) {
  const response = await fetch(businessOrigin + route, {
    redirect: "error", cache: "no-store", signal: AbortSignal.timeout(60000),
    headers: { authorization: "Bearer " + process.env.SEO_IMPORT_TOKEN },
  });
  if (!response.ok) throw Error("business_read_" + response.status);
  return response.json();
}

function reportWindows(last) {
  const days = Array.from({ length: 4 }, (_, index) => shiftDay(last, -index));
  const latestThursday = shiftDay(last, -((new Date(last + "T00:00:00Z").getUTCDay() + 3) % 7));
  return [...days.map(day => ({ start: day, end: day })),
    ...[latestThursday, shiftDay(latestThursday, -7)].map(end => ({ start: shiftDay(end, -6), end }))];
}

async function archivedReportWindows(last) {
  const groups = await Promise.all(["daily", "weekly"].map(async kind => {
    const { dates } = await platformRead("/api/seo/digest?" + new URLSearchParams({ saved: "1", archive: "1", kind }));
    if (!Array.isArray(dates)) throw Error("business_report_archive_invalid");
    return dates.flatMap(date => {
      if (typeof date !== "string" || !validRange({ start: date, end: date })) return [];
      const end = shiftDay(date, -1);
      if (end > last || end < shiftDay(last, -89)) return [];
      return [{ start: kind === "daily" ? end : shiftDay(date, -7), end }];
    });
  }));
  return groups.flat();
}

async function run() {
  const importResults = process.argv.includes("--import");
  if (importResults && !process.env.SEO_IMPORT_TOKEN) throw Error("missing_import_token");
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(new Date());
  const last = shiftDay(propertyToday("America/Los_Angeles"), -1);
  const reportingWindows = [{ start: last, end: last }, { start: shiftDay(last, -6), end: last }, ...organicReportWindows(today, last)];
  const registrationGate = await resolveRegistrationCollectionGate({ importing: importResults, token: process.env.SEO_IMPORT_TOKEN, range: reportingWindows[0] });
  const coverageStart = cohortCoverageStart(process.env.GA4_COHORT_COVERAGE_START);
  const cohortGate = await resolveCohortCollectionGate({ coverageStart, importing: importResults, token: process.env.SEO_IMPORT_TOKEN, range: reportingWindows[0] });
  const windows = [...new Map([...reportingWindows, ...(cohortGate.enabled ? matureCohortWindows(new Date(), coverageStart) : [])].map(row => [row.start + ":" + row.end, row])).values()];
  const queryKey = ({ start, end, country, scope }) => [start, end, country, scope].join(":");
  const queries = new Map();
  for (const range of windows) for (const country of ["all", "US", "JP", "BR", "ES"]) for (const scope of ["all-channels", "session-organic-search"]) {
    const query = { ...range, country, scope };
    queries.set(queryKey(query), query);
  }
  const reportRanges = reportWindows(last);
  if (importResults && process.argv.includes("--backfill-reports")) reportRanges.push(...await archivedReportWindows(last));
  for (const range of reportRanges) {
    const query = { ...range, country: "all", scope: "all-channels" };
    if (!queries.has(queryKey(query))) queries.set(queryKey(query), query);
  }
  let fetched = 0, imported = 0;
  const failures = [], registrations = [];
  for (const query of queries.values()) {
    const { start, end, country, scope } = query;
    try {
      const record = await collectOptionalApiCohorts(await fetchGa4Business(query, new Date(), { registrationCompatibility: registrationGate.enabled }), query, cohortGate, fetchGa4ApiCohorts);
      record.engagement = await fetchGa4Engagement(query);
      if (scope === "all-channels") record.journeys = await Promise.all([fetchGa4Journey(query, "gpu"), fetchGa4Journey(query, "api")]);
      businessAnalyticsSchema.parse(record); fetched++;
      if (!importResults) continue;
      const response = await fetch("https://flatkey-seo-roadmap.vercel.app/api/seo/business", { method: "POST", redirect: "error", signal: AbortSignal.timeout(60000), headers: { "content-type": "application/json", authorization: "Bearer " + process.env.SEO_IMPORT_TOKEN }, body: JSON.stringify(record) });
      if (!response.ok) throw Error("business_import_" + response.status);
      const receipt = await response.json();
      if (receipt.stored !== true || receipt.id !== businessAnalyticsId(businessAnalyticsSchema.parse(receipt.record))) throw Error("business_readback_failed");
      if (country === "all" && scope === "all-channels") {
        const { users } = flatkeyRegistrationCount([receipt.record], start, end);
        registrations.push({ start, end, available: users !== null, reasons: receipt.record.reasons });
      }
      imported++;
    } catch (error) { failures.push({ ...query, error: error.code || (/^business_[a-z_0-9]+$/.test(error.message) ? error.message : "collection_failed") }); }
  }
  const githubReferrals = { enriched: 0, imported: 0, unavailable: 0, errors: [] };
  // Existing GitHub archives supply only the repository observations; Google is
  // queried here with the already-authorized Actions credential, never copied to Vercel.
  if (importResults) try {
    const api = async (route, body) => {
      const response = await fetch("https://flatkey-seo-roadmap.vercel.app" + route, { method: body ? "POST" : "GET", redirect: "error", signal: AbortSignal.timeout(60000), headers: { "content-type": "application/json", authorization: "Bearer " + process.env.SEO_IMPORT_TOKEN }, ...(body ? { body: JSON.stringify(body) } : {}) });
      if (!response.ok) throw Error("github_import_" + response.status);
      return response.json();
    };
    const archive = await api("/api/seo/github?start=" + reportingWindows.map(row => row.start).sort()[0] + "&end=" + today);
    if (!Array.isArray(archive.records)) throw Error("github_archive_invalid");
    const records = await enrichGithubReferrals(archive.records.map(row => githubChannelSchema.parse(row)), reportingWindows);
    for (const record of records) {
      githubReferrals.enriched++;
      githubReferrals.unavailable += record.referrals.filter(row => row.status !== "ok").length;
      const receipt = await api("/api/seo/github", record);
      if (receipt.stored !== true || receipt.id !== githubChannelId(record) || githubChannelId(receipt.record) !== receipt.id) throw Error("github_readback_failed");
      githubReferrals.imported++;
    }
  } catch (error) { githubReferrals.errors.push(/^github_[a-z_0-9]+$/.test(error.message) ? error.message : "github_collection_failed"); }
  const dailyRegistrations = [];
  if (importResults) {
    // The manual run also covers the previous 90-day comparison window.
    const range = { start: shiftDay(last, process.argv.includes("--backfill-reports") ? -179 : -6), end: last };
    for (const country of ["all", "US", "JP", "BR", "ES"]) {
      try {
        const record = await fetchGa4RegistrationDays({ ...range, country });
        const response = await fetch(businessOrigin + "/api/seo/registrations", {
          method: "POST", redirect: "error", signal: AbortSignal.timeout(60000),
          headers: { "content-type": "application/json", authorization: "Bearer " + process.env.SEO_IMPORT_TOKEN },
          body: JSON.stringify(record),
        });
        if (!response.ok) throw Error("business_registration_import_" + response.status);
        const receipt = await response.json();
        const dates = new Map((receipt.record?.days ?? []).map(day => [day.date, day.users]));
        if (!receipt.stored || receipt.record?.country !== country || receipt.record?.observedAt !== record.observedAt ||
          dates.size !== record.days.length || record.days.some(day => dates.get(day.date) !== day.users)) {
          throw Error("business_registration_readback_failed");
        }
        dailyRegistrations.push({ country, ...range, recordedDays: record.days.length });
      } catch (error) {
        failures.push({ ...range, country, scope: "registration-days", error: error.status ? "ga4_http_" + error.status :
          error.code || (/^business_[a-z_0-9]+$/.test(error.message) ? error.message : "collection_failed") });
      }
    }
  }
  if (importResults && process.argv.includes("--backfill-reports")) {
    const weeklyEnd = reportWindows(last).find(range => range.start !== range.end).end;
    for (const [kind, date] of [["daily", shiftDay(last, 1)], ["weekly", shiftDay(weeklyEnd, 1)]]) {
      const { report } = await platformRead("/api/seo/digest?" + new URLSearchParams({ saved: "1", archive: "1", kind, date }));
      console.log(JSON.stringify({ kind: "registration-report-readback", reportKind: kind, date,
        savedReport: !!report, registrationAvailable: typeof report?.flatkeyRegistrations?.users === "number" }));
    }
  }
  console.log(JSON.stringify({ kind: "ga4-business", mode: importResults ? "import" : "read_only", fetched, imported, failures, windows, registrations, dailyRegistrations, githubReferrals, cohortGate, registrationGate }));
  if (failures.length) process.exitCode = 1;
  if (githubReferrals.errors.length) process.exitCode = 1;
}
if (require.main === module) run().catch(error => { console.error(JSON.stringify({ error: error.code || "business_collection_failed" })); process.exitCode = 1; });
