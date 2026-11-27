// Read-only Google inputs for the existing weekly digest's save_draft command.
const fs = require("node:fs/promises");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { bootstrap } = require("./server-seo-report-scalars.cjs");
const { PROPERTY, TIMEZONE, canonical, jobsFor } = require("./lib/seo-report-ga4-scalars.cjs");
const { reportDay, reportDayStart } = require("../src/lib/seo-report-time.cjs");

const countries = { US: "usa", JP: "jpn", BR: "bra", ES: "esp" };
const moduleIds = ["home", "blog", "models", "gpu", "prompts"];
const gaEndpoint = "https://analyticsdata.googleapis.com/v1beta/properties/";
const gscEndpoint = "https://www.googleapis.com/webmasters/v3/sites/";
const sha = data => createHash("sha256").update(data).digest("hex");
const evidenceKey = ({ side, source, key }) => [side, source, key].join("-");
const count = n => Number.isSafeInteger(n) && n >= 0;
const gaCount = value => /^\d+$/.test(value ?? "") && count(Number(value)) ? Number(value) : null;
const exact = (fieldName, value) => ({ filter: { fieldName, stringFilter: { matchType: "EXACT", value, caseSensitive: true } } });
const inList = (fieldName, values) => ({ filter: { fieldName, inListFilter: { values, caseSensitive: fieldName !== "hostName" } } });
const shiftDay = (day, offset) => new Date(Date.parse(day + "T00:00:00Z") + offset * 86400000).toISOString().slice(0, 10);

function propertyWindow({ startDate, endDate }, timezone) {
  if (timezone === TIMEZONE) return { dates: { startDate, endDate }, filters: [] };
  const from = Date.parse(reportDayStart(startDate)), to = Date.parse(reportDayStart(shiftDay(endDate, 1)));
  const format = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" });
  const hours = Array.from({ length: (to - from) / 3600000 }, (_, offset) => {
    const parts = Object.fromEntries(format.formatToParts(new Date(from + offset * 3600000)).map(part => [part.type, part.value]));
    return parts.year + parts.month + parts.day + parts.hour;
  });
  if (new Set(hours).size !== hours.length) throw Error("ambiguous_property_hours");
  const isoDay = key => key.replace(/^(\d{4})(\d{2})(\d{2})\d{2}$/, "$1-$2-$3");
  return { dates: { startDate: isoDay(hours[0]), endDate: isoDay(hours.at(-1)) }, filters: [inList("dateHour", hours)] };
}

function pageFilter({ notExpression, filter }) {
  const landing = (notExpression?.filter ?? filter).stringFilter.value;
  const pattern = landing.replace(/(^|\(|\|)\^/g, "$1").replace(/\$(?=$|\||\))/g, "");
  return { dimension: "page", operator: notExpression ? "excludingRegex" : "includingRegex",
    expression: "^https://(?:www\\.)?flatkey\\.ai(?:" + pattern + ")(?:[?#].*)?$" };
}

function gaValues(job, data) {
  const meta = data.metadata;
  if (meta?.timeZone !== job.timezone || meta.subjectToThresholding || meta.dataLossFromOtherRow || meta.emptyReason
    || meta.dataTruncationReasons?.length || meta.schemaRestrictionResponse?.activeMetricRestrictions?.length
    || meta.samplingMetadatas?.some(item => item.samplesReadCount !== item.samplingSpaceSize)
    || data.metricHeaders?.map(item => item.name).join() !== job.query.metrics[0].name
    || (data.dimensionHeaders ?? []).map(item => item.name).join() !== (job.query.dimensions ?? []).map(item => item.name).join()) return null;
  return data;
}

