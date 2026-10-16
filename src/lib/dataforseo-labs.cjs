/* global URL, module */
/* Pure DataForSEO Labs protocol. No network, credentials or filesystem. */
const ENDPOINT = "https://api.dataforseo.com/v3/dataforseo_labs/google/ranked_keywords/live";
const DEFAULT_RUN_ID = "flatkey-us-en-ranked-keywords-first-trial-v1";
const SOURCE = "dataforseo_labs";
class CollectorError extends Error {
  constructor(code, message) { super(message); this.name = "CollectorError"; this.code = code; }
}
const fail = (code, message) => { throw new CollectorError(code, message); };
function validateRunId(runId) {
  if (typeof runId !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/.test(runId)) fail("INVALID_RUN_ID", "run-id must be a stable 1–100 character file-safe identifier.");
  return runId;
}
function quoteForLimit(limit) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000) fail("INVALID_LIMIT", "limit must be an integer from 1 to 1000.");
  const maxCostMicros = 12000 + 120 * limit;
  return { currency: "USD", baseCostMicros: 12000, perItemCostMicros: 120, limit, maxCostMicros, maxCostUsd: (maxCostMicros / 1000000).toFixed(6) };
}
function parseCliArgs(argv) {
  const options = { execute: false, runId: DEFAULT_RUN_ID, limit: 1000 };
  const seen = new Set();
  for (let index = 0; index < argv.length; index++) {
    const separator = argv[index].indexOf("="), name = separator < 0 ? argv[index] : argv[index].slice(0, separator);
    const inline = separator < 0 ? undefined : argv[index].slice(separator + 1);
    if (!["--execute", "--dry-run", "--run-id", "--limit", "--help"].includes(name) || seen.has(name)) fail("INVALID_ARGUMENT", "Use --execute, --dry-run, --run-id ID, --limit 1..1000 or --help; do not repeat flags.");
    seen.add(name);
    if (["--execute", "--dry-run", "--help"].includes(name)) {
      if (inline !== undefined) fail("INVALID_ARGUMENT", "Boolean flags do not accept values.");
      if (name === "--execute") options.execute = true;
      if (name === "--help") options.help = true;
      continue;
    }
    const value = inline ?? argv[++index];
    if (!value || value.startsWith("--")) fail("INVALID_ARGUMENT", "A run-id or integer limit value is missing.");
    if (name === "--run-id") options.runId = value;
    else {
      if (!/^\d+$/.test(value)) fail("INVALID_LIMIT", "limit must be an integer from 1 to 1000.");
      options.limit = Number(value);
    }
  }
  if (seen.has("--execute") && seen.has("--dry-run")) fail("INVALID_ARGUMENT", "Choose either --execute or --dry-run.");
  validateRunId(options.runId); quoteForLimit(options.limit);
  return options;
}
function buildRankedKeywordsTask(limit, runId) {
  quoteForLimit(limit); validateRunId(runId);
  return { target: "flatkey.ai", location_code: 2840, language_code: "en", limit, offset: 0,
    item_types: ["organic"], historical_serp_mode: "live", include_clickstream_data: false,
    filters: [["ranked_serp_element.serp_item.type", "=", "organic"], "and", ["ranked_serp_element.serp_item.rank_group", "<=", 100]],
    order_by: ["ranked_serp_element.serp_item.rank_group,asc"], tag: runId };
  // include_serp_info is not a documented option on this endpoint. SERP dates
  // and check URLs are already part of the ranked keyword response.
}
function providerDate(value) {
  if (typeof value !== "string") return null;
  const match = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}):(\d{2}):(\d{2})(\.\d{1,3})?\s?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match || Number(match[2]) > 23 || Number(match[3]) > 59 || Number(match[4]) > 59) return null;
  const day = new Date(`${match[1]}T00:00:00Z`);
  if (!Number.isFinite(day.getTime()) || day.toISOString().slice(0, 10) !== match[1]) return null;
  const timestamp = Date.parse(`${match[1]}T${match[2]}:${match[3]}:${match[4]}${match[5] ?? ""}${match[6]}`);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}
const nonNegativeInteger = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
const costMicros = value => typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.round(value * 1000000) : null;
const normalizedWord = value => value.normalize("NFKC").replace(/\s+/gu, " ").trim().toLowerCase();
function isTargetUrl(value) {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password && !url.port
      && (url.hostname === "flatkey.ai" || url.hostname.endsWith(".flatkey.ai"));
  } catch { return false; }
}

