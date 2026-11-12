import "server-only";
import { getGoogleReadAccessToken, GoogleReadError } from "../google-read-auth";
import { FLATKEY_BUSINESS_HOSTS, ga4HostFilter } from "../ga4-host-scope";
import { apiCohortSchema, cohortDefinitions, cohortKinds, COHORT_TIMEZONE, planApiCohort, type ApiCohort, type CohortKind, type CohortQuery } from "../seo-api-cohorts";
import { shiftDay } from "../seo-date-range";

const exact = (fieldName: string, value: string) => ({ funnelFieldFilter: { fieldName, stringFilter: { matchType: "EXACT", value, caseSensitive: true } } });
/** Two separate signup -> outcome funnels. Acquisition filters belong to signup
 * only: a subsequent Direct session or a payment before first use still counts. */
export function apiCohortRequest(query: CohortQuery, plan: ApiCohort) {
  if (query.start !== plan.registrationStart || query.end !== plan.registrationEnd || query.country !== plan.registrationCountry || query.scope !== plan.registrationScope) throw Error("cohort_query_scope_mismatch");
  const dates: string[] = [];
  for (let day = query.start; day <= query.end; day = shiftDay(day, 1)) dates.push(day.replaceAll("-", ""));
  return {
    dateRanges: [{ startDate: query.start, endDate: plan.observationEnd }],
    funnel: { isOpenFunnel: false, steps: [
      { name: "Registration", isDirectlyFollowedBy: false, filterExpression: { andGroup: { expressions: [
        { funnelEventFilter: { eventName: "sign_up" } },
        { funnelFieldFilter: { fieldName: "date", inListFilter: { values: dates, caseSensitive: true } } },
        ...(query.country === "all" ? [] : [exact("countryId", query.country)]),
        ...(query.scope === "all-channels" ? [] : [exact("sessionDefaultChannelGroup", "Organic Search")]),
      ] } } },
      { name: "Outcome", isDirectlyFollowedBy: false, withinDurationFromPriorStep: `${plan.windowSeconds}s`, filterExpression: {
        funnelEventFilter: { eventName: cohortDefinitions[plan.kind].event, funnelParameterFilterExpression: {
          funnelParameterFilter: { eventParameterName: "business", stringFilter: { matchType: "EXACT", value: "api", caseSensitive: true } },
        } },
      } },
    ] },
    dimensionFilter: ga4HostFilter(FLATKEY_BUSINESS_HOSTS),
  };
}

const unavailable = (plan: ApiCohort, reason: string, status: "unavailable" | "partial" = "unavailable") => apiCohortSchema.parse({ ...plan, status, reasons: [reason], registeredUsers: null, convertedUsers: null, rate: null });
const qualityProblem = (metadata: Record<string, unknown> | undefined) => Boolean(metadata && (
  metadata.subjectToThresholding || metadata.dataLossFromOtherRow || metadata.emptyReason ||
  Array.isArray(metadata.samplingMetadatas) && metadata.samplingMetadatas.length ||
  metadata.samplingMetadatas && !Array.isArray(metadata.samplingMetadatas) ||
  metadata.schemaRestrictionResponse && Object.keys(metadata.schemaRestrictionResponse).length ||
  Array.isArray(metadata.dataTruncationReasons) && metadata.dataTruncationReasons.length
));

type FunnelTable = { dimensionHeaders?: { name?: string }[]; metricHeaders?: { name?: string; type?: string }[]; rows?: { dimensionValues?: { value?: string }[]; metricValues?: { value?: string }[] }[]; rowCount?: number; metadata?: Record<string, unknown> };
type FunnelUsers = { status: "ready"; users: [number, number] } | { status: "unavailable" | "partial"; reason: string };
const canonicalTableMetrics = ["activeUsers", "funnelStepCompletionRate", "funnelStepAbandonments", "funnelStepAbandonmentRate"] as const;
const integerUserCount = (value: unknown) => typeof value === "string" && /^\d+$/.test(value) && Number.isSafeInteger(Number(value)) ? Number(value) : null;

/** Extract only same-funnel users. The diagnostic caller supplies its own fixed
 * step labels; this helper does not infer registration coverage or compute rates. */
