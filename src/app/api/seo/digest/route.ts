import { readdir, readFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { z } from "zod";
import { authenticateImportToken } from "@/lib/services/import-tokens";
import { analyticsLocalPreview, authorizeAnalyticsRead, privateAnalyticsHeaders as headers } from "@/lib/seo-analytics-access";
import { beijingDay, digestDateSchema, digestKindSchema, digestWindow, type SeoDigest } from "@/lib/seo-digest";
import { flatkeyRegistrationCount } from "@/lib/seo-business-analytics";
import { loadBusinessAnalytics } from "@/lib/services/seo-business-analytics";
import { beginDigestAttempt, claimDigest, DigestError, finishDigestAttempt, generateSeoDigest, saveSeoDigest } from "@/lib/services/seo-digest";
import { confirmKnownDigestRejection, DigestRecoveryError } from "@/lib/services/seo-digest-recovery";
import { webhookReceiptSchema } from "@/lib/seo-webhook-receipt";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
const auth = async (request: Request) => !request.headers.get("origin") && await authenticateImportToken(request);
const reportId = z.string().regex(/^seo-digest:\d{4}-\d{2}-\d{2}:[a-f0-9]{16}$/);
const mutation = z.discriminatedUnion("action", [
  z.object({ action: z.literal("confirm_provider_rejection"), incidentId: z.literal("2026-11-11-dingtalk-1001") }).strict(),
  z.object({ action: z.literal("read_saved"), reportId }).strict(),
  z.object({ action: z.literal("delivery_status"), id: z.string().regex(/^seo-digest-delivery:(daily|weekly):\d{4}-\d{2}-\d{2}$/) }).strict(),
  z.object({ action: z.literal("prepare"), date: digestDateSchema, kind: digestKindSchema.default("daily") }).strict(),
  z.object({ action: z.literal("claim"), reportId: z.string().min(1).max(200), owner: z.string().min(1).max(200), transport: z.enum(["application-bot", "signed-webhook"]).optional(), messageFormat: z.literal("actionCard").optional() }).strict(),
  z.object({ action: z.literal("begin"), id: z.string().min(1).max(200), owner: z.string().min(1).max(200), fencingToken: z.number().int().positive(), transport: z.enum(["application-bot", "signed-webhook"]).optional() }).strict(),
  z.object({ action: z.literal("finish"), reportId: z.string().min(1).max(200), reportHash: z.string().regex(/^[a-f0-9]{64}$/), destination: z.string().min(1).max(200), robotCode: z.string().min(1).max(200), id: z.string().min(1).max(200), owner: z.string().min(1).max(200), fencingToken: z.number().int().positive(), status: z.enum(["DELIVERED", "UNKNOWN"]), processQueryKey: z.string().min(1).max(2000).optional(), webhookReceipt: webhookReceiptSchema.optional(), errorCode: z.string().max(1000).optional() }).strict(),
]);
function errorResponse(error: unknown) {
  return Response.json({ message: error instanceof DigestError || error instanceof DigestRecoveryError ? error.message : error instanceof z.ZodError ? "日报周报参数无效" : "无法完成报告操作" }, { status: error instanceof DigestError || error instanceof DigestRecoveryError ? error.status : error instanceof z.ZodError || error instanceof SyntaxError ? 400 : 503, headers });
}
export async function GET(request: Request) {
  if (!await auth(request) && !await authorizeAnalyticsRead(request)) return Response.json({ message: "请先登录" }, { status: 401, headers });
  try {
    const params = new URL(request.url).searchParams;
    const archive = params.get("saved") === "1" && params.get("archive") === "1";
    const rawDate = params.get("date");
    const date = rawDate === null && archive ? null : digestDateSchema.parse(rawDate ?? beijingDay());
    const kind = digestKindSchema.parse(params.get("kind") ?? "daily");
    if (date && kind === "weekly" && new Date(date + "T00:00:00Z").getUTCDay() !== 5) return Response.json({ message: "周报日期必须是北京时间周五" }, { status: 400, headers });
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
        const report = saved ? JSON.parse(saved).report : null;
        return Response.json({ report: report && report.date === selected && report.kind === kind && (!explicitId || explicitId === report.id) ? report : null, dates }, { headers });
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
      const exact = explicitId ?? (delivery?.status === "DELIVERED" ? delivery.reportId : null);
      const saved = await prisma.seoReportVersion.findFirst({
        where: { ...scope, periodStart: new Date(selected), ...(exact ? { id: exact } : {}),
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        select: { payload: true },
      });
      const report = saved?.payload as unknown as SeoDigest | undefined;
      if (archive && report && report.flatkeyRegistrations?.users == null) {
        const { trafficStart, trafficEnd } = digestWindow(selected, kind);
        const observations = await loadBusinessAnalytics(trafficStart, trafficEnd).catch(() => []);
        return Response.json({ report: { ...report, flatkeyRegistrations: flatkeyRegistrationCount(observations, trafficStart, trafficEnd) }, dates }, { headers });
      }
      return Response.json({ report: report ?? null, dates }, { headers });
    }
    return Response.json({ report: await generateSeoDigest(date ?? beijingDay(), new Date(), kind) }, { headers });
  } catch (error) { return errorResponse(error); }
}
export async function POST(request: Request) {
  if (!await auth(request)) return Response.json({ message: "需要服务器采集凭据" }, { status: 401, headers });
  try {
    const text = await request.text();
    if (text.length > 8000) return Response.json({ message: "请求过大" }, { status: 413, headers });
    const input = mutation.parse(JSON.parse(text));
    if (input.action === "confirm_provider_rejection") return Response.json(await confirmKnownDigestRejection(input.incidentId), { headers });
    if (input.action === "read_saved") {
      const saved = await prisma.seoReportVersion.findUnique({ where: { id: input.reportId } });
      if (!saved || saved.kind !== "SEO_DIGEST") throw new DigestError("报告快照不存在", 404);
      return Response.json({ report: saved.payload }, { headers });
    }
    if (input.action === "delivery_status") return Response.json({ delivery: await prisma.seoDigestDelivery.findUnique({ where: { id: input.id } }) }, { headers });
    if (input.action === "prepare") {
      if (input.kind === "weekly" && new Date(input.date + "T00:00:00Z").getUTCDay() !== 5) return Response.json({ message: "周报日期必须是北京时间周五" }, { status: 400, headers });
      return Response.json({ report: await saveSeoDigest(await generateSeoDigest(input.date, new Date(), input.kind)) }, { headers });
    }
    if (input.action === "claim") return Response.json(await claimDigest(input.reportId, input.owner, new Date(), input.transport, input.messageFormat), { headers });
    if (input.action === "begin") return Response.json(await beginDigestAttempt(input.id, input.owner, input.fencingToken, input.transport), { headers });
    return Response.json(await finishDigestAttempt(input), { headers });
  } catch (error) { return errorResponse(error); }
}
