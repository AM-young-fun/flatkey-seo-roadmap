import "server-only";
import { GA4_HOST_SCOPE, FLATKEY_ENTRY_HOSTS, ga4HostFilter } from "../ga4-host-scope";

import { getGoogleReadAccessToken, GoogleReadError } from "../google-read-auth";
import { propertyToday, shiftDay, validRange, type DateRange } from "../seo-date-range";
import type { SearchRegionCode } from "../seo";

export const GA4_ORGANIC_CHANNEL = "Organic Search";
export const GA4_CHANNEL_DIMENSION = "sessionDefaultChannelGroup";
export const GA4_REGISTRATION_EVENT = "sign_up_success";
const GA4_PROPERTY_ID = "541304395";
const GA4_TIMEZONE = "America/Los_Angeles";
const GA4_READ_SCOPE = "https://www.googleapis.com/auth/analytics.readonly";
const PAGE_SIZE = 10_000;
const MAX_ROWS = 250_000;

export type Ga4OrganicDay = {
  date: string;
  sessions: number | null;
  /** Distinct users who recorded sign_up_success on this date. Do not add across dates or pages. */
  registrations: number | null;
  registrationEvents: number | null;
};
export type Ga4OrganicPage = Ga4OrganicDay & { path: string; hostname: string };
export type Ga4ReportQuality = { complete: boolean; reasons: string[] };
export type Ga4OrganicResult = DateRange & {
  hostScope: typeof GA4_HOST_SCOPE;
  propertyId: string;
  timezone: string;
  fetchedAt: string;
  daily: Ga4OrganicDay[];
  pages: Ga4OrganicPage[];
  quality: Record<"siteSessions" | "siteRegistrations" | "pageSessions" | "pageRegistrations", Ga4ReportQuality>;
};
export type Ga4RealtimeResult = {
  scope: "all-channels";
  propertyId: string;
  fetchedAt: string;
  windowMinutes: 30;
  activeUsers: number;
  activeUsersLast5Minutes: number;
  pageViews: number;
  registrationEvents: number;
  organicSearchAvailable: false;
};

type Row = {
  dimensionValues?: { value?: string }[];
  metricValues?: { value?: string }[];
};
type Report = {
  dimensionHeaders?: { name?: string }[];
  metricHeaders?: { name?: string }[];
  rows?: Row[];
  rowCount?: number;
  metadata?: {
    timeZone?: string;
    dataLossFromOtherRow?: boolean;
    subjectToThresholding?: boolean;
    emptyReason?: string;
    samplingMetadatas?: { samplesReadCount?: string; samplingSpaceSize?: string }[];
    dataTruncationReasons?: unknown[];
    schemaRestrictionResponse?: { activeMetricRestrictions?: unknown[] };
  };
};

type ReportQuery = {
  dimensions?: { name: string }[];
  metrics: { name: string }[];
  dimensionFilter?: unknown;
  dateRanges?: { startDate: string; endDate: string }[];
  minuteRanges?: { startMinutesAgo: number; endMinutesAgo: number }[];
  orderBys?: { dimension: { dimensionName: string } }[];
  limit?: string;
  offset?: string;
};

const exact = (fieldName: string, value: string) => ({
  filter: { fieldName, stringFilter: { matchType: "EXACT", value, caseSensitive: true } },
});

function propertyId() {
  const id = process.env.SEO_GA4_PROPERTY_ID?.trim() || GA4_PROPERTY_ID;
  if (!/^\d+$/.test(id)) throw new GoogleReadError("invalid_credentials", "GA4 属性 ID 无效。");
  return id;
}

async function accessToken() {
  return process.env.SEO_GA4_ACCESS_TOKEN?.trim() || await getGoogleReadAccessToken(GA4_READ_SCOPE);
}

