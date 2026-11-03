import { prisma } from "@/lib/prisma";
import { settleReads } from "@/lib/database-read";
import { timedRead } from "@/lib/read-profile";
import { weeklyPeriods, activeReportPeriods } from "@/lib/weekly-traffic";
import { weeklyTrafficEvidence } from "@/lib/weekly-traffic-evidence";
import { auditedWeeklyDiagnosis } from "@/lib/weekly-audit-diagnosis";
import { diagnoseWeeklyReport } from "@/lib/weekly-report-diagnosis";
import { loadWeeklySerp } from "@/lib/services/weekly-serp";
import { comparableWeeklyCutoffs, reportingCutoff } from "@/lib/weekly-cutoff";
import { buildWeeklySeoTrafficReport } from "@/lib/weekly-seo-report";
import type { PageTrafficSeries } from "@/lib/page-traffic-history";

export async function buildWeeklyReport(periods: ReturnType<typeof weeklyPeriods>) {
  const domains = ["flatkey.ai", "rackrate.org", "modelfit.cc"];
  const [weekly, weeks, movements] = await settleReads([
    timedRead("weekly.traffic", () => prisma.weeklyTraffic.findMany({ where: { siteDomain: { in: domains }, periodStart: { in: [new Date(periods.current.start), new Date(periods.previous.start)] } }, orderBy: [{ collectedAt: "desc" }, { importedAt: "desc" }] })),
    prisma.weeklyTraffic.findMany({ where: { siteDomain: { in: domains }, periodStart: { lte: new Date(weeklyPeriods().current.start) } }, distinct: ["periodStart"], select: { periodStart: true }, orderBy: { periodStart: "desc" } }),
    timedRead("weekly.serp", () => loadWeeklySerp(periods)),
  ]);
  // Read-only: preserve original imports and Friday snapshots. Whole-site
  // totals and unscoped page/funnel evidence cannot become SEO evidence.
  const { traffic, evidence } = buildWeeklySeoTrafficReport(weekly, periods, weeklyTrafficEvidence(periods.current.start));
  const rowFor = (start: string, end: string) => weekly.find(row => row.siteDomain === "flatkey.ai" &&
    row.periodStart.toISOString().slice(0, 10) === start && row.periodEnd.toISOString().slice(0, 10) === end);
  const flatkey = rowFor(periods.current.start, periods.current.end);
  const prior = rowFor(periods.previous.start, periods.previous.end);
  const cutoff = reportingCutoff(flatkey?.analysis);
  const sameCutoff = comparableWeeklyCutoffs(flatkey?.analysis, prior?.analysis);
  const comparableRanks = movements.ranking.baseline || movements.ranking.noNewCapture || movements.ranking.waiting ? null : movements.comparison;
  const automatic = await diagnoseWeeklyReport(traffic, comparableRanks, periods.current.end);
  const audited = evidence?.complete ? auditedWeeklyDiagnosis(evidence) : { significant: false, findings: [] };
  const diagnosis = { significant: automatic.significant || audited.significant, findings: [...audited.findings, ...automatic.findings] };
  return {
    periods, evidence, trafficScope: "organic_search" as const,
    pageVisitors: evidence?.pageVisitors ?? null,
    // Existing page history is all-channel; daily SEO trends use their own
    // store. No historical whole-site curves are relabelled as organic.
    pageTrafficHistory: [] as PageTrafficSeries,
    reportingCutoff: cutoff ? { ...cutoff, collectedAt: flatkey!.collectedAt.toISOString(), comparable: sameCutoff } : null,
    draft: null,
    history: [...new Set([activeReportPeriods().current.start, ...weeks.map(row => row.periodStart.toISOString().slice(0, 10))])].sort().reverse(),
    traffic, ...movements, diagnosis, pages: [],
  };
}
