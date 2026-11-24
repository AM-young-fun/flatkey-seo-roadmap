import { prisma } from "@/lib/prisma";
import { isDatabaseConfigured } from "@/lib/env";
import { buildConversionProjection, unavailableConversionProjection, type ConversionScope } from "@/lib/seo-conversion";

/** Reads saved authorized evidence only. No Google client, account API,
 * instrumentation, payment mutation, importer, polling or task creation. */
export async function loadConversionProjection(scope: ConversionScope, now = new Date()) {
  if (!isDatabaseConfigured()) return unavailableConversionProjection(scope, now, "尚未接入可只读的转化证据存档；未把缺源当0");
  const rows = await prisma.seoReportVersion.findMany({
    where: { siteDomain: scope.site, kind: { in: ["SEO_CONVERSION_EVIDENCE", "GA4_BUSINESS"] }, periodStart: new Date(scope.start), periodEnd: new Date(scope.end) },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 100, select: { id: true, kind: true, createdAt: true, payload: true },
  });
  const projection = buildConversionProjection(scope, rows.filter(row => row.kind === "SEO_CONVERSION_EVIDENCE").map(row => ({ reference: `archive:${row.id}`, payload: row.payload })), now);
  if (!projection.sourceEvidence.length && rows.some(row => row.kind === "GA4_BUSINESS")) {
    projection.readiness.reasons.push("已保存GA4行为/顺序漏斗，但其会话归因、注册资格、首次账户注册和全历史收款证明未满足新cohort口径，未转作最终付费率");
    projection.sourceEvidence = rows.filter(row => row.kind === "GA4_BUSINESS").slice(0, 5).map(row => ({ reference: `archive:${row.id}`, observedAt: row.createdAt.toISOString() }));
  }
  return projection;
}
