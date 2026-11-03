import { z } from "zod";
import { dailySeoPropertyDate, parseDailySeoTrafficQuery, shiftDailySeoDate, type DailySeoTrafficCohort, type DailySeoTrafficQuery } from "./daily-seo-traffic";

export const DAILY_SEO_PAGE_GROUPS_API_PATH = "/api/traffic/daily/groups";
export const DAILY_SEO_PAGE_GROUP_RULE_VERSION = 1;
const locale = "(?:/(?:en|zh|es|fr|pt|ru|ja|vi|de|id))?";
const legacyGpu = "b300|b200|h200|h100|a100|l40s|rtx-pro-6000|rtx-5090|rtx-4090";
// Version 1 includes current public routes and the explicit legacy price
// redirects verified in flatkey website origin/main on 2026-11-03. No wildcard
// compute descendants or console routes belong to the entry-page group.
const definitions = [
  { key: "gpu_compute", name: "GPU 算力", scope: "GPU 产品页及已核实的旧价格页", pathPattern: `^${locale}/compute(?:/prices(?:/(?:${legacyGpu}))?)?/?$`, excludePathPattern: null },
  { key: "model_list", name: "模型列表", scope: "模型列表页，含语言版本与筛选参数", pathPattern: `^${locale}/models/?$`, excludePathPattern: null },
  { key: "model_detail", name: "模型详情", scope: "单个模型详情页，不含列表或提示词详情", pathPattern: `^${locale}/models/[^/]+/?$`, excludePathPattern: `^${locale}/models/prompts/?$` },
  { key: "prompts", name: "提示词库", scope: "提示词列表、详情及模型内提示词详情", pathPattern: `^${locale}/(?:prompts(?:/(?:[^/]+|(?:image|video|model|use-case)/[^/]+))?|models/[^/]+/prompts/[^/]+)/?$`, excludePathPattern: null },
] as const;
export const DAILY_SEO_PAGE_GROUPS = definitions.map(group => ({
  ...group,
  pageLocationPattern: `^https://(?:www\\.)?flatkey\\.ai${group.pathPattern.slice(1, -1)}(?:[?#].*)?$`,
  excludePageLocationPattern: group.excludePathPattern ? `^https://(?:www\\.)?flatkey\\.ai${group.excludePathPattern.slice(1, -1)}(?:[?#].*)?$` : null,
}));
export type DailySeoPageGroupKey = typeof definitions[number]["key"];
export const DAILY_SEO_PAGE_GROUP_FUNNEL_RULE = {
  ruleVersion: 1, closed: true, sameDay: true, indirect: true,
  entryEvent: "page_view", registrationEvent: "sign_up_success",
  entryHostnames: ["flatkey.ai", "www.flatkey.ai"], entryFilterScope: "first_step_only",
} as const;

export function matchesDailySeoPageGroupUrl(key: DailySeoPageGroupKey, value: string): boolean {
  if (!URL.canParse(value)) return false;
  const url = new URL(value), group = DAILY_SEO_PAGE_GROUPS.find(item => item.key === key)!;
  return url.protocol === "https:" && ["flatkey.ai", "www.flatkey.ai"].includes(url.hostname) && !url.username && !url.password && (!url.port || url.port === "443") &&
    new RegExp(group.pathPattern).test(url.pathname) && (!group.excludePathPattern || !new RegExp(group.excludePathPattern).test(url.pathname));
}

