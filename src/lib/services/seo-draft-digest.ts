import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { SeoDigest } from "../seo-digest";
import { buildDraftSeoDigest, draftDigestCommandSchema, sameDraftDigest } from "../seo-draft-digest";
import { ReviewedDigestError } from "../seo-reviewed-digest";

export async function saveDraftSeoDigest(raw: unknown, now = new Date()) {
  const input = draftDigestCommandSchema.parse(raw);
  const base = await prisma.seoReportVersion.findUnique({ where: { id: input.baseReportId } });
  if (!base || base.kind !== "SEO_DIGEST" || base.siteDomain !== "flatkey.ai"
    || base.periodStart.toISOString().slice(0, 10) !== input.date || base.periodEnd.toISOString().slice(0, 10) !== input.date) throw new ReviewedDigestError("基础周报快照不存在", 404);
  const report = buildDraftSeoDigest(base.payload as unknown as SeoDigest, input, now);
  await prisma.seoReportVersion.createMany({ data: { id: report.id, siteDomain: "flatkey.ai", kind: "SEO_DIGEST",
    periodStart: new Date(report.date), periodEnd: new Date(report.date), createdAt: new Date(report.generatedAt),
    payload: JSON.parse(JSON.stringify(report)) as Prisma.InputJsonValue }, skipDuplicates: true });
  const stored = await prisma.seoReportVersion.findUnique({ where: { id: report.id } });
  const saved = stored?.payload as unknown as SeoDigest | undefined;
  if (!stored || stored.kind !== "SEO_DIGEST" || stored.siteDomain !== "flatkey.ai"
    || stored.periodStart.toISOString().slice(0, 10) !== input.date || stored.periodEnd.toISOString().slice(0, 10) !== input.date
    || !saved || !sameDraftDigest(saved, report)) throw new ReviewedDigestError("待审报告不可变版本冲突", 409);
  return saved;
}
