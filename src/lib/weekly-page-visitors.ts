import { z } from "zod";

export const PILLAR_VISITORS_START = "2026-10-20";
const locale = "(?:/(?:en|zh|es|fr|pt|ru|ja|vi|de|id))?";

// Keep filters disjoint: model-specific prompt details belong to prompts.
// GA4 runs one filtered, dimensionless totalUsers query per group and week;
// summing page/day/language rows would double-count visitors.
export const PILLAR_PAGE_GROUPS = [
  { key: "models", name: "模型详情页", pathPattern: `^${locale}/models/[^/]+/?$`, scope: "模型详情 · 含各语言版本，不含模型目录" },
  { key: "prompts", name: "Prompt Library", pathPattern: `^${locale}/(?:prompts(?:/.*)?|models/[^/]+/prompts(?:/.*)?)/?$`, scope: "提示词库与详情页 · 含模型内提示词及各语言版本" },
] as const;

const visitors = z.number().int().nonnegative().nullable();
export const weeklyPageVisitorsSchema = z.object({
  metric: z.literal("totalUsers"),
  eventName: z.literal("page_view"),
  ruleVersion: z.union([z.literal(1), z.literal(2)]),
  siteUsers: z.object({ current: visitors, previous: visitors }).strict().optional(),
  sourceUrl: z.url().refine(value => {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "analytics.google.com" && !url.username && !url.password;
  }, "页面访客量必须提供 GA4 来源"),
  groups: z.array(z.object({
    key: z.enum(["models", "prompts"]),
    users: z.object({ current: visitors, previous: visitors }).strict(),
  }).strict()).length(2),
}).strict().superRefine((value, ctx) => {
  if (value.ruleVersion === 2 && !value.siteUsers) ctx.addIssue({code:"custom", message:"访客占比须提供同区间全站去重访客量"});
  for (const period of ["current", "previous"] as const) {
    const total = value.siteUsers?.[period];
    if (total != null && value.groups.some(group => group.users[period] != null && group.users[period]! > total)) ctx.addIssue({code:"custom", message:"页面组访客量不能超过同期全站访客量"});
  }
  if (new Set(value.groups.map(group => group.key)).size !== 2) {
    ctx.addIssue({ code: "custom", message: "每周必须分别记录模型页和提示词页访客量；缺失用 null" });
  }
});

export type WeeklyPageVisitors = z.infer<typeof weeklyPageVisitorsSchema>;

export function pageVisitorRows(evidence?: WeeklyPageVisitors | null, complete = false) {
  return PILLAR_PAGE_GROUPS.map(group => {
    const users = evidence?.groups.find(row => row.key === group.key)?.users;
    const current = users?.current ?? null, previous = users?.previous ?? null;
    const comparable = complete && current !== null && previous !== null;
    const share = (period: "current" | "previous", users: number | null) => {
      const total = evidence?.ruleVersion === 2 ? evidence.siteUsers?.[period] : null;
      return users !== null && total != null && total > 0 ? users / total : null;
    };
    const currentShare = share("current", current), previousShare = complete ? share("previous", previous) : null;
    const legacy = evidence?.ruleVersion === 1 && group.key === "models";
    return { ...group, ...(legacy ? {name:"模型页面（历史口径）",scope:"模型目录与详情页 · 含各语言版本"} : {}), current, previous, currentShare, previousShare,
      sharePoints: currentShare !== null && previousShare !== null ? (currentShare - previousShare) * 100 : null,
      delta: comparable ? current - previous : null,
      rate: comparable && previous > 0 ? (current - previous) / previous : null,
      newTraffic: comparable && previous === 0 && current > 0,
    };
  });
}
