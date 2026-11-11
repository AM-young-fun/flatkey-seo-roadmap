import "server-only";
import { Prisma } from "@prisma/client";
import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { SEO_REPORT_GROUP, SEO_REPORT_ROBOT } from "../seo-digest";
// One operator-verified incident only. No caller-supplied proof can unlock another UNKNOWN delivery.
export const REJECTED_INCIDENT = Object.freeze({
  id: "2026-11-11-dingtalk-1001", deliveryId: "seo-digest-delivery:daily:2026-11-11",
  reportId: "seo-digest:2026-11-11:2b7e97020e839419", reportHash: "2b7e97020e83941952cd30e342c03ba6c1d6e19d77d221faed4a131c10ad86dd",
  fencingToken: 1, providerCode: "1001", providerTrace: "2101eeef17943921037703915e0a65", providerObservedAt: "2026-11-11T10:15:04.021Z",
  evidenceSha256: "3cb831aeba2a977240643e9134ab8a1f2b944e37df5df01e2a562f9ded73af75",
  reason: "Confirmed provider rejection: application bot not installed. User authorized reuse of the existing signed webhook and one recovery of this unchanged daily report.",
});
export class DigestRecoveryError extends Error { constructor(message: string, public status = 409) { super(message); } }
export async function confirmKnownDigestRejection(incidentId: string, now = new Date()) {
  if (incidentId !== REJECTED_INCIDENT.id) throw new DigestRecoveryError("该拒绝事件没有核验授权", 400);
  const incident = REJECTED_INCIDENT, auditId = "seo-digest-rejection:" + incident.id;
  return prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${incident.deliveryId}))`;
    const audited = await tx.seoReportVersion.findUnique({ where: { id: auditId } });
    if (audited) return { recovered: false, replay: true, auditId };
    const row = await tx.seoDigestDelivery.findUnique({ where: { id: incident.deliveryId } });
    const report = await tx.seoReportVersion.findUnique({ where: { id: incident.reportId } });
    const payload = report?.payload as { hash?: string; text?: string } | undefined;
    const at = Date.parse(incident.providerObservedAt);
    if (!row || row.status !== "UNKNOWN" || row.reportId !== incident.reportId || row.reportHash !== incident.reportHash || row.fencingToken !== incident.fencingToken || row.destination !== SEO_REPORT_GROUP || row.robotCode !== SEO_REPORT_ROBOT || row.errorCode !== "dws_nonzero_result_unknown" || !row.attemptedAt || at < row.attemptedAt.getTime() || at - row.attemptedAt.getTime() > 120000 || !payload?.text || payload.hash !== incident.reportHash || createHash("sha256").update(payload.text).digest("hex") !== incident.reportHash) throw new DigestRecoveryError("当前发送记录与已核验拒绝证据不一致，禁止恢复");
    await tx.seoReportVersion.create({ data: { id: auditId, siteDomain: "flatkey.ai", kind: "SEO_DIGEST_REJECTION", periodStart: now, periodEnd: now, createdAt: now,
      payload: { incident, actor: "authorized-import-token", confirmedAt: now.toISOString(), previous: { ...row, attemptedAt: row.attemptedAt.toISOString(), createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(), leaseUntil: row.leaseUntil?.toISOString() ?? null, deliveredAt: row.deliveredAt?.toISOString() ?? null } } as unknown as Prisma.InputJsonValue } });
    await tx.seoDigestDelivery.update({ where: { id: row.id }, data: { status: "REJECTED_CONFIRMED", attemptedAt: null, leaseUntil: null, errorCode: "confirmed_provider_rejection_1001", receipt: { auditId, incidentId } } });
    return { recovered: true, replay: false, auditId, reportId: row.reportId };
  });
}
