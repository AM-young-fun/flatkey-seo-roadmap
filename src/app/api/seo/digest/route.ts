import { withRequestReads } from "@/lib/request-read-scope";
import { profileRead, timedRead } from "@/lib/read-profile";
import { readdir, readFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { z } from "zod";
import { authenticateImportToken } from "@/lib/services/import-tokens";
import { analyticsLocalPreview, authorizeAnalyticsRead, privateAnalyticsHeaders as headers } from "@/lib/seo-analytics-access";
import { reportDay, beijingDay, DAILY_BUSINESS_DATE_SWITCH, digestDateSchema, digestKindSchema, type SeoDigest } from "@/lib/seo-digest";
import { weeklyReportDate } from "@/lib/seo-date-range";
import { beginDigestAttempt, claimDigest, DigestError, finishDigestAttempt, generateSeoDigest, saveSeoDigest } from "@/lib/services/seo-digest";
import { confirmKnownDigestRejection, DigestRecoveryError } from "@/lib/services/seo-digest-recovery";
import { webhookReceiptSchema } from "@/lib/seo-webhook-receipt";
import { prisma } from "@/lib/prisma";
import { authorizeWorkflow } from "@/lib/seo-workflow-http";
import { loadWeeklySupplementForDate } from "@/lib/services/seo-weekly-supplement";
import { reviewedDigestCommandSchema, ReviewedDigestError } from "@/lib/seo-reviewed-digest";
import { saveReviewedSeoDigest } from "@/lib/services/seo-reviewed-digest";
import { draftDigestCommandSchema } from "@/lib/seo-draft-digest";
import { saveDraftSeoDigest } from "@/lib/services/seo-draft-digest";
import { dailyDashboardCommandSchema } from "@/lib/seo-daily-dashboard";
import { saveDailyDashboardSeoDigest } from "@/lib/services/seo-daily-dashboard";

export const dynamic = "force-dynamic";
const auth = async (request: Request) => !request.headers.get("origin") && await authenticateImportToken(request);
const reportId = z.string().regex(/^seo-digest:\d{4}-\d{2}-\d{2}:[a-f0-9]{16}$/);
const archivePageSize = 10;
const archivePageSchema = z.string().regex(/^[1-9]\d*$/).transform(Number).pipe(z.number().int().positive().max(214748364));
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
  z.object({ action: z.literal("begin_daily_manual"), id: z.string().regex(/^seo-digest-delivery:daily:\d{4}-\d{2}-\d{2}$/),
    owner: z.string().regex(/^web-daily-[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/), fencingToken: z.number().int().positive(),
    reportId, reportHash: z.string().regex(/^[a-f0-9]{64}$/), payloadSha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict(),
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
    const rawArchivePage = params.get("archivePage");
    if (rawArchivePage !== null && (!archive || params.getAll("archivePage").length !== 1)) {
      return Response.json({ message: "归档页码仅用于已保存报告列表" }, { status: 400, headers });
    }
    const archivePage = rawArchivePage === null ? null : archivePageSchema.parse(rawArchivePage);
    const archiveOffset = archivePage === null ? 0 : (archivePage - 1) * archivePageSize;
    const archiveMetadata = (archiveHasNext: boolean) => archivePage === null ? {} : { archivePage, archiveHasNext };
    const rawDate = params.get("date");
    const kind = digestKindSchema.parse(params.get("kind") ?? "daily");
    const defaultDate = kind === "daily" && beijingDay() >= DAILY_BUSINESS_DATE_SWITCH ? beijingDay() : reportDay();
    const date = rawDate === null && archive ? null : digestDateSchema.parse(rawDate ?? defaultDate);
    if (date && kind === "weekly" && weeklyReportDate(date) !== date) return Response.json({ message: "周报日期须为北京时间周四整理日或周五修订日；旧期仅支持周五" }, { status: 400, headers });
    if (params.get("saved") === "1") {
      const explicitId = params.get("reportId");
      if (explicitId) reportId.parse(explicitId);
      const requestedDate = date ?? explicitId?.split(":")[1] ?? null;
      const preview = process.env.SEO_DIGEST_PREVIEW_DIR;
      if (preview && isAbsolute(preview) && analyticsLocalPreview(request)) {
        const suffix = `.${kind}.json`;
        const allDates = archive ? (await readdir(preview))
          .filter(name => name.endsWith(suffix))
          .map(name => name.slice(0, -suffix.length))
          .filter(value => digestDateSchema.safeParse(value).success)
          .sort().reverse() : undefined;
        const dates = archivePage === null ? allDates : allDates?.slice(archiveOffset, archiveOffset + archivePageSize);
        const selected = requestedDate ?? allDates?.[0];
        const saved = selected ? await readFile(join(preview, `${selected}.${kind}.json`), "utf8").catch((error: NodeJS.ErrnoException) => {
          if (error.code === "ENOENT") return null;
          throw error;
        }) : null;
        const local = saved ? JSON.parse(saved) : null;
        const report = local?.report;
        return Response.json({ report: report && report.date === selected && report.kind === kind && (!explicitId || explicitId === report.id) ? report : null,
          dates, ...archiveMetadata((allDates?.length ?? 0) > archiveOffset + archivePageSize) }, { headers });
      }
      const scope = { kind: "SEO_DIGEST", siteDomain: "flatkey.ai", payload: { path: ["kind"], equals: kind } };
      const sourceDashboardScope = { ...scope, AND: [{ payload: { path: ["dailyDashboardBody", "recordOnly"], equals: true } }] };
      const dateRows = archive ? await timedRead("archive-dates", () => prisma.seoReportVersion.groupBy({
        by: ["periodStart"],
        where: scope,
        orderBy: { periodStart: "desc" },
        ...(archivePage === null ? {} : { skip: archiveOffset, take: archivePageSize }),
      })) : undefined;
      const dateKey = (day: Date) => day.toISOString().slice(0, 10);
      const dates = dateRows?.map(row => dateKey(row.periodStart));
      const last = dateRows?.at(-1)?.periodStart;
      const [older, latest, latestSourceDashboard] = await Promise.all([
        archivePage !== null && dateRows?.length === archivePageSize && last
          ? prisma.seoReportVersion.findFirst({ where: { ...scope, periodStart: { lt: last } }, select: { periodStart: true } }) : null,
        archiveOffset > 0 && !requestedDate
          ? prisma.seoReportVersion.findFirst({ where: scope, orderBy: { periodStart: "desc" }, select: { periodStart: true } }) : null,
        archivePage !== null && kind === "daily" && !requestedDate
          ? prisma.seoReportVersion.findFirst({ where: sourceDashboardScope,
            orderBy: [{ periodStart: "desc" }, { createdAt: "desc" }, { id: "desc" }], select: { periodStart: true, payload: true } }) : null,
      ]);
      const latestDate = archiveOffset > 0 ? latest && dateKey(latest.periodStart) : dates?.[0];
      const sourceDate = latestSourceDashboard && dateKey(latestSourceDashboard.periodStart);
      const selected = requestedDate ?? sourceDate ?? latestDate;
      const selection = { dates, ...archiveMetadata(Boolean(older)),
        ...(sourceDate && latestDate && latestDate > sourceDate ? { pendingArchiveDate: latestDate } : {}) };
      if (!selected) return Response.json({ report: null, ...selection }, { headers });
      if (latestSourceDashboard) return Response.json({ report: latestSourceDashboard.payload, ...selection }, { headers });
      const delivery = explicitId || archive ? null : await prisma.seoDigestDelivery.findUnique({
        where: { id: `seo-digest-delivery:${kind}:${selected}` }, select: { status: true, reportId: true },
      });
      // The date view shows the latest archived refresh. An explicit reportId still opens the exact sent snapshot.
      const exact = explicitId ?? (!archive && delivery?.status === "DELIVERED" ? delivery.reportId : null);
      const saved = await timedRead("report-snapshot", async () => {
        const query = { where: { ...scope, periodStart: new Date(selected), ...(exact ? { id: exact } : {}) },
          orderBy: [{ createdAt: "desc" as const }, { id: "desc" as const }], select: { payload: true as const } };
        // A racing or legacy generic preparation cannot obscure a previously
        // saved source dashboard. Explicit IDs still select their exact version.
        const dashboard = !exact && kind === "daily" ? await prisma.seoReportVersion.findFirst({ ...query,
          where: { ...query.where, AND: sourceDashboardScope.AND },
        }) : null;
        return dashboard ?? prisma.seoReportVersion.findFirst(query);
      });
      const report = saved?.payload as unknown as SeoDigest | undefined;
      // Saved date views and explicit IDs consume the same frozen payload.
      // Current execution status belongs to the original work pages.
      const weeklySections = report && kind === "weekly" && params.get("supplement") === "1" && await authorizeAnalyticsRead(request)
        ? await timedRead("weekly-supplement", async () => {
          const access = await authorizeWorkflow(request);
          const editable = access.actor === "human";
          const [weeklySupplement, weeklyAttribution] = await Promise.all([
            loadWeeklySupplementForDate(report.date, access.localPreview).then(supplement => ({ supplement, editable })).catch(() => undefined),
            explicitId ? undefined : loadWeeklySupplementForDate(report.date, access.localPreview, "attribution").then(supplement => ({ supplement, editable })).catch(() => undefined),
          ]);
          return { weeklySupplement, weeklyAttribution };
        }).catch(() => undefined) : undefined;
      return Response.json({ report: report ?? null, ...selection, ...weeklySections }, { headers });
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
    if (input.action === "begin_daily_manual") return Response.json(await beginDigestAttempt(input.id, input.owner, input.fencingToken, "signed-webhook",
      { reportId: input.reportId, reportHash: input.reportHash, payloadSha256: input.payloadSha256 }), { headers });
    return Response.json(await finishDigestAttempt(input), { headers });
  } catch (error) { return errorResponse(error); }
}
