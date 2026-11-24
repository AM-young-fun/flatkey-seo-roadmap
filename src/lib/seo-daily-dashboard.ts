import { replaceDailyTrafficSection } from "./seo-daily-report-sections";
import { z } from "zod";
import { digestWindow, type SeoDigest } from "./seo-digest";
import { ReviewedDigestError, reviewedTextHash } from "./seo-reviewed-digest";
import { dashboardComparisonGroups, reportDashboardEvidenceSchema, sameReportDashboard } from "./seo-report-dashboard";
import { reportModuleShareLines, type ReportModuleShareSnapshot } from "./report-module-shares";

const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const count = z.number().int().nonnegative().nullable();
const counts = z.object({ all: count, modelDetail: count, prompts: count }).strict();
export const dailyDashboardCommandSchema = z.object({
  action: z.literal("save_daily_dashboard"), kind: z.literal("daily"), date: z.iso.date(),
  baseReportId: z.string().regex(/^seo-digest:\d{4}-\d{2}-\d{2}:[a-f0-9]{16}$/), baseReportHash: sha256,
  sourceEvidenceSha256: sha256,
  moduleShares: z.object({ current: counts, previous: counts, observedAt: z.iso.datetime({ offset: true }) }).strict(),
  dashboardEvidence: reportDashboardEvidenceSchema.optional(),
}).strict();
export type DailyDashboardBody = {
  version: 1; recordOnly: true; baseReportId: string; baseReportHash: string;
  baseGeneratedAt: string; sourceEvidenceSha256: string;
};
export type DailyDashboardSeoDigest = SeoDigest & { dailyDashboardBody: DailyDashboardBody };
const canonical = (value: unknown): string => JSON.stringify(value, (_key, child) => child && typeof child === "object" && !Array.isArray(child)
  ? Object.fromEntries(Object.keys(child).sort().map(key => [key, child[key]])) : child);
const shift = (day: string) => new Date(Date.parse(day + "T00:00:00Z") - 86400000).toISOString().slice(0, 10);

