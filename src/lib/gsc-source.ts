import "server-only";
import { GoogleReadError, getGoogleReadAccessToken } from "./google-read-auth";
import type { SearchRegionCode } from "./seo";

const READ_SCOPE = "https://www.googleapis.com/auth/webmasters.readonly";
const SEARCH_CONSOLE_API = "https://www.googleapis.com/webmasters/v3/sites";
const GSC_TIME_ZONE = "America/Los_Angeles";
const PAGE_SIZE = 25_000;
const DAY_ROW_LIMIT = 50_000;

export type GscMetrics = { clicks: number; impressions: number; ctr: number; position: number };
export type GscPageRow = GscMetrics & { url: string };
export type GscCoverage = Record<string, GscMetrics>;
export type GscDailyReport = {
  date: string;
  timeZone: typeof GSC_TIME_ZONE;
  property: string;
  fetchedAt: string;
  state: "final" | "partial" | "unavailable";
  pages: GscPageRow[];
  totals: GscMetrics | null;
  completeness: "reconciled" | "totals_mismatch" | "row_limit" | "not_finalized";
};

const countryCodes: Record<SearchRegionCode, string> = { US: "USA", JP: "JPN", ES: "ESP", BR: "BRA" };
type GscOptions = { property?: string; accessToken?: string; country?: SearchRegionCode; aggregation?: "byPage" | "byProperty" };
type ReportBody = {
  startDate: string;
  endDate: string;
  dimensions: ["date"] | ["page"] | ["page", "query"];
  rowLimit: number;
  startRow?: number;
};
type GscRow = GscMetrics & { key: string; query?: string };

function isDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function isPage(value: string): boolean {
  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:") && !url.username && !url.password;
  } catch {
    return false;
  }
}

function getProperty(options: GscOptions): string {
  const property = options.property ?? process.env.SEO_GSC_PROPERTY?.trim() ?? "sc-domain:flatkey.ai";
  if (!/^sc-domain:[a-z0-9.-]+$/i.test(property) && !isPage(property)) {
    throw new GoogleReadError("invalid_credentials", "Search Console 属性配置无效");
  }
  return property;
}

function parseReport(payload: unknown, limit: number, dimensions: number, aggregation = "byPage"): GscRow[] {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new GoogleReadError("invalid_response", "Search Console 报表格式无效");
  }
  const data = payload as { rows?: unknown; responseAggregationType?: unknown };
  if (data.responseAggregationType !== undefined && data.responseAggregationType !== aggregation) {
    throw new GoogleReadError("invalid_response", "Search Console 未返回逐页聚合报表");
  }
  const rows = data.rows === undefined ? [] : data.rows;
  if (!Array.isArray(rows) || rows.length > limit) {
    throw new GoogleReadError("invalid_response", "Search Console 报表行数无效");
  }
  return rows.map((row) => {
    if (!Array.isArray(row?.keys) || row.keys.length !== dimensions || !row.keys.every((key: unknown) => typeof key === "string" && key.length > 0) ||
        !Number.isSafeInteger(row.clicks) || row.clicks < 0 ||
        !Number.isSafeInteger(row.impressions) || row.impressions < 0 ||
        typeof row.ctr !== "number" || !Number.isFinite(row.ctr) || row.ctr < 0 ||
        typeof row.position !== "number" || !Number.isFinite(row.position) || row.position < 0) {
      throw new GoogleReadError("invalid_response", "Search Console 报表行格式无效");
    }
    return { key: row.keys[0], query: row.keys[1], clicks: row.clicks, impressions: row.impressions, ctr: row.ctr, position: row.position };
  });
}

async function query(property: string, options: GscOptions, body: ReportBody): Promise<GscRow[]> {
  const token = options.accessToken ?? (process.env.SEO_GSC_ACCESS_TOKEN?.trim() || await getGoogleReadAccessToken(READ_SCOPE));
  const dimensionFilterGroups = options.country ? [{
    groupType: "and", filters: [{ dimension: "country", operator: "equals", expression: countryCodes[options.country] }],
  }] : undefined;
  let response: Response;
  try {
    response = await fetch(`${SEARCH_CONSOLE_API}/${encodeURIComponent(property)}/searchAnalytics/query`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, type: "web", aggregationType: options.aggregation ?? "byPage", dataState: "final", dimensionFilterGroups }),
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    throw new GoogleReadError("unavailable", "无法连接 Search Console API");
  }
  if (!response.ok) {
    if (response.status === 401) throw new GoogleReadError("auth_failed", "Search Console 授权无效", response.status);
    if (response.status === 403) throw new GoogleReadError("forbidden", "Search Console 属性读取被拒绝", response.status);
    if (response.status === 429) throw new GoogleReadError("rate_limited", "Search Console API 已限流", response.status);
    throw new GoogleReadError("unavailable", "Search Console API 请求失败", response.status);
  }
  return parseReport(await response.json().catch(() => null), body.rowLimit, body.dimensions.length, options.aggregation);
}

