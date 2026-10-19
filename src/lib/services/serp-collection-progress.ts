import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { SerpCollectionProgress } from "@/lib/serp-collection-progress";

/** One metadata query. It never reads provider receipts or starts collection. */
export async function loadSerpCollectionProgress(site = "all"): Promise<SerpCollectionProgress | null> {
  const rows = await prisma.$queryRaw<Array<{
    runId: string; periodLabel: string; status: string; totalQueries: number; startedAt: Date; completedAt: Date | null;
    completedQueries: number; plannedQueries: number; waitingQueries: number; processingQueries: number; failedQueries: number;
    totalKeywords: number; completedKeywords: number;
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
    ) SELECT r.id AS "runId", r."periodLabel", r.status, r."queryCount" AS "totalQueries", r."startedAt", r."completedAt",
      COALESCE(SUM(w.completed),0)::integer AS "completedQueries", COALESCE(SUM(w.planned),0)::integer AS "plannedQueries",
      COALESCE(SUM(w.waiting),0)::integer AS "waitingQueries", COALESCE(SUM(w.processing),0)::integer AS "processingQueries",
      COALESCE(SUM(w.failed),0)::integer AS "failedQueries", COUNT(w.keyword)::integer AS "totalKeywords",
      COUNT(w.keyword) FILTER (WHERE w.countries = 4 AND w.completed = w.total)::integer AS "completedKeywords"
    FROM latest_run r LEFT JOIN words w ON true GROUP BY r.id, r."periodLabel", r.status, r."queryCount", r."startedAt", r."completedAt"
  `);
  const row = rows[0];
  return row ? { ...row, submittedQueries: row.totalQueries - row.plannedQueries,
    startedAt: row.startedAt.toISOString(), completedAt: row.completedAt?.toISOString() ?? null, checkedAt: new Date().toISOString() } : null;
}