function pageSessions(data) {
  if (!data || !Array.isArray(data.rows) || data.rowCount !== data.rows.length || data.rowCount >= 25000) return null;
  const pages = new Map();
  for (const row of data.rows) {
    if (row.dimensionValues?.length !== 2 || row.metricValues?.length !== 1) return null;
    const [host, landing] = row.dimensionValues.map(item => item.value);
    const sessions = gaCount(row.metricValues[0]?.value);
    if (!["flatkey.ai", "www.flatkey.ai"].includes(host) || !/^\/(?!\/)/.test(landing)) continue;
    const url = new URL("https://" + host + landing);
    if (url.hostname !== host || sessions === null || url.search || url.hash || pages.has(url.href)) return null;
    pages.set(url.href, sessions);
  }
  return pages;
}

function growingPages(previous, current) {
  if (!previous || !current) return [];
  return [...current].flatMap(([url, sessions]) => {
    const baseline = previous.get(url);
    return baseline === undefined || sessions <= baseline ? [] : [{ url, previous: baseline, current: sessions, delta: sessions - baseline }];
  }).sort((a, b) => b.delta - a.delta || a.url.localeCompare(b.url));
}

async function collectWeeklySources(date, outputFolder, { now = new Date(), refresh = false } = {}) {
  const { weeklyReportRange, WEEKLY_REPORT_SWITCH_DATE } = require("../src/lib/seo-date-range.ts");
  const { CLUSTER_SITES } = require("../src/lib/seo-cluster-sites.ts");
  const { FLATKEY_ENTRY_HOSTS } = require("../src/lib/ga4-host-scope.ts");
  const { DAILY_SEO_PAGE_GROUPS } = require("../src/lib/daily-seo-page-groups.ts");
  const { PILLAR_PAGE_GROUPS } = require("../src/lib/weekly-page-visitors.ts");
  const { getGoogleReadAccessToken } = require("../src/lib/google-read-auth.ts");
  const { reportDashboardEvidenceSchema } = require("../src/lib/seo-report-dashboard.ts");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? "") || shiftDay(date, 0) !== date || date < WEEKLY_REPORT_SWITCH_DATE
    || new Date(date + "T00:00:00Z").getUTCDay() !== 4 || date > reportDay(now)) throw Error("expected_closed_weekly_report_date");
  const range = weeklyReportRange(date);
  const reportPeriod = { ...range, timezone: TIMEZONE };
  const sides = { previous: { startDate: shiftDay(range.start, -7), endDate: shiftDay(range.end, -7) }, current: { startDate: range.start, endDate: range.end } };
  const sites = [{ domain: "flatkey.ai", ga4: PROPERTY, ga4TimeZone: TIMEZONE, gsc: "sc-domain:flatkey.ai" }, ...CLUSTER_SITES];
  const definitions = jobsFor(range.end, { pillars: PILLAR_PAGE_GROUPS, pageGroups: DAILY_SEO_PAGE_GROUPS, entryHosts: FLATKEY_ENTRY_HOSTS }, now).filter(job => job.side === "current");
  const organic = [exact("sessionDefaultChannelGroup", "Organic Search"), exact("eventName", "session_start")];
  const flatkeyHosts = inList("hostName", FLATKEY_ENTRY_HOSTS);
  const jobs = [];
  for (const [side, dates] of Object.entries(sides)) {
    const ga = (key, filters, { property = PROPERTY, timezone = TIMEZONE, metric = "sessions", dimensions } = {}) => {
      const window = propertyWindow(dates, timezone);
      jobs.push({ key, side, source: "ga4", property, timezone, query: {
        dateRanges: [window.dates], metrics: [{ name: metric }], keepEmptyRows: true,
        ...(dimensions ? { dimensions: dimensions.map(name => ({ name })), limit: "25000" } : { limit: "1", metricAggregations: ["TOTAL"] }),
        dimensionFilter: { andGroup: { expressions: [...filters, ...window.filters] } },
      } });
    };
    const gsc = (key, property, { filters = [], aggregationType = "byProperty", dimensions = [] } = {}) => {
      jobs.push({ key, side, source: "gsc", property, query: { ...dates, type: "web", dataState: "all",
        aggregationType, dimensions, rowLimit: dimensions.length ? 10 : 1, ...(filters.length ? { dimensionFilterGroups: [{ filters }] } : {}),
      } });
    };
    for (const site of sites) {
      ga(site.domain, [...organic, site.ga4 === PROPERTY ? flatkeyHosts : inList("hostName", [site.domain, "www." + site.domain])],
        { property: site.ga4, timezone: site.ga4TimeZone });
      gsc(site.domain, site.gsc);
      gsc(site.domain + "-coverage", site.gsc, { dimensions: ["date"] });
    }
    for (const [country, code] of Object.entries(countries)) {
      ga(country, [...organic, flatkeyHosts, exact("countryId", country)]);
      gsc(country, sites[0].gsc, { filters: [{ dimension: "country", operator: "equals", expression: code }] });
    }
    for (const { kind, key, metric, request } of definitions) {
      const filters = request.dimensionFilter.andGroup.expressions;
      ga(kind === "share" ? "share-" + key : key, filters, { metric });
      if (kind === "module") gsc(key, sites[0].gsc, { aggregationType: "byPage",
        filters: filters.filter(row => (row.notExpression ?? row).filter?.fieldName === "landingPage").map(pageFilter) });
    }
    ga("registrations", [exact("firstUserPrimaryChannelGroup", "Organic Search"), exact("eventName", "sign_up_success")], { metric: "totalUsers" });
    ga("entry-pages", [...organic, inList("hostName", ["flatkey.ai", "www.flatkey.ai"])], { dimensions: ["hostName", "landingPage"] });
  }

  if (new Set(jobs.map(evidenceKey)).size !== jobs.length) throw Error("duplicate_weekly_source_scope");
  await fs.mkdir(outputFolder, { recursive: true, mode: 0o700 });
  const results = new Map();
  const readJobs = async list => {
    let cursor = 0;
    await Promise.all(Array.from({ length: 4 }, async () => {
      while (cursor < list.length) {
        const job = list[cursor++];
        const key = evidenceKey(job);
        const file = path.join(outputFolder, key + ".json");
        let saved;
        if (!refresh) {
          try {
            const bytes = await fs.readFile(file);
            const prior = JSON.parse(bytes);
            if (prior.status === 200 && canonical(prior.job) === canonical(job)) saved = { ...prior, sourceSha256: sha(bytes) };
          } catch (error) { if (error.code !== "ENOENT") throw error; }
        }
        if (!saved) {
          const ga = job.source === "ga4";
          const url = ga ? gaEndpoint + job.property + ":runReport" : gscEndpoint + encodeURIComponent(job.property) + "/searchAnalytics/query";
          let status = null, data = null, reason;
          try {
            const scope = ga ? "analytics.readonly" : "webmasters.readonly";
            const token = await getGoogleReadAccessToken("https://www.googleapis.com/auth/" + scope);
            const response = await fetch(url, { method: "POST", redirect: "error", signal: AbortSignal.timeout(35000),
              headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" }, body: JSON.stringify(job.query) });
            status = response.status;
            data = await response.json();
          } catch (error) { reason = error.cause?.code ?? error.code ?? error.name; }
          const result = { job, status, data, reason, observedAt: new Date().toISOString() };
          const bytes = JSON.stringify(result) + "\n";
          await fs.writeFile(file, bytes, { mode: 0o600 });
          saved = { ...result, sourceSha256: sha(await fs.readFile(file)) };
        }
        results.set(key, { ...saved, file });
      }
    }));
  };
  await readJobs(jobs);
  const receipt = (side, source, key) => results.get(evidenceKey({ side, source, key }));
  const source = (side, provider, key) => {
    const row = receipt(side, provider, key);
    if (row?.status !== 200 || !row.data) return null;
    return provider === "ga4" ? gaValues(row.job, row.data) : row.data.responseAggregationType === row.job.query.aggregationType ? row.data : null;
  };
  const pair = lookup => Object.fromEntries(Object.keys(sides).map(side => [side, lookup(side)]));
  const gaCountPair = key => pair(side => {
    const data = source(side, "ga4", key);
    const rows = data?.rows?.length ? data.rows : data?.totals;
    return rows?.length === 1 ? gaCount(rows[0].metricValues?.[0]?.value) : null;
  });
  const gscCount = (key, metric) => pair(side => {
    const data = source(side, "gsc", key);
    const value = data?.rows?.length === 1 ? data.rows[0][metric] : null;
    return count(value) ? value : null;
  });
  const metrics = key => ({ sessions: gaCountPair(key), clicks: gscCount(key, "clicks"), impressions: gscCount(key, "impressions") });
  const coverage = Object.keys(sides).flatMap(side => sites.map(site => source(side, "gsc", site.domain + "-coverage")));
  const incompleteDates = coverage.flatMap(data => {
    const day = data?.metadata?.firstIncompleteDate ?? data?.metadata?.first_incomplete_date;
    return day ? [day] : [];
  });
  const gscProvisionalFrom = incompleteDates.filter(day => day >= range.start && day <= range.end).sort()[0];
  const flatkeyCoverage = pair(side => source(side, "gsc", sites[0].domain + "-coverage")?.rows?.map(row => row.keys[0]));
  const fullFlatkeyDays = Object.entries(sides).every(([side, window]) =>
    Array.from({ length: 7 }, (_, day) => shiftDay(window.startDate, day)).every(day => flatkeyCoverage[side]?.includes(day)));
  const observedAt = [...results.values()].map(result => result.observedAt).sort().at(-1);
  const sharePairs = ["all", "modelDetail", "prompts"].map(key => [key, gaCountPair("share-" + key)]);
  const shares = pair(side => Object.fromEntries(sharePairs.map(([key, values]) => [key, values[side]])));
  const dashboardEvidence = reportDashboardEvidenceSchema.parse({
    scope: "website-console", timezone: TIMEZONE, observedAt, gscComparable: fullFlatkeyDays && coverage.every(Boolean) && !incompleteDates.length,
    gscProvisionalFrom, sites: sites.map(({ domain }) => ({ name: domain, ...metrics(domain), ...(domain === "flatkey.ai" ? { registrations: gaCountPair("registrations") } : {}) })),
    countries: Object.keys(countries).map(name => ({ name, ...metrics(name) })),
    modules: moduleIds.map(id => ({ id, ...metrics(id) })), moduleShares: { ...shares, observedAt },
  });
  const previousPages = pageSessions(source("previous", "ga4", "entry-pages"));
  const currentPages = pageSessions(source("current", "ga4", "entry-pages"));
  const receipts = [...results.entries()].sort(([a], [b]) => a.localeCompare(b))
    .map(([key, { file, sourceSha256, status, reason, observedAt }]) => ({ key, file, sourceSha256, status, reason, observedAt }));
  return { reportPeriod, dashboardEvidence, growingPageCandidates: growingPages(previousPages, currentPages),
    pageComparisonAvailable: previousPages !== null && currentPages !== null, receipts, sourceEvidenceSha256: sha(canonical(receipts)) };
}

if (require.main === module) {
  bootstrap();
  const flag = name => process.argv.find(arg => arg.startsWith("--" + name + "="))?.slice(name.length + 3);
  const date = flag("date"), directory = path.resolve(flag("out") ?? path.join(".local", "seo-weekly-report-sources", date ?? "missing"));
  collectWeeklySources(date, directory, { refresh: process.argv.includes("--refresh") }).then(async result => {
    const file = path.join(directory, "weekly-report-sources.json");
    await fs.writeFile(file, JSON.stringify(result, null, 2) + "\n", { mode: 0o600 });
    console.log(JSON.stringify({ file, reportPeriod: result.reportPeriod, pageComparisonAvailable: result.pageComparisonAvailable,
      candidates: result.growingPageCandidates.length, httpGaps: result.receipts.filter(row => row.status !== 200).length }));
  }).catch(error => { console.error(error.code ?? error.message); process.exitCode = 1; });
}

module.exports = { collectWeeklySources, growingPages, pageSessions, propertyWindow };
