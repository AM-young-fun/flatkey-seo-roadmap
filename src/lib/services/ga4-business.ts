import "server-only";
import { getGoogleReadAccessToken, GoogleReadError } from "../google-read-auth";
import { businessAnalyticsSchema, businessEventLabels, type BusinessAnalytics } from "../seo-business-analytics";

type Query = Pick<BusinessAnalytics, "start" | "end" | "country" | "scope">;
const exact = (fieldName: string, value: string) => ({ filter: { fieldName, stringFilter: { matchType: "EXACT", value, caseSensitive: true } } });

export async function fetchGa4Business(query: Query, now = new Date()): Promise<BusinessAnalytics> {
  const token = process.env.SEO_GA4_ACCESS_TOKEN?.trim() || await getGoogleReadAccessToken("https://www.googleapis.com/auth/analytics.readonly");
  const filters: unknown[] = [{ filter: { fieldName: "eventName", inListFilter: { values: Object.keys(businessEventLabels), caseSensitive: true } } }];
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
  return businessAnalyticsSchema.parse({ version: 1, siteDomain: "flatkey.ai", propertyId: "541304395", source: "google-api", ...query,
    timezone: "America/Los_Angeles", observedAt: now.toISOString(), distinctOverWholePeriod: true, complete: reasons.length === 0, reasons,
    rows: raw.map((row: { dimensionValues?: { value: string }[]; metricValues?: { value: string }[] }) => ({ event: row.dimensionValues?.[0]?.value, events: count(row.metricValues?.[0]?.value), users: count(row.metricValues?.[1]?.value) })) });
}
