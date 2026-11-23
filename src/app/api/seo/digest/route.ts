import { loadRegistrationPeriods } from "@/lib/services/seo-registration-period";
import { withRequestReads } from "@/lib/request-read-scope";
import { profileRead, timedRead } from "@/lib/read-profile";
import { registrationCorrection } from "@/lib/seo-registration-correction";
import { readdir, readFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { z } from "zod";
import { GA4_HOST_SCOPE } from "@/lib/ga4-host-scope";
import { authenticateImportToken } from "@/lib/services/import-tokens";
import { analyticsLocalPreview, authorizeAnalyticsRead, privateAnalyticsHeaders as headers } from "@/lib/seo-analytics-access";
import { reportDay, digestDateSchema, digestKindSchema, digestWindow, type SeoDigest } from "@/lib/seo-digest";
import { shiftDay, weeklyReportDate } from "@/lib/seo-date-range";
import { flatkeyRegistrationCount, weeklyBusinessDigestLines } from "@/lib/seo-business-analytics";
import { githubDigestLines } from "@/lib/seo-github-channel";
import { loadGithubChannels } from "@/lib/services/seo-github-channel";
import { loadBusinessAnalytics } from "@/lib/services/seo-business-analytics";
import { accountRegistrationSummary } from "@/lib/seo-account-registrations";
import { loadAccountRegistrationSummary } from "@/lib/services/seo-account-registrations";
import { beginDigestAttempt, claimDigest, DigestError, finishDigestAttempt, generateSeoDigest, loadDigestWorkPlan, loadRecentDigestPages, saveSeoDigest } from "@/lib/services/seo-digest";
import { confirmKnownDigestRejection, DigestRecoveryError } from "@/lib/services/seo-digest-recovery";
import { webhookReceiptSchema } from "@/lib/seo-webhook-receipt";
import { prisma } from "@/lib/prisma";
import { reviewedDigestCommandSchema, ReviewedDigestError } from "@/lib/seo-reviewed-digest";
import { saveReviewedSeoDigest } from "@/lib/services/seo-reviewed-digest";
import { draftDigestCommandSchema } from "@/lib/seo-draft-digest";
import { saveDraftSeoDigest } from "@/lib/services/seo-draft-digest";
import { dailyDashboardCommandSchema } from "@/lib/seo-daily-dashboard";
import { saveDailyDashboardSeoDigest } from "@/lib/services/seo-daily-dashboard";

export const dynamic = "force-dynamic";
const auth = async (request: Request) => !request.headers.get("origin") && await authenticateImportToken(request);
const reportId = z.string().regex(/^seo-digest:\d{4}-\d{2}-\d{2}:[a-f0-9]{16}$/);
async function reportView(date: string, kind: "daily" | "weekly") {
  const [workPlan, currentWorkPlan, recentPages] = await Promise.allSettled([
    loadDigestWorkPlan(date, kind),
    kind === "weekly" ? loadDigestWorkPlan(date, "daily") : Promise.resolve(undefined),
    loadRecentDigestPages(date, kind),
  ]);
  return {
    ...(workPlan.status === "fulfilled" && workPlan.value ? { workPlan: workPlan.value } : {}),
    ...(currentWorkPlan.status === "fulfilled" && currentWorkPlan.value ? { currentWorkPlan: currentWorkPlan.value } : {}),
    ...(recentPages.status === "fulfilled" ? { recentPages: recentPages.value } : {}),
  };
}
const mutation = z.discriminatedUnion("action", [
  reviewedDigestCommandSchema,
  draftDigestCommandSchema,
  dailyDashboardCommandSchema,
  z.object({ action: z.literal("confirm_provider_rejection"), incidentId: z.literal("2026-11-11-dingtalk-1001") }).strict(),
  z.object({ action: z.literal("read_saved"), reportId }).strict(),
  z.object({ action: z.literal("delivery_status"), id: z.string().regex(/^seo-digest-delivery:(daily|weekly):\d{4}-\d{2}-\d{2}(?::revision)?$/) }).strict(),
  z.object({ action: z.literal("prepare"), date: digestDateSchema, kind: digestKindSchema.default("daily") }).strict(),
  z.object({ action: z.literal("claim"), reportId: z.string().min(1).max(200), owner: z.string().min(1).max(200), transport: z.enum(["application-bot", "signed-webhook"]).optional(), messageFormat: z.literal("actionCard").optional(), revision: z.literal(true).optional() }).strict(),
  z.object({ action: z.literal("begin"), id: z.string().min(1).max(200), owner: z.string().min(1).max(200), fencingToken: z.number().int().positive(), transport: z.enum(["application-bot", "signed-webhook"]).optional() }).strict(),
  z.object({ action: z.literal("finish"), reportId: z.string().min(1).max(200), reportHash: z.string().regex(/^[a-f0-9]{64}$/), destination: z.string().min(1).max(200), robotCode: z.string().min(1).max(200), id: z.string().min(1).max(200), owner: z.string().min(1).max(200), fencingToken: z.number().int().positive(), status: z.enum(["DELIVERED", "UNKNOWN"]), processQueryKey: z.string().min(1).max(2000).optional(), webhookReceipt: webhookReceiptSchema.optional(), errorCode: z.string().max(1000).optional() }).strict(),
]);
function errorResponse(error: unknown) {
  return Response.json({ message: error instanceof DigestError || error instanceof DigestRecoveryError || error instanceof ReviewedDigestError ? error.message : error instanceof z.ZodError ? "日报周报参数无效" : "无法完成报告操作" }, { status: error instanceof DigestError || error instanceof DigestRecoveryError || error instanceof ReviewedDigestError ? error.status : error instanceof z.ZodError || error instanceof SyntaxError ? 400 : 503, headers });
}
export async function GET(request: Request) {
  const result = await withRequestReads(() => profileRead(() => readDigest(request)));
  result.value.headers.set("Server-Timing", [...result.phases.map(phase => `${phase.phase};dur=${phase.durationMs}`), `digest;dur=${result.durationMs}`].join(", "));
  return result.value;
}
async function readDigest(request: Request) {
  if (!await auth(request) && !await authorizeAnalyticsRead(request)) return Response.json({ message: "请先登录" }, { status: 401, headers });
  try {
    const params = new URL(request.url).searchParams;
    const archive = params.get("saved") === "1" && params.get("archive") === "1";
    const rawDate = params.get("date");
    const date = rawDate === null && archive ? null : digestDateSchema.parse(rawDate ?? reportDay());
    const kind = digestKindSchema.parse(params.get("kind") ?? "daily");
    if (date && kind === "weekly" && weeklyReportDate(date) !== date) return Response.json({ message: "周报日期须为北京时间周四整理日或周五修订日；旧期仅支持周五" }, { status: 400, headers });
    if (params.get("saved") === "1") {
      const explicitId = params.get("reportId");
      if (explicitId) reportId.parse(explicitId);
      const requestedDate = date ?? explicitId?.split(":")[1] ?? null;
      const preview = process.env.SEO_DIGEST_PREVIEW_DIR;
      if (preview && isAbsolute(preview) && analyticsLocalPreview(request)) {
        const suffix = `.${kind}.json`;
        const dates = archive ? (await readdir(preview))
          .filter(name => name.endsWith(suffix))
          .map(name => name.slice(0, -suffix.length))
          .filter(value => digestDateSchema.safeParse(value).success)
          .sort().reverse() : undefined;
        const selected = requestedDate ?? dates?.[0];
        const saved = selected ? await readFile(join(preview, `${selected}.${kind}.json`), "utf8").catch((error: NodeJS.ErrnoException) => {
          if (error.code === "ENOENT") return null;
          throw error;
        }) : null;
        const local = saved ? JSON.parse(saved) : null;
        const report = local?.report;
        return Response.json({ report: report && report.date === selected && report.kind === kind && (!explicitId || explicitId === report.id) ? report : null, dates, ...(!explicitId && local?.view ? { view: local.view } : {}) }, { headers });
      }
      const scope = { kind: "SEO_DIGEST", siteDomain: "flatkey.ai", payload: { path: ["kind"], equals: kind } };
      const dates = archive ? (await prisma.seoReportVersion.groupBy({
        by: ["periodStart"],
        where: scope,
        orderBy: { periodStart: "desc" },
      })).map(row => row.periodStart.toISOString().slice(0, 10)) : undefined;
      const selected = requestedDate ?? dates?.[0];
      if (!selected) return Response.json({ report: null, dates }, { headers });
      const delivery = explicitId ? null : await prisma.seoDigestDelivery.findUnique({
        where: { id: `seo-digest-delivery:${kind}:${selected}` }, select: { status: true, reportId: true },
      });
      // The date view shows the latest archived refresh. An explicit reportId still opens the exact sent snapshot.
      const exact = explicitId ?? (!archive && delivery?.status === "DELIVERED" ? delivery.reportId : null);
      const saved = await prisma.seoReportVersion.findFirst({
        where: { ...scope, periodStart: new Date(selected), ...(exact ? { id: exact } : {}),
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        select: { payload: true },
      });
      const report = saved?.payload as unknown as SeoDigest | undefined;
      // Latest details may show current task status and the month ranking. The saved
      // report body, ID and hash stay intact; explicit reportId never gets live data.
      const view = archive && report && !explicitId ? await timedRead("report-view", () => reportView(selected, kind)) : undefined;
      const currentDaily = !explicitId && kind === "daily" && selected === reportDay() && params.get("currentPreview") === "1";
      if (currentDaily && !report?.dashboard) {
        const fresh = await generateSeoDigest(selected).catch(() => null);
        if (fresh) return Response.json({ report: fresh, dates }, { headers });
      }
      if (archive && report && !explicitId && !report.reviewedBody && !report.draftBody && !report.dashboard) {
        const { trafficStart, trafficEnd } = digestWindow(selected, kind);
        const offset = kind === "weekly" ? -7 : -1;
        const previousStart = shiftDay(trafficStart, offset);
        const accountRange = { start: trafficStart, end: trafficEnd };
        const [observations, recentPages, workPlan, github, accountRegistrations] = await Promise.all([
          loadBusinessAnalytics(previousStart, trafficEnd).catch(() => []),
          loadRecentDigestPages(selected, kind).catch(() => report.recentPages),
          (kind === "weekly" && selected === reportDay()) || !report.workPlan
            ? loadDigestWorkPlan(selected, kind).catch(() => report.workPlan) : Promise.resolve(report.workPlan),
          loadGithubChannels(shiftDay(trafficStart, -7), trafficEnd).catch(() => []),
          loadAccountRegistrationSummary(accountRange).catch(() => report.accountRegistrations ?? accountRegistrationSummary(accountRange)),
        ]);
        const collected = flatkeyRegistrationCount(observations, trafficStart, trafficEnd);
        const flatkeyRegistrations = collected.users !== null ? collected : report.flatkeyRegistrations ?? collected;
        const registrationPeriods = await loadRegistrationPeriods(previousStart, trafficEnd);
        const githubSection = github.length ? githubDigestLines(github, trafficStart, trafficEnd, kind === "weekly", new Date()) : undefined;
        const businessSection = kind === "weekly" && observations.some(row => row.start === trafficStart && row.country === "all" && row.hostScope === GA4_HOST_SCOPE && row.rows.length)
          ? weeklyBusinessDigestLines(observations, trafficStart, trafficEnd) : undefined;
        return Response.json({ report: registrationCorrection({ ...report, flatkeyRegistrations, accountRegistrations, recentPages, workPlan, githubSection, businessSection }, registrationPeriods), dates, view }, { headers });
      }
      return Response.json({ report: report ?? null, dates, view }, { headers });
    }
    return Response.json({ report: await generateSeoDigest(date ?? reportDay(), new Date(), kind) }, { headers });
  } catch (error) { return errorResponse(error); }
}
export async function POST(request: Request) {
  if (!await auth(request)) return Response.json({ message: "需要服务器采集凭据" }, { status: 401, headers });
  try {
    const text = await request.text();
    if (text.length > 16000) return Response.json({ message: "请求过大" }, { status: 413, headers });
    const raw = JSON.parse(text);
    if (text.length > 8000 && !["save_draft", "save_daily_dashboard"].includes(raw?.action)) return Response.json({ message: "请求过大" }, { status: 413, headers });
    const input = mutation.parse(raw);
    if (input.action === "save_reviewed") return Response.json({ report: await saveReviewedSeoDigest(input) }, { headers });
    if (input.action === "save_draft") return Response.json({ report: await saveDraftSeoDigest(input) }, { headers });
    if (input.action === "save_daily_dashboard") return Response.json({ report: await saveDailyDashboardSeoDigest(input) }, { headers });
    if (input.action === "confirm_provider_rejection") return Response.json(await confirmKnownDigestRejection(input.incidentId), { headers });
    if (input.action === "read_saved") {
      const saved = await prisma.seoReportVersion.findUnique({ where: { id: input.reportId } });
      if (!saved || saved.kind !== "SEO_DIGEST") throw new DigestError("报告快照不存在", 404);
      return Response.json({ report: saved.payload }, { headers });
    }
    if (input.action === "delivery_status") return Response.json({ delivery: await prisma.seoDigestDelivery.findUnique({ where: { id: input.id } }) }, { headers });
    if (input.action === "prepare") {
      if (input.kind === "weekly" && weeklyReportDate(input.date) !== input.date) return Response.json({ message: "周报日期须为北京时间周四整理日或周五修订日；旧期仅支持周五" }, { status: 400, headers });
      return Response.json({ report: await saveSeoDigest(await generateSeoDigest(input.date, new Date(), input.kind)) }, { headers });
    }
    if (input.action === "claim") return Response.json(await claimDigest(input.reportId, input.owner, new Date(), input.transport, input.messageFormat, input.revision), { headers });
    if (input.action === "begin") return Response.json(await beginDigestAttempt(input.id, input.owner, input.fencingToken, input.transport), { headers });
    return Response.json(await finishDigestAttempt(input), { headers });
  } catch (error) { return errorResponse(error); }
}
