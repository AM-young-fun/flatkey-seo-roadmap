const fs = require("node:fs");
const { createHash } = require("node:crypto");
const ts = require("typescript");
const Module = require("node:module");
const load = Module._load;
Module._load = function(name, ...args) {
  return name === "server-only" ? {} : load.call(this, name, ...args);
};
require.extensions[".ts"] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText, file);
const { getGoogleReadAccessToken } = require("../src/lib/google-read-auth.ts");
const { DAILY_SEO_TRAFFIC_DEFAULTS, dailySeoTrafficSchema, dailySeoPropertyDate, shiftDailySeoDate } = require("../src/lib/daily-seo-traffic.ts");
const { DAILY_SEO_PAGE_GROUPS, dailySeoPageGroupsSchema } = require("../src/lib/daily-seo-page-groups.ts");

const sources = ["https://analytics.google.com/analytics/web/"];
const destination = "https://flatkey-seo-roadmap.vercel.app";
const ga = "https://analyticsdata.googleapis.com";
const cohort = DAILY_SEO_TRAFFIC_DEFAULTS;

const and = (...expressions) => ({ andGroup: { expressions } });
const not = notExpression => ({ notExpression });
const filter = (fieldName, value, matchType = "EXACT") => ({ fieldName, stringFilter: { value, matchType } });
const dimensions = (fieldName, value, matchType) => ({ filter: filter(fieldName, value, matchType) });
const firstOrganic = dimensions(cohort.channelDimension, cohort.channelName);
const count = value => typeof value === "string" && /^\d+$/.test(value) && Number.isSafeInteger(Number(value)) ? Number(value) : null;

async function api(origin, path, credential, payload) {
  const response = await fetch(origin + path, { redirect: "error", method: payload ? "POST" : "GET",
    headers: { Authorization: "Bearer " + credential, "content-type": "application/json" },
    ...(payload ? { body: JSON.stringify(payload) } : {}), signal: AbortSignal.timeout(45_000) });
  if (!response.ok) throw Error((origin === ga ? "ga4" : "archive") + "_" + response.status);
  const result = await response.json();
  if (origin === ga && process.env.SEO_ACQUISITION_OUTPUT) {
    const folder=process.env.SEO_ACQUISITION_OUTPUT; fs.mkdirSync(folder,{recursive:true});
    fs.appendFileSync(folder+"/google-queries.ndjson",JSON.stringify({path,payload,result,observedAt:new Date().toISOString()})+"\n");
  }
  return result;
}

async function core(token, dateRanges, metrics, dimensionFilter) {
  const report = await api(ga, "/v1beta/properties/" + cohort.ga4PropertyId + ":runReport", token, {
    dateRanges, dimensions: [{ name: "date" }], metrics: metrics.map(name => ({ name })), dimensionFilter, keepEmptyRows: true,
  });
  const metadata = report.metadata;
  if (metadata?.timeZone !== cohort.timezone || metadata.subjectToThresholding || metadata.dataLossFromOtherRow ||
      metadata.samplingMetadatas?.length || metadata.schemaRestrictionResponse?.activeMetricRestrictions?.length ||
      report.rowCount > (report.rows?.length ?? 0)) throw Error("ga4_core_quality_unverified");
  return new Map((report.rows ?? []).map(row => [row.dimensionValues[0].value.replace(/^(....)(..)(..)$/, "$1-$2-$3"),
    row.metricValues.map(metric => count(metric.value))]));
}

async function closedFunnel(token, date, group) {
  const field = (name, value, matchType) => ({ funnelFieldFilter: filter(name, value, matchType) });
  const event = eventName => ({ funnelEventFilter: { eventName } });
  const report = await api(ga, "/v1alpha/properties/" + cohort.ga4PropertyId + ":runFunnelReport", token, {
    dateRanges: [{ startDate: date, endDate: date }], dimensionFilter: firstOrganic,
    funnel: { isOpenFunnel: false, steps: [
      { name: "Viewed group", filterExpression: and(event("page_view"), field("pageLocation", group.pageLocationPattern, "FULL_REGEXP"),
        ...(group.excludePageLocationPattern ? [not(field("pageLocation", group.excludePageLocationPattern, "FULL_REGEXP"))] : [])) },
      { name: "Registered", isDirectlyFollowedBy: false, filterExpression: event("sign_up_success") },
    ] },
  });
  return readFunnelCounts(report.funnelTable);
}

function readFunnelCounts(table) {
  if (!table || table.metadata?.samplingMetadatas?.length) throw Error("ga4_funnel_quality_unverified");
  const dimension = table.dimensionHeaders.findIndex(column => column.name === "funnelStepName");
  const metricIndex = name => table.metricHeaders.findIndex(column => column.name === name);
  const users = metricIndex("activeUsers");
  if (dimension < 0 || users < 0) throw Error("ga4_funnel_columns_missing");
  const steps = new Map((table.rows ?? []).map(row => [row.dimensionValues[dimension]?.value, row.metricValues]));
  const viewed = steps.get("1. Viewed group"), registered = steps.get("2. Registered");
  const entrants = count(viewed?.[users]?.value);
  const completionRate = viewed?.[metricIndex("funnelStepCompletionRate")]?.value;
  const abandoned = count(viewed?.[metricIndex("funnelStepAbandonments")]?.value);
  // GA4 can omit the second step when it explicitly reports no completions in the first.
  const registrations = registered ? count(registered[users]?.value)
    : entrants !== null && entrants > 0 && abandoned === entrants && completionRate === "0" ? 0 : null;
  if (entrants === null || registrations === null || registrations > entrants) throw Error("ga4_funnel_step_unavailable");
  return { entrants, registrations };
}

