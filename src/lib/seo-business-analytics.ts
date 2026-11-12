import { z } from "zod";
import { GA4_HOST_SCOPE, GA4_HOST_UNVERIFIED, GA4_REGISTRATION_METRIC } from "./ga4-host-scope";
import { createHash } from "node:crypto";

import { journeySchema, engagementSchema } from "./seo-business-journeys";
import { businessEventLabels } from "./seo-business-events";
import { apiCohortSchema, cohortKinds } from "./seo-api-cohorts";
export { businessEventLabels } from "./seo-business-events";
export const businessEventSchema = z.enum(Object.keys(businessEventLabels) as [keyof typeof businessEventLabels, ...(keyof typeof businessEventLabels)[]]);
export const businessScopeSchema = z.enum(["all-channels", "session-organic-search"]);
export const businessCountrySchema = z.enum(["all", "US", "JP", "BR", "ES"]);
export const businessAnalyticsSchema = z.object({
  hostScope: z.literal("production-hosts-v1").optional(), version: z.literal(1), siteDomain: z.literal("flatkey.ai"), propertyId: z.literal("541304395"),
  source: z.literal("google-api"), start: z.iso.date(), end: z.iso.date(), timezone: z.literal("America/Los_Angeles"),
  country: businessCountrySchema, scope: businessScopeSchema, observedAt: z.iso.datetime(),
  registrationMetric: z.literal(GA4_REGISTRATION_METRIC).optional(),
  distinctOverWholePeriod: z.literal(true), complete: z.boolean(), reasons: z.array(z.string().max(500)).max(30),
  journeys: z.array(journeySchema).max(2).optional(), engagement: engagementSchema.optional(),
  apiCohorts: z.array(apiCohortSchema).length(2).optional(),
  rows: z.array(z.object({ event: businessEventSchema, events: z.number().int().nonnegative(), users: z.number().int().nonnegative() }).strict()).max(11),
}).strict().superRefine((row, ctx) => {
  const issue = (message: string) => ctx.addIssue({ code: "custom", message });
  if (row.end < row.start || Date.parse(row.end) - Date.parse(row.start) > 366 * 86400000) issue("日期区间无效");
  if (row.end >= new Intl.DateTimeFormat("en-CA", { timeZone: row.timezone }).format(new Date(row.observedAt)) || Date.parse(row.observedAt) > Date.now() + 300000) issue("仅归档已结束且非未来的区间");
  if (new Set(row.rows.map(value => value.event)).size !== row.rows.length) issue("事件重复");
  if (row.journeys && (row.scope !== "all-channels" || new Set(row.journeys.map(value => value.business)).size !== row.journeys.length)) issue("漏斗需独立全渠道口径且业务不可重复");
  if (row.complete && row.reasons.length) issue("有质量缺口不能标完整");
  if (row.apiCohorts && (new Set(row.apiCohorts.map(value => value.kind)).size !== 2 || row.apiCohorts.some(value => value.registrationStart !== row.start || value.registrationEnd !== row.end || value.registrationCountry !== row.country || value.registrationScope !== row.scope || value.observedAt !== row.observedAt))) issue("cohort 必须绑定相同注册区间、来源、国家与采集时点");
});
export type BusinessAnalytics = z.infer<typeof businessAnalyticsSchema>;
export const businessAnalyticsId = (row: BusinessAnalytics) => `ga4-business:${createHash("sha256").update(JSON.stringify(row)).digest("hex")}`;

/** Navigation only: never substitute a different registration window into a card. */
export function recentMatureCohortPeriods(rows: BusinessAnalytics[], country: BusinessAnalytics["country"], scope: BusinessAnalytics["scope"]) {
  const seen = new Set<string>();
  const latest = rows.filter(row => row.country === country && row.scope === scope).sort((a, b) => b.observedAt.localeCompare(a.observedAt)).filter(row => {
    const key = row.start + ":" + row.end;
    if (seen.has(key)) return false;
    seen.add(key); return row.hostScope === GA4_HOST_SCOPE;
  });
  return cohortKinds.flatMap(kind => {
    const cohort = latest.flatMap(row => row.apiCohorts ?? []).filter(row => row.kind === kind && ["ready", "no_users"].includes(row.status))
      .sort((a, b) => b.registrationEnd.localeCompare(a.registrationEnd) || b.observedAt.localeCompare(a.observedAt))[0];
    return cohort ? [{ kind, start: cohort.registrationStart, end: cohort.registrationEnd, observationEnd: cohort.observationEnd }] : [];
  });
}

/** No daily-user summation or conversion rates inferred from unjoined event totals. */
export function latestBusinessPeriod(rows: BusinessAnalytics[], start: string, end: string, country: BusinessAnalytics["country"], scope: BusinessAnalytics["scope"]) {
  const row = rows.filter(row => row.start === start && row.end === end && row.country === country && row.scope === scope)
    .sort((a, b) => b.observedAt.localeCompare(a.observedAt))[0] ?? null;
  if (!row || row.hostScope === GA4_HOST_SCOPE) return row;
  return { ...row, complete: false, reasons: [GA4_HOST_UNVERIFIED], rows: [], journeys: undefined, engagement: undefined, apiCohorts: undefined };
}

export function flatkeyRegistrationCount(rows: BusinessAnalytics[], start: string, end: string) {
  const period = latestBusinessPeriod(rows, start, end, "all", "all-channels");
  return { start, end, users: period?.complete ? period.rows.find(row => row.event === "sign_up")?.users ?? null : null };
}

export function businessDigestLines(rows: BusinessAnalytics[], start: string, end: string, includeRegistration = true) {
  const lines = ["GA4 行为与转化"];
  for (const scope of ["session-organic-search", "all-channels"] as const) {
    const row = latestBusinessPeriod(rows, start, end, "all", scope);
    const label = scope === "session-organic-search" ? "自然搜索归因" : "全渠道业务";
    if (!row) { lines.push(`• ${label}：${start}—${end} 尚无同区间回执，待更新。`); continue; }
    lines.push(`• ${label}：${row.start}—${row.end} · ${row.timezone} · ${row.complete ? "查询完整" : "部分数据"} · 采集 ${row.observedAt}`);
    for (const event of ["gpu_rental_success", "first_model_success", "first_payment_completed", "sign_up"] as const) {
      if (event === "sign_up" && !includeRegistration) continue;
      const value = row.rows.find(item => item.event === event);
      lines.push(`  ${businessEventLabels[event]}：${value ? `${value.events} 次 / 区间去重 ${value.users} 人` : "未观测到，埋点上线及收数待核验"}`);
    }
    for (const journey of row.journeys ?? []) {
      lines.push(`  ${journey.business === "gpu" ? "GPU" : "API"} 同用户顺序漏斗：${journey.status === "unavailable" ? "待核验（" + journey.reason + "）" : journey.steps.map(step => `${step.name} ${step.users}人`).join(" → ") + (journey.status === "partial" ? "（部分数据）" : "")}`);
    }
    if (row.engagement) lines.push(`  有效参与时长：${row.engagement.engagementSeconds === null ? "待核验" : row.engagement.engagementSeconds + "秒"}；自定义活跃停留指标：${row.engagement.activeTimeCustomMetric === "registered" ? "已注册，明细待分析" : "定义待核验"}`);
    if (row.reasons.length) lines.push(`  质量说明：${row.reasons.join("、")}`);
  }
  lines.push("不同事件人数不能相加或直接当成漏斗转化率；全渠道不能当成自然搜索效果。漏斗为所选区间内 GA4 同用户顺序行为，不等同成熟注册 cohort 转化率；完整路径及跨域身份仍须验收。");
  return lines;
}
