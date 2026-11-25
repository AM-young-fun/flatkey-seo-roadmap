import { serpPeriodFromKey } from "@/lib/serp-periods";
import { prisma } from "@/lib/prisma";
import { approvedWeeklyCaptureRunIds, buildApprovedWeeklyKeywordCapture, type ApprovedWeeklyKeywordCaptureInput } from "@/lib/approved-weekly-keyword-capture";
import { loadApprovedKeywordReview } from "@/lib/services/approved-keyword-review";
import { loadApprovedOtherKeywordReview } from "@/lib/services/approved-other-keyword-review";

export type { ApprovedWeeklyKeywordCaptureInput, ApprovedWeeklyKeywordCapture } from "@/lib/approved-weekly-keyword-capture";

/** Only saved DB snapshots and two fixed ledger identities; never submits or polls a provider. */
export async function loadApprovedWeeklyKeywordCapture(input: ApprovedWeeklyKeywordCaptureInput) {
  const [first, other, metadata] = await Promise.all([
    loadApprovedKeywordReview(),
    loadApprovedOtherKeywordReview(),
    prisma.serpMonitorRun.findMany({ where: { id: { in: approvedWeeklyCaptureRunIds() } }, select: {
      id: true, scope: true, periodKey: true, cohortHash: true, targetCount: true, queryCount: true,
      estimatedCostMicros: true, reservedCostMicros: true, configJson: true,
    } }),
  ]);
  return buildApprovedWeeklyKeywordCapture(input, { first, other }, metadata);
}


export const NOVEMBER_SECOND_CAPTURE_DAY = "2026-11-23";
export const NOVEMBER_SECOND_CAPTURE_PERIOD = serpPeriodFromKey("2026-11-17");

export function loadNovemberSecondKeywordCapture(asOf = new Date()) {
  return loadApprovedWeeklyKeywordCapture({ start: "2026-11-22", end: NOVEMBER_SECOND_CAPTURE_DAY, asOf });
}
