import "server-only";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { SEO_REPORT_GROUP, SEO_REPORT_ROBOT } from "../seo-digest";

const KIND = "REPORTING_CONTROL";
const SITE = "flatkey.ai";
const versionSchema = z.number().int().nonnegative().max(999999999999);
const actorSchema = z.enum(["import-token", "admin-session"]);
export const seoReportingCommandSchema = z.object({
  enabled: z.boolean(), expectedVersion: versionSchema,
  protocolVersion: z.literal(2), destination: z.literal(SEO_REPORT_GROUP),
  robotCode: z.literal(SEO_REPORT_ROBOT), reason: z.string().trim().min(1).max(500),
}).strict();
const storedSchema = seoReportingCommandSchema.omit({ expectedVersion: true }).extend({
  version: versionSchema.refine(value => value > 0), actor: actorSchema, updatedAt: z.iso.datetime(),
}).strict();
type StoredControl = z.infer<typeof storedSchema>;
export type SeoReportingControl = Omit<StoredControl, "actor" | "updatedAt"> & {
  actor: StoredControl["actor"] | null; updatedAt: string | null;
};
export class SeoReportingControlError extends Error {
  constructor(public code: string, message: string, public status = 409) { super(message); }
}
const idFor = (version: number) => `reporting-control:v${String(version).padStart(12, "0")}`;
type Reader = Pick<Prisma.TransactionClient, "seoReportVersion">;
async function readControl(db: Reader): Promise<SeoReportingControl> {
  // IDs have fixed-width monotonic versions; wall clocks cannot roll the switch back.
  const row = await db.seoReportVersion.findFirst({ where: { kind: KIND, siteDomain: SITE }, orderBy: { id: "desc" }, select: { id: true, payload: true } });
  if (!row) return { enabled: false, protocolVersion: 2, destination: SEO_REPORT_GROUP, robotCode: SEO_REPORT_ROBOT, version: 0, reason: "尚未验收启用", actor: null, updatedAt: null };
  const parsed = storedSchema.safeParse(row.payload);
  if (!parsed.success || row.id !== idFor(parsed.data.version)) throw new SeoReportingControlError("invalid_stored_control", "通知开关版本不可验证", 503);
  return parsed.data;
}
export async function getSeoReportingControl(): Promise<SeoReportingControl> {
  return readControl(prisma);
}
export async function setSeoReportingControl(input: unknown, actor: z.infer<typeof actorSchema>, now = new Date()) {
  const command = seoReportingCommandSchema.parse(input);
  actorSchema.parse(actor);
  try {
    return await prisma.$transaction(async tx => {
      const current = await readControl(tx);
      if (command.expectedVersion !== current.version) throw new SeoReportingControlError("version_conflict", "通知开关已变更，请刷新后重试");
      if (current.version === 999999999999) throw new SeoReportingControlError("version_exhausted", "通知开关版本超出范围", 503);
      const { expectedVersion: _expectedVersion, ...settings } = command;
      void _expectedVersion;
      const next = storedSchema.parse({ ...settings, version: current.version + 1, actor, updatedAt: now.toISOString() });
      // Append-only audit + unique version ID is a database CAS across all nodes.
      // Concurrent writers using the same expectedVersion cannot both succeed.
      await tx.seoReportVersion.create({ data: { id: idFor(next.version), kind: KIND, siteDomain: SITE, periodStart: now, periodEnd: now, createdAt: now, payload: next as Prisma.InputJsonValue } });
      return { control: next, storage: "database" as const };
    });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "P2002") throw new SeoReportingControlError("version_conflict", "通知开关已变更，请刷新后重试");
    throw error;
  }
}