export function extractClosedFunnelUsers(response: unknown, stepNames: readonly [string, string]): FunnelUsers {
  const fail = (reason: string): FunnelUsers => ({ status: "unavailable", reason });
  if (stepNames.length !== 2 || stepNames[0] === stepNames[1]) return fail("funnel_expected_steps_invalid");
  const result = response as { funnelTable?: FunnelTable; funnelVisualization?: FunnelTable; metadata?: Record<string, unknown> } | null;
  const table = result?.funnelTable, visualization = result?.funnelVisualization;
  if (qualityProblem(result?.metadata) || qualityProblem(table?.metadata) || qualityProblem(visualization?.metadata)) return { status: "partial", reason: "sampling_thresholding_or_restriction" };
  const twoStepTable = (value: FunnelTable | undefined) => value?.dimensionHeaders?.length === 1 && value.dimensionHeaders[0].name === "funnelStepName" && Array.isArray(value.metricHeaders) && Array.isArray(value.rows) && value.rows.length === 2 && (value.rowCount === undefined || value.rowCount === 2);
  if (!twoStepTable(table)) return fail("funnel_steps_incomplete");
  const headers = table!.metricHeaders!;
  const userIndexes = headers.flatMap((header, i) => header.name === "activeUsers" ? [i] : []);
  // Actual 2026-11-11 provider response (run 43012602560): the complete four
  // table headers repeat twice, but each row has only ONE four-value group.
  // Accept that exact anomaly only with an independent matching visualization.
  // Never pick the first activeUsers of an otherwise ambiguous header layout.
  const repeatedHeaders = headers.length === 8 && headers.every((header, i) => header.name === canonicalTableMetrics[i % 4] && header.type === headers[i % 4].type);
  if (userIndexes.length !== 1 && !repeatedHeaders) return fail("funnel_headers_ambiguous");
  const width = repeatedHeaders ? 4 : headers.length;
  const visualizationHeaders = visualization?.metricHeaders;
  const checkedVisualization = twoStepTable(visualization) && visualizationHeaders?.length === (repeatedHeaders ? 2 : 1) && visualizationHeaders.every(header => header.name === "activeUsers") && (!repeatedHeaders || visualizationHeaders[0].type === visualizationHeaders[1].type);
  if (repeatedHeaders && !checkedVisualization || visualization && !checkedVisualization) return fail("funnel_visualization_layout_unverified");
  const users: number[] = [];
  for (const [i, name] of stepNames.entries()) {
    const matches = (value: FunnelTable) => value.rows!.filter(row => row.dimensionValues?.length === 1 && [name, `${i + 1}. ${name}`].includes(row.dimensionValues[0].value ?? ""));
    const rows = matches(table!);
    if (rows.length !== 1 || rows[0].metricValues?.length !== width) return fail("funnel_row_width_or_step_invalid");
    const value = integerUserCount(rows[0].metricValues[userIndexes[0]]?.value);
    if (value === null) return fail("funnel_users_invalid");
    if (checkedVisualization) {
      const visualRows = matches(visualization!);
      if (visualRows.length !== 1 || visualRows[0].metricValues?.length !== 1 || integerUserCount(visualRows[0].metricValues[0]?.value) !== value) return fail("funnel_visualization_users_mismatch");
    }
    users.push(value);
  }
  if (users[1] > users[0]) return fail("closed_funnel_users_inconsistent");
  return { status: "ready", users: [users[0], users[1]] };
}

export function parseApiCohortResponse(plan: ApiCohort, response: unknown): ApiCohort {
  if (plan.status !== "unavailable" || plan.reasons[0] !== "awaiting_funnel_query") throw Error("cohort_query_gate_not_met");
  const result = extractClosedFunnelUsers(response, ["Registration", "Outcome"]);
  if (result.status !== "ready") return unavailable(plan, result.reason, result.status);
  const [registeredUsers, convertedUsers] = result.users;
  return apiCohortSchema.parse({ ...plan, status: registeredUsers ? "ready" : "no_users", reasons: [], registeredUsers, convertedUsers, rate: registeredUsers ? convertedUsers / registeredUsers : null });
}

export async function fetchGa4ApiCohort(query: CohortQuery, kind: CohortKind, options: { now?: Date; coverageStart?: string; verifiedTimezone?: string } = {}): Promise<ApiCohort> {
  const plan = planApiCohort(query, kind, options.now ?? new Date(), options.coverageStart ?? process.env.GA4_COHORT_COVERAGE_START);
  if (plan.status !== "unavailable" || plan.reasons[0] !== "awaiting_funnel_query") return plan;
  // runFunnelReport metadata has no timezone. The caller must pass the timezone
  // from the same property's successful, strict runReport response, not an env guess.
  if (options.verifiedTimezone !== COHORT_TIMEZONE) return unavailable(plan, "property_timezone_not_verified");
  try {
    const token = process.env.SEO_GA4_ACCESS_TOKEN?.trim() || await getGoogleReadAccessToken("https://www.googleapis.com/auth/analytics.readonly");
    const response = await fetch("https://analyticsdata.googleapis.com/v1alpha/properties/541304395:runFunnelReport", {
      method: "POST", redirect: "error", cache: "no-store", signal: AbortSignal.timeout(30000),
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(apiCohortRequest(query, plan)),
    });
    if (!response.ok) return unavailable(plan, `funnel_http_${response.status}`);
    return parseApiCohortResponse(plan, await response.json());
  } catch (error) { return unavailable(plan, error instanceof GoogleReadError ? error.code : "funnel_query_failed"); }
}
export async function fetchGa4ApiCohorts(query: CohortQuery, options: { now?: Date; coverageStart?: string; verifiedTimezone?: string } = {}) {
  return Promise.all(cohortKinds.map(kind => fetchGa4ApiCohort(query, kind, options)));
}
