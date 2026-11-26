import "server-only";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { beijingDay, digestClaimable, SEO_REPORT_GROUP, SEO_REPORT_WEBHOOK_ROBOT } from "@/lib/seo-digest";
import { claimCurrentDailyDigest, currentDailyReportArchiveOnly, DigestError, validateCurrentDailyArchive } from "./seo-digest";
import { getSeoReportingControl } from "./seo-reporting-control";

export type DailySendStatus = { state: "ready" | "pending" | "sent" | "unknown" | "unavailable"; message?: string };

const deliveryId = (date: string) => `seo-digest-delivery:daily:${date}`;
const dispatchUrl = "https://api.github.com/repos/AM-young-fun/flatkey-seo-roadmap/actions/workflows/seo-report-manual-send.yml/dispatches";
const missingTransport = "钉钉手动发送凭据尚未接入";

async function dispatchToken() {
  const token = process.env.SEO_DINGTALK_DISPATCH_TOKEN?.trim();
  if (!token) throw new DigestError(missingTransport, 503);
  const control = await getSeoReportingControl();
  if (!control.enabled || control.transport !== "signed-webhook" || control.destination !== SEO_REPORT_GROUP
    || control.robotCode !== SEO_REPORT_WEBHOOK_ROBOT || !control.webhookConfigSha256) {
    throw new DigestError("原钉钉群发送渠道暂不可用", 503);
  }
  return token;
}

export async function readDailySendStatus(reportId: string, reportHash: string, now = new Date()): Promise<DailySendStatus> {
  const date = beijingDay(now);
  if (currentDailyReportArchiveOnly(date, now)) return { state: "unavailable", message: "今天的日报只归档" };
  try { await validateCurrentDailyArchive(reportId, reportHash, now); }
  catch (error) {
    if (error instanceof DigestError) return { state: "unavailable", message: error.message };
    throw error;
  }
  const delivery = await prisma.seoDigestDelivery.findUnique({ where: { id: deliveryId(date) },
    select: { status: true, attemptedAt: true, leaseUntil: true, errorCode: true } });
  if (delivery?.status === "DELIVERED") return { state: "sent" };
  if (delivery && !digestClaimable(delivery, now)) {
    const attemptOverdue = delivery.status === "SENDING" && delivery.attemptedAt && now.getTime() - delivery.attemptedAt.getTime() > 120_000;
    return delivery.status === "UNKNOWN" || attemptOverdue
      ? { state: "unknown", message: "钉钉送达结果待核对" }
      : { state: "pending", message: "正在发送日报" };
  }
  try { await dispatchToken(); }
  catch (error) {
    if (error instanceof DigestError) return { state: "unavailable", message: error.message };
    throw error;
  }
  return { state: "ready", ...(delivery?.errorCode ? { message: "上次发送未开始，可以重试" } : {}) };
}

export async function dispatchDailySend(reportId: string, reportHash: string, now = new Date()): Promise<DailySendStatus> {
  const token = await dispatchToken();
  const owner = `web-daily-${randomUUID()}`;
  const claim = await claimCurrentDailyDigest(reportId, reportHash, owner, now);
  let response: Response;
  try {
    response = await fetch(dispatchUrl, {
      method: "POST", redirect: "error", cache: "no-store", signal: AbortSignal.timeout(12_000),
      headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${token}`,
        "Content-Type": "application/json", "X-GitHub-Api-Version": "2022-11-28" },
      body: JSON.stringify({ ref: "main", inputs: { report_id: reportId, owner, fencing_token: String(claim.fencingToken) } }),
    });
  } catch {
    // A lost response may follow an accepted dispatch. Leave the fenced claim for that run.
    return { state: "pending", message: "正在核对发送请求" };
  }
  const status = response.status;
  await response.body?.cancel().catch(() => {});
  if (response.ok) return { state: "pending", message: "正在发送日报" };
  if (status >= 400 && status < 500 && status !== 408) {
    await prisma.seoDigestDelivery.updateMany({ where: { id: claim.id, claimedBy: owner, fencingToken: claim.fencingToken, status: "CLAIMED", attemptedAt: null },
      data: { leaseUntil: new Date(), errorCode: `manual_dispatch_http_${status}` } });
    const accessFailure = status === 401 || status === 403 || status === 404 || status === 422;
    throw new DigestError(accessFailure ? "钉钉手动发送工作流不可用" : "发送请求未被接收，请稍后重试", 503);
  }
  return { state: "pending", message: "正在核对发送请求" };
}
