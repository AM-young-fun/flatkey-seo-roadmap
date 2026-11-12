import "server-only";
import { FLATKEY_BUSINESS_HOSTS, ga4HostFilter, ga4RegistrationFunnelFilter } from "../ga4-host-scope";
import { getGoogleReadAccessToken, GoogleReadError } from "../google-read-auth";
import { journeyLabels, journeySchema, engagementSchema, type BusinessJourney, type BusinessEngagement } from "../seo-business-journeys";
import type { BusinessAnalytics } from "../seo-business-analytics";

type Query = Pick<BusinessAnalytics, "start" | "end" | "country" | "scope">;
const origin = "https://analyticsdata.googleapis.com";
const property = "properties/541304395";
const exact = (fieldName: string, value: string) => ({ filter: { fieldName, stringFilter: { matchType: "EXACT", value, caseSensitive: true } } });
const parameter = (eventParameterName: string, value: string) => ({ funnelParameterFilter: { eventParameterName, stringFilter: { matchType: "EXACT", value, caseSensitive: true } } });
const event = (eventName: string, parameters?: Record<string, string>) => ({ funnelEventFilter: { eventName, ...(parameters ? { funnelParameterFilterExpression: { andGroup: { expressions: Object.entries(parameters).map(([name, value]) => parameter(name, value)) } } } : {}) } });
const finite = (value: unknown) => { if (typeof value !== "string" || !/^\d+(\.\d+)?$/.test(value) || !Number.isFinite(Number(value))) throw new GoogleReadError("invalid_response", "GA4 数值无效"); return Number(value); };
const reason = (error: unknown) => error instanceof GoogleReadError ? `${error.code}${error.status ? " HTTP " + error.status : error.message.startsWith("funnel_") ? ":" + error.message : ""}` : "query_failed";
const partial = (metadata: Record<string, unknown> = {}) => Boolean(metadata.subjectToThresholding || metadata.dataLossFromOtherRow || metadata.samplingMetadatas || metadata.schemaRestrictionResponse || metadata.dataTruncationReasons || metadata.emptyReason);
async function request(endpoint: string, token: string, body?: unknown) {
  const response = await fetch(origin + endpoint, { method: body ? "POST" : "GET", redirect: "error", cache: "no-store", signal: AbortSignal.timeout(30000), headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
  if (!response.ok) throw new GoogleReadError(response.status === 403 ? "forbidden" : response.status === 400 ? "invalid_response" : "unavailable", "GA4 分析查询未完成", response.status);
  return response.json();
}
export function funnelRequest(query: Query, business: "gpu" | "api") {
  if (query.scope !== "all-channels") throw new GoogleReadError("invalid_response", "漏斗为全渠道同用户口径");
  const filters = business === "gpu" ? [event("page_view", { business: "gpu" }), event("flow_step", { flow: "gpu_rental", step: "start" }), event("gpu_rental_success")] : [ga4RegistrationFunnelFilter(), event("first_model_success", { business: "api" }), event("first_payment_completed", { business: "api" })];
  return { dateRanges: [{ startDate: query.start, endDate: query.end }], funnel: { isOpenFunnel: false,
    steps: filters.map((filterExpression, i) => ({ name: journeyLabels[business][i], filterExpression, isDirectlyFollowedBy: false, ...(i ? { withinDurationFromPriorStep: business === "gpu" ? "86400s" : i === 1 ? "604800s" : "2592000s" } : {}) })) },
    dimensionFilter: { andGroup: { expressions: [ga4HostFilter(FLATKEY_BUSINESS_HOSTS), ...(query.country === "all" ? [] : [exact("countryId", query.country)])] } } };
}
export async function fetchGa4Journey(query: Query, business: "gpu" | "api"): Promise<BusinessJourney> {
  const base = { business, closedFunnel: true as const, identity: "ga4-reporting-identity" as const };
  try {
    const token = process.env.SEO_GA4_ACCESS_TOKEN?.trim() || await getGoogleReadAccessToken("https://www.googleapis.com/auth/analytics.readonly");
    const response = await request(`/v1alpha/${property}:runFunnelReport`, token, funnelRequest(query, business));
    const report = response.funnelTable;
    if (!report || report.dimensionHeaders?.length !== 1 || report.dimensionHeaders[0].name !== "funnelStepName" || !Array.isArray(report.metricHeaders)) throw new GoogleReadError("invalid_response", "funnel_headers_unrecognized");
    if (report.rows === undefined || Array.isArray(report.rows) && report.rows.length === 0) return { ...base, status: "unavailable", reason: "no_matching_steps_in_selected_period", steps: [] };
    if (!Array.isArray(report.rows)) throw new GoogleReadError("invalid_response", "funnel_rows_invalid");
    const index = (name: string) => report.metricHeaders.findIndex((row: { name: string }) => row.name === name);
    if (index("activeUsers") < 0 || report.rows.length !== 3 || report.rowCount !== undefined && report.rowCount !== 3) throw new GoogleReadError("invalid_response", "funnel_steps_incomplete");
    const steps = journeyLabels[business].map((name, i) => {
      const row = report.rows.find((row: { dimensionValues: { value: string }[] }) => row.dimensionValues?.[0]?.value === `${i + 1}. ${name}` || row.dimensionValues?.[0]?.value === name);
      if (!row) throw new GoogleReadError("invalid_response", "funnel_step_names_unrecognized");
      const metric = (key: string) => index(key) < 0 ? null : finite(row.metricValues?.[index(key)]?.value);
      return { name, users: metric("activeUsers"), abandonments: i === 2 ? null : metric("funnelStepAbandonments"), completionRate: i === 2 ? null : metric("funnelStepCompletionRate") };
    });
    if (!steps.some(step => step.users !== null && step.users > 0)) return { ...base, status: "unavailable", reason: "no_matching_steps_in_selected_period", steps: [] };
    return journeySchema.parse({ ...base, status: partial(report.metadata) ? "partial" : "ready", steps, ...(partial(report.metadata) ? { reason: "thresholding_sampling_or_restriction" } : {}) });
  } catch (error) { return { ...base, status: "unavailable", reason: reason(error), steps: [] }; }
}
export async function fetchGa4Engagement(query: Query): Promise<BusinessEngagement> {
  let activeTimeCustomMetric: BusinessEngagement["activeTimeCustomMetric"] = "unverified";
  try {
    const token = process.env.SEO_GA4_ACCESS_TOKEN?.trim() || await getGoogleReadAccessToken("https://www.googleapis.com/auth/analytics.readonly");
    try {
      const metadata = await request(`/v1beta/${property}/metadata`, token);
      if (Array.isArray(metadata.metrics)) activeTimeCustomMetric = metadata.metrics.some((row: { apiName: string }) => row.apiName === "customEvent:active_time_msec") ? "registered" : "missing";
    } catch { /* Metadata cannot replace or invalidate the independently queried standard metric. */ }
    const filters = [ga4HostFilter(FLATKEY_BUSINESS_HOSTS), ...(query.country === "all" ? [] : [exact("countryId", query.country)]), ...(query.scope === "all-channels" ? [] : [exact("sessionDefaultChannelGroup", "Organic Search")])];
    const report = await request(`/v1beta/${property}:runReport`, token, { dateRanges: [{ startDate: query.start, endDate: query.end }], metrics: [{ name: "userEngagementDuration" }, { name: "activeUsers" }], ...(filters.length ? { dimensionFilter: { andGroup: { expressions: filters } } } : {}) });
    if (report.metricHeaders?.map((row: { name: string }) => row.name).join() !== "userEngagementDuration,activeUsers" || report.rows?.length !== 1) throw new GoogleReadError("invalid_response", "参与时长无完整回执");
    return engagementSchema.parse({ status: partial(report.metadata) ? "partial" : "ready", engagementSeconds: finite(report.rows[0].metricValues?.[0]?.value), activeUsers: finite(report.rows[0].metricValues?.[1]?.value), activeTimeCustomMetric });
  } catch (error) { return { status: "unavailable", reason: reason(error), engagementSeconds: null, activeUsers: null, activeTimeCustomMetric }; }
}