async function requestReport(
  id: string,
  token: string,
  method: "runReport" | "runRealtimeReport",
  query: ReportQuery,
): Promise<Report> {
  const url = `https://analyticsdata.googleapis.com/v1beta/properties/${id}:${method}`;
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      cache: "no-store",
      redirect: "error",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(query),
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    throw new GoogleReadError("unavailable", "GA4 数据接口暂时不可用。");
  }
  if (!response.ok) {
    const status = response.status;
    if (status === 401) throw new GoogleReadError("auth_failed", "GA4 的 Google 访问凭据已失效。", status);
    if (status === 403) throw new GoogleReadError("forbidden", "当前 Google 凭据无法读取该 GA4 属性，请检查属性读权限及 analytics.readonly 授权。", status);
    if (status === 429) throw new GoogleReadError("rate_limited", "GA4 请求达到配额，请稍后重试。", status);
    throw new GoogleReadError("unavailable", `GA4 未能执行查询（HTTP ${status}）。`, status);
  }
  const report = await response.json().catch(() => null) as Report | null;
  const dimensions = query.dimensions?.map(({ name }) => name) ?? [];
  const metrics = query.metrics.map(({ name }) => name);
  const matchesHeaders = (headers: Report["dimensionHeaders"], expected: string[]) => {
    const actual = headers ?? [];
    return Array.isArray(actual) && actual.length === expected.length && actual.every((header, i) => header?.name === expected[i]);
  };
  if (!report || !matchesHeaders(report.dimensionHeaders, dimensions) || !matchesHeaders(report.metricHeaders, metrics)
    || (report.rows !== undefined && !Array.isArray(report.rows))
    || (report.rowCount !== undefined && (!Number.isSafeInteger(report.rowCount) || report.rowCount < 0))) {
    throw new GoogleReadError("invalid_response", "GA4 返回的报表字段或行数不符合查询。");
  }
  return report;
}

function qualityReasons(report: Report): string[] {
  const metadata = report.metadata;
  if (!metadata) return [];
  return [
    metadata.subjectToThresholding ? "thresholding" : null,
    metadata.dataLossFromOtherRow ? "other_row" : null,
    metadata.samplingMetadatas?.some(row => row.samplesReadCount !== row.samplingSpaceSize) ? "sampling" : null,
    metadata.dataTruncationReasons?.length ? "data_truncation" : null,
    metadata.schemaRestrictionResponse?.activeMetricRestrictions?.length ? "restricted_metrics" : null,
    metadata.emptyReason ? "empty_reason" : null,
  ].filter((reason): reason is string => reason !== null);
}

function metric(row: Row, index: number): number {
  const value = row.metricValues?.[index]?.value;
  const count = Number(value);
  if (typeof value !== "string" || !/^\d+$/.test(value) || !Number.isSafeInteger(count)) {
    throw new GoogleReadError("invalid_response", "GA4 返回了无效计数。");
  }
  return count;
}

async function coreReport(
  id: string,
  token: string,
  range: DateRange,
  byPage: boolean,
  registration: boolean,
  country?: SearchRegionCode,
  timezone = GA4_TIMEZONE,
) {
  const dimensions = ["date", ...(byPage ? ["landingPage", "hostName"] : [])];
  const channel = exact(GA4_CHANNEL_DIMENSION, GA4_ORGANIC_CHANNEL);
  const filters: unknown[] = [channel, ...(id === GA4_PROPERTY_ID ? [ga4HostFilter(FLATKEY_ENTRY_HOSTS)] : [])];
  if (country) filters.push(exact("countryId", country));
  if (registration) filters.push(exact("eventName", GA4_REGISTRATION_EVENT));
  else if (byPage) filters.push(exact("eventName", "session_start"));
  const query: ReportQuery = {
    dateRanges: [{ startDate: range.start, endDate: range.end }],
    dimensions: dimensions.map(name => ({ name })),
    metrics: (registration ? ["totalUsers", "eventCount"] : ["sessions"]).map(name => ({ name })),
    dimensionFilter: filters.length > 1 ? { andGroup: { expressions: filters } } : channel,
    orderBys: dimensions.map(dimensionName => ({ dimension: { dimensionName } })),
    limit: String(PAGE_SIZE),
  };
  const values = new Map<string, number[]>();
  const reasons = new Set<string>();
  let readRows = 0;
  let totalRows: number | undefined;
  do {
    const report = await requestReport(id, token, "runReport", { ...query, offset: String(readRows) });
    if (report.metadata?.timeZone && report.metadata.timeZone !== timezone) {
      throw new GoogleReadError("invalid_response", `GA4 属性时区与配置的 ${timezone} 不一致。`);
    }
    for (const reason of qualityReasons(report)) reasons.add(reason);
    const rows = report.rows ?? [];
    const reportedRows = report.rowCount ?? rows.length;
    totalRows ??= reportedRows;
    if (reportedRows !== totalRows || rows.length > PAGE_SIZE || readRows + rows.length > reportedRows) {
      throw new GoogleReadError("invalid_response", "GA4 分页结果发生变化，请重新采集。");
    }
    for (const row of rows) {
      const rawDate = row.dimensionValues?.[0]?.value ?? "";
      const date = `${rawDate.slice(0, 4)}-${rawDate.slice(4, 6)}-${rawDate.slice(6, 8)}`;
      if (!/^\d{8}$/.test(rawDate) || date < range.start || date > range.end || !validRange({ start: date, end: date })) {
        throw new GoogleReadError("invalid_response", "GA4 返回了查询区间以外或无效的日期。");
      }
      const path = row.dimensionValues?.[1]?.value;
      // GA4 also has traffic without a known landing path. Site totals are queried independently.
      if (byPage && (!path?.startsWith("/") || path.startsWith("//"))) continue;
      const hostname = row.dimensionValues?.[2]?.value?.trim().toLowerCase();
      if (byPage && (!hostname || !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i.test(hostname))) { reasons.add("unknown_hostname"); continue; }
      const key = byPage ? `${date}\t${hostname}\t${path}` : date;
      if (values.has(key)) throw new GoogleReadError("invalid_response", "GA4 返回了重复的日期与页面行。");
      values.set(key, query.metrics.map((_, index) => metric(row, index)));
    }
    readRows += rows.length;
    if (rows.length === 0) break;
  } while (readRows < Math.min(totalRows, MAX_ROWS));
  if (readRows < totalRows) reasons.add("incomplete_pagination");
  const quality: Ga4ReportQuality = { complete: reasons.size === 0, reasons: [...reasons] };
  return {
    values,
    quality,
    count: (key: string, index = 0) => values.get(key)?.[index] ?? (quality.complete ? 0 : null),
  };
}

