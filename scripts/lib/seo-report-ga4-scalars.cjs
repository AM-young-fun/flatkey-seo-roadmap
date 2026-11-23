const fs = require("node:fs/promises"), path = require("node:path"), { createHash } = require("node:crypto");
const PROPERTY = "541304395", TIMEZONE = "America/Los_Angeles";
const canonical = value => JSON.stringify(value, (_key, child) => child && typeof child === "object" && !Array.isArray(child) ? Object.fromEntries(Object.keys(child).sort().map(key => [key, child[key]])) : child);
const hash = value => createHash("sha256").update(canonical(value)).digest("hex");
const dayAt = date => new Intl.DateTimeFormat("en-CA", { timeZone: TIMEZONE }).format(date);
const shift = day => new Date(Date.parse(day + "T00:00:00Z") - 86400000).toISOString().slice(0, 10);
const exact = (fieldName, value) => ({ filter: { fieldName, stringFilter: { matchType: "EXACT", value, caseSensitive: true } } });
const regexp = (fieldName, value) => ({ filter: { fieldName, stringFilter: { matchType: "FULL_REGEXP", value, caseSensitive: true } } });
const hosts = values => ({ filter: { fieldName: "hostName", inListFilter: { values: [...values], caseSensitive: false } } });
function scalarCollectionScope(env) {
  if (env.SEO_LOCAL_START || env.SEO_LOCAL_END) return { collect: false, reason: "explicit_historical_scope_preserved" };
  const input = env.SEO_LOCAL_SCOPES?.trim();
  if (!input) return { collect: true };
  try {
    const scopes = input.startsWith("[") ? JSON.parse(input) : input.split(",").map(scope => scope.trim()).filter(Boolean);
    if (!Array.isArray(scopes) || !scopes.length || scopes.some(scope => typeof scope !== "string" || !/^[a-z0-9.-]+\/(?:all|[A-Z]{2})\/(?:GA4|GSC)$/.test(scope))) throw Error("invalid_scope");
    return scopes.includes("flatkey.ai/all/GA4") ? { collect: true } : { collect: false, reason: "explicit_source_scope_preserved" };
  } catch { return { collect: false, invalid: true, reason: "scalar_selected_scope_invalid" }; }
}

function jobsFor(sourceDate, { pillars, pageGroups, entryHosts }, now) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(sourceDate) || new Date(sourceDate).toISOString().slice(0, 10) !== sourceDate || sourceDate >= dayAt(now)) throw Error("scalar_source_day_not_closed");
  const group = key => pageGroups.find(row => row.key === key), detail = group("model_detail"), list = group("model_list");
  const modules = [
    { id: "home", pattern: "^/(?:(?:en|zh|es|fr|pt|ru|ja|vi|de|id)/?)?$" },
    { id: "blog", pattern: "^/(?:en/|zh/|es/|fr/|pt/|ru/|ja/|vi/|de/|id/)?blog(?:/.*)?$" },
    { id: "models", pattern: "(?:" + list.pathPattern + "|" + detail.pathPattern + ")", exclude: detail.excludePathPattern },
    { id: "gpu", pattern: group("gpu_compute").pathPattern }, { id: "prompts", pattern: group("prompts").pathPattern },
  ];
  const users = [{ key: "all" }, ...pillars.map(row => ({ ...row, key: row.key === "models" ? "modelDetail" : row.key }))];
  const jobs = [];
  for (const [side, date] of [["previous", shift(sourceDate)], ["current", sourceDate]]) {
    const base = [exact("sessionDefaultChannelGroup", "Organic Search"), hosts(entryHosts)];
    const add = (kind, key, metric, expressions) => {
      const request = { dateRanges: [{ startDate: date, endDate: date }], metrics: [{ name: metric }], dimensionFilter: { andGroup: { expressions } }, keepEmptyRows: true, metricAggregations: ["TOTAL"], limit: "1" };
      jobs.push({ kind, key, side, date, metric, request, queryHash: hash({ propertyId: PROPERTY, request }) });
    };
    for (const group of users) add("share", group.key, "totalUsers", [...base, exact("eventName", "page_view"), ...(group.pathPattern ? [regexp("pagePath", group.pathPattern)] : [])]);
    for (const module of modules) add("module", module.id, "sessions", [...base, exact("eventName", "session_start"), hosts(["flatkey.ai", "www.flatkey.ai"]), regexp("landingPage", module.pattern), ...(module.exclude ? [{ notExpression: regexp("landingPage", module.exclude) }] : [])]);
  }
  return jobs;
}

function validate(job, record, now) {
  const reasons = [], data = record?.data ?? record?.result ?? {}, metadata = data.metadata ?? {};
  if (record?.propertyId !== PROPERTY || canonical(record.request ?? record.query) !== canonical(job.request)) reasons.push("scope_mismatch");
  if ((record.status ?? record.httpStatus ?? record.http) !== 200) reasons.push("source_http_unavailable");
  if (metadata.timeZone !== TIMEZONE) reasons.push("source_timezone_unverified");
  const observedAt = record.observedAt;
  if (!observedAt || !Number.isFinite(Date.parse(observedAt)) || Date.parse(observedAt) > now.getTime() || dayAt(new Date(observedAt)) <= job.date) reasons.push("source_time_invalid");
  for (const key of ["subjectToThresholding", "dataLossFromOtherRow", "dataTruncationReasons", "emptyReason"]) if (metadata[key] && (!Array.isArray(metadata[key]) || metadata[key].length)) reasons.push(key);
  if (metadata.samplingMetadatas?.some(row => row.samplesReadCount !== row.samplingSpaceSize)) reasons.push("sampling");
  if (metadata.schemaRestrictionResponse?.activeMetricRestrictions?.length) reasons.push("restricted_metrics");
  if ((data.dimensionHeaders?.length ?? 0) || data.metricHeaders?.map(row => row.name).join() !== job.metric) reasons.push("scalar_schema_mismatch");
  const rows = data.rows ?? [], totals = data.totals ?? [], row = rows.length === 1 && (data.rowCount ?? 1) === 1 ? rows[0] : !rows.length && totals.length === 1 ? totals[0] : null;
  const value = row?.metricValues?.[0]?.value;
  if (!row || row.metricValues?.length !== 1 || !/^\d+$/.test(value ?? "") || !Number.isSafeInteger(Number(value))) reasons.push("no_explicit_scalar");
  return { value: reasons.length ? null : Number(value), reasons, observedAt: observedAt ?? null };
}

