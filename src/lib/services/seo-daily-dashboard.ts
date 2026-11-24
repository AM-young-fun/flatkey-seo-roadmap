import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { SeoDigest } from "../seo-digest";
import { buildDailyDashboardSeoDigest, dailyDashboardCommandSchema, sameDailyDashboardDigest, type DailyDashboardSeoDigest } from "../seo-daily-dashboard";
import { ReviewedDigestError } from "../seo-reviewed-digest";

export async function saveDailyDashboardSeoDigest(raw: unknown, now = new Date()) {
  const input = dailyDashboardCommandSchema.parse(raw);
  const base = await prisma.seoReportVersion.findUnique({ where: { id: input.baseReportId } });
  if (!base || base.kind !== "SEO_DIGEST" || base.siteDomain !== "flatkey.ai"
    || base.periodStart.toISOString().slice(0, 10) !== input.date || base.periodEnd.toISOString().slice(0, 10) !== input.date) throw new ReviewedDigestError("基础日报快照不存在", 404);
  const report = buildDailyDashboardSeoDigest(base.payload as unknown as SeoDigest, input, now);
  // An exact replay may read its original immutable version even after a later
  // revision. A new revision must preserve the latest source-bearing base.
  const replay = await prisma.seoReportVersion.findUnique({ where: { id: report.id } });
  if (!replay) {
    const latest = await prisma.seoReportVersion.findFirst({ where: { kind: "SEO_DIGEST", siteDomain: "flatkey.ai",
      periodStart: new Date(input.date), payload: { path: ["dailyDashboardBody", "recordOnly"], equals: true } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: { id: true },
    });
    if (latest && latest.id !== base.id) throw new ReviewedDigestError("日报已有更新来源快照；须重读最新来源版本后差分补数", 409);
  }
  await prisma.seoReportVersion.createMany({ data: { id: report.id, siteDomain: "flatkey.ai", kind: "SEO_DIGEST",
    periodStart: new Date(report.date), periodEnd: new Date(report.date), createdAt: new Date(report.generatedAt),
    payload: JSON.parse(JSON.stringify(report)) as Prisma.InputJsonValue }, skipDuplicates: true });
  const stored = await prisma.seoReportVersion.findUnique({ where: { id: report.id } });
  const saved = stored?.payload as unknown as DailyDashboardSeoDigest | undefined;
  if (!stored || stored.kind !== "SEO_DIGEST" || stored.siteDomain !== "flatkey.ai"
    || stored.periodStart.toISOString().slice(0, 10) !== input.date || stored.periodEnd.toISOString().slice(0, 10) !== input.date
    || !saved || !sameDailyDashboardDigest(saved, report)) throw new ReviewedDigestError("日报不可变版本冲突", 409);
  return saved;
}
