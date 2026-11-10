import { z } from "zod";
import { shiftDay, validRange, type DateRange } from "./seo-date-range";
import { REGION_CODES, type SeoCountry } from "./seo";
import { clusterDomainForProperty, type ClusterDomain } from "./seo-cluster-sites";

const count = z.number().int().nonnegative().safe();
const base = {
  date: z.iso.date(),
  observedAt: z.iso.datetime(),
  source: z.enum(["google-api", "browser-export"]),
  complete: z.boolean(),
  country: z.enum(REGION_CODES).optional(),
};
const ga4 = { ...base, property: z.literal("541304395"), scope: z.literal("session-organic-search") };
const sessions = { sessions: count.nullable(), registrations: count.nullable() };
const gscMetrics = { clicks: count, impressions: count, position: z.number().finite().nonnegative().nullable() };
const gscProperty = z.enum(["sc-domain:flatkey.ai", "https://flatkey.ai/", "https://www.flatkey.ai/"]);
const clusterGa4Property = z.string().regex(/^\d+$/).refine(value => Boolean(clusterDomainForProperty(value)));
const clusterGscProperty = z.string().url().refine(value => Boolean(clusterDomainForProperty(value)));
const gscPage = z.string().url().max(2048).refine(value => {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password && !url.port
      && (url.hostname === "flatkey.ai" || url.hostname.endsWith(".flatkey.ai"));
  } catch { return false; }
}, "页面必须属于 Flatkey 属性");
export const analyticsObservationSchema = z.discriminatedUnion("kind", [
  z.object({ ...ga4, ...sessions, property: z.union([ga4.property, clusterGa4Property]), kind: z.literal("ga4-site") }).strict(),
  z.object({ ...base, ...gscMetrics, kind: z.literal("gsc-site"), property: clusterGscProperty }).strict(),
  z.object({ ...ga4, kind: z.literal("ga4-pages"), sessionsComplete: z.boolean().optional(),
    rows: z.array(z.object({ ...sessions, path: z.string().startsWith("/").max(2048) }).strict()).max(50000) }).strict(),
  z.object({ ...base, kind: z.literal("gsc-pages"), property: gscProperty, rows: z.array(z.object({ ...gscMetrics, url: gscPage }).strict()).max(50000) }).strict(),
  z.object({ ...base, kind: z.literal("gsc-page-queries"), property: gscProperty,
    // Search Console can return queries longer than a URL. The import endpoint
    // bounds the entire request; preserve the source text without truncating it.
    rows: z.array(z.object({ ...gscMetrics, url: gscPage, query: z.string().min(1) }).strict()).max(50000) }).strict(),
]).superRefine((record, ctx) => {
  if (record.kind === "ga4-site" && (record.complete !== (record.sessions !== null && record.registrations !== null) || record.sessions === null && record.registrations === null)) {
    ctx.addIssue({ code: "custom", message: "站点日数据的完成标记与指标不一致" });
  }
  if (record.kind !== "ga4-site" && record.kind !== "gsc-site") {
    const keys = record.kind === "ga4-pages" ? record.rows.map(row => row.path)
      : record.kind === "gsc-page-queries" ? record.rows.map(row => JSON.stringify([row.url, row.query]))
      : record.rows.map(row => row.url);
    if (new Set(keys).size !== keys.length) ctx.addIssue({ code: "custom", message: "报表含有重复记录" });
  }
  if (record.kind === "ga4-pages" && record.sessionsComplete && record.rows.some(row => row.sessions === null)) {
    ctx.addIssue({ code: "custom", message: "已核对的着陆页会话报表含缺失值" });
  }
});
export type AnalyticsObservation = z.infer<typeof analyticsObservationSchema>;
export type AnalyticsKind = AnalyticsObservation["kind"];
export const analyticsKinds: AnalyticsKind[] = ["ga4-site", "ga4-pages", "gsc-pages", "gsc-page-queries"];
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
    if (url.protocol !== "https:" || url.username || url.password || url.port || !["flatkey.ai", "www.flatkey.ai"].includes(url.hostname)) return null;
    for (const key of [...url.searchParams.keys()]) {
      if (/^utm_/i.test(key) || /^(gclid|dclid|fbclid|msclkid|gbraid|wbraid)$/i.test(key)) url.searchParams.delete(key);
    }
    url.searchParams.sort();
    return url.pathname + url.search;
  } catch { return null; }
}

