const fs = require("node:fs/promises");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { bootstrap } = require("./server-seo-report-scalars.cjs");
const { PROPERTY, TIMEZONE, canonical, jobsFor, loadCache, validate } = require("./lib/seo-report-ga4-scalars.cjs");
const origin = "https://flatkey-seo-roadmap.vercel.app";
const exact = (fieldName, value) => ({ filter: { fieldName, stringFilter: { matchType: "EXACT", value, caseSensitive: true } } });
const sha256 = text => createHash("sha256").update(text).digest("hex");

function trafficJobs(date, definitions, now) {
  const { entryHosts } = definitions;
  const hostScope = { filter: { fieldName: "hostName", inListFilter: { values: [...entryHosts], caseSensitive: false } } };
  const job = (key, metric, expressions, module = null) => ({ key, module, date, metric,
    request: { dateRanges: [{ startDate: date, endDate: date }], metrics: [{ name: metric }],
      dimensionFilter: { andGroup: { expressions } }, keepEmptyRows: true, metricAggregations: ["TOTAL"], limit: "1" } });
  const acquisition = exact("firstUserPrimaryChannelGroup", "Organic Search");
  const organic = exact("sessionDefaultChannelGroup", "Organic Search");
  // Match the established property-level sign_up_success cohort. Successful
  // events can lack a page hostname; applying the session host filter loses them.
  const registration = [exact("eventName", "sign_up_success")];
  const startup = [hostScope, exact("eventName", "session_start")];
  const modules = jobsFor(date, definitions, now).filter(row => row.kind === "module" && row.side === "current");
  return [
    job("totalSessions", "sessions", startup), job("organicSessions", "sessions", [...startup, organic]),
    job("totalRegistrations", "totalUsers", registration), job("organicRegistrations", "totalUsers", [...registration, acquisition]),
    ...modules.flatMap(row => {
      const expressions = row.request.dimensionFilter.andGroup.expressions;
      return [{ ...row, key: "organicSessions", module: row.key },
        job("totalSessions", "sessions", expressions.filter(part => part.filter?.fieldName !== "sessionDefaultChannelGroup"), row.key)];
    }),
  ];
}

