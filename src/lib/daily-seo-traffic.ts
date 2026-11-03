import { z } from "zod";

export const DAILY_SEO_TRAFFIC_API_PATH = "/api/traffic/daily";
export const DAILY_SEO_TRAFFIC_DEFAULTS = {
  siteDomain: "flatkey.ai",
  ga4PropertyId: "541304395",
  timezone: "America/Los_Angeles",
  trafficScope: "organic_search",
  channelName: "Organic Search",
  channelDimension: "firstUserPrimaryChannelGroup",
  registrationMetric: "sign_up_success_distinct_users",
} as const;

const day = z.iso.date();
const count = z.number().int().min(0).max(2_147_483_647).nullable();
const channelDimension = z.enum(["firstUserPrimaryChannelGroup", "firstUserDefaultChannelGroup"]);
const source = z.url().max(20000).refine(value => {
  if (!URL.canParse(value)) return false;
  const url = new URL(value);
  return url.protocol === "https:" && url.hostname === "analytics.google.com" && (!url.port || url.port === "443") && !url.username && !url.password;
}, "须提供 Google Analytics HTTPS 来源链接");

export function dailySeoPropertyDate(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: DAILY_SEO_TRAFFIC_DEFAULTS.timezone }).format(now);
}

export function shiftDailySeoDate(date: string, offset: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + offset * 86_400_000).toISOString().slice(0, 10);
}

export const dailySeoTrafficSchema = z.object({
  kind: z.literal("daily-seo-traffic"),
  requestId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/),
  siteDomain: z.literal(DAILY_SEO_TRAFFIC_DEFAULTS.siteDomain),
  ga4PropertyId: z.literal(DAILY_SEO_TRAFFIC_DEFAULTS.ga4PropertyId),
  timezone: z.literal(DAILY_SEO_TRAFFIC_DEFAULTS.timezone),
  trafficScope: z.literal(DAILY_SEO_TRAFFIC_DEFAULTS.trafficScope),
  channelName: z.literal(DAILY_SEO_TRAFFIC_DEFAULTS.channelName),
  channelDimension,
  registrationMetric: z.literal(DAILY_SEO_TRAFFIC_DEFAULTS.registrationMetric),
  collectedAt: z.iso.datetime({ offset: true }),
  sources: z.array(source).min(1).max(20),
  points: z.array(z.object({
    date: day,
    newUsers: count,
    newRegistrations: count,
    missingReason: z.string().trim().min(1).max(500).optional(),
  }).strict()).min(1).max(366),
}).strict().superRefine((data, ctx) => {
  const collectedAt = Date.parse(data.collectedAt);
  if (!Number.isFinite(collectedAt)) return;
  if (collectedAt > Date.now() + 300_000) {
    ctx.addIssue({ code: "custom", path: ["collectedAt"], message: "采集时间不能在未来" });
  }
  const today = dailySeoPropertyDate(new Date(data.collectedAt));
  const seen = new Set<string>();
  data.points.forEach((point, index) => {
    if (point.date >= today) ctx.addIssue({ code: "custom", path: ["points", index, "date"], message: "只能保存 GA4 属性时区中已经结束的自然日" });
    if (seen.has(point.date)) ctx.addIssue({ code: "custom", path: ["points", index, "date"], message: "同一批次的日流量日期不能重复" });
    seen.add(point.date);
  });
});

export type DailySeoTrafficPayload = z.infer<typeof dailySeoTrafficSchema>;
export type DailySeoTrafficCohort = Pick<DailySeoTrafficPayload, "siteDomain" | "ga4PropertyId" | "timezone" | "trafficScope" | "channelName" | "channelDimension" | "registrationMetric">;
export type DailySeoTrafficQuery = DailySeoTrafficCohort & { start: string; end: string };
export type DailySeoTrafficHistoryPoint = {
  date: string;
  newUsers: number | null;
  newRegistrations: number | null;
  collectedAt: string | null;
  newUsersCollectedAt: string | null;
  newRegistrationsCollectedAt: string | null;
  revisions: number;
  missingReason: string | null;
};
export type DailySeoTrafficHistory = DailySeoTrafficQuery & {
  kind: "daily-seo-traffic";
  sources: string[];
  collectedAt: string | null;
  points: DailySeoTrafficHistoryPoint[];
  coverage: { days: number; newUsersDays: number; registrationDays: number; completeDays: number };
};
export type DailySeoTrafficObservation = {
  date: Date | string;
  newUsers: number | null;
  newRegistrations: number | null;
  missingReason?: string | null;
  importBatch: DailySeoTrafficCohort & { requestId: string; collectedAt: Date | string; importedAt: Date | string; sources: string[] };
};

