import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { registrationDaySeries, registrationDaysKind, registrationDaysSchema, type RegistrationDays } from "../seo-registration-days";
import type { DateRange } from "../seo-date-range";

export async function saveRegistrationDays(input: unknown) {
  const record = registrationDaysSchema.parse(input);
  const id = "ga4-registration-days:" + createHash("sha256").update(JSON.stringify(record)).digest("hex");
  await prisma.seoReportVersion.createMany({
    data: { id, siteDomain: record.siteDomain, kind: registrationDaysKind, periodStart: new Date(record.start),
      periodEnd: new Date(record.end), createdAt: new Date(record.observedAt), payload: record as Prisma.InputJsonValue },
    skipDuplicates: true,
  });
  const stored = await prisma.seoReportVersion.findUniqueOrThrow({ where: { id }, select: { payload: true } });
  return { id, stored: true, record: registrationDaysSchema.parse(stored.payload) };
}

export async function loadRegistrationDays(range: DateRange, country: RegistrationDays["country"]) {
  const rows = await prisma.seoReportVersion.findMany({
    where: {
      siteDomain: "flatkey.ai", kind: registrationDaysKind, periodStart: { lte: new Date(range.end) },
      periodEnd: { gte: new Date(range.start) }, payload: { path: ["country"], equals: country },
    },
    select: { payload: true },
  });
  return registrationDaySeries(range, rows.flatMap(({ payload }) => {
    const parsed = registrationDaysSchema.safeParse(payload);
    return parsed.success ? [parsed.data] : [];
  }));
}