async function loadCache(directories) {
  const records = [];
  for (const directory of [...new Set(directories)]) {
    let files; try { files = await fs.readdir(directory); } catch (error) { if (error.code === "ENOENT") continue; throw error; }
    let manifest;
    try { manifest = JSON.parse(await fs.readFile(path.join(directory, "dashboard-ga4-scalars.json"), "utf8")); } catch { /* Native cache files carry their own property. */ }
    for (const name of files.filter(name => name.endsWith("-source.json"))) {
      try {
        const text = await fs.readFile(path.join(directory, name), "utf8"), record = JSON.parse(text);
        if (manifest?.sourceHashes?.[name] && createHash("sha256").update(text).digest("hex") !== manifest.sourceHashes[name]) continue;
        const propertyId = record.propertyId ?? (manifest?.sourceFiles?.includes(name) ? manifest.propertyId : null);
        if (propertyId) records.push({ ...record, propertyId, cacheArtifact: path.join(directory, name) });
      } catch { /* Corrupt/unrelated files cannot become source evidence. */ }
    }
  }
  return records;
}

async function collectDailyReportScalars({ sourceDate, definitions, outputDirectory, cacheDirectories = [], requestReport, offline = false, now = new Date(), clock = () => new Date() }) {
  const jobs = jobsFor(sourceDate, definitions, now), cached = await loadCache([outputDirectory, ...cacheDirectories]), records = [];
  let requests = 0, cacheHits = 0;
  await fs.mkdir(outputDirectory, { recursive: true, mode: 0o700 });
  for (const job of jobs) {
    const prior = cached.map(record => ({ record, valid: validate(job, record, now) })).filter(item => item.valid.value !== null).sort((a, b) => b.valid.observedAt.localeCompare(a.valid.observedAt))[0];
    let source, selected;
    if (prior) { source = { ...prior.record }; delete source.cacheArtifact; selected = prior.valid; cacheHits++; }
    else if (offline) { source = { propertyId: PROPERTY, request: job.request, status: null, observedAt: null, data: null, error: "cache_miss_offline" }; selected = { value: null, reasons: ["cache_miss_offline"], observedAt: null }; }
    else {
      requests++;
      try { source = { ...(await requestReport(job.request)), propertyId: PROPERTY, request: job.request }; }
      catch (error) { source = { propertyId: PROPERTY, request: job.request, status: null, observedAt: clock().toISOString(), data: null, error: error.code ?? "source_unavailable" }; }
      selected = validate(job, source, clock());
    }
    const name = `${job.queryHash}-${hash(source).slice(0, 16)}-source.json`, file = path.join(outputDirectory, name);
    await fs.writeFile(file, JSON.stringify(source, null, 2) + "\n", { mode: 0o600 });
    const readback = JSON.parse(await fs.readFile(file, "utf8"));
    if (canonical(readback) !== canonical(source)) throw Error("scalar_source_readback_mismatch");
    records.push({ ...job, ...selected, sourceFile: file, sourceSha256: createHash("sha256").update(await fs.readFile(file)).digest("hex") });
  }
  const observedAt = records.map(row => row.observedAt).filter(Boolean).sort().at(-1) ?? null;
  const users = side => Object.fromEntries(["all", "modelDetail", "prompts"].map(key => [key, records.find(row => row.kind === "share" && row.side === side && row.key === key).value]));
  const moduleShares = { current: users("current"), previous: users("previous"), observedAt };
  const moduleSessions = ["home", "blog", "models", "gpu", "prompts"].map(id => ({ id, sessions: Object.fromEntries(["previous", "current"].map(side => [side, records.find(row => row.kind === "module" && row.side === side && row.key === id).value])) }));
  const result = { version: 1, sourceDate, previousDate: shift(sourceDate), propertyId: PROPERTY, timezone: TIMEZONE, scope: "website-console", hostScope: "production-hosts-v1", preparedAt: now.toISOString(), observedAt, moduleShares, moduleSessions,
    complete: records.every(row => row.value !== null), cacheHits, requests, missing: records.filter(row => row.value === null).map(row => ({ side: row.side, kind: row.kind, key: row.key, reasons: row.reasons })), records,
    sourceEvidenceSha256: hash(records.map(({ queryHash, value, reasons, observedAt, sourceSha256 }) => ({ queryHash, value, reasons, observedAt, sourceSha256 }))), paidRequests: 0, notifications: 0 };
  const summaryPath = path.join(outputDirectory, "daily-report-scalars.json");
  await fs.writeFile(summaryPath, JSON.stringify(result, null, 2) + "\n", { mode: 0o600 });
  return { ...result, summaryPath };
}
module.exports = { PROPERTY, TIMEZONE, canonical, hash, dayAt, scalarCollectionScope, jobsFor, validate, loadCache, collectDailyReportScalars };
