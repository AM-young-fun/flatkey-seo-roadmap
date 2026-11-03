import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { ImportRequestError } from "@/lib/ranking-import";
import { buildDailySeoPageGroupsHistory, type DailySeoPageGroupsPayload, type DailySeoPageGroupsQuery, type DailySeoPageGroupObservation } from "@/lib/daily-seo-page-groups";
const unique = (sources: string[]) => [...new Set(sources)].sort();
function canonicalPayload(payload: DailySeoPageGroupsPayload) {
  return { ...payload, requestId: undefined, sources: unique(payload.sources), groups: [...payload.groups].sort((a, b) => a.key.localeCompare(b.key)).map(group => ({ ...group,
    points: [...group.points].sort((a, b) => a.date.localeCompare(b.date)).map(point => ({ ...point, sources: point.sources ? unique(point.sources) : undefined,
      funnel: point.funnel ? { ...point.funnel, sources: unique(point.funnel.sources) } : null })) })) };
}
export async function importDailySeoPageGroups(payload: DailySeoPageGroupsPayload) {
  const payloadHash = createHash("sha256").update(JSON.stringify(canonicalPayload(payload))).digest("hex");
  const replay = (row: { requestId: string; payloadHash: string; pointCount: number; importedAt: Date }) => {
    if (row.payloadHash !== payloadHash) throw new ImportRequestError("requestId 已被不同页面组日数据使用", 409);
    return { kind: "daily-seo-page-groups" as const, requestId: row.requestId, imported: row.pointCount, duplicate: true, importedAt: row.importedAt.toISOString() };
  };
  const existing = await prisma.dailySeoPageGroupImport.findUnique({ where: { requestId: payload.requestId } });
  if (existing) return replay(existing);
  return prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`daily-seo-page-groups:${payload.siteDomain}`}))`;
    const existing = await tx.dailySeoPageGroupImport.findUnique({ where: { requestId: payload.requestId } });
    if (existing) return replay(existing);
    const site = await tx.seoSite.findUnique({ where: { domain: payload.siteDomain } });
    if (!site?.active || site.ga4PropertyId && site.ga4PropertyId !== payload.ga4PropertyId) throw new ImportRequestError("网站未启用或 GA4 属性与网站不匹配", 400);
    const { groups, kind: _kind, ...metadata } = payload;
    const points = groups.flatMap(group => group.points.map(point => ({ groupKey: group.key, date: new Date(`${point.date}T00:00:00Z`),
      totalUsers: point.totalUsers, pageViews: point.pageViews, trafficCollectedAt: new Date(point.collectedAt ?? payload.collectedAt), trafficSources: unique(point.sources ?? payload.sources),
      funnelEntrants: point.funnel?.entrants ?? null, funnelRegistrations: point.funnel?.registrations ?? null,
      funnelCollectedAt: point.funnel ? new Date(point.funnel.collectedAt) : null, funnelSources: point.funnel ? unique(point.funnel.sources) : [], missingReason: point.missingReason } )));
    const saved = await tx.dailySeoPageGroupImport.create({ data: { ...metadata, sources: unique(payload.sources), collectedAt: new Date(payload.collectedAt),
      payloadHash, pointCount: points.length, points: { create: points } } });
    return { kind: "daily-seo-page-groups" as const, requestId: saved.requestId, imported: saved.pointCount, duplicate: false, importedAt: saved.importedAt.toISOString() };
  });
}
export async function loadDailySeoPageGroupsHistory(query: DailySeoPageGroupsQuery) {
  const { start, end, ...cohort } = query;
  const observations = await prisma.dailySeoPageGroupPoint.findMany({ where: {
    date: { gte: new Date(`${start}T00:00:00Z`), lte: new Date(`${end}T00:00:00Z`) }, importBatch: cohort,
  }, include: { importBatch: true } });
  return buildDailySeoPageGroupsHistory(query, observations as DailySeoPageGroupObservation[]);
}
