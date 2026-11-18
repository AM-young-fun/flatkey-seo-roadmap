import { prisma } from "@/lib/prisma";
import { registrationPeriodSchema, registrationPeriodId, type RegistrationPeriod } from "../seo-registration-period";

export async function saveRegistrationPeriod(input: unknown) {
  const record = registrationPeriodSchema.parse(input), id = registrationPeriodId(record);
  await prisma.seoReportVersion.createMany({ data: { id, siteDomain: record.siteDomain, kind: "SEO_REGISTRATION_PERIOD",
    periodStart: new Date(record.start), periodEnd: new Date(record.end), createdAt: new Date(record.observedAt), payload: record }, skipDuplicates: true });
  const stored = await prisma.seoReportVersion.findUniqueOrThrow({ where: { id } });
  const readback = registrationPeriodSchema.parse(stored.payload);
  if (registrationPeriodId(readback) !== id) throw new Error("registration_period_readback_mismatch");
  return { stored: true, id, record: readback };
}
export async function loadRegistrationPeriods(start: string, end: string): Promise<RegistrationPeriod[]> {
  const rows = await prisma.seoReportVersion.findMany({ where: { siteDomain: "flatkey.ai", kind: "SEO_REGISTRATION_PERIOD",
    periodStart: { gte: new Date(start) }, periodEnd: { lte: new Date(end) } }, orderBy: { createdAt: "desc" }, take: 2000, select: { payload: true } });
  return rows.flatMap(row => { const parsed = registrationPeriodSchema.safeParse(row.payload); return parsed.success ? [parsed.data] : []; });
}
