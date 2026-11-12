// Contract diagnostics only: never import results or establish event coverage.
const fs = require("node:fs"), path = require("node:path"), Module = require("node:module"), crypto = require("node:crypto"), ts = require("typescript");
const originalLoad = Module._load;
Module._load = function(name, ...rest) { return name === "server-only" ? {} : originalLoad.call(this, name, ...rest); };
require.extensions[".ts"] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, file);
const { getGoogleReadAccessToken } = require("../src/lib/google-read-auth.ts");
const { apiCohortRequest } = require("../src/lib/services/ga4-api-cohorts.ts");
const { cohortKinds, cohortDay, planApiCohort, COHORT_TIMEZONE } = require("../src/lib/seo-api-cohorts.ts");
const { shiftDay } = require("../src/lib/seo-date-range.ts");
const { FLATKEY_BUSINESS_HOSTS, ga4HostFilter } = require("../src/lib/ga4-host-scope.ts");

const PROBE_BRANCH = "refs/heads/codex/ga4-registration-cohorts-20261111";
const REPORT_URL = "https://analyticsdata.googleapis.com/v1beta/properties/541304395:runReport";
const FUNNEL_URL = "https://analyticsdata.googleapis.com/v1alpha/properties/541304395:runFunnelReport";
const hash = value => crypto.createHash("sha256").update(value).digest("hex");

function assertProbeExecution(env, argv) {
  if (env.GITHUB_REF !== PROBE_BRANCH || env.GITHUB_EVENT_NAME !== "workflow_dispatch" || argv.length) throw Error("probe_execution_not_authorized");
  if (env.SEO_IMPORT_TOKEN || env.SEO_DINGTALK_CONFIG || env.GA4_COHORT_COVERAGE_START) throw Error("probe_must_not_receive_write_credentials_or_coverage");
  if (env.GA4_COHORT_PROBE_MODE && !["business-contract", "page-view-shape"].includes(env.GA4_COHORT_PROBE_MODE)) throw Error("probe_mode_invalid");
  if (!env.GA4_COHORT_PROBE_OUTPUT_DIR) throw Error("probe_output_directory_required");
}

function createProbeCases(now, mode = "business-contract") {
  if (mode === "page-view-shape") {
    const end = shiftDay(cohortDay(now), -3), start = shiftDay(end, -6);
    return [{ id: "page-view-diagnostic:shape-only", kind: "page-view-diagnostic", query: { start, end, country: "all", scope: "all-channels" }, observationEnd: end,
      request: { dateRanges: [{ startDate: start, endDate: end }], dimensionFilter: ga4HostFilter(FLATKEY_BUSINESS_HOSTS),
        funnel: { isOpenFunnel: false, steps: [
          { name: "Page-view diagnostic start", filterExpression: { funnelEventFilter: { eventName: "page_view" } } },
          { name: "Page-view diagnostic outcome", isDirectlyFollowedBy: false, withinDurationFromPriorStep: "604800s", filterExpression: { funnelEventFilter: { eventName: "page_view" } } },
        ] } } }];
  }
  if (mode !== "business-contract") throw Error("probe_mode_invalid");
  const end = shiftDay(cohortDay(now), -36), start = shiftDay(end, -6);
  return cohortKinds.flatMap(kind => ["all-channels", "session-organic-search"].map(scope => {
    const query = { start, end, country: scope === "session-organic-search" ? "JP" : "all", scope };
    // Unconfigured plan is used only to construct the request. It is never
    // parsed into a result, saved as a cohort, or assigned an invented epoch.
    const plan = planApiCohort(query, kind, now);
    if (plan.status !== "unconfigured" || plan.coverageStart !== null) throw Error("probe_coverage_must_remain_unknown");
    return { id: `${kind}:${scope}`, kind, query, observationEnd: plan.observationEnd, request: apiCohortRequest(query, plan) };
  }));
}

function safeProviderError(body, token) {
  const error = body && typeof body.error === "object" ? body.error : {};
  let message = typeof error.message === "string" ? error.message.slice(0, 1600) : null;
  if (message) message = message.split(token).join("[redacted]").replace(/Bearer\s+\S+/gi, "Bearer [redacted]").replace(/-----BEGIN[\s\S]*?-----END[^-]*-----/g, "[redacted]").slice(0, 800);
  return { code: Number.isInteger(error.code) ? error.code : null, status: typeof error.status === "string" && /^[A-Z_]{1,60}$/.test(error.status) ? error.status : null, message };
}

function safeReceiptText(value, token, limit = 150) {
  return typeof value === "string" ? value.split(token).join("[redacted]").slice(0, limit) : null;
}