const querySchema = z.object({
  site: z.literal(DAILY_SEO_TRAFFIC_DEFAULTS.siteDomain).default(DAILY_SEO_TRAFFIC_DEFAULTS.siteDomain),
  ga4PropertyId: z.literal(DAILY_SEO_TRAFFIC_DEFAULTS.ga4PropertyId).default(DAILY_SEO_TRAFFIC_DEFAULTS.ga4PropertyId),
  timezone: z.literal(DAILY_SEO_TRAFFIC_DEFAULTS.timezone).default(DAILY_SEO_TRAFFIC_DEFAULTS.timezone),
  trafficScope: z.literal(DAILY_SEO_TRAFFIC_DEFAULTS.trafficScope).default(DAILY_SEO_TRAFFIC_DEFAULTS.trafficScope),
  channelDimension: channelDimension.default(DAILY_SEO_TRAFFIC_DEFAULTS.channelDimension),
  registrationMetric: z.literal(DAILY_SEO_TRAFFIC_DEFAULTS.registrationMetric).default(DAILY_SEO_TRAFFIC_DEFAULTS.registrationMetric),
  start: day.optional(),
  end: day.optional(),
}).strict().superRefine((data, ctx) => {
  if (Boolean(data.start) !== Boolean(data.end)) ctx.addIssue({ code: "custom", message: "须同时提供开始和结束日期" });
  if (data.start && data.end && (data.start > data.end || Date.parse(data.end) - Date.parse(data.start) > 365 * 86_400_000)) {
    ctx.addIssue({ code: "custom", message: "日趋势区间须为连续 1 至 366 天" });
  }
});

export function parseDailySeoTrafficQuery(params: URLSearchParams, now = new Date()): DailySeoTrafficQuery {
  const input = Object.fromEntries([...params].filter(([, value]) => value !== ""));
  const parsed = querySchema.parse(input);
  const lastClosed = shiftDailySeoDate(dailySeoPropertyDate(now), -1);
  const end = parsed.end ?? lastClosed;
  if (end > lastClosed) throw new Error("日趋势只能读取 GA4 属性时区中已经结束的日期");
  return {
    ...DAILY_SEO_TRAFFIC_DEFAULTS,
    channelDimension: parsed.channelDimension,
    start: parsed.start ?? shiftDailySeoDate(end, -29),
    end,
  };
}

const stamp = (value: Date | string) => new Date(value).toISOString();
const sameCohort = (a: DailySeoTrafficCohort, b: DailySeoTrafficCohort) =>
  a.siteDomain === b.siteDomain && a.ga4PropertyId === b.ga4PropertyId && a.timezone === b.timezone &&
  a.trafficScope === b.trafficScope && a.channelName === b.channelName && a.channelDimension === b.channelDimension &&
  a.registrationMetric === b.registrationMetric;

// This is a daily series, never a sum of users across days. Registrations must
// still be queried for the whole weekly interval when preparing a weekly report.
export function buildDailySeoTrafficHistory(query: DailySeoTrafficQuery, observations: DailySeoTrafficObservation[]): DailySeoTrafficHistory {
  const matching = observations.filter(row => sameCohort(row.importBatch, query))
    .sort((a, b) => stamp(b.importBatch.collectedAt).localeCompare(stamp(a.importBatch.collectedAt)) ||
      stamp(b.importBatch.importedAt).localeCompare(stamp(a.importBatch.importedAt)) || b.importBatch.requestId.localeCompare(a.importBatch.requestId));
  const byDay = new Map<string, DailySeoTrafficObservation[]>();
  for (const row of matching) {
    const date = row.date instanceof Date ? row.date.toISOString().slice(0, 10) : row.date;
    if (date < query.start || date > query.end) continue;
    byDay.set(date, [...(byDay.get(date) ?? []), row]);
  }
  const sources = new Set<string>();
  const points: DailySeoTrafficHistoryPoint[] = [];
  for (let date = query.start; date <= query.end; date = shiftDailySeoDate(date, 1)) {
    const rows = byDay.get(date) ?? [];
    const users = rows.find(row => row.newUsers !== null);
    const registrations = rows.find(row => row.newRegistrations !== null);
    for (const row of [users, registrations]) for (const sourceUrl of row?.importBatch.sources ?? []) sources.add(sourceUrl);
    const newUsersCollectedAt = users ? stamp(users.importBatch.collectedAt) : null;
    const newRegistrationsCollectedAt = registrations ? stamp(registrations.importBatch.collectedAt) : null;
    const newUsers = users?.newUsers ?? null, newRegistrations = registrations?.newRegistrations ?? null;
    points.push({
      date, newUsers, newRegistrations, newUsersCollectedAt, newRegistrationsCollectedAt,
      collectedAt: [newUsersCollectedAt, newRegistrationsCollectedAt].filter((value): value is string => value !== null).sort().at(-1) ?? null,
      revisions: rows.length,
      missingReason: newUsers === null || newRegistrations === null ? rows[0]?.missingReason ?? "自然搜索日数据尚未补齐" : null,
    });
  }
  return {
    kind: "daily-seo-traffic", ...query, points, sources: [...sources].sort(),
    collectedAt: points.flatMap(point => point.collectedAt ? [point.collectedAt] : []).sort().at(-1) ?? null,
    coverage: {
      days: points.length,
      newUsersDays: points.filter(point => point.newUsers !== null).length,
      registrationDays: points.filter(point => point.newRegistrations !== null).length,
      completeDays: points.filter(point => point.newUsers !== null && point.newRegistrations !== null).length,
    },
  };
}
