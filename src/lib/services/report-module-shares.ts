import { prisma } from "@/lib/prisma";
import { isDatabaseConfigured } from "@/lib/env";
import { cohortDay } from "../seo-api-cohorts";
import { reportModuleShareRows, savedReportModuleShares, type ReportModuleShareComparison, type ReportModuleShareSnapshot, type ReportTrafficRange } from "../report-module-shares";

/** Reuses already archived whole-period source evidence. Never reconstructs
 * unique users by summing daily counts and never starts a new source query. */
export async function loadReportModuleShares(period: ReportTrafficRange, comparisonPeriod: ReportTrafficRange, kind: "daily" | "weekly", now = new Date()): Promise<ReportModuleShareSnapshot | undefined> {
  if (!isDatabaseConfigured()) return undefined;
  const rows = await prisma.seoReportVersion.findMany({ where: { kind: "SEO_DIGEST", siteDomain: "flatkey.ai", AND: [
    { payload: { path: ["reportPeriod", "start"], equals: period.start } },
    { payload: { path: ["reportPeriod", "end"], equals: period.end } },
    { payload: { path: ["reportPeriod", "timezone"], equals: "America/Los_Angeles" } },
  ] }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 20, select: { id: true, payload: true } });
  for (const row of rows) {
    if (!row.payload || typeof row.payload !== "object" || Array.isArray(row.payload)) continue;
    const report = row.payload as unknown as { kind?: string; dashboard?: { moduleShares?: ReportModuleShareComparison; sourceEvidenceSha256?: string }; moduleShareSnapshot?: ReportModuleShareSnapshot };
    if (report.kind !== kind) continue;
    const saved = report.moduleShareSnapshot;
    if (saved && (saved.version !== 1 || !saved.period || !saved.comparisonPeriod)) continue;
    const values = savedReportModuleShares(saved?.values ?? report.dashboard?.moduleShares), sourceEvidenceSha256 = saved?.sourceEvidenceSha256 ?? report.dashboard?.sourceEvidenceSha256;
    const sourceReportId = saved?.sourceReportId ?? row.id;
    if (!/^seo-digest:\d{4}-\d{2}-\d{2}:[a-f0-9]{16}$/u.test(sourceReportId)) continue;
    if (!values || typeof sourceEvidenceSha256 !== "string" || !/^[a-f0-9]{64}$/u.test(sourceEvidenceSha256) || !values.observedAt
      || !Number.isFinite(Date.parse(values.observedAt)) || Date.parse(values.observedAt) > now.getTime() || cohortDay(new Date(values.observedAt)) <= period.end) continue;
    if (saved && (saved.period.start !== period.start || saved.period.end !== period.end || saved.comparisonPeriod.start !== comparisonPeriod.start || saved.comparisonPeriod.end !== comparisonPeriod.end || saved.timezone !== "America/Los_Angeles")) continue;
    if (reportModuleShareRows(values).every(value => value.previousShare === null && value.currentShare === null)) continue;
    return { version: 1, period, comparisonPeriod, timezone: "America/Los_Angeles", sourceReportId, sourceEvidenceSha256, values };
  }
  return undefined;
}