export function safeAnalyticsUrl(value: string): boolean {
  return value.length <= 2048 && pageKey(value) !== null;
}

function landingKey(path: string) {
  // Landing page in GA4 is a path, not an event URL or a referrer.
  if (!path.startsWith("/") || path.startsWith("//")) return null;
  try { return pageKey(new URL(path, "https://flatkey.ai").href)?.split("?")[0] ?? null; }
  catch { return null; }
}

function indexLandingRows(rows: { path: string; sessions: number | null; registrations: number | null }[]) {
  const index = new Map<string, { sessions: number | null; registrations: number | null }>();
  for (const row of rows) {
    const key = landingKey(row.path);
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

export function analyticsView(range: DateRange, urls: string[], observations: AnalyticsObservation[]) {
  const dates = rangeDays(range);
  const dateSet = new Set(dates);
  const records = observations.filter(record => dateSet.has(record.date));
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
  return {
    ...range,
    scope: "session-organic-search" as const,
    ga4: status(urls.length ? gaPages : site, dates.length, "部分日期尚未取得可核验的 GA4 报表；缺失不计为零。"),
    gsc: status(gsPages, dates.length, "仅显示已取得的 GSC 网页搜索数据；延迟、导出上限及未返回页面保留缺失。"),
    daily: dates.map(date => ({ date, sessions: byDate.get(date)?.sessions ?? null, registrations: byDate.get(date)?.registrations ?? null })),
    pages: urls.map(url => {
      const path = pageKey(url);
      // A business query variant is not an independently observed GA4 landing path.
      const ga4 = path && !path.includes("?") ? indexedGa4.flatMap(index => index.get(path) ?? []) : [];
      const gsc = indexedGsc.flatMap(index => index.get(url) ?? []);
      const add = (name: "sessions" | "registrations") =>
        ga4.every(row => row[name] !== null) ? ga4.reduce((sum, row) => sum + row[name]!, 0) : null;
      const clicks = gsc.reduce((sum, row) => sum + row.clicks, 0);
      const impressions = gsc.reduce((sum, row) => sum + row.impressions, 0);
      const hasPosition = impressions > 0 && gsc.every(row => row.impressions === 0 || row.position !== null);
      return {
        url,
        ga4: ga4.length ? { sessions: add("sessions"), registrations: add("registrations"), days: ga4.length } : null,
        gsc: gsc.length ? { clicks, impressions, ctr: impressions > 0 ? clicks / impressions : null,
          position: hasPosition ? gsc.reduce((sum, row) => sum + (row.position ?? 0) * row.impressions, 0) / impressions : null, days: gsc.length } : null,
      };
    }),
  };
}

/** Enumerate observed pages so the UI can sort the entire result before pagination. */
export function observedPageUrls(observations: AnalyticsObservation[]) {
  const urls = new Set<string>();
  for (const day of observations) {
    if (day.kind === "ga4-pages") for (const row of day.rows) {
      const path = landingKey(row.path);
      if (path) urls.add(`https://flatkey.ai${path}`);
    }
    if (day.kind === "gsc-pages") for (const row of day.rows) {
      if (safeAnalyticsUrl(row.url)) urls.add(row.url);
    }
  }
  return [...urls].sort();
}

/** Daily traffic for the catalog, using the same GA4 landing-path keys as its rows. */
export function landingTrafficDays(range: DateRange, observations: AnalyticsObservation[]) {
  const complete = new Map(observations
    .filter(row => row.kind === "ga4-pages" && (row.complete || row.sessionsComplete))
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