const source = z.url().max(20000).refine(value => {
  if (!URL.canParse(value)) return false;
  const url = new URL(value);
  return url.protocol === "https:" && url.hostname === "analytics.google.com" && (!url.port || url.port === "443") && !url.username && !url.password;
}, "须提供 Google Analytics HTTPS 来源链接");
const sources = z.array(source).min(1).max(20);
const count = z.number().int().min(0).max(2_147_483_647);
const timestamp = z.iso.datetime({ offset: true });
const funnel = z.object({ entrants: count, registrations: count, collectedAt: timestamp, sources }).strict().superRefine((data, ctx) => {
  if (data.registrations > data.entrants) ctx.addIssue({ code: "custom", message: "闭合顺序漏斗注册人数不能超过入口去重人数" });
});
export const dailySeoPageGroupsSchema = z.object({
  kind: z.literal("daily-seo-page-groups"), requestId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/),
  siteDomain: z.literal("flatkey.ai"), ga4PropertyId: z.literal("541304395"), timezone: z.literal("America/Los_Angeles"),
  trafficScope: z.literal("organic_search"), channelName: z.literal("Organic Search"), channelDimension: z.literal("firstUserPrimaryChannelGroup"),
  registrationMetric: z.literal("sign_up_success_distinct_users"), ruleVersion: z.literal(DAILY_SEO_PAGE_GROUP_RULE_VERSION),
  collectedAt: timestamp, sources,
  groups: z.array(z.object({
    key: z.enum(["gpu_compute", "model_list", "model_detail", "prompts"]),
    points: z.array(z.object({ date: z.iso.date(), totalUsers: count.nullable(), pageViews: count.nullable(),
      collectedAt: timestamp.optional(), sources: sources.optional(), funnel: funnel.nullable(), missingReason: z.string().trim().min(1).max(500).optional(),
    }).strict()).min(1).max(366),
  }).strict()).min(1).max(4),
}).strict().superRefine((data, ctx) => {
  const batchStamp = Date.parse(data.collectedAt);
  if (!Number.isFinite(batchStamp)) return;
  if (batchStamp > Date.now() + 300_000) ctx.addIssue({ code: "custom", path: ["collectedAt"], message: "采集时间不能在未来" });
  const keys = new Set<string>();
  data.groups.forEach((group, gi) => {
    if (keys.has(group.key)) ctx.addIssue({ code: "custom", path: ["groups", gi, "key"], message: "页面组不能重复" });
    keys.add(group.key);
    const days = new Set<string>();
    group.points.forEach((point, pi) => {
      const path = ["groups", gi, "points", pi];
      if (days.has(point.date)) ctx.addIssue({ code: "custom", path, message: "同一页面组的日期不能重复" });
      days.add(point.date);
      for (const collectedAt of [point.collectedAt ?? data.collectedAt, ...(point.funnel ? [point.funnel.collectedAt] : [])]) {
        const value = Date.parse(collectedAt);
        if (!Number.isFinite(value)) continue;
        if (value > batchStamp) ctx.addIssue({ code: "custom", path, message: "指标采集时间不能晚于本批采集时间" });
        if (point.date >= dailySeoPropertyDate(new Date(value))) ctx.addIssue({ code: "custom", path, message: "只能导入属性时区中已结束的自然日；漏斗两步须在同一日内核对" });
      }
    });
  });
});
export type DailySeoPageGroupsPayload = z.infer<typeof dailySeoPageGroupsSchema>;
export type DailySeoPageGroupsQuery = DailySeoTrafficQuery & { ruleVersion: 1 };
export type DailySeoPageGroupFunnel = z.infer<typeof funnel>;
export type DailySeoPageGroupHistoryPoint = {
  date: string; totalUsers: number | null; pageViews: number | null;
  totalUsersCollectedAt: string | null; pageViewsCollectedAt: string | null;
  totalUsersSources: string[]; pageViewsSources: string[]; funnel: DailySeoPageGroupFunnel | null;
  collectedAt: string | null; revisions: number; missingReason: string | null;
};
export type DailySeoPageGroupsHistory = DailySeoPageGroupsQuery & {
  kind: "daily-seo-page-groups"; funnelRule: typeof DAILY_SEO_PAGE_GROUP_FUNNEL_RULE; sources: string[]; collectedAt: string | null;
  groups: (typeof DAILY_SEO_PAGE_GROUPS[number] & { points: DailySeoPageGroupHistoryPoint[];
    coverage: { days: number; totalUsersDays: number; pageViewsDays: number; funnelDays: number } })[];
};
export type DailySeoPageGroupObservation = {
  date: Date | string; groupKey: string; totalUsers: number | null; pageViews: number | null;
  trafficCollectedAt: Date | string; trafficSources: string[];
  funnelEntrants: number | null; funnelRegistrations: number | null; funnelCollectedAt: Date | string | null; funnelSources: string[];
  missingReason?: string | null;
  importBatch: DailySeoTrafficCohort & { requestId: string; ruleVersion: number; collectedAt: Date | string; importedAt: Date | string };
};
export function parseDailySeoPageGroupsQuery(params: URLSearchParams, now = new Date()): DailySeoPageGroupsQuery {
  const input = new URLSearchParams(params);
  if (input.has("ruleVersion") && input.get("ruleVersion") !== "1") throw new Error("页面组规则版本无效");
  input.delete("ruleVersion");
  const query = parseDailySeoTrafficQuery(input, now);
  if (query.channelDimension !== "firstUserPrimaryChannelGroup") throw new Error("页面组只接受已核验的首次用户主要渠道维度");
  return { ...query, ruleVersion: 1 };
}
const stamp = (value: Date | string) => new Date(value).toISOString();
const sameCohort = (a: DailySeoPageGroupObservation["importBatch"], b: DailySeoPageGroupsQuery) =>
  a.siteDomain === b.siteDomain && a.ga4PropertyId === b.ga4PropertyId && a.timezone === b.timezone && a.trafficScope === b.trafficScope &&
  a.channelName === b.channelName && a.channelDimension === b.channelDimension && a.registrationMetric === b.registrationMetric && a.ruleVersion === b.ruleVersion;
