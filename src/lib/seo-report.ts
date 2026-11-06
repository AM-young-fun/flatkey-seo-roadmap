import { z } from "zod";
import type { DailySeoTrafficHistory } from "./daily-seo-traffic";
import type { DailySeoPageGroupsHistory } from "./daily-seo-page-groups";
import { parseDailySeoTrafficQuery } from "./daily-seo-traffic";

const rangeSchema = z.object({ start: z.iso.date(), end: z.iso.date() }).strict();
export const reportInputSchema = rangeSchema.extend({ id: z.uuid(), comparison: rangeSchema.nullable().optional() }).strict();
export type ReportInput = z.infer<typeof reportInputSchema>;
export type ReportEvidence = { daily: DailySeoTrafficHistory; groups: DailySeoPageGroupsHistory };

export function validateReportRanges(input: ReportInput) {
  parseDailySeoTrafficQuery(new URLSearchParams({ start: input.start, end: input.end }));
  if (input.comparison) parseDailySeoTrafficQuery(new URLSearchParams(input.comparison));
}

export function dailyMetrics(data: DailySeoTrafficHistory) {
  const average = (field: "newUsers" | "newRegistrations") => {
    if (!data.points.length || data.points.some(p => p[field] === null)) return null;
    return data.points.reduce((sum, p) => sum + p[field]!, 0) / data.points.length;
  };
  return { newUsersAverage: average("newUsers"), registrationsAverage: average("newRegistrations") };
}

export function reportPayload(input: ReportInput, evidence: ReportEvidence, comparison: ReportEvidence | null) {
  const complete = (e: ReportEvidence) => e.daily.coverage.completeDays === e.daily.coverage.days
    && e.groups.groups.every(g => g.coverage.funnelDays === g.coverage.days && g.coverage.totalUsersDays === g.coverage.days && g.coverage.pageViewsDays === g.coverage.days);
  const metrics = dailyMetrics(evidence.daily);
  const previous = comparison ? dailyMetrics(comparison.daily) : null;
  const change = (now: number | null, before: number | null | undefined) => now === null || before == null || before === 0 ? null : (now - before) / before;
  const averages = metrics.newUsersAverage === null || metrics.registrationsAverage === null ? "日均指标因缺日暂不计算。"
    : `日均自然搜索新用户${metrics.newUsersAverage.toFixed(1)}人，日均注册${metrics.registrationsAverage.toFixed(1)}人。`;
  return {
    schemaVersion: 1,
    scope: "first_user_organic",
    status: complete(evidence) && (!comparison || complete(comparison)) ? "daily_evidence_complete" : "partial",
    range: { start: input.start, end: input.end },
    comparisonRange: input.comparison ?? null,
    intervalRegistrations: null,
    summary: `${input.start}至${input.end}，全站完整日记录${evidence.daily.coverage.completeDays}/${evidence.daily.coverage.days}天。${averages}区间去重注册尚未独立采集，日均注册不代表区间去重人数或转化率。`,
    metrics,
    changes: {
      newUsersAverage: change(metrics.newUsersAverage, previous?.newUsersAverage),
      registrationsAverage: change(metrics.registrationsAverage, previous?.registrationsAverage),
    },
    ...evidence,
    comparison,
  };
}
