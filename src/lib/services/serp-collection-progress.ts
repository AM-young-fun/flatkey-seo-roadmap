import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { SerpCollectionProgress } from "@/lib/serp-collection-progress";

/** One metadata query. It never reads provider receipts or starts collection. */
export async function loadSerpCollectionProgress(site = "all"): Promise<SerpCollectionProgress | null> {
  const rows = await prisma.$queryRaw<Array<{
    runId: string; periodLabel: string; status: string; totalQueries: number; startedAt: Date; completedAt: Date | null;
    completedQueries: number; plannedQueries: number; waitingQueries: number; processingQueries: number; failedQueries: number;
    totalKeywords: number; completedKeywords: number;
    rankedKeywordCount: number; rankedKeywords: SerpCollectionProgress["rankedKeywords"];
  }>>(Prisma.sql`
    /* serp-monitor:collection-progress */
    WITH latest_run AS (
      SELECT r.id, r."periodLabel", r.status, r."queryCount", r."startedAt", r."completedAt"
      FROM "SerpMonitorRun" r WHERE r.scope = 'SCHEDULED' AND (${site} = 'all' OR EXISTS (
        SELECT 1 FROM jsonb_array_elements(r."cohortJson") target WHERE target->>'siteDomain' = ${site}
      )) ORDER BY r."createdAt" DESC LIMIT 1
    ), words AS (
      SELECT t.keyword, COUNT(*)::integer AS total,
        COUNT(*) FILTER (WHERE t.state = 'COMPLETE')::integer AS completed,
        COUNT(DISTINCT t.region) FILTER (WHERE t.state = 'COMPLETE')::integer AS countries,
        COUNT(*) FILTER (WHERE t.state = 'PLANNED')::integer AS planned,
        COUNT(*) FILTER (WHERE t.state IN ('QUEUED','SUBMITTING'))::integer AS waiting,
        COUNT(*) FILTER (WHERE t.state = 'RECEIVED')::integer AS processing,
        COUNT(*) FILTER (WHERE t.state IN ('FAILED','INCOMPLETE','UNKNOWN'))::integer AS failed
      FROM "SerpMonitorTask" t JOIN latest_run r ON r.id = t."runId" GROUP BY t.keyword
    ), hits AS (
      SELECT t.keyword, t.region, t."checkedAt", page->>'url' AS url,
        CASE WHEN page->>'rankGroup' ~ '^[0-9]{1,3}$' THEN (page->>'rankGroup')::integer END AS rank
      FROM "SerpMonitorTask" t JOIN latest_run r ON r.id = t."runId"
      CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(t."normalizedJson"->'organicResults') = 'array'
        THEN t."normalizedJson"->'organicResults' ELSE '[]'::jsonb END) page
      WHERE t.state = 'COMPLETE' AND t."checkedAt" IS NOT NULL
        AND t."normalizedJson"->>'captureComplete' = 'true' AND t."normalizedJson"->>'queryStatus' = 'EXACT'
        AND t."normalizedJson"->>'rankingVerified' = 'true'
        AND (page->>'domain' = 'flatkey.ai' OR page->>'domain' LIKE '%.flatkey.ai')
    ), ranked_words AS (
      SELECT DISTINCT ON (keyword) keyword, region, rank, url, "checkedAt" FROM hits WHERE rank BETWEEN 1 AND 100
      ORDER BY keyword, rank, region, url
    ) SELECT r.id AS "runId", r."periodLabel", r.status, r."queryCount" AS "totalQueries", r."startedAt", r."completedAt",
      COALESCE(SUM(w.completed),0)::integer AS "completedQueries", COALESCE(SUM(w.planned),0)::integer AS "plannedQueries",
      COALESCE(SUM(w.waiting),0)::integer AS "waitingQueries", COALESCE(SUM(w.processing),0)::integer AS "processingQueries",
      COALESCE(SUM(w.failed),0)::integer AS "failedQueries", COUNT(w.keyword)::integer AS "totalKeywords",
      COUNT(w.keyword) FILTER (WHERE w.countries = 4 AND w.completed = w.total)::integer AS "completedKeywords",
      (SELECT COUNT(*)::integer FROM ranked_words) AS "rankedKeywordCount",
      COALESCE((SELECT jsonb_agg(jsonb_build_object('keyword',p.keyword,'region',p.region,'rank',p.rank,'url',p.url,
        'checkedAt',p."checkedAt" AT TIME ZONE 'UTC') ORDER BY p.rank,p.keyword)
        FROM (SELECT * FROM ranked_words ORDER BY rank,keyword LIMIT 10) p),'[]'::jsonb) AS "rankedKeywords"
    FROM latest_run r LEFT JOIN words w ON true GROUP BY r.id, r."periodLabel", r.status, r."queryCount", r."startedAt", r."completedAt"
  `);
  const row = rows[0];
  return row ? { ...row, submittedQueries: row.totalQueries - row.plannedQueries,
    startedAt: row.startedAt.toISOString(), completedAt: row.completedAt?.toISOString() ?? null, checkedAt: new Date().toISOString() } : null;
}
