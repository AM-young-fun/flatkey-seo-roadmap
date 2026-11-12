import { GA4_HOST_SCOPE, GA4_HOST_UNVERIFIED, isFlatkeyEntryHost } from "./ga4-host-scope";
import { z } from "zod";
import { shiftDay, validRange, type DateRange } from "./seo-date-range";
import { REGION_CODES, type SeoCountry } from "./seo";
import { CLUSTER_SITES, clusterDomainForProperty, type ClusterDomain } from "./seo-cluster-sites";

const count = z.number().int().nonnegative().safe();
const base = {
  date: z.iso.date(),
  observedAt: z.iso.datetime(),
  source: z.enum(["google-api", "browser-export"]),
  complete: z.boolean(),
  country: z.enum(REGION_CODES).optional(),
};
const ga4 = { hostScope: z.literal("production-hosts-v1").optional(), ...base, property: z.literal("541304395"), scope: z.literal("session-organic-search") };
const sessions = { sessions: count.nullable(), registrations: count.nullable() };
const gscMetrics = { clicks: count, impressions: count, position: z.number().finite().nonnegative().nullable() };
const gscProperty = z.enum(["sc-domain:flatkey.ai", "https://flatkey.ai/", "https://www.flatkey.ai/"]);
const clusterGa4Property = z.string().regex(/^\d+$/).refine(value => Boolean(clusterDomainForProperty(value)));
const clusterGscProperty = z.string().refine(value => Boolean(clusterDomainForProperty(value)) && !/^\d+$/.test(value));
const anyGscProperty = z.union([gscProperty, clusterGscProperty]);
const ga4Property = z.union([ga4.property, clusterGa4Property]);
const hostname = z.string().trim().toLowerCase().regex(/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i);
const ownedDomains = ["flatkey.ai", ...CLUSTER_SITES.map(site => site.domain)];
export function analyticsSiteForProperty(property: string) { return clusterDomainForProperty(property) ?? (property === "541304395" || gscProperty.safeParse(property).success ? "flatkey.ai" : null); }
const belongsToSite = (hostname: string, site: string) => hostname === site || hostname.endsWith(`.${site}`);
const gscPage = z.string().url().max(2048).refine(value => {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password && !url.port
      && ownedDomains.some(site => belongsToSite(url.hostname, site));
  } catch { return false; }
}, "页面必须属于五站已登记属性");
export const analyticsObservationSchema = z.discriminatedUnion("kind", [
  z.object({ ...ga4, ...sessions, registrationMetric: z.enum(["sign_up_success", "sign_up_or_legacy_distinct_users"]).optional(), registrationEvidence: z.enum(["reported_daily_row", "missing_daily_row"]).optional(), property: z.union([ga4.property, clusterGa4Property]), kind: z.literal("ga4-site") }).strict(),
  z.object({ ...base, ...gscMetrics, kind: z.literal("gsc-site"), property: anyGscProperty }).strict(),
  z.object({ ...ga4, property: ga4Property, kind: z.literal("ga4-pages"), sessionsComplete: z.boolean().optional(), hostnameDimension: z.literal("hostName").optional(),
    registrationMissingReason: z.string().max(300).optional(),
    rows: z.array(z.object({ ...sessions, hostname: hostname.nullable().optional(), path: z.string().startsWith("/").max(2048) }).strict()).max(50000) }).strict(),
  z.object({ ...base, kind: z.literal("gsc-pages"), property: anyGscProperty, rows: z.array(z.object({ ...gscMetrics, url: gscPage }).strict()).max(50000) }).strict(),
  z.object({ ...base, kind: z.literal("gsc-page-queries"), property: anyGscProperty,
    // Search Console can return queries longer than a URL. The import endpoint
    // bounds the entire request; preserve the source text without truncating it.
    rows: z.array(z.object({ ...gscMetrics, url: gscPage, query: z.string().min(1) }).strict()).max(50000) }).strict(),
]).superRefine((record, ctx) => {
  if (record.kind === "ga4-site" && (record.complete !== (record.sessions !== null && record.registrations !== null) || record.sessions === null && record.registrations === null)) {
    ctx.addIssue({ code: "custom", message: "站点日数据的完成标记与指标不一致" });
  }
  if (record.kind === "ga4-site" && (record.registrationEvidence === "reported_daily_row" && record.registrations === null
    || record.registrationEvidence === "missing_daily_row" && record.registrations !== null)) {
    ctx.addIssue({ code: "custom", message: "注册行证据与实际注册值不一致" });
  }
  if (record.kind !== "ga4-site" && record.kind !== "gsc-site") {
    const keys = record.kind === "ga4-pages" ? record.rows.map(row => JSON.stringify([row.hostname ?? null, row.path]))
      : record.kind === "gsc-page-queries" ? record.rows.map(row => JSON.stringify([row.url, row.query]))
      : record.rows.map(row => row.url);
    if (new Set(keys).size !== keys.length) ctx.addIssue({ code: "custom", message: "报表含有重复记录" });
    const site = analyticsSiteForProperty(record.property);
    if (record.rows.some(row => {
      const host = "url" in row ? new URL(row.url).hostname : row.hostname;
      return host && (!site || !belongsToSite(host, site)) || "url" in row && record.property.startsWith("https://") && !row.url.startsWith(record.property);
    })) ctx.addIssue({ code: "custom", message: "页面主机与采集属性不一致" });
  }
  if (record.kind === "ga4-pages" && record.sessionsComplete && record.rows.some(row => row.sessions === null)) {
    ctx.addIssue({ code: "custom", message: "已核对的着陆页会话报表含缺失值" });
  }
});
export type AnalyticsObservation = z.infer<typeof analyticsObservationSchema>;
export type AnalyticsKind = AnalyticsObservation["kind"];
export const analyticsKinds: AnalyticsKind[] = ["ga4-site", "gsc-site", "ga4-pages", "gsc-pages", "gsc-page-queries"];
export const analyticsStorageKind = (kind: AnalyticsKind, country: SeoCountry = "all", site?: ClusterDomain) =>
  [kind, country === "all" ? null : country, site].filter(Boolean).join(":");