/** Adds source evidence to another immutable daily version; it grants no delivery or approval authority. */
export function buildDailyDashboardSeoDigest(base: SeoDigest, raw: unknown, now = new Date()): DailyDashboardSeoDigest {
  const input = dailyDashboardCommandSchema.parse(raw), expected = digestWindow(input.date, "daily", { legacyDailyExecution: !base.businessDate }), period = base.reportPeriod;
  if (base.id !== input.baseReportId || base.date !== input.date || base.kind !== "daily"
    || !base.id.startsWith(`seo-digest:${input.date}:`) || base.draftBody || base.reviewedBody) throw new ReviewedDigestError("须绑定同日日报的确切基础快照");
  if (base.hash !== input.baseReportHash || reviewedTextHash(base.text) !== base.hash) throw new ReviewedDigestError("基础日报哈希不匹配", 409);
  if (!period || period.timezone !== "America/Los_Angeles" || period.start !== expected.trafficStart || period.end !== expected.trafficEnd
    || base.deliveryProtocol !== 2 || base.readyAfter !== expected.readyAfter || base.workWindow.start !== expected.workStart || base.workWindow.end !== expected.workEnd) throw new ReviewedDigestError("日报来源须绑定基础快照的完整洛杉矶统计周期");
  if (Date.parse(input.moduleShares.observedAt) > now.getTime()
    || period.end >= new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(new Date(input.moduleShares.observedAt))) throw new ReviewedDigestError("模块来源时间无效或统计日尚未结束");
  for (const side of [input.moduleShares.current, input.moduleShares.previous]) {
    if (side.all !== null && [side.modelDetail, side.prompts].some(value => value !== null && value > side.all!)) throw new ReviewedDigestError("模块访客不能超过同口径全站访客");
  }
  if (input.dashboardEvidence?.moduleShares && canonical(input.dashboardEvidence.moduleShares) !== canonical(input.moduleShares)) throw new ReviewedDigestError("模块来源证据不一致");
  if (input.dashboardEvidence && Date.parse(input.dashboardEvidence.observedAt) > now.getTime()) throw new ReviewedDigestError("来源采集时间不能在未来");
  const comparisons = (rows: NonNullable<typeof input.dashboardEvidence>["sites"] | NonNullable<typeof input.dashboardEvidence>["countries"]) =>
    dashboardComparisonGroups(rows, period, input.dashboardEvidence!.gscComparable).map(row => ({ ...row, metrics: row.metrics.map(metric => ({ ...metric,
      period: `${shift(period.start)}—${shift(period.end)} → ${period.start}—${period.end}`,
    })) }));
  const dashboard = { ...base.dashboard, detailText: base.dashboard?.detailText ?? base.detailText ?? base.text, attributionText: base.dashboard?.attributionText ?? "", sourceEvidenceSha256: input.sourceEvidenceSha256,
    moduleShares: input.moduleShares,
    ...(input.dashboardEvidence ? { traffic: { sites: comparisons(input.dashboardEvidence.sites), countries: comparisons(input.dashboardEvidence.countries),
      modules: input.dashboardEvidence.modules, gscComparable: input.dashboardEvidence.gscComparable } } : {}),
  };
  const key = reviewedTextHash(canonical(["daily-dashboard-v1", base.id, input.sourceEvidenceSha256, input.moduleShares, input.dashboardEvidence]));
  const currentTemplate = base.reportTemplateVersion !== undefined && base.reportTemplateVersion >= 9;
  const moduleShareSnapshot: ReportModuleShareSnapshot = { version: 1, period: { start: period.start, end: period.end },
    comparisonPeriod: { start: shift(period.start), end: shift(period.end) }, timezone: "America/Los_Angeles", sourceReportId: base.id, sourceEvidenceSha256: input.sourceEvidenceSha256, values: input.moduleShares };
  const replaceShares = (text: string) => {
    const escaped = reportModuleShareLines(base.moduleShareSnapshot?.values).map(line => line.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"));
    const before = new RegExp(escaped.join("\\s*"), "u"), after = reportModuleShareLines(input.moduleShares).join("  \n");
    if (!before.test(text)) throw new ReviewedDigestError("日报模块正文与原来源快照不一致，须先核对原版本");
    return text.replace(before, after);
  };
  const reviseBody = (text: string) => {
    const shares = replaceShares(text);
    if (!input.dashboardEvidence) return shares;
    try { return replaceDailyTrafficSection(shares, input.dashboardEvidence, period.end); }
    catch (error) { throw new ReviewedDigestError(error instanceof Error ? error.message : "日报流量正文来源不一致"); }
  };
  const text = currentTemplate ? reviseBody(base.text) : base.text, detailText = currentTemplate ? reviseBody(base.detailText) : base.detailText;
  if (currentTemplate) dashboard.detailText = reviseBody(dashboard.detailText);
  return { ...base, id: `seo-digest:${input.date}:${key.slice(0, 16)}`, generatedAt: now.toISOString(), dashboard,
    ...(currentTemplate ? { moduleShareSnapshot, text, detailText, hash: reviewedTextHash(text) } : {}),
    dailyDashboardBody: { version: 1, recordOnly: true, baseReportId: base.id, baseReportHash: base.hash,
      baseGeneratedAt: base.generatedAt, sourceEvidenceSha256: input.sourceEvidenceSha256 },
  };
}

export function sameDailyDashboardDigest(stored: DailyDashboardSeoDigest, expected: DailyDashboardSeoDigest) {
  const { generatedAt: _storedTime, dashboard: a, ...storedFields } = stored;
  const { generatedAt: _expectedTime, dashboard: b, ...expectedFields } = expected;
  return !stored.draftBody && !stored.reviewedBody && sameReportDashboard(a, b)
    && reviewedTextHash(stored.text) === stored.hash && canonical(storedFields) === canonical(expectedFields);
}