/** Collect the GA4 site's and landing paths' daily metrics under the same session channel filter. */
export async function fetchGa4Organic(range: DateRange, country?: SearchRegionCode): Promise<Ga4OrganicResult> {
  if (!validRange(range) || range.end >= propertyToday() || Date.parse(range.end) - Date.parse(range.start) > 365 * 86_400_000) {
    throw new RangeError("请选择 GA4 属性时区内 1 至 366 个已结束日。");
  }
  const id = propertyId();
  const token = await accessToken();
  const [siteSessions, siteRegistrations, pageSessions] = await Promise.all([
    coreReport(id, token, range, false, false, country),
    coreReport(id, token, range, false, true, country),
    coreReport(id, token, range, true, false, country),
  ]);
  // hostName is event-scoped. At signup it can be console.flatkey.ai while
  // landingPage still describes a website entry. Until a session landing-host
  // dimension/funnel is verified, that pair must never create a conversion URL.
  const pageRegistrations = { values: new Map<string, number[]>(), count: (_key: string, _index = 0): number | null => null,
    quality: { complete: false, reasons: ["landing_host_attribution_unverified"] } };
  const daily: Ga4OrganicDay[] = [];
  for (let date = range.start; date <= range.end; date = shiftDay(date, 1)) {
    daily.push({ date, sessions: siteSessions.count(date), registrations: siteRegistrations.count(date), registrationEvents: siteRegistrations.count(date, 1) });
  }
  const pages = [...new Set([...pageSessions.values.keys(), ...pageRegistrations.values.keys()])].sort().map(key => ({
    date: key.slice(0, 10),
    hostname: key.split("\t")[1],
    path: key.split("\t")[2],
    sessions: pageSessions.count(key),
    registrations: pageRegistrations.count(key),
    registrationEvents: pageRegistrations.count(key, 1),
  }));
  return {
    ...range,
    hostScope: GA4_HOST_SCOPE, propertyId: id,
    timezone: GA4_TIMEZONE,
    fetchedAt: new Date().toISOString(),
    daily,
    pages,
    quality: {
      siteSessions: siteSessions.quality,
      siteRegistrations: siteRegistrations.quality,
      pageSessions: pageSessions.quality,
      pageRegistrations: pageRegistrations.quality,
    },
  };
}

