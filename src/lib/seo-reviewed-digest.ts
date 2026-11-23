import { createHash } from "node:crypto";
import { z } from "zod";
import { reportDay, digestWindow, type SeoDigest } from "./seo-digest";
import { digestSnapshotId } from "./seo-digest-message.cjs";
import { sameReportDashboard } from "./seo-report-dashboard";
import { currentCanonicalWeeklyDraft } from "./seo-weekly-review-window";
import { growthHash, growthReportMissingFactLines } from "./growth-strategy";

const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const reportId = z.string().regex(/^seo-digest:\d{4}-\d{2}-\d{2}:[a-f0-9]{16}$/);
export const reviewedDigestCommandSchema = z.object({
  action: z.literal("save_reviewed"), kind: z.literal("weekly"), date: z.iso.date(),
  baseReportId: reportId, baseReportHash: sha256,
  reportPeriod: z.object({ start: z.iso.date(), end: z.iso.date(), timezone: z.literal("America/Los_Angeles") }).strict(),
  text: z.string().min(100).max(6000), textSha256: sha256, sourceEvidenceSha256: sha256,
  approvedAt: z.iso.datetime({ offset: true }),
}).strict();
export type ReviewedDigestCommand = z.infer<typeof reviewedDigestCommandSchema>;
export type ReviewedDigestBody = {
  version: 1; recordOnly: true; baseReportId: string; baseReportHash: string;
  baseGeneratedAt: string; textSha256: string; sourceEvidenceSha256: string; approvedAt: string;
};
export class ReviewedDigestError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
export const reviewedTextHash = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");

/** Records the reviewed body; it does not authorize, claim, or send a message. */
export function buildReviewedSeoDigest(base: SeoDigest, raw: unknown, now = new Date()): SeoDigest {
  const input = reviewedDigestCommandSchema.parse(raw);
  if ((input.date !== reportDay(now) && !currentCanonicalWeeklyDraft(base, now))
    || base.id !== input.baseReportId || base.date !== input.date || base.kind !== "weekly"
    || !input.baseReportId.startsWith(`seo-digest:${input.date}:`)) throw new ReviewedDigestError("必须绑定当天周报，或当前已闭合洛杉矶周的确切待审快照");
  if (base.hash !== input.baseReportHash || reviewedTextHash(base.text) !== base.hash) throw new ReviewedDigestError("基础报告哈希不匹配", 409);
  if (base.draftBody && (input.text !== base.text || input.textSha256 !== base.hash
    || input.sourceEvidenceSha256 !== base.draftBody.sourceEvidenceSha256)) throw new ReviewedDigestError("须批准同一待审全文及证据；内容修改须另存待审版本", 409);
  let expected: ReturnType<typeof digestWindow>;
  try { expected = digestWindow(input.date, "weekly"); }
  catch { throw new ReviewedDigestError("周报日期无效"); }
  if (expected.workTimezone !== "America/Los_Angeles" || input.reportPeriod.start !== expected.trafficStart || input.reportPeriod.end !== expected.trafficEnd
    || base.reportPeriod?.start !== input.reportPeriod.start || base.reportPeriod.end !== input.reportPeriod.end
    || base.reportPeriod.timezone !== input.reportPeriod.timezone || base.deliveryProtocol !== 2 || base.readyAfter !== expected.readyAfter
    || base.workWindow.start !== expected.workStart || base.workWindow.end !== expected.workEnd) throw new ReviewedDigestError("已审正文必须保持基础快照的洛杉矶统计周期与通知协议");
  if (Buffer.byteLength(input.text, "utf8") > 24000 || Array.from(input.text).some(character => character.charCodeAt(0) < 32 && ![9, 10, 13].includes(character.charCodeAt(0)))
    || reviewedTextHash(input.text) !== input.textSha256) throw new ReviewedDigestError("正文长度、字符或 SHA256 不匹配");
  if (Date.parse(input.approvedAt) > now.getTime() || Date.parse(input.approvedAt) < Date.parse(base.generatedAt)) throw new ReviewedDigestError("审稿记录时间无效");
  if (base.growthSnapshot && growthReportMissingFactLines(base.growthSnapshot, input.text).length) throw new ReviewedDigestError("已审正文与冻结growth事实不一致，不能改写页面值、链接、原任务、行动或效果比较后仍显示旧结构");
  const title = input.text.split(/\r?\n/, 1)[0].replace(/^\*\*(.+)\*\*$/, "$1").replace(/^#{1,3}\s+/, "");
  if (!title || title.length > 160 || title.includes("\r")) throw new ReviewedDigestError("正文标题无效");
  // Only exact string fields determine the new ID. JSONB object-key order cannot change it.
  const id = digestSnapshotId({ date: input.date, text: input.text, detailText: input.text, ...(base.growthSnapshot ? { growthSnapshot: base.growthSnapshot } : {}) });
  if (id === base.id) throw new ReviewedDigestError("已审正文须另存不同的不可变快照", 409);
  return { ...base, id, title, text: input.text, detailText: input.text, hash: input.textSha256,
    generatedAt: now.toISOString(), draftBody: undefined,
    reviewedBody: { version: 1, recordOnly: true, baseReportId: base.id, baseReportHash: base.hash,
      baseGeneratedAt: base.generatedAt, textSha256: input.textSha256, sourceEvidenceSha256: input.sourceEvidenceSha256, approvedAt: input.approvedAt },
    // The exact body is authoritative. Old structured traffic cannot be mistaken for its values.
    ...(base.dashboard ? {} : { pagePerformance: [], recentPages: [], weeklyTraffic: undefined, weeklyHighlights: undefined, workPlan: undefined,
      organicRegistrationCanCompare: false, registrationCoverageNote: "", accountRegistrations: undefined }),
  };
}

export function sameReviewedDigest(stored: SeoDigest, expected: SeoDigest) {
  const a = stored.reviewedBody, b = expected.reviewedBody;
  return stored.id === expected.id && stored.date === expected.date && stored.kind === "weekly" && !stored.draftBody
    && stored.title === expected.title && stored.text === expected.text && stored.detailText === expected.detailText
    && stored.hash === expected.hash && reviewedTextHash(stored.text) === stored.hash && sameReportDashboard(stored.dashboard, expected.dashboard)
    && growthHash(stored.growthSnapshot) === growthHash(expected.growthSnapshot)
    && stored.readyAfter === expected.readyAfter && stored.deliveryProtocol === expected.deliveryProtocol
    && stored.preliminary === expected.preliminary && stored.workWindow.start === expected.workWindow.start && stored.workWindow.end === expected.workWindow.end
    && stored.reportPeriod?.start === expected.reportPeriod?.start && stored.reportPeriod?.end === expected.reportPeriod?.end
    && stored.reportPeriod?.timezone === expected.reportPeriod?.timezone
    && !!a && !!b && a.version === 1 && a.recordOnly === true
    && a.baseReportId === b.baseReportId && a.baseReportHash === b.baseReportHash && a.baseGeneratedAt === b.baseGeneratedAt
    && a.textSha256 === b.textSha256 && a.sourceEvidenceSha256 === b.sourceEvidenceSha256 && a.approvedAt === b.approvedAt;
}