function normalizeRankedKeywords(raw, { runId, collectedAt, limit = 1000 }) {
  const quote = quoteForLimit(limit); validateRunId(runId);
  if (!Number.isFinite(Date.parse(collectedAt))) fail("INVALID_COLLECTION_TIME", "An actual collection timestamp is required.");
  if (raw?.status_code !== 20000 || raw?.tasks_error !== 0 || raw?.tasks_count !== 1 || !Array.isArray(raw.tasks) || raw.tasks.length !== 1) fail("PROVIDER_STATUS", "DataForSEO did not confirm one successful task; inspect the saved response without resubmitting.");
  const task = raw.tasks[0];
  if (task.status_code !== 20000 || !Array.isArray(task.result) || task.result.length !== 1) fail("TASK_STATUS", "DataForSEO task did not return one successful result; inspect the saved response without resubmitting.");
  const result = task.result[0];
  if (result.target !== "flatkey.ai" || result.location_code !== 2840 || result.language_code !== "en" || (result.se_type && result.se_type !== "google")) fail("RESPONSE_SCOPE", "Response target or market differs from the approved flatkey.ai US English trial.");
  const totalCount = nonNegativeInteger(result.total_count), itemsCount = nonNegativeInteger(result.items_count);
  const items = result.items === null && itemsCount === 0 ? [] : result.items;
  if (!Array.isArray(items) || itemsCount !== items.length || items.length > limit || totalCount === null || totalCount < items.length) fail("RESPONSE_ITEMS", "Response item counts are invalid or exceed the approved single-request limit.");
  const rows = [], rejectedItems = [], seen = new Set();
  for (const [itemIndex, item] of items.entries()) {
    const data = item?.keyword_data, ranked = item?.ranked_serp_element, serp = ranked?.serp_item;
    let reason = null;
    if (typeof data?.keyword !== "string" || !normalizedWord(data.keyword)) reason = "missing_keyword";
    else if (serp?.type !== "organic") reason = "not_organic";
    else if (!Number.isInteger(serp.rank_group) || serp.rank_group < 1 || serp.rank_group > 100) reason = "outside_or_invalid_rank_group";
    else if (ranked.is_lost === true) reason = "lost_result";
    else if (!isTargetUrl(serp.url)) reason = "foreign_or_invalid_url";
    else if ((data.location_code !== undefined && data.location_code !== 2840) || (data.language_code !== undefined && data.language_code !== "en")) reason = "item_market_mismatch";
    if (reason) { rejectedItems.push({ itemIndex, reason }); continue; }
    const rankedDate = providerDate(ranked.last_updated_time), keywordSerpDate = providerDate(data.serp_info?.last_updated_time);
    const sourceSerpUpdatedAt = rankedDate ?? keywordSerpDate;
    const keyword = normalizedWord(data.keyword);
    const identity = JSON.stringify([keyword, serp.url, serp.rank_group, sourceSerpUpdatedAt]);
    if (seen.has(identity)) { rejectedItems.push({ itemIndex, reason: "duplicate_observation" }); continue; }
    seen.add(identity);
    rows.push({ source: SOURCE, keyword, rawKeyword: data.keyword, region: "US", locationCode: 2840, languageCode: "en", itemIndex,
      rank_group: serp.rank_group, rank_absolute: Number.isInteger(serp.rank_absolute) && serp.rank_absolute >= 1 ? serp.rank_absolute : null,
      url: serp.url, title: typeof serp.title === "string" ? serp.title : null,
      sourceSerpUpdatedAt, sourceSerpUpdatedAtRaw: rankedDate ? ranked.last_updated_time : keywordSerpDate ? data.serp_info.last_updated_time : null,
      sourceSerpDateField: rankedDate ? "ranked_serp_element.last_updated_time" : keywordSerpDate ? "keyword_data.serp_info.last_updated_time" : null,
      volume: nonNegativeInteger(data.keyword_info?.search_volume), volumeUpdatedAt: providerDate(data.keyword_info?.last_updated_time),
      checkUrl: typeof ranked.check_url === "string" ? ranked.check_url : typeof data.serp_info?.check_url === "string" ? data.serp_info.check_url : null,
      collectedAt: new Date(collectedAt).toISOString() });
  }
  rows.sort((a, b) => a.rank_group - b.rank_group || a.keyword.localeCompare(b.keyword) || a.url.localeCompare(b.url));
  const actualCostMicros = costMicros(raw.cost) ?? costMicros(task.cost);
  return { schemaVersion: 1, source: SOURCE, datasetType: "provider_ranked_keywords_snapshot", runId, targetDomain: "flatkey.ai", region: "US", languageCode: "en",
    collectedAt: new Date(collectedAt).toISOString(), historicalSerpMode: "live", realTimeSerpFetch: false,
    taskId: typeof task.id === "string" ? task.id : null, estimatedMaxCostUsd: quote.maxCostUsd,
    actualCostMicros, actualCostUsd: actualCostMicros === null ? null : (actualCostMicros / 1000000).toFixed(6),
    costWithinEstimate: actualCostMicros === null ? null : actualCostMicros <= quote.maxCostMicros,
    requestedLimit: limit, returnedItems: items.length, totalMatchingCount: totalCount, truncated: totalCount > items.length,
    additionalRequestsPerformed: 0, uniqueKeywords: new Set(rows.map(row => row.keyword)).size,
    rows, rejectedItems };
}


module.exports = { ENDPOINT, DEFAULT_RUN_ID, CollectorError, fail, quoteForLimit, parseCliArgs, buildRankedKeywordsTask, normalizeRankedKeywords };
