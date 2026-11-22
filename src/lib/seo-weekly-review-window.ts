import { createHash } from "node:crypto";
import { reportDay } from "./seo-report-time.cjs";
import { shiftDay, weeklyReportRange, WEEKLY_REPORT_SWITCH_DATE } from "./seo-date-range";
import type { SeoDigest } from "./seo-digest";

/** Calendar eligibility only; exact approval and delivery bindings are checked separately. */
export function currentCanonicalWeeklyDraft(report: SeoDigest, now: Date): boolean {
  const period = weeklyReportRange(reportDay(now)), date = shiftDay(period.end, 1), draft = report.draftBody;
  return date >= WEEKLY_REPORT_SWITCH_DATE && report.kind === "weekly" && report.date === date
    && new RegExp(`^seo-digest:${date}:[a-f0-9]{16}$`).test(report.id)
    && report.reportPeriod?.timezone === "America/Los_Angeles"
    && report.reportPeriod.start === period.start && report.reportPeriod.end === period.end
    && !report.reviewedBody && !!draft && draft.version === 1 && draft.recordOnly === true && draft.pendingReview === true
    && typeof report.text === "string" && report.detailText === report.text
    && /^[a-f0-9]{64}$/.test(report.hash) && createHash("sha256").update(report.text, "utf8").digest("hex") === report.hash
    && draft.textSha256 === report.hash && /^[a-f0-9]{64}$/.test(draft.sourceEvidenceSha256)
    && new RegExp(`^seo-digest:${date}:[a-f0-9]{16}$`).test(draft.baseReportId) && draft.baseReportId !== report.id
    && /^[a-f0-9]{64}$/.test(draft.baseReportHash)
    && Number.isFinite(Date.parse(draft.baseGeneratedAt)) && Date.parse(draft.baseGeneratedAt) <= Date.parse(report.generatedAt)
    && Number.isFinite(Date.parse(report.generatedAt)) && Date.parse(report.generatedAt) <= now.getTime();
}