export function rangeDays(range: DateRange) {
  if (!validRange(range)) throw new Error("日期区间无效");
  const length = Math.round((Date.parse(range.end) - Date.parse(range.start)) / 86400000) + 1;
  if (length > 366) throw new Error("一次查询最多 366 天");
  return Array.from({length}, (_, index) => shiftDay(range.start, index));
}

function pageKey(input: string) {
  try {
    const url = new URL(input);
    if (url.protocol !== "https:" || url.username || url.password || url.port || !ownedDomains.some(site => belongsToSite(url.hostname, site))) return null;
    for (const key of [...url.searchParams.keys()]) {
      if (/^utm_/i.test(key) || /^(gclid|dclid|fbclid|msclkid|gbraid|wbraid)$/i.test(key)) url.searchParams.delete(key);
    }
    url.searchParams.sort();
    return url.origin + url.pathname + url.search;
  } catch { return null; }
}

export function safeAnalyticsUrl(value: string): boolean {
  return value.length <= 2048 && pageKey(value) !== null;
}

function landingKey(path: string, hostname?: string | null) {
  // Landing page in GA4 is a path, not an event URL or a referrer.
  if (!hostname || !path.startsWith("/") || path.startsWith("//")) return null;
  try { return pageKey(new URL(path, `https://${hostname}`).href)?.split("?")[0] ?? null; }
  catch { return null; }
}

function indexLandingRows(rows: { path: string; hostname?: string | null; sessions: number | null; registrations: number | null }[]) {
  const index = new Map<string, { sessions: number | null; registrations: number | null }>();
  for (const row of rows) {
    const key = landingKey(row.path, row.hostname);
    if (!key) continue;
    const prior = index.get(key);
    if (!prior) index.set(key, row);
    else index.set(key, {
      // A session has one landing URL; distinct users can appear under multiple query variants.
      sessions: prior.sessions === null || row.sessions === null ? null : prior.sessions + row.sessions,
      registrations: prior.registrations === 0 ? row.registrations : row.registrations === 0 ? prior.registrations : null,
    });
  }
  return index;
}

