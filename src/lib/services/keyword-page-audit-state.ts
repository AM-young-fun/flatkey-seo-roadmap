import { prisma } from "@/lib/prisma";
import { readPageAuditVerdict } from "@/lib/keyword-monitoring";
import { PAGE_AUDIT_SOURCE_ID, type PageAuditVerdict } from "@/lib/page-audit";

export type LatestPageAudit = { verdict: PageAuditVerdict; reason: string | null; checkedAt: string | null };
export async function loadLatestPageAudits(keywordIds: string[]): Promise<Map<string, LatestPageAudit>> {
  const ids = [...new Set(keywordIds)];
  if (!ids.length) return new Map();
  const wanted = new Set(ids);
  const rows = await prisma.keywordSourceRow.findMany({ where: { siteDomain: "flatkey.ai", sourceId: PAGE_AUDIT_SOURCE_ID,
    rowKey: { in: ids.map(id => `keyword:${id}`) } }, select: { rowKey: true, snapshot: true } });
  const result = new Map<string, LatestPageAudit>();
  for (const row of rows) {
    const id = row.rowKey.startsWith("keyword:") ? row.rowKey.slice("keyword:".length) : "";
    if (!wanted.has(id)) continue;
    const snapshot = row.snapshot && typeof row.snapshot === "object" && !Array.isArray(row.snapshot) ? row.snapshot as Record<string, unknown> : {};
    const wrongIdentity = snapshot.keywordId !== undefined && snapshot.keywordId !== id;
    result.set(id, { verdict: wrongIdentity ? "REVIEW" : readPageAuditVerdict(snapshot),
      reason: typeof snapshot.reason === "string" ? snapshot.reason : null,
      checkedAt: typeof snapshot.checkedAt === "string" && Number.isFinite(Date.parse(snapshot.checkedAt)) ? new Date(snapshot.checkedAt).toISOString() : null });
  }
  return result;
}
