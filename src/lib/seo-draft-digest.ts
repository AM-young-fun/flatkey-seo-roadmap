import { z } from "zod";
import { digestWindow, type SeoDigest } from "./seo-digest";
import { ReviewedDigestError, reviewedTextHash } from "./seo-reviewed-digest";
import { dashboardComparisonGroups, reportDashboardEvidenceSchema, sameReportDashboard } from "./seo-report-dashboard";
import { growthHash, growthReportMissingFactLines } from "./growth-strategy";

const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
export const draftDigestCommandSchema = z.object({
  action: z.literal("save_draft"), kind: z.literal("weekly"), date: z.iso.date(),
  baseReportId: z.string().regex(/^seo-digest:\d{4}-\d{2}-\d{2}:[a-f0-9]{16}$/), baseReportHash: sha256,
  reportPeriod: z.object({ start: z.iso.date(), end: z.iso.date(), timezone: z.literal("America/Los_Angeles") }).strict(),
  text: z.string().min(100).max(6000), textSha256: sha256, sourceEvidenceSha256: sha256,
  attributionText: z.string().min(20).max(5000).optional(), dashboardEvidence: reportDashboardEvidenceSchema.optional(),
}).strict();
export type DraftDigestBody = {
  version: 1; recordOnly: true; pendingReview: true; baseReportId: string; baseReportHash: string;
  baseGeneratedAt: string; textSha256: string; sourceEvidenceSha256: string;
};

/** Archives a complete review draft. It carries no approval or delivery authority. */
export function buildDraftSeoDigest(base: SeoDigest, raw: unknown, now = new Date()): SeoDigest {
  const input = draftDigestCommandSchema.parse(raw);
  if (base.id !== input.baseReportId || base.date !== input.date || base.kind !== "weekly"
    || !base.id.startsWith(`seo-digest:${input.date}:`)) throw new ReviewedDigestError("待审正文须绑定同日周报基础快照");
  if (base.hash !== input.baseReportHash || reviewedTextHash(base.text) !== base.hash) throw new ReviewedDigestError("基础报告哈希不匹配", 409);
  const expected = digestWindow(input.date, "weekly");
  if (expected.workTimezone !== "America/Los_Angeles" || input.reportPeriod.start !== expected.trafficStart || input.reportPeriod.end !== expected.trafficEnd
    || base.reportPeriod?.start !== input.reportPeriod.start || base.reportPeriod.end !== input.reportPeriod.end
    || base.reportPeriod.timezone !== input.reportPeriod.timezone || base.deliveryProtocol !== 2 || base.readyAfter !== expected.readyAfter
    || base.workWindow.start !== expected.workStart || base.workWindow.end !== expected.workEnd) throw new ReviewedDigestError("待审正文须保持基础周报的统计周期");
  if (Buffer.byteLength(input.text, "utf8") > 24000 || reviewedTextHash(input.text) !== input.textSha256
    || Array.from(input.text).some(c => c.charCodeAt(0) < 32 && ![9, 10, 13].includes(c.charCodeAt(0)))) throw new ReviewedDigestError("正文长度、字符或 SHA256 不匹配");
  for (const section of ["一", "二", "三", "四", "五", "六"]) {
    if (!new RegExp(`(?:^|\\n)(?:\\*\\*|#{1,3}\\s*)${section}、`, "u").test(input.text)) throw new ReviewedDigestError("待审正文须包含完整六块内容");
  }
  const title = input.text.split(/\r?\n/, 1)[0].replace(/^\*\*(.+)\*\*$/, "$1").replace(/^#{1,3}\s+/, "");
  if (!title || title.length > 160 || title.includes("\r")) throw new ReviewedDigestError("正文标题无效");
  if (input.attributionText && !input.text.includes(input.attributionText)) throw new ReviewedDigestError("涨跌分析须属于同一待审正文");
  if (base.growthSnapshot && growthReportMissingFactLines(base.growthSnapshot, input.text).length) throw new ReviewedDigestError("正文与冻结growth事实不一致：须保留季度/批次目标、方向页面值与URL、原任务、行动及前后窗口；修改须另存同步来源快照");
  // Draft identities are separate from the approved body identity, so approval
  // creates another immutable snapshot instead of upgrading this row in place.
  const key = reviewedTextHash(JSON.stringify(["weekly-review-draft-v1", base.id, input.textSha256, input.sourceEvidenceSha256,
    input.attributionText, input.dashboardEvidence]));
  return { ...base, id: `seo-digest:${input.date}:${key.slice(0, 16)}`, title,
    text: input.text, detailText: input.text, hash: input.textSha256, generatedAt: now.toISOString(), reviewedBody: undefined,
    draftBody: { version: 1, recordOnly: true, pendingReview: true, baseReportId: base.id, baseReportHash: base.hash,
      baseGeneratedAt: base.generatedAt, textSha256: input.textSha256, sourceEvidenceSha256: input.sourceEvidenceSha256 },
    dashboard: { detailText: base.dashboard?.detailText ?? base.detailText ?? base.text, attributionText: input.attributionText ?? "",
      sourceEvidenceSha256: input.sourceEvidenceSha256,
      technicalText: /\*\*五、[^\n]+\*\*\s*\n([\s\S]*?)(?=\n\*\*六、)/u.exec(input.text)?.[1].trim(),
      ...(input.dashboardEvidence ? { traffic: {
        sites: dashboardComparisonGroups(input.dashboardEvidence.sites, input.reportPeriod, input.dashboardEvidence.gscComparable),
        countries: dashboardComparisonGroups(input.dashboardEvidence.countries, input.reportPeriod, input.dashboardEvidence.gscComparable),
        modules: input.dashboardEvidence.modules, gscComparable: input.dashboardEvidence.gscComparable,
      }, moduleShares: input.dashboardEvidence.moduleShares } : {}),
    },
  };
}

export function sameDraftDigest(stored: SeoDigest, expected: SeoDigest) {
  const a = stored.draftBody, b = expected.draftBody;
  return stored.id === expected.id && stored.date === expected.date && stored.kind === "weekly" && !stored.reviewedBody
    && stored.title === expected.title && stored.text === expected.text && stored.detailText === expected.detailText
    && stored.hash === expected.hash && reviewedTextHash(stored.text) === stored.hash && sameReportDashboard(stored.dashboard, expected.dashboard)
    && growthHash(stored.growthSnapshot) === growthHash(expected.growthSnapshot)
    && stored.readyAfter === expected.readyAfter && stored.deliveryProtocol === expected.deliveryProtocol
    && stored.workWindow.start === expected.workWindow.start && stored.workWindow.end === expected.workWindow.end
    && stored.reportPeriod?.start === expected.reportPeriod?.start && stored.reportPeriod?.end === expected.reportPeriod?.end
    && stored.reportPeriod?.timezone === expected.reportPeriod?.timezone
    && !!a && !!b && a.version === 1 && a.recordOnly === true && a.pendingReview === true
    && a.baseReportId === b.baseReportId && a.baseReportHash === b.baseReportHash && a.baseGeneratedAt === b.baseGeneratedAt
    && a.textSha256 === b.textSha256 && a.sourceEvidenceSha256 === b.sourceEvidenceSha256;
}
