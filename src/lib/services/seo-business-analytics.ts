import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { businessAnalyticsId, businessAnalyticsSchema, recentMatureCohortPeriods, type BusinessAnalytics } from "../seo-business-analytics";
import { cohortDay } from "../seo-api-cohorts";
import { shiftDay } from "../seo-date-range";

export async function saveBusinessAnalytics(input: unknown) {
  const row = businessAnalyticsSchema.parse(input), id = businessAnalyticsId(row);
  await prisma.seoReportVersion.createMany({ data: { id, siteDomain: row.siteDomain, kind: "GA4_BUSINESS", periodStart: new Date(row.start), periodEnd: new Date(row.end), createdAt: new Date(row.observedAt), payload: row as Prisma.InputJsonValue }, skipDuplicates: true });
  const saved = await prisma.seoReportVersion.findUniqueOrThrow({ where: { id }, select: { payload: true } });
  const readback = businessAnalyticsSchema.parse(saved.payload);
  if (businessAnalyticsId(readback) !== id) throw Error("business_readback_failed");
  return { stored: true, id, record: readback };
}

export async function loadBusinessAnalytics(start: string, end: string): Promise<BusinessAnalytics[]> {
  const rows = await prisma.seoReportVersion.findMany({ where: { siteDomain: "flatkey.ai", kind: "GA4_BUSINESS", periodStart: { gte: new Date(start), lte: new Date(end) }, periodEnd: { lte: new Date(end) } }, orderBy: { createdAt: "desc" }, take: 1000, select: { payload: true } });
  return rows.flatMap(({ payload }) => { const parsed = businessAnalyticsSchema.safeParse(payload); return parsed.success ? [parsed.data] : []; });
}

export async function loadRecentMatureCohortPeriods(country: BusinessAnalytics["country"], scope: BusinessAnalytics["scope"], now = new Date()) {
  const today = cohortDay(now);
  return recentMatureCohortPeriods(await loadBusinessAnalytics(shiftDay(today, -50), shiftDay(today, -1)), country, scope);
}