async function run() {
  bootstrap();
  const { closedTrafficSummaryDay, mergeTrafficSummaryDay, trafficSummaryDaySchema, TRAFFIC_SUMMARY_KIND, TRAFFIC_SUMMARY_MODULES } = require("../src/lib/seo-traffic-summary.ts");
  const { getGoogleReadAccessToken } = require("../src/lib/google-read-auth.ts");
  const { PILLAR_PAGE_GROUPS } = require("../src/lib/weekly-page-visitors.ts");
  const { DAILY_SEO_PAGE_GROUPS } = require("../src/lib/daily-seo-page-groups.ts");
  const { FLATKEY_ENTRY_HOSTS } = require("../src/lib/ga4-host-scope.ts");
  const now = new Date(), option = name => process.argv.find(arg => arg.startsWith("--" + name + "="))?.split("=").slice(1).join("=");
  const date = option("date") ?? closedTrafficSummaryDay(now);
  const output = path.resolve(option("out") ?? path.join(".local", "seo-traffic-summary", date));
  const importing = process.argv.includes("--import");
  let token = process.env.SEO_IMPORT_TOKEN;
  if (importing && !token && option("settings")) {
    const { tokenFile } = JSON.parse(await fs.readFile(option("settings"), "utf8"));
    const stat = await fs.lstat(tokenFile);
    if (!stat.isFile() || stat.uid !== process.getuid() || (stat.mode & 0o077)) throw Error("collector_token_file_permissions");
    token = (await fs.readFile(tokenFile, "utf8")).trim();
  }
  if (importing && !token) throw Error("missing_seo_import_token");
  const api = async (suffix, body) => {
    const response = await fetch(origin + "/api/seo/traffic-summary" + suffix, { method: body ? "POST" : "GET", redirect: "error",
      headers: { authorization: "Bearer " + token, ...(body ? { "content-type": "application/json" } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(45000) });
    if (!response.ok) throw Error("traffic_summary_platform_" + response.status);
    return response.json();
  };
  const dayQuery = "?date=" + encodeURIComponent(date);
  const before = importing ? (await api(dayQuery)).day : null;
  const jobs = trafficJobs(date, { pillars: PILLAR_PAGE_GROUPS, pageGroups: DAILY_SEO_PAGE_GROUPS, entryHosts: FLATKEY_ENTRY_HOSTS }, now);
  const day = { kind: TRAFFIC_SUMMARY_KIND, date, property: PROPERTY, timezone: TIMEZONE,
    site: {}, modules: Object.fromEntries(TRAFFIC_SUMMARY_MODULES.map(([key]) => [key, {}])) };
  const store = (target, name, value) => { (target ? day.modules[target] : day.site)[name] = value; };
  const oldValue = item => (item.module ? before?.modules[item.module] : before?.site)?.[item.key];
  const base = path.join(output, "sources");
  await fs.mkdir(base, { recursive: true, mode: 0o700 });
  let requests = 0, google;
  const missing = [];
  const refresh = process.argv.includes("--refresh");
  const cached = refresh ? [] : await loadCache([base]);
  const pending = jobs.filter(item => refresh || !oldValue(item));
  for (const item of jobs) {
    if (!pending.includes(item)) {
      store(item.module, item.key, oldValue(item));
      continue;
    }
    let evidence = cached.filter(row => validate(item, row, new Date()).value !== null)
      .sort((a, b) => Date.parse(b.observedAt) - Date.parse(a.observedAt))[0];
    if (evidence) {
      const { cacheArtifact, ...source } = evidence;
      evidence = source;
    } else {
      requests++;
      try {
        google ??= await getGoogleReadAccessToken("https://www.googleapis.com/auth/analytics.readonly");
        const response = await fetch("https://analyticsdata.googleapis.com/v1beta/properties/" + PROPERTY + ":runReport",
          { method: "POST", headers: { authorization: "Bearer " + google, "content-type": "application/json" },
            body: JSON.stringify(item.request), redirect: "error", signal: AbortSignal.timeout(45000) });
        evidence = { propertyId: PROPERTY, request: item.request, status: response.status, observedAt: new Date().toISOString(), data: await response.json() };
      } catch (error) {
        evidence = { propertyId: PROPERTY, request: item.request, status: null, observedAt: new Date().toISOString(), error: error.code ?? "source_unavailable" };
      }
    }
    const verification = validate(item, evidence, new Date()), bytes = JSON.stringify(evidence, null, 2) + "\n";
    const hash = sha256(bytes);
    await fs.writeFile(path.join(base, (item.module ?? "site") + "-" + item.key + "-" + hash.slice(0, 12) + "-source.json"), bytes, { mode: 0o600 });
    const value = verification.value === null ? oldValue(item) ?? null : { value: verification.value, observedAt: verification.observedAt, sourceSha256: hash };
    if (value === null) missing.push({ module: item.module, key: item.key, reasons: verification.reasons });
    store(item.module, item.key, value);
  }
  const record = trafficSummaryDaySchema.parse(day);
  const manifest = { record, missing, requests, reused: jobs.length - requests, readback: null };
  if (importing && pending.length && missing.length < jobs.length) {
    await fs.writeFile(path.join(output, "traffic-summary-submission.json"), JSON.stringify(record, null, 2) + "\n", { mode: 0o600 });
    let write, writeError;
    try { write = await api("", record); } catch (error) { writeError = error; }
    const { day: readback } = await api(dayQuery);
    if (canonical(readback) !== canonical(mergeTrafficSummaryDay(before, record))) throw writeError ?? Error("traffic_summary_production_readback_mismatch");
    manifest.readback = write ?? { date, complete: missing.length === 0, verifiedAfterAmbiguousResponse: true };
  } else if (before) {
    manifest.readback = { date, complete: missing.length === 0, replay: true };
  }
  const file = path.join(output, "traffic-summary-receipt.json");
  await fs.writeFile(file, JSON.stringify(manifest, null, 2) + "\n", { mode: 0o600 });
  console.log(JSON.stringify({ date, requests, missing: missing.length, readback: manifest.readback, file }));
}

module.exports = { trafficJobs };
if (require.main === module) run().catch(error => { console.error(error.message); process.exitCode = 1; });
