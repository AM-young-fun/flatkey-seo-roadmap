import "server-only";
import { GA4_HOST_SCOPE, FLATKEY_BUSINESS_HOSTS, ga4HostFilter, ga4RegistrationFilter, GA4_REGISTRATION_METRIC } from "../ga4-host-scope";
import { getGoogleReadAccessToken, GoogleReadError } from "../google-read-auth";
import { businessAnalyticsSchema, businessEventLabels, type BusinessAnalytics } from "../seo-business-analytics";

type Query = Pick<BusinessAnalytics, "start" | "end" | "country" | "scope">;
const exact = (fieldName: string, value: string) => ({ filter: { fieldName, stringFilter: { matchType: "EXACT", value, caseSensitive: true } } });

function registrationHostFilter(query: Query) {
  const productionHosts = ga4HostFilter(FLATKEY_BUSINESS_HOSTS);
  if (query.scope !== "all-channels" || query.country !== "all") return productionHosts;
  // The legacy server event does not attach a page URL. Its verified Flatkey
  // production stream identifies it without broadening any traffic attribution.
  return { orGroup: { expressions: [productionHosts, { andGroup: { expressions: [
    exact("eventName", "sign_up_success"), exact("streamId", "15056169010"),
    { filter: { fieldName: "hostName", emptyFilter: {} } },
  ] } }] } };
}

export async function fetchGa4Business(query: Query, now = new Date(), options: { registrationCompatibility?: boolean } = {}): Promise<BusinessAnalytics> {
  const token = process.env.SEO_GA4_ACCESS_TOKEN?.trim() || await getGoogleReadAccessToken("https://www.googleapis.com/auth/analytics.readonly");
  const filters: unknown[] = [ga4HostFilter(FLATKEY_BUSINESS_HOSTS), { filter: { fieldName: "eventName", inListFilter: { values: Object.keys(businessEventLabels).filter(name => !options.registrationCompatibility || name !== "sign_up"), caseSensitive: true } } }];
  if (query.country !== "all") filters.push(exact("countryId", query.country));
  if (query.scope === "session-organic-search") filters.push(exact("sessionDefaultChannelGroup", "Organic Search"));
  const response = await fetch("https://analyticsdata.googleapis.com/v1beta/properties/541304395:runReport", {
    method: "POST", redirect: "error", cache: "no-store", signal: AbortSignal.timeout(30000),
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ dateRanges: [{ startDate: query.start, endDate: query.end }], dimensions: [{ name: "eventName" }],
      metrics: [{ name: "eventCount" }, { name: "totalUsers" }], dimensionFilter: { andGroup: { expressions: filters } }, limit: "100" }),
  });
  if (!response.ok) throw new GoogleReadError(response.status === 403 ? "forbidden" : "unavailable", `GA4业务查询未完成（HTTP ${response.status}）`, response.status);
  const report = await response.json();
  if (report.dimensionHeaders?.map((row: { name: string }) => row.name).join() !== "eventName" || report.metricHeaders?.map((row: { name: string }) => row.name).join() !== "eventCount,totalUsers") throw new GoogleReadError("invalid_response", "GA4业务字段不匹配");
  const raw = report.rows ?? [];
  if (!Array.isArray(raw) || (report.rowCount ?? raw.length) !== raw.length || raw.length > 11) throw new GoogleReadError("invalid_response", "GA4业务报表行数不完整");
  const metadata = report.metadata ?? {};
  if (metadata.timeZone !== "America/Los_Angeles") throw new GoogleReadError("invalid_response", "GA4业务时区缺失或不匹配");
  const reasons = [metadata.subjectToThresholding && "thresholding", metadata.dataLossFromOtherRow && "other_row", metadata.emptyReason && "empty_reason",
    metadata.samplingMetadatas?.some((row: { samplesReadCount: string; samplingSpaceSize: string }) => row.samplesReadCount !== row.samplingSpaceSize) && "sampling",
    metadata.dataTruncationReasons?.length && "truncation", metadata.schemaRestrictionResponse?.activeMetricRestrictions?.length && "restricted_metrics"].filter((value): value is string => typeof value === "string");
  const count = (value: unknown) => { if (typeof value !== "string" || !/^\d+$/.test(value) || !Number.isSafeInteger(Number(value))) throw new GoogleReadError("invalid_response", "GA4业务计数无效"); return Number(value); };
  const rows = raw.map((row: { dimensionValues?: { value: string }[]; metricValues?: { value: string }[] }) => ({ event: row.dimensionValues?.[0]?.value, events: count(row.metricValues?.[0]?.value), users: count(row.metricValues?.[1]?.value) }));
  if (options.registrationCompatibility) {
    // One dimensionless IN query: GA4 deduplicates people observed under both
    // historical event names. Event counts are raw occurrences, not users.
    try {
      const registration = await fetch("https://analyticsdata.googleapis.com/v1beta/properties/541304395:runReport", {
        method: "POST", redirect: "error", cache: "no-store", signal: AbortSignal.timeout(30000),
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ dateRanges: [{ startDate: query.start, endDate: query.end }], metrics: [{ name: "eventCount" }, { name: "totalUsers" }],
          dimensionFilter: { andGroup: { expressions: [registrationHostFilter(query), ga4RegistrationFilter(),
            ...(query.country === "all" ? [] : [exact("countryId", query.country)]),
            ...(query.scope === "all-channels" ? [] : [exact("sessionDefaultChannelGroup", "Organic Search")])] } }, limit: "1" }),
      });
      if (!registration.ok) throw new GoogleReadError("unavailable", "registration_http_error", registration.status);
      const report = await registration.json(), metadata = report.metadata ?? {}, registrationRows = report.rows ?? [];
      if ((report.dimensionHeaders?.length ?? 0) !== 0 || report.metricHeaders?.map((row: { name: string }) => row.name).join() !== "eventCount,totalUsers" || metadata.timeZone !== "America/Los_Angeles" || !Array.isArray(registrationRows) || registrationRows.length > 1 || (report.rowCount ?? registrationRows.length) !== registrationRows.length) throw new GoogleReadError("invalid_response", "registration_shape_invalid");
      const restricted = metadata.subjectToThresholding || metadata.dataLossFromOtherRow || metadata.emptyReason || metadata.dataTruncationReasons?.length || metadata.schemaRestrictionResponse?.activeMetricRestrictions?.length || metadata.samplingMetadatas?.some((row: { samplesReadCount: string; samplingSpaceSize: string }) => row.samplesReadCount !== row.samplingSpaceSize);
      if (restricted) reasons.push("registration_thresholding_sampling_or_restriction");
      else if (registrationRows.length) {
        const row = registrationRows[0];
        if ((row.dimensionValues?.length ?? 0) || row.metricValues?.length !== 2) throw new GoogleReadError("invalid_response", "registration_row_invalid");
        rows.push({ event: "sign_up", events: count(row.metricValues[0].value), users: count(row.metricValues[1].value) });
      }
    } catch (error) { reasons.push(error instanceof GoogleReadError ? `registration_${error.code}${error.status ? "_http_" + error.status : ""}` : "registration_query_failed"); }
  }
  return businessAnalyticsSchema.parse({ ...(options.registrationCompatibility ? { registrationMetric: GA4_REGISTRATION_METRIC } : {}), hostScope: GA4_HOST_SCOPE, version: 1, siteDomain: "flatkey.ai", propertyId: "541304395", source: "google-api", ...query,
    timezone: "America/Los_Angeles", observedAt: now.toISOString(), distinctOverWholePeriod: true, complete: reasons.length === 0, reasons,
    rows });
}