async function run() {
  const credential = process.env.SEO_IMPORT_TOKEN;
  if (!credential) throw Error("missing_seo_import_token");
  const token = await getGoogleReadAccessToken("https://www.googleapis.com/auth/analytics.readonly");
  const end = process.env.SEO_ACQUISITION_END || shiftDailySeoDate(dailySeoPropertyDate(), -3);
  const start = shiftDailySeoDate(end, -1);
  const dates = [start, end];
  const dateRanges = [{ startDate: start, endDate: end }];
  const read = async promise => promise.then(value => ({ value })).catch(error => ({ reason: error.code ?? error.message }));
  const [users, registrations] = await Promise.all([
    read(core(token, dateRanges, ["newUsers"], firstOrganic)),
    read(core(token, dateRanges, ["totalUsers"], and(firstOrganic, dimensions("eventName", "sign_up_success")))),
  ]);
  const groups = [];
  // Fetch one group's conversion requests together and let the next group use the same short-lived credentials.
  for (const group of DAILY_SEO_PAGE_GROUPS) {
    const pageScope = and(firstOrganic, dimensions("eventName", "page_view"),
      dimensions("hostName", "^(?:www\\.)?flatkey\\.ai$", "FULL_REGEXP"), dimensions("pagePath", group.pathPattern, "FULL_REGEXP"),
      ...(group.excludePathPattern ? [not(dimensions("pagePath", group.excludePathPattern, "FULL_REGEXP"))] : []));
    const [traffic, ...funnels] = await Promise.all([
      read(core(token, dateRanges, ["totalUsers", "screenPageViews"], pageScope)),
      ...dates.map(date => read(closedFunnel(token, date, group))),
    ]);
    groups.push({ group, traffic, funnels });
  }
  const collectedAt = new Date().toISOString();
  const batchId = kind => kind + ":" + createHash("sha256").update(kind + collectedAt).digest("hex").slice(0, 24);
  const points = dates.map(date => {
    const newUsers = users.value?.get(date)?.[0] ?? null;
    const newRegistrations = registrations.value?.get(date)?.[0] ?? null;
    return { date, newUsers, newRegistrations, ...(newUsers === null || newRegistrations === null
      ? { missingReason: "GA4 未返回核实日行。" } : {}) };
  });
  const pageGroups = groups.map(({ group, traffic, funnels }) => ({ key: group.key,
    points: dates.map((date, index) => {
      const result = traffic.value?.get(date);
      const totalUsers = result?.[0] ?? null, pageViews = result?.[1] ?? null;
      const funnel = funnels[index].value ? { ...funnels[index].value, collectedAt, sources } : null;
      return { date, totalUsers, pageViews, funnel, ...(totalUsers === null || pageViews === null || !funnel
        ? { missingReason: [traffic.reason, funnels[index].reason].filter(Boolean).join(" / ") || "GA4 未返回核实日行。" } : {}) };
    }),
  }));
  const base = { ...cohort, collectedAt, sources };
  const daily = dailySeoTrafficSchema.parse({ ...base, kind: "daily-seo-traffic", requestId: batchId("acquisition"), points });
  const pages = dailySeoPageGroupsSchema.parse({ ...base, kind: "daily-seo-page-groups", ruleVersion: 1, requestId: batchId("page-groups"), groups: pageGroups });
  const output = process.env.SEO_ACQUISITION_OUTPUT || require("node:path").join(process.env.RUNNER_TEMP || ".local", "seo-acquisition-"+collectedAt.replace(/[:.]/g,"-"));
  fs.mkdirSync(output, {recursive:true});
  fs.writeFileSync(output+"/payloads.json",JSON.stringify({daily,pages},null,2));
  if (!process.argv.includes("--import")) { console.log(JSON.stringify({status:"preview_only",daily,pages})); return; }
  const result = await api(destination, "/api/traffic/daily", credential, daily);
  const groupResult = await api(destination, "/api/traffic/daily/groups", credential, pages);
  if (result.requestId !== daily.requestId || groupResult.requestId !== pages.requestId) throw Error("archive_receipt_not_bound");
  fs.writeFileSync(output+"/receipts.json",JSON.stringify({result,groupResult},null,2));
  const query = "?start=" + start + "&end=" + end;
  const [saved, savedGroups] = await Promise.all([
    api(destination, "/api/traffic/daily" + query, credential), api(destination, "/api/traffic/daily/groups" + query, credential),
  ]);
  fs.writeFileSync(output+"/readback.json",JSON.stringify({saved,savedGroups},null,2));
  const matching = (savedRows, rows, keys) => rows.every(row => savedRows.some(savedRow => savedRow.date === row.date &&
    keys.every(key => row[key] === null || savedRow[key] === row[key]) &&
    (!row.funnel || savedRow.funnel?.entrants === row.funnel.entrants && savedRow.funnel.registrations === row.funnel.registrations)));
  if (!matching(saved.points, points, ["newUsers", "newRegistrations"]) || !pageGroups.every(group =>
    matching(savedGroups.groups.find(savedGroup => savedGroup.key === group.key)?.points ?? [], group.points, ["totalUsers", "pageViews"]))) throw Error("archive_readback_mismatch");
  console.log(JSON.stringify({ start, end, points, groups: pageGroups.map(group => ({
    key: group.key, points: group.points.map(({ date, totalUsers, pageViews, funnel, missingReason }) =>
      ({ date, totalUsers, pageViews, registrations: funnel?.registrations ?? null, missingReason })),
  })) }));
}
module.exports = { readFunnelCounts };
if (require.main === module) run().catch(error => { console.error(error.code ?? error.message); process.exitCode = 1; });