/** GA4 Realtime exposes property-wide activity. Its schema has no session channel or landing URL dimension. */
export async function fetchGa4Realtime(): Promise<Ga4RealtimeResult> {
  const id = propertyId();
  const token = await accessToken();
  const summary = (minutes: number, metrics: string[], dimensionFilter?: unknown) => requestReport(id, token, "runRealtimeReport", {
    minuteRanges: [{ startMinutesAgo: minutes - 1, endMinutesAgo: 0 }],
    metrics: metrics.map(name => ({ name })),
    dimensionFilter,
  });
  const [last30, last5, registration] = await Promise.all([
    summary(30, ["activeUsers", "screenPageViews"]),
    summary(5, ["activeUsers"]),
    summary(30, ["eventCount"], exact("eventName", GA4_REGISTRATION_EVENT)),
  ]);
  const count = (report: Report, index = 0) => {
    const rows = report.rows ?? [];
    if (rows.length > 1 || (report.rowCount ?? rows.length) !== rows.length) {
      throw new GoogleReadError("invalid_response", "GA4 实时汇总返回了意外的行数。");
    }
    return rows[0] ? metric(rows[0], index) : 0;
  };
  return {
    scope: "all-channels",
    propertyId: id,
    fetchedAt: new Date().toISOString(),
    windowMinutes: 30,
    activeUsers: count(last30),
    activeUsersLast5Minutes: count(last5),
    pageViews: count(last30, 1),
    registrationEvents: count(registration),
    organicSearchAvailable: false,
  };
}

/** Cluster registration events are not verified; collect only independently reported sessions. */
export async function fetchGa4SiteSessions(range: DateRange, property: string, timezone: string, country?: SearchRegionCode) {
  if (!/^\d+$/.test(property) || !validRange(range) || range.end >= propertyToday(timezone)) {
    throw new RangeError("GA4 属性或日期无效");
  }
  const report = await coreReport(property, await accessToken(), range, false, false, country, timezone);
  return { fetchedAt: new Date().toISOString(), quality: report.quality,
    daily: [...report.values].map(([date, values]) => ({ date, sessions: report.quality.complete ? values[0] : null })) };
}

/** Cluster page sessions retain host identity; unverified conversion events stay null. */
export async function fetchGa4SitePages(range: DateRange, property: string, timezone: string, country?: SearchRegionCode) {
  if (!/^\d+$/.test(property) || !validRange(range) || range.end >= propertyToday(timezone)) throw new RangeError("GA4 属性或日期无效");
  const report = await coreReport(property, await accessToken(), range, true, false, country, timezone);
  return { fetchedAt: new Date().toISOString(), quality: report.quality,
    pages: [...report.values].map(([key, values]) => ({ date: key.split("\t")[0], hostname: key.split("\t")[1], path: key.split("\t")[2],
      sessions: report.quality.complete ? values[0] : null, registrations: null })) };
}

/** Period-unique users are queried without date/page dimensions, never summed from daily rows. */
export async function fetchGa4OrganicPeriod(range: DateRange, country?: SearchRegionCode) {
  if (!validRange(range) || range.end >= propertyToday() || Date.parse(range.end) - Date.parse(range.start) > 365 * 86_400_000) throw new RangeError("请选择 GA4 属性时区内 1 至 366 个已结束日。");
  const id = propertyId(), token = await accessToken();
  const report = async (registration: boolean) => {
    const filters: unknown[] = [exact(GA4_CHANNEL_DIMENSION, GA4_ORGANIC_CHANNEL), ga4HostFilter(FLATKEY_ENTRY_HOSTS)];
    if (country) filters.push(exact("countryId", country));
    if (registration) filters.push(exact("eventName", GA4_REGISTRATION_EVENT));
    const result = await requestReport(id, token, "runReport", {
      dateRanges: [{ startDate: range.start, endDate: range.end }], metrics: [{ name: "totalUsers" }],
      dimensionFilter: filters.length === 1 ? filters[0] : { andGroup: { expressions: filters } }, limit: "1",
    });
    if (result.metadata?.timeZone !== GA4_TIMEZONE) throw new GoogleReadError("invalid_response", "GA4 区间汇总未返回可验证的属性时区");
    const rows = result.rows ?? [];
    if (rows.length > 1 || (result.rowCount ?? rows.length) !== rows.length) throw new GoogleReadError("invalid_response", "GA4 区间汇总返回意外行数");
    const reasons = qualityReasons(result);
    if (!rows.length && result.rowCount === undefined) reasons.push("empty_response_unverified");
    return { value: rows[0] ? metric(rows[0], 0) : 0, reasons };
  };
  const [users, registrations] = await Promise.all([report(false), report(true)]);
  const reasons = [...new Set([...users.reasons.map(reason => `users:${reason}`), ...registrations.reasons.map(reason => `registrations:${reason}`)])];
  return { ...range, range, hostScope: GA4_HOST_SCOPE, propertyId: id, timezone: GA4_TIMEZONE, fetchedAt: new Date().toISOString(),
    scope: "session-organic-search" as const, users: users.reasons.length ? null : users.value,
    registrations: registrations.reasons.length ? null : registrations.value,
    quality: { complete: reasons.length === 0, reasons } };
}
