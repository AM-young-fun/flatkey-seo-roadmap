import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { accountRegistrationSnapshotSchema, accountRegistrationStorageKind, accountRegistrationSummary } from "../seo-account-registrations";
import type { DateRange } from "../seo-date-range";

const snapshotId = (record: ReturnType<typeof accountRegistrationSnapshotSchema.parse>) =>
  "flatkey-account-registrations:" + createHash("sha256").update(JSON.stringify(record)).digest("hex");

export async function saveAccountRegistrationSnapshot(input: unknown) {
  const record = accountRegistrationSnapshotSchema.parse(input);
  record.days.sort((a, b) => a.date.localeCompare(b.date));
  const id = snapshotId(record);
  await prisma.seoReportVersion.createMany({
    data: {
      id, siteDomain: "flatkey.ai", kind: accountRegistrationStorageKind, createdAt: new Date(record.observedAt),
      periodStart: new Date(record.days[0].date), periodEnd: new Date(record.days.at(-1)!.date), payload: record as Prisma.InputJsonValue,
    },
    skipDuplicates: true,
  });
  const saved = await prisma.seoReportVersion.findUniqueOrThrow({ where: { id }, select: { payload: true } });
  const readback = accountRegistrationSnapshotSchema.parse(saved.payload);
  if (snapshotId(readback) !== id) throw new Error("account_registration_readback_failed");
  return { id, stored: true, record: readback };
}

export async function loadAccountRegistrationSummary(range: DateRange) {
  const snapshots = await prisma.seoReportVersion.findMany({
    where: {
      kind: accountRegistrationStorageKind, siteDomain: "flatkey.ai",
      periodStart: { lte: new Date(range.end) }, periodEnd: { gte: new Date(range.start) },
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { payload: true },
  });
  const rows = snapshots.flatMap(({ payload }) => {
    const parsed = accountRegistrationSnapshotSchema.safeParse(payload);
    return parsed.success ? [parsed.data] : [];
  });
  return accountRegistrationSummary(range, rows);
}