/** Keep raw archives intact; unscoped totals cannot be presented as Flatkey-only. */
export function scopedAnalytics(observations: AnalyticsObservation[]): AnalyticsObservation[] {
  return observations.flatMap((row): AnalyticsObservation[] => {
    if (row.property !== "541304395") return [row];
    if (row.kind === "ga4-site" && row.hostScope !== GA4_HOST_SCOPE) return [];
    // The previous API collector synthesized 0 for absent date rows. Keep the
    // archive intact, but require explicit returned-row evidence for these zeros.
    // Browser exports and positive observed counts are not blanket-redacted.
    if (row.kind === "ga4-site" && row.source === "google-api" && row.registrations === 0 && !row.registrationEvidence) {
      return [{ ...row, registrations: null, complete: false }];
    }
    if (row.kind === "ga4-pages") return [{ ...row, rows: row.rows.filter(page => !page.hostname || isFlatkeyEntryHost(page.hostname)) }];
    return [row];
  });
}

export function analyticsView(range: DateRange, urls: string[], observations: AnalyticsObservation[]) {
  const dates = rangeDays(range);
  const dateSet = new Set(dates);
  const records = scopedAnalytics(observations).filter(record => dateSet.has(record.date));
  const site = records.filter(row => row.kind === "ga4-site");
  const gaPages = records.filter(row => row.kind === "ga4-pages");
  const gsPages = records.filter(row => row.kind === "gsc-pages");
  const byDate = new Map(site.map(row => [row.date, row]));
  const status = (rows: AnalyticsObservation[], required: number, message: string) => {
    const through = rows.map(row => row.date).sort().at(-1) ?? null;
    const observedAt = rows.map(row => row.observedAt).sort().at(-1) ?? null;
    const ready = rows.length === required && rows.every(row => row.complete);
    return { status: ready ? "ready" : rows.length ? "partial" : "missing", through, observedAt, reason: ready ? null : message };
  };
  const indexedGa4 = gaPages.map(day => indexLandingRows(day.rows));
  const indexedGsc = gsPages.map(day => new Map(day.rows.map(row => [row.url, row])));
  const gscSourceUrls = new Map<string, Set<string>>();
  for (const day of gsPages) for (const row of day.rows) {
    const key = pageKey(row.url);
    if (!key) continue;
    const variants = gscSourceUrls.get(key) ?? new Set<string>();
    variants.add(row.url); gscSourceUrls.set(key, variants);
  }
  const ga4Reports = urls.length ? gaPages.map(row => ({ ...row, complete: row.complete && row.rows.every(page => Boolean(page.hostname)) })) : site;
  const ga4SessionReports = urls.length ? gaPages.map(row => ({ ...row, complete: Boolean(row.sessionsComplete || row.complete) && row.rows.every(page => Boolean(page.hostname)) }))
    : site.map(row => ({ ...row, complete: row.sessions !== null }));
  return {
    ...range,
    scope: "session-organic-search" as const,
    registrationMetric: site.length && site.every(row => row.registrationMetric === "sign_up_or_legacy_distinct_users") ? "sign_up_or_legacy_distinct_users" as const : "sign_up_success" as const,
    ga4: { ...status(ga4Reports, dates.length, observations.some(row => row.kind === "ga4-site" && row.property === "541304395" && row.hostScope !== GA4_HOST_SCOPE) ? GA4_HOST_UNVERIFIED : "缺失不计为零。注册未返回当日记录时保持未知；历史事件缺少正式域名或来源时无法归属。逐页注册的跨域入口归因尚未核实。"),
      sessionsStatus: status(ga4SessionReports, dates.length, "部分入口会话尚未取得可核实报表").status,
      registrationsStatus: status(ga4Reports, dates.length, "注册归因待核实").status },
    gsc: status(gsPages, dates.length, "仅显示已取得的 GSC 网页搜索数据；延迟、导出上限及未返回页面保留缺失。"),
    daily: dates.map(date => ({ date, sessions: byDate.get(date)?.sessions ?? null, registrations: byDate.get(date)?.registrations ?? null })),
    pages: urls.map(url => {
      const path = pageKey(url);
      // A business query variant is not an independently observed GA4 landing path.
      const ga4 = path && !path.includes("?") ? indexedGa4.flatMap(index => index.get(path) ?? []) : [];
      const gsc = indexedGsc.flatMap(index => index.get(url) ?? []);
      const sourceUrls = path ? [...(gscSourceUrls.get(path) ?? [])].sort() : [];
      const add = (name: "sessions" | "registrations") =>
        ga4.every(row => row[name] !== null) ? ga4.reduce((sum, row) => sum + row[name]!, 0) : null;
      const clicks = gsc.reduce((sum, row) => sum + row.clicks, 0);
      const impressions = gsc.reduce((sum, row) => sum + row.impressions, 0);
      const hasPosition = impressions > 0 && gsc.every(row => row.impressions === 0 || row.position !== null);
      return {
        url,
        ...(sourceUrls.some(source => source !== url) ? { sourceUrls } : {}),
        ga4: ga4.length ? { sessions: add("sessions"), registrations: ga4.length === 1 ? ga4[0].registrations : null, days: ga4.length } : null,
        gsc: gsc.length ? { clicks, impressions, ctr: impressions > 0 ? clicks / impressions : null,
          position: hasPosition ? gsc.reduce((sum, row) => sum + (row.position ?? 0) * row.impressions, 0) / impressions : null, days: gsc.length } : null,
      };
    }),
  };
}

