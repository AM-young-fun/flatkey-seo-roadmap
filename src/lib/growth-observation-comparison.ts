import { z } from "zod";

const count = z.number().int().nonnegative().safe().nullable();
const timezone = z.string().min(1).refine(value => { try { new Intl.DateTimeFormat("en-CA", { timeZone: value }); return true; } catch { return false; } }, "比较来源时区无效");
const reference = z.object({ source: z.literal("GA4"), reference: z.string().trim().min(1).max(3000), observedAt: z.iso.datetime({ offset: true }) }).strict();
const windowSchema = z.object({ start: z.iso.date(), end: z.iso.date(), coveredDates: z.array(z.iso.date()).max(56), sessions: count, evidence: z.array(reference).max(60), limitations: z.array(z.string().trim().min(1).max(1000)).max(20) }).strict();
export const growthObservationComparisonInputSchema = z.object({
  status: z.enum(["complete", "insufficient_data", "new_page"]), publicationId: z.string().min(1).max(200), taskId: z.string().min(1).max(200), contentVersion: z.string().min(1).max(200),
  site: z.enum(["flatkey.ai", "rackrate.org", "modelfit.cc"]), pageUrl: z.url().startsWith("https://"), country: z.string().min(2).max(10).nullable(), language: z.string().min(2).max(20).nullable(),
  source: z.literal("GA4"), propertyId: z.string().regex(/^\d+$/).nullable(), sourceTimezone: timezone, scope: z.literal("page-session-organic-search"),
  before: windowSchema, after: windowSchema, reason: z.string().trim().min(1).max(3000), limitations: z.array(z.string().trim().min(1).max(1000)).max(20),
}).strict();
export const growthObservationComparisonStoredSchema = growthObservationComparisonInputSchema.extend({ previousSessions: count, currentSessions: count, delta: z.number().finite().nullable(), relativeChange: z.number().finite().nullable() }).strict();
export type GrowthObservationComparison = z.infer<typeof growthObservationComparisonStoredSchema>;
type ReferencePublication = { id: string; taskId: string; siteDomain: string; pageUrl: string; contentVersion: string; publishedAt: string; country?: string | null; language?: string; kind: string };
const shift = (day: string, offset: number) => new Date(Date.parse(day + "T00:00:00Z") + offset * 86400000).toISOString().slice(0, 10);

/** A comparison is a page's equal-length natural-day windows. Publication day
 * is excluded on both sides; a single observation cannot stand in for N days. */
export function prepareGrowthObservationComparison(raw: unknown, publication: ReferencePublication, checkpoint: number, context: { sourceTimezone: string; propertyId: string | null; now: Date; sessions: number | null }) {
  const input = growthObservationComparisonInputSchema.parse(raw), issues: string[] = [];
  if (input.publicationId !== publication.id || input.taskId !== publication.taskId || input.contentVersion !== publication.contentVersion || input.site !== publication.siteDomain || input.pageUrl !== publication.pageUrl || input.country !== (publication.country ?? null) || input.language !== (publication.language ?? null)) issues.push("效果比较须绑定原发布版本、原任务、页面及原国家语言");
  if (input.sourceTimezone !== context.sourceTimezone || input.propertyId !== null && input.propertyId !== context.propertyId) issues.push("效果比较必须使用该页面真实GA4属性及来源时区");
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: context.sourceTimezone }).format(new Date(publication.publishedAt));
  const expected = {
    before: { start: shift(day, -checkpoint), end: shift(day, -1), dates: Array.from({ length: checkpoint }, (_, index) => shift(day, -checkpoint + index)) },
    after: { start: shift(day, 1), end: shift(day, checkpoint), dates: Array.from({ length: checkpoint }, (_, index) => shift(day, index + 1)) },
  };
  for (const side of ["before", "after"] as const) {
    const window = input[side], required = expected[side];
    if (window.start !== required.start || window.end !== required.end) issues.push("前窗须为上线前N个完整日，后窗须从上线后首个完整日起连续N日，两窗必须等长");
    if (new Set(window.coveredDates).size !== window.coveredDates.length || window.coveredDates.some(date => !required.dates.includes(date))) issues.push("实际覆盖日期须独立去重且位于对应完整窗口内");
    const full = required.dates.every(date => window.coveredDates.includes(date));
    if (window.sessions !== null && (!full || !window.evidence.length)) issues.push("缺日或缺独立GA4证据时，整窗会话必须保留null，不能拿部分日或单日替代");
    if (window.evidence.some(item => Date.parse(item.observedAt) > context.now.getTime() || new Intl.DateTimeFormat("en-CA", { timeZone: input.sourceTimezone }).format(new Date(item.observedAt)) <= required.end)) issues.push("来源证据必须在对应窗口结束后实际采集，且不能为未来时间");
    if (input.status === "complete" && (!full || window.sessions === null || !window.evidence.length || window.limitations.length)) issues.push("完整比较需要前后各N日全覆盖、独立来源及真实会话，不能有未解决缺口");
  }
  if (input.after.sessions !== context.sessions) issues.push("比较后窗会话须与同一观察的真实GA4流量一致");
  if (input.status === "complete" && (!input.propertyId || !context.propertyId || input.limitations.length)) issues.push("属性未核实或存在数据缺口时不得标为完整比较");
  if (input.status === "new_page") {
    if (publication.kind === "optimization") issues.push("旧页优化缺前窗应标insufficient_data，不能冒充新页");
    if (input.before.sessions !== null || input.before.coveredDates.length || input.before.evidence.length || !input.before.limitations.length) issues.push("新页没有历史基线，前窗必须为null并明确无历史原因，不得填0");
  }
  if (input.status === "insufficient_data" && !input.limitations.length) issues.push("来源不足必须记录具体限制和待补原因");
  const complete = input.status === "complete" && issues.length === 0;
  const comparison: GrowthObservationComparison = { ...input, previousSessions: input.before.sessions, currentSessions: input.after.sessions, delta: complete ? input.after.sessions! - input.before.sessions! : null, relativeChange: complete && input.before.sessions! > 0 ? (input.after.sessions! - input.before.sessions!) / input.before.sessions! : null };
  return { comparison, issues };
}