/** Dates with no finalized report are omitted. The same byPage basis is used to reconcile each daily detail report. */
export async function fetchGscDateCoverage(start: string, end: string, options: GscOptions = {}): Promise<GscCoverage> {
  if (!isDate(start) || !isDate(end) || start > end) throw new Error("Search Console 日期范围无效");
  const dateCount = Math.round((Date.parse(end) - Date.parse(start)) / 86_400_000) + 1;
  if (dateCount > 366) throw new Error("Search Console 覆盖检查最多支持 366 天");
  const rows = await query(getProperty(options), options, {
    startDate: start, endDate: end, dimensions: ["date"], rowLimit: dateCount,
  });
  const coverage: GscCoverage = {};
  for (const { key, query: _query, ...metrics } of rows) {
    if (!isDate(key) || key < start || key > end || key in coverage) {
      throw new GoogleReadError("invalid_response", "Search Console 返回了无效或重复的日期");
    }
    coverage[key] = metrics;
  }
  return coverage;
}

/** CTR is the 0..1 ratio Google returns. Keep source page URLs and never turn an omitted URL into a zero row. */
export async function fetchGscDailyPages(date: string, options: GscOptions & { totals?: GscMetrics | null } = {}): Promise<GscDailyReport> {
  if (!isDate(date)) throw new Error("Search Console 日期无效");
  const property = getProperty(options);
  const totals = options.totals === undefined ? (await fetchGscDateCoverage(date, date, options))[date] ?? null : options.totals;
  const base = { date, timeZone: GSC_TIME_ZONE, property, totals } as const;
  if (!totals) {
    return { ...base, fetchedAt: new Date().toISOString(), state: "unavailable", completeness: "not_finalized", pages: [] };
  }

  const pages = new Map<string, GscPageRow>();
  let fetchedRows = 0;
  let duplicate = false;
  for (let startRow = 0; startRow < DAY_ROW_LIMIT; startRow += PAGE_SIZE) {
    const rows = await query(property, options, {
      startDate: date, endDate: date, dimensions: ["page"], rowLimit: PAGE_SIZE, startRow,
    });
    fetchedRows += rows.length;
    for (const { key, query: _query, ...metrics } of rows) {
      if (!isPage(key)) throw new GoogleReadError("invalid_response", "Search Console 返回了无效的页面地址");
      if (pages.has(key)) duplicate = true;
      else pages.set(key, { url: key, ...metrics });
    }
    if (rows.length < PAGE_SIZE) break;
  }

  const rows = [...pages.values()];
  const impressions = rows.reduce((sum, row) => sum + row.impressions, 0);
  const clicks = rows.reduce((sum, row) => sum + row.clicks, 0);
  const completeness = fetchedRows >= DAY_ROW_LIMIT ? "row_limit" :
    duplicate || clicks !== totals.clicks || impressions !== totals.impressions ? "totals_mismatch" : "reconciled";
  return {
    ...base,
    fetchedAt: new Date().toISOString(),
    state: completeness === "reconciled" ? "final" : "partial",
    completeness,
    pages: rows,
  };
}

export async function fetchGscDailyPageQueries(date: string, options: GscOptions = {}) {
  if (!isDate(date)) throw new Error("Search Console 日期无效");
  const property = getProperty(options);
  const entries = new Map<string, { url: string; query: string; clicks: number; impressions: number; position: number }>();
  let complete = false;
  for (let startRow = 0; startRow < DAY_ROW_LIMIT; startRow += PAGE_SIZE) {
    const rows = await query(property, options, {
      startDate: date, endDate: date, dimensions: ["page", "query"], rowLimit: PAGE_SIZE, startRow,
    });
    for (const row of rows) {
      if (!isPage(row.key) || !row.query) throw new GoogleReadError("invalid_response", "Search Console 返回了无效的页面搜索词");
      const key = JSON.stringify([row.key, row.query]);
      if (entries.has(key)) throw new GoogleReadError("invalid_response", "Search Console 返回了重复的页面搜索词");
      entries.set(key, { url: row.key, query: row.query, clicks: row.clicks, impressions: row.impressions, position: row.position });
    }
    if (rows.length < PAGE_SIZE) {
      complete = true;
      break;
    }
  }
  return { property, observedAt: new Date().toISOString(), complete, rows: [...entries.values()] };
}
