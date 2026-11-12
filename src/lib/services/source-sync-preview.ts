import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { normalizeKeywordText } from "@/lib/keyword-relevance";
import type { SourceSyncPayload } from "@/lib/source-sync";

const epoch = z.number().finite().nullable();
const snapshotSchema = z.object({
  siteActive: z.boolean(),
  sourceRows: z.array(z.object({ rowKey: z.string(), snapshotHash: z.string(), snapshot: z.unknown(), observedAtMs: epoch })),
  keywords: z.array(z.object({ id: z.string(), text: z.string(), active: z.boolean() })),
  links: z.array(z.object({ keywordId: z.string(), active: z.boolean(), pool: z.string(), reviewStatus: z.string(),
    curationId: z.string().nullable(), curatedAtMs: epoch, targetUrls: z.array(z.string()), candidateUrls: z.array(z.string()),
    mappingStatus: z.string(), topicId: z.string().nullable(), protected: z.boolean() })),
});

// All four inputs come from one PostgreSQL statement snapshot. Preview never
// waits on the writer's advisory lock or keeps an interactive transaction open.
// Apply still locks and recomputes the plan; the preview is not a write permit.
export async function readSourceSyncPreview(payload: SourceSyncPayload) {
  const rowKeys = payload.rows.map(row => row.rowKey.normalize("NFKC").trim());
  const rows = await prisma.$queryRaw<unknown[]>`
    SELECT
      COALESCE((SELECT "active" FROM "SeoSite" WHERE "domain" = 'flatkey.ai'), false) AS "siteActive",
      COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'rowKey', "rowKey", 'snapshotHash', "snapshotHash", 'snapshot', "snapshot",
        'observedAtMs', EXTRACT(EPOCH FROM "observedAt") * 1000))
        FROM "KeywordSourceRow" WHERE "siteDomain" = 'flatkey.ai' AND "sourceId" = ${payload.sourceId}
          AND "rowKey" IN (SELECT jsonb_array_elements_text(${JSON.stringify(rowKeys)}::jsonb))), '[]'::jsonb) AS "sourceRows",
      COALESCE((SELECT jsonb_agg(jsonb_build_object('id', "id", 'text', "text", 'active', "active"))
        FROM "Keyword" WHERE ${rowKeys.length > 0}), '[]'::jsonb) AS "keywords",
      COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'keywordId', "keywordId", 'active', "active", 'pool', "pool", 'reviewStatus', "reviewStatus",
        'curationId', "curationId", 'curatedAtMs', EXTRACT(EPOCH FROM "curatedAt") * 1000,
        'targetUrls', "targetUrls", 'candidateUrls', "candidateUrls", 'mappingStatus', "mappingStatus",
        'topicId', "topicId", 'protected', "protected"))
        FROM "SiteKeyword" WHERE "siteDomain" = 'flatkey.ai' AND ${rowKeys.length > 0}), '[]'::jsonb) AS "links"
  `;
  if (rows.length !== 1) throw new Error("SOURCE_PREVIEW_SNAPSHOT_INVALID");
  const parsed = snapshotSchema.safeParse(rows[0]);
  if (!parsed.success) throw new Error("SOURCE_PREVIEW_SNAPSHOT_INVALID");
  const incoming = new Set(payload.rows.flatMap(row => row.keywords.map(word => normalizeKeywordText(word.keyword))));
  const keywords = parsed.data.keywords.filter(keyword => incoming.has(normalizeKeywordText(keyword.text)));
  const ids = new Set(keywords.map(keyword => keyword.id));
  return {
    siteActive: parsed.data.siteActive,
    priorRows: parsed.data.sourceRows.map(({ observedAtMs, ...row }) => ({ ...row, observedAt: observedAtMs === null ? null : new Date(observedAtMs) })),
    keywords,
    // Preserve the existing Prisma select order: the planner's version token
    // hashes JSON and must be identical on the later locked apply read.
    links: parsed.data.links.filter(link => ids.has(link.keywordId)).map(link => ({
      keywordId: link.keywordId, active: link.active, pool: link.pool, reviewStatus: link.reviewStatus,
      curationId: link.curationId, curatedAt: link.curatedAtMs === null ? null : new Date(link.curatedAtMs),
      targetUrls: link.targetUrls, candidateUrls: link.candidateUrls, mappingStatus: link.mappingStatus,
      topicId: link.topicId, protected: link.protected,
    })),
  };
}
