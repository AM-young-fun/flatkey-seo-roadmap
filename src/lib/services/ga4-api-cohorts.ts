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

export function parseApiCohortResponse(plan: ApiCohort, response: unknown): ApiCohort {
  if (plan.status !== "unavailable" || plan.reasons[0] !== "awaiting_funnel_query") throw Error("cohort_query_gate_not_met");
  type Table = { dimensionHeaders?: { name?: string }[]; metricHeaders?: { name?: string }[]; rows?: { dimensionValues?: { value?: string }[]; metricValues?: { value?: string }[] }[]; rowCount?: number; metadata?: Record<string, unknown> };
  const result = response as { funnelTable?: Table; metadata?: Record<string, unknown> } | null;
  const table = result?.funnelTable;
  if (qualityProblem(result?.metadata) || qualityProblem(table?.metadata)) return unavailable(plan, "sampling_thresholding_or_restriction", "partial");
  if (!table || table.dimensionHeaders?.length !== 1 || table.dimensionHeaders[0].name !== "funnelStepName" || !Array.isArray(table.metricHeaders)) return unavailable(plan, "funnel_headers_unrecognized");
  const userIndexes = table.metricHeaders.flatMap((header, i) => header.name === "activeUsers" ? [i] : []);
  if (userIndexes.length !== 1 || !Array.isArray(table.rows) || table.rows.length !== 2 || table.rowCount !== undefined && table.rowCount !== 2) return unavailable(plan, "funnel_steps_incomplete");
  const users: number[] = [];
  for (const [i, name] of ["Registration", "Outcome"].entries()) {
    const matches = table.rows.filter(row => row.dimensionValues?.length === 1 && [name, `${i + 1}. ${name}`].includes(row.dimensionValues[0].value ?? ""));
    const value = matches.length === 1 ? matches[0].metricValues?.[userIndexes[0]]?.value : undefined;
    if (!value || !/^\d+$/.test(value) || !Number.isSafeInteger(Number(value))) return unavailable(plan, "funnel_users_invalid");
    users.push(Number(value));
  }
  const [registeredUsers, convertedUsers] = users;
  if (convertedUsers > registeredUsers) return unavailable(plan, "closed_funnel_users_inconsistent");
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
