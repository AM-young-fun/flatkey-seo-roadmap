import { z } from "zod";
import type { DateRange } from "./seo-date-range";

export const TRAFFIC_SUMMARY_KIND = "flatkey-traffic-summary-v1";
export const TRAFFIC_SUMMARY_SITE_METRICS = ["totalSessions", "organicSessions", "totalRegistrations", "organicRegistrations"] as const;
export const TRAFFIC_SUMMARY_MODULES = [
  ["home", "首页"], ["blog", "博客"], ["models", "模型"], ["gpu", "GPU"], ["prompts", "提示词"],
] as const;
export const TRAFFIC_SUMMARY_SESSION_METRICS = ["totalSessions", "organicSessions"] as const;

const metric = z.object({
  value: z.number().int().nonnegative().safe(),
  observedAt: z.iso.datetime(),
  sourceSha256: z.string().regex(/^[a-f0-9]{64}$/u),
}).strict().nullable();
const sessions = z.object({ totalSessions: metric, organicSessions: metric }).strict();
export const trafficSummaryDaySchema = z.object({
  kind: z.literal(TRAFFIC_SUMMARY_KIND),
  date: z.iso.date(),
  property: z.literal("541304395"),
  timezone: z.literal("America/Los_Angeles"),
  site: sessions.extend({ totalRegistrations: metric, organicRegistrations: metric }),
  modules: z.object({ home: sessions, blog: sessions, models: sessions, gpu: sessions, prompts: sessions }).strict(),
}).strict();
export const TRAFFIC_SUMMARY_PERIOD = "flatkey-traffic-summary-period-v1";
export const trafficSummaryPeriodSchema = z.object({
  kind: z.literal(TRAFFIC_SUMMARY_PERIOD), start: z.iso.date(), end: z.iso.date(),
  property: z.literal("541304395"), timezone: z.literal("America/Los_Angeles"),
  totalSessions: metric, totalRegistrations: metric,
}).strict().refine(row => row.start <= row.end && Date.parse(row.end) - Date.parse(row.start) <= 365 * 86400000,
  { message: "流量汇总周期无效" });
export type TrafficSummaryPeriod = z.infer<typeof trafficSummaryPeriodSchema>;
export const trafficSummaryPeriodKind = ({ start, end }: DateRange) =>
  `${TRAFFIC_SUMMARY_PERIOD}:${(Date.parse(end) - Date.parse(start)) / 86400000 + 1}`;

export type TrafficSummaryDay = z.infer<typeof trafficSummaryDaySchema>;
export type TrafficSummaryRead = { date: string; latestClosedDay: string; day: TrafficSummaryDay | null; previous: TrafficSummaryDay | null };
type SiteMetric = typeof TRAFFIC_SUMMARY_SITE_METRICS[number];
type Module = typeof TRAFFIC_SUMMARY_MODULES[number][0];
type SessionMetric = typeof TRAFFIC_SUMMARY_SESSION_METRICS[number];
export type TrafficSummaryTrendDay = { date: string; site: Record<SiteMetric, number | null>;
  modules: Record<Module, Record<SessionMetric, number | null>> };
export type TrafficSummaryTrend = { start: string; end: string; daily: TrafficSummaryTrendDay[] };

export function trafficSummaryTrendDay(date: string, day: TrafficSummaryDay | null): TrafficSummaryTrendDay {
  return { date,
    site: Object.fromEntries(TRAFFIC_SUMMARY_SITE_METRICS.map(key => [key, day?.site[key]?.value ?? null])) as TrafficSummaryTrendDay["site"],
    modules: Object.fromEntries(TRAFFIC_SUMMARY_MODULES.map(([key]) => [key, {
      totalSessions: day?.modules[key].totalSessions?.value ?? null,
      organicSessions: day?.modules[key].organicSessions?.value ?? null,
    }])) as TrafficSummaryTrendDay["modules"],
  };
}
type Evidence = z.infer<typeof metric>;
const choose = (previous: Evidence | undefined, next: Evidence) =>
  next && (!previous || Date.parse(next.observedAt) > Date.parse(previous.observedAt)) ? next : previous ?? null;

export const trafficSummaryEvidence = (day: TrafficSummaryDay) => [
  ...Object.values(day.site),
  ...Object.values(day.modules).flatMap(module => Object.values(module)),
];
export const closedTrafficSummaryDay = (now = new Date()) => {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(now);
  return new Date(Date.parse(today + "T00:00:00Z") - 86400000).toISOString().slice(0, 10);
};

export function mergeTrafficSummaryDay(previous: TrafficSummaryDay | null, next: TrafficSummaryDay): TrafficSummaryDay {
  const site = { ...next.site }, modules = { ...next.modules };
  for (const key of TRAFFIC_SUMMARY_SITE_METRICS) site[key] = choose(previous?.site[key], next.site[key]);
  for (const [id] of TRAFFIC_SUMMARY_MODULES) {
    modules[id] = { ...next.modules[id] };
    for (const key of TRAFFIC_SUMMARY_SESSION_METRICS) modules[id][key] = choose(previous?.modules[id][key], next.modules[id][key]);
  }
  return { ...next, site, modules };
}


export function mergeTrafficSummaryPeriod(previous: TrafficSummaryPeriod | null, next: TrafficSummaryPeriod): TrafficSummaryPeriod {
  return { ...next, totalSessions: choose(previous?.totalSessions, next.totalSessions),
    totalRegistrations: choose(previous?.totalRegistrations, next.totalRegistrations) };
}