export function buildDailySeoPageGroupsHistory(query: DailySeoPageGroupsQuery, observations: DailySeoPageGroupObservation[]): DailySeoPageGroupsHistory {
  const matching = observations.filter(row => sameCohort(row.importBatch, query));
  const newest = (rows: DailySeoPageGroupObservation[], field: "trafficCollectedAt" | "funnelCollectedAt") => [...rows].sort((a, b) =>
    stamp(b[field]!).localeCompare(stamp(a[field]!)) || stamp(b.importBatch.importedAt).localeCompare(stamp(a.importBatch.importedAt)) || b.importBatch.requestId.localeCompare(a.importBatch.requestId))[0];
  const allSources = new Set<string>();
  const groups = DAILY_SEO_PAGE_GROUPS.map(group => {
    const points: DailySeoPageGroupHistoryPoint[] = [];
    for (let date = query.start; date <= query.end; date = shiftDailySeoDate(date, 1)) {
      const rows = matching.filter(row => row.groupKey === group.key && (row.date instanceof Date ? row.date.toISOString().slice(0, 10) : row.date) === date);
      const users = newest(rows.filter(row => row.totalUsers !== null), "trafficCollectedAt");
      const views = newest(rows.filter(row => row.pageViews !== null), "trafficCollectedAt");
      const converted = newest(rows.filter(row => row.funnelEntrants !== null && row.funnelRegistrations !== null && row.funnelCollectedAt !== null && row.funnelRegistrations <= row.funnelEntrants), "funnelCollectedAt");
      const resultFunnel = converted ? { entrants: converted.funnelEntrants!, registrations: converted.funnelRegistrations!, collectedAt: stamp(converted.funnelCollectedAt!), sources: converted.funnelSources } : null;
      const totalUsersCollectedAt = users ? stamp(users.trafficCollectedAt) : null, pageViewsCollectedAt = views ? stamp(views.trafficCollectedAt) : null;
      const selectedSources = [...(users?.trafficSources ?? []), ...(views?.trafficSources ?? []), ...(resultFunnel?.sources ?? [])];
      selectedSources.forEach(value => allSources.add(value));
      points.push({ date, totalUsers: users?.totalUsers ?? null, pageViews: views?.pageViews ?? null,
        totalUsersCollectedAt, pageViewsCollectedAt, totalUsersSources: users?.trafficSources ?? [], pageViewsSources: views?.trafficSources ?? [],
        funnel: resultFunnel, collectedAt: [totalUsersCollectedAt, pageViewsCollectedAt, resultFunnel?.collectedAt].filter((value): value is string => Boolean(value)).sort().at(-1) ?? null,
        revisions: rows.length, missingReason: !users || !views || !resultFunnel ? rows.find(row => row.missingReason)?.missingReason ?? "页面组自然搜索日数据尚未补齐" : null });
    }
    return { ...group, points, coverage: { days: points.length, totalUsersDays: points.filter(point => point.totalUsers !== null).length,
      pageViewsDays: points.filter(point => point.pageViews !== null).length, funnelDays: points.filter(point => point.funnel !== null).length } };
  });
  return { kind: "daily-seo-page-groups", ...query, funnelRule: DAILY_SEO_PAGE_GROUP_FUNNEL_RULE, groups, sources: [...allSources].sort(),
    collectedAt: groups.flatMap(group => group.points.flatMap(point => point.collectedAt ? [point.collectedAt] : [])).sort().at(-1) ?? null };
}
