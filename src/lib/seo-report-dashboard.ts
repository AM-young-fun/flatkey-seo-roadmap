import { z } from "zod";
import type { ReportComparisonGroups } from "./seo-report-comparisons";

const count = z.number().int().nonnegative().nullable();
const pair = z.object({ previous: count, current: count }).strict();
const traffic = z.object({ sessions: pair, clicks: pair, impressions: pair }).strict();
const withRegistration = traffic.extend({ registrations: pair.optional() });
const shareCounts = z.object({ all: count, modelDetail: count, prompts: count }).strict();
export const reportDashboardEvidenceSchema = z.object({
  scope: z.literal("website-console"), timezone: z.literal("America/Los_Angeles"),
  observedAt: z.iso.datetime({ offset: true }), gscComparable: z.boolean(), gscProvisionalFrom: z.iso.date().optional(),
  sites: z.array(withRegistration.extend({ name: z.enum(["flatkey.ai", "rackrate.org", "modelfit.cc", "rougecue.org", "mochichatbot.com", "jev-llm.com"]) })).min(5).max(6),
  countries: z.array(traffic.extend({ name: z.enum(["US", "JP", "BR", "ES"]) })).length(4),
  modules: z.array(withRegistration.extend({ id: z.enum(["home", "blog", "models", "gpu", "prompts"]) })).length(5).optional(),
  moduleShares: z.object({ current: shareCounts, previous: shareCounts, observedAt: z.iso.datetime({ offset: true }) }).strict().optional(),
}).strict().superRefine((value, ctx) => {
  for (const field of ["sites", "countries", "modules"] as const) {
    const rows = value[field];
    if (rows && new Set(rows.map(row => "name" in row ? row.name : row.id)).size !== rows.length) ctx.addIssue({ code: "custom", path: [field], message: "报告分组不可重复" });
  }
});
export type ReportDashboardEvidence = z.infer<typeof reportDashboardEvidenceSchema>;
export type ReportDashboard = {
  detailText: string; attributionText: string; sourceEvidenceSha256: string;
  technicalText?: string;
  traffic?: { sites: ReportComparisonGroups; countries: ReportComparisonGroups; modules?: ReportDashboardEvidence["modules"]; gscComparable: boolean; gscProvisionalFrom?: string };
  moduleShares?: ReportDashboardEvidence["moduleShares"];
};
export function sameReportDashboard(a: ReportDashboard | undefined, b: ReportDashboard | undefined) {
  const ordered = (value: unknown): unknown => Array.isArray(value) ? value.map(ordered)
    : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, ordered(child)])) : value;
  return JSON.stringify(ordered(a)) === JSON.stringify(ordered(b));
}
export function dashboardComparisonGroups(rows: ReportDashboardEvidence["sites"] | ReportDashboardEvidence["countries"], period: { start: string; end: string }, gscComparable: boolean, gscProvisionalFrom?: string): ReportComparisonGroups {
  const shift = (day: string) => new Date(Date.parse(day + "T00:00:00Z") - 7 * 86400000).toISOString().slice(0, 10);
  return rows.map(row => ({ name: row.name, metrics: ([ ["sessions", "自然会话"], ["clicks", "Google 点击"], ["impressions", "曝光"], ["registrations", "自然搜索注册"] ] as const).flatMap(([key, label]) => {
    const metric = key === "registrations" ? ("registrations" in row ? row.registrations : undefined) : row[key];
    if (!metric) return [];
    const { previous, current } = metric;
    const comparable = key === "sessions" || key === "registrations" || gscComparable;
    return [{ label, previous, current,
      delta: !comparable || previous === null || current === null || previous === 0 ? "" : previous === current ? "持平" : `${current > previous ? "+" : ""}${((current - previous) / previous * 100).toFixed(1)}%`,
      period: `${shift(period.start)}—${shift(period.end)} → ${period.start}—${period.end}`,
      note: comparable ? "" : gscProvisionalFrom ? `GSC ${gscProvisionalFrom} 起为初步数据，不计算周环比` : "不计算周环比",
    }];
  }) }));
}
