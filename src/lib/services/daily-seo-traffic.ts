import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { ImportRequestError } from "@/lib/ranking-import";
import { buildDailySeoTrafficHistory, type DailySeoTrafficObservation, type DailySeoTrafficPayload, type DailySeoTrafficQuery } from "@/lib/daily-seo-traffic";

function canonicalPayload(payload: DailySeoTrafficPayload) {
  return { ...payload, requestId: undefined, sources: [...new Set(payload.sources)].sort(), points: [...payload.points].sort((a, b) => a.date.localeCompare(b.date)) };
}

export async function importDailySeoTraffic(payload: DailySeoTrafficPayload) {
  const payloadHash = createHash("sha256").update(JSON.stringify(canonicalPayload(payload))).digest("hex");
  const replay = (row: { requestId: string; payloadHash: string; importedAt: Date; pointCount: number }) => {
    if (row.payloadHash !== payloadHash) throw new ImportRequestError("requestId 已被不同的日流量内容使用", 409);
    return { kind: "daily-seo-traffic" as const, requestId: row.requestId, imported: row.pointCount, duplicate: true, importedAt: row.importedAt.toISOString() };
  };
  const existing = await prisma.dailySeoTrafficImport.findUnique({ where: { requestId: payload.requestId } });
  if (existing) return replay(existing);
  return prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`daily-seo-traffic:${payload.siteDomain}`}))`;
    const duplicate = await tx.dailySeoTrafficImport.findUnique({ where: { requestId: payload.requestId } });
    if (duplicate) return replay(duplicate);
    const site = await tx.seoSite.findUnique({ where: { domain: payload.siteDomain } });
    if (!site?.active) throw new ImportRequestError("目标网站未启用", 400);
    if (site.ga4PropertyId && site.ga4PropertyId !== payload.ga4PropertyId) throw new ImportRequestError("GA4 属性与网站不匹配", 400);
    const { points, kind: _kind, ...metadata } = payload;
    const saved = await tx.dailySeoTrafficImport.create({ data: {
      ...metadata, sources: [...new Set(payload.sources)].sort(), collectedAt: new Date(payload.collectedAt),
      payloadHash, pointCount: points.length,
      points: { create: points.map(point => ({ ...point, date: new Date(`${point.date}T00:00:00Z`) })) },
    } });
    return { kind: "daily-seo-traffic" as const, requestId: saved.requestId, imported: saved.pointCount, duplicate: false, importedAt: saved.importedAt.toISOString() };
  });
}

export async function loadDailySeoTrafficHistory(query: DailySeoTrafficQuery) {
  const { start, end, ...cohort } = query;
  const observations = await prisma.dailySeoTrafficPoint.findMany({
    where: { date: { gte: new Date(`${start}T00:00:00Z`), lte: new Date(`${end}T00:00:00Z`) }, importBatch: cohort },
    include: { importBatch: true },
    orderBy: [{ importBatch: { collectedAt: "desc" } }, { importBatch: { importedAt: "desc" } }],
  });
  return buildDailySeoTrafficHistory(query, observations as DailySeoTrafficObservation[]);
}