function aggregateShape(body, part = "funnelTable") {
  const table = body?.[part];
  const headerNames = headers => Array.isArray(headers) ? headers.slice(0, 10).map(row => typeof row?.name === "string" ? row.name.slice(0, 100) : null) : null;
  const numberValue = value => typeof value === "string" && /^\d+(\.\d+)?$/.test(value) ? value : null;
  return {
    dimensionHeaders: headerNames(table?.dimensionHeaders), metricHeaders: headerNames(table?.metricHeaders),
    metricTypes: Array.isArray(table?.metricHeaders) ? table.metricHeaders.slice(0, 10).map(row => typeof row?.type === "string" && /^[A-Z_]{1,40}$/.test(row.type) ? row.type : null) : null,
    returnedRows: Array.isArray(table?.rows) ? table.rows.length : null,
    // The request has no user-level dimensions. Only recognized step labels and
    // numeric aggregate values survive; do not archive arbitrary provider text.
    rows: Array.isArray(table?.rows) ? table.rows.slice(0, 10).map(row => ({
      step: ["Registration", "Outcome", "1. Registration", "2. Outcome", "Page-view diagnostic start", "Page-view diagnostic outcome", "1. Page-view diagnostic start", "2. Page-view diagnostic outcome"].includes(row?.dimensionValues?.[0]?.value) ? row.dimensionValues[0].value : null,
      values: Array.isArray(row?.metricValues) ? row.metricValues.slice(0, 10).map(value => numberValue(value?.value)) : null,
    })) : null,
    samplingPresent: Boolean(table?.metadata?.samplingMetadatas?.length || body?.metadata?.samplingMetadatas?.length),
  };
}

async function runCohortProbe({ now = new Date(), mode = "business-contract", fetchImpl = fetch, getToken = getGoogleReadAccessToken } = {}) {
  const cases = createProbeCases(now, mode);
  const result = { version: 1, kind: "ga4-cohort-contract-probe", diagnosticMode: mode, observedAt: now.toISOString(), propertyId: "541304395", diagnosticOnly: true,
    imported: false, coverageVerified: false, conversionRates: null, timezoneVerification: null, queries: [], success: false };
  const token = await getToken("https://www.googleapis.com/auth/analytics.readonly");
  if (typeof token !== "string" || !token.trim()) throw Error("probe_access_token_missing");
  const send = async (url, request) => {
    const response = await fetchImpl(url, { method: "POST", redirect: "error", cache: "no-store", signal: AbortSignal.timeout(30000),
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(request) });
    const raw = await response.text();
    let body = null;
    try { body = JSON.parse(raw); } catch { /* The body hash still identifies the invalid provider response. */ }
    return { response, body, receipt: { httpStatus: response.status, responseSha256: hash(raw),
      providerRequestId: safeReceiptText(response.headers.get("x-goog-request-id") || response.headers.get("x-request-id"), token) } };
  };
  const day = shiftDay(cohortDay(now), -1);
  const timezoneRequest = { dateRanges: [{ startDate: day, endDate: day }], dimensions: [{ name: "date" }], metrics: [{ name: "activeUsers" }], limit: "1" };
  try {
    const { response, body, receipt } = await send(REPORT_URL, timezoneRequest);
    const actual = safeReceiptText(body?.metadata?.timeZone, token, 80);
    const verified = response.ok && actual === COHORT_TIMEZONE;
    result.timezoneVerification = { ...receipt, request: timezoneRequest, expected: COHORT_TIMEZONE, actual, verified,
      ...(!response.ok ? { providerError: safeProviderError(body, token) } : {}) };
    if (!verified) return result;
  } catch { result.timezoneVerification = { verified: false, error: "timezone_request_failed" }; return result; }
  for (const testCase of cases) {
    const record = { ...testCase, requestSha256: hash(JSON.stringify(testCase.request)) };
    try {
      const { response, body, receipt } = await send(FUNNEL_URL, testCase.request);
      const validTable = body?.funnelTable && Array.isArray(body.funnelTable.dimensionHeaders) && Array.isArray(body.funnelTable.metricHeaders);
      record.receipt = { ...receipt, status: response.ok ? validTable ? "api_accepted" : "invalid_response" : "api_rejected", responseShape: response.ok ? aggregateShape(body) : null,
        visualizationShape: response.ok ? aggregateShape(body, "funnelVisualization") : null,
        ...(!response.ok ? { providerError: safeProviderError(body, token) } : {}) };
    } catch { record.receipt = { status: "network_error" }; }
    result.queries.push(record);
  }
  result.success = result.queries.length === cases.length && result.queries.every(row => row.receipt.status === "api_accepted");
  return result;
}

async function main() {
  assertProbeExecution(process.env, process.argv.slice(2));
  const directory = process.env.GA4_COHORT_PROBE_OUTPUT_DIR;
  fs.mkdirSync(directory, { recursive: true });
  let result;
  try { result = await runCohortProbe({ mode: process.env.GA4_COHORT_PROBE_MODE || "business-contract" }); }
  catch (error) { result = { kind: "ga4-cohort-contract-probe", diagnosticOnly: true, imported: false, coverageVerified: false, success: false,
    error: ["missing_credentials", "invalid_credentials", "auth_failed", "forbidden", "rate_limited", "unavailable", "invalid_response"].includes(error?.code) ? error.code : "probe_failed" }; }
  const text = JSON.stringify(result, null, 2) + "\n";
  fs.writeFileSync(path.join(directory, "cohort-contract-probe.json"), text, { mode: 0o600 });
  console.log(JSON.stringify({ kind: result.kind, success: result.success, diagnosticOnly: true, imported: false, coverageVerified: false,
    queryCount: result.queries?.length ?? 0, evidenceSha256: hash(text) }));
  if (!result.success) process.exitCode = 1;
}

module.exports = { PROBE_BRANCH, assertProbeExecution, createProbeCases, runCohortProbe, aggregateShape };
if (require.main === module) main().catch(() => { console.error(JSON.stringify({ error: "probe_execution_failed" })); process.exitCode = 1; });