/** Enumerate observed pages so the UI can sort the entire result before pagination. */
export function observedPageUrls(observations: AnalyticsObservation[]) {
  const urls = new Set<string>();
  for (const day of scopedAnalytics(observations)) {
    if (day.kind === "ga4-pages") for (const row of day.rows) {
      const path = landingKey(row.path, row.hostname);
      if (path) urls.add(path);
    }
    if (day.kind === "gsc-pages") for (const row of day.rows) {
      const page = pageKey(row.url);
      if (page) urls.add(page);
    }
  }
  return [...urls].sort();
}

/** Daily traffic for the catalog, using the same GA4 landing-path keys as its rows. */
export function landingTrafficDays(range: DateRange, observations: AnalyticsObservation[]) {
  const complete = new Map(scopedAnalytics(observations)
    .filter(row => row.kind === "ga4-pages" && (row.complete || row.sessionsComplete) && row.rows.every(page => Boolean(page.hostname)))
    .map(row => [row.date, row]));

  return rangeDays(range).map(date => {
    const day = complete.get(date);
    if (!day || day.kind !== "ga4-pages") return { date, paths: null, registrationsComplete: false };
    const paths = [...indexLandingRows(day.rows)].map(([key, row]): [string, number | null, number | null] =>
      [key, row.sessions, day.complete ? row.registrations : null]);
    return { date, paths, registrationsComplete: day.complete };
  });
}

export function pageDailyView(range: DateRange, url: string, observations: AnalyticsObservation[]) {
  const byDate = new Map<string, AnalyticsObservation[]>();
  for (const row of observations) {
    const rows = byDate.get(row.date) ?? [];
    rows.push(row); byDate.set(row.date, rows);
  }
  return rangeDays(range).map(date => {
    const page = analyticsView({ start: date, end: date }, [url], byDate.get(date) ?? []).pages[0];
    return { date, sessions: page.ga4?.sessions ?? null, registrations: page.ga4?.registrations ?? null,
      clicks: page.gsc?.clicks ?? null, impressions: page.gsc?.impressions ?? null, position: page.gsc?.position ?? null };
  });
}

export function pageQueryView(range: DateRange, observations: AnalyticsObservation[], url?: string) {
  const days = new Set(rangeDays(range));
  const reports = observations.filter(row => row.kind === "gsc-page-queries").filter(row => days.has(row.date));
  const queries = new Map<string, { url: string; query: string; clicks: number; impressions: number; rankSum: number; rankedImpressions: number }>();
  for (const report of reports) {
    for (const row of report.rows) {
      if (url && row.url !== url || !safeAnalyticsUrl(row.url)) continue;
      const key = JSON.stringify([row.url, row.query]);
      const entry = queries.get(key) ?? { url: row.url, query: row.query, clicks: 0, impressions: 0, rankSum: 0, rankedImpressions: 0 };
      entry.clicks += row.clicks;
      entry.impressions += row.impressions;
      if (row.position !== null) {
        entry.rankSum += row.position * row.impressions;
        entry.rankedImpressions += row.impressions;
      }
      queries.set(key, entry);
    }
  }
  return {
    recordedDays: reports.length,
    partial: reports.length !== days.size || reports.some(report => !report.complete),
    rows: [...queries.values()].map(({ rankSum, rankedImpressions, ...row }) => ({
      ...row,
      position: rankedImpressions > 0 && rankedImpressions === row.impressions ? rankSum / rankedImpressions : null,
    })),
  };
}
