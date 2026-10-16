import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { SearchRegionCode } from "@/lib/seo";
import { buildSerpKeywordResults, SERP_MARKET_LANGUAGE, SERP_SOURCE, summarizeSerpMovements, summarizeSerpResults, type SerpResultsResponse, type SerpTaskRead, type SerpTrendCohort } from "@/lib/serp-results";
import { loadSerpTargetCohort } from "@/lib/services/serp-targets";
import type { SerpTarget } from "@/lib/serp-targets";
import { serpPeriod } from "@/lib/serp-periods";

export async function loadSerpTrendCohorts(region: SearchRegionCode, start: string, end: string, languageCode = SERP_MARKET_LANGUAGE[region], device = "desktop"): Promise<SerpTrendCohort[]> {
  const rows = await prisma.$queryRaw<Array<{ runId: string; periodKey: string; cohortJson: unknown }>>(Prisma.sql`
    /* serp-monitor:trend-cohorts */
    SELECT id AS "runId", "periodKey", "cohortJson" FROM "SerpMonitorRun"
    WHERE "configJson"->>'region' = ${region} AND "configJson"->>'languageCode' = ${languageCode}
      AND "configJson"->>'device' = ${device} AND "configJson"->>'depth' = '100'
      AND "periodStart" <= ${end}::date AND "periodEnd" >= ${start}::date
    ORDER BY "periodKey"
  `);
  return rows.map(row => {
    const targets = new Map<string, SerpTarget>();
    for (const value of Array.isArray(row.cohortJson) ? row.cohortJson : []) {
      if (!value || typeof value !== "object" || Array.isArray(value)) continue;
      const target = value as Record<string, unknown>;
      if (typeof target.keywordId !== "string" || typeof target.keyword !== "string" || typeof target.siteDomain !== "string" ||
        !["flatkey.ai", "rackrate.org", "modelfit.cc"].includes(target.siteDomain)) continue;
      targets.set(`${target.siteDomain}:${target.keywordId}`, { keywordId: target.keywordId, keyword: target.keyword, siteDomain: target.siteDomain,
        targetUrls: Array.isArray(target.targetUrls) ? target.targetUrls.filter((url): url is string => typeof url === "string") : [] });
    }
    // Do not run today's activation/relevance policy against an immutable past
    // cohort. Later additions, exclusions and deletes must not rewrite totals.
    return { runId: row.runId, periodKey: row.periodKey, targets: [...targets.values()] };
  });
}

export async function loadSerpTasks(region: SearchRegionCode, languageCode = SERP_MARKET_LANGUAGE[region], device = "desktop", start?: string, end?: string): Promise<SerpTaskRead[]> {
  const historical = Boolean(start || end);
  return prisma.$queryRaw<SerpTaskRead[]>(Prisma.sql`
    /* serp-monitor:results */
    WITH market_tasks AS (
      SELECT t.id, t."runId", t.keyword, t."targetsJson", t.state, t."normalizedJson", t."checkedAt",
        t."providerTaskId", t."errorCode", t."updatedAt", r."createdAt" AS "runCreatedAt",
        r."periodKey", r."periodLabel", r."periodStart", r."periodEnd"
      FROM "SerpMonitorTask" t JOIN "SerpMonitorRun" r ON r.id = t."runId"
      WHERE r."configJson"->>'region' = ${region}
        AND r."configJson"->>'languageCode' = ${languageCode}
        AND r."configJson"->>'device' = ${device}
        AND r."configJson"->>'depth' = '100'
        AND (${!end} OR (t."checkedAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Shanghai')::date <= ${end ?? "9999-12-31"}::date
          OR (t."checkedAt" IS NULL AND r."periodStart" <= ${end ?? "9999-12-31"}::date))
    ), expanded_tasks AS (
      SELECT t.*, target->>'siteDomain' AS "targetSite", target->>'keywordId' AS "targetKeyword",
        (t."checkedAt" IS NOT NULL AND (
          (t.state = 'COMPLETE' AND t."normalizedJson"->>'completeDepth' = 'true' AND COALESCE(t."normalizedJson"->>'rankingVerified','true') = 'true') OR
          (t.state = 'INCOMPLETE' AND t."normalizedJson"->>'rankingVerified' = 'true' AND EXISTS (
            SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(t."normalizedJson"->'organicResults') = 'array' THEN t."normalizedJson"->'organicResults' ELSE '[]'::jsonb END) item
            WHERE item->>'domain' = target->>'siteDomain' OR item->>'domain' LIKE '%.' || (target->>'siteDomain')
          ))
        )) AS verified
      FROM market_tasks t CROSS JOIN LATERAL jsonb_array_elements(
        CASE WHEN jsonb_typeof(t."targetsJson") = 'array' THEN t."targetsJson" ELSE '[]'::jsonb END
      ) target
    ), ranked_tasks AS (
      SELECT t.*, ROW_NUMBER() OVER w AS n,
        SUM(CASE WHEN verified THEN 1 ELSE 0 END) OVER w AS "verifiedN",
        SUM(CASE WHEN verified AND (t."checkedAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Shanghai')::date < ${start ?? "1970-01-01"}::date THEN 1 ELSE 0 END) OVER w AS "priorN"
      FROM expanded_tasks t WINDOW w AS (PARTITION BY "targetSite", "targetKeyword" ORDER BY "periodKey" DESC, "runCreatedAt" DESC, "updatedAt" DESC, id DESC ROWS UNBOUNDED PRECEDING)
    ), selected_tasks AS (
      SELECT DISTINCT id FROM ranked_tasks WHERE
        (${historical} AND (("checkedAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Shanghai')::date >= ${start ?? "1970-01-01"}::date
          OR ("checkedAt" IS NULL AND "periodEnd" >= ${start ?? "1970-01-01"}::date) OR (verified AND "priorN" <= 2))) OR
        (${!historical} AND (n = 1 OR (verified AND "verifiedN" <= 2)))
    )
    SELECT t.id, t."runId", t.keyword, t."targetsJson", t.state, t."checkedAt", t."providerTaskId", t."errorCode", t."runCreatedAt", t."updatedAt",
      t."periodKey", t."periodLabel", t."periodStart", t."periodEnd",
      CASE WHEN t."normalizedJson" IS NOT NULL THEN jsonb_build_object(
        'completeDepth', t."normalizedJson"->'completeDepth', 'rankingVerified', t."normalizedJson"->'rankingVerified', 'maxOrganicRank', t."normalizedJson"->'maxOrganicRank',
        'checkedAt', t."normalizedJson"->'checkedAt', 'googleUrl', t."normalizedJson"->'googleUrl',
        'organicResults', COALESCE((SELECT jsonb_agg(item) FROM jsonb_array_elements(
          CASE WHEN jsonb_typeof(t."normalizedJson"->'organicResults') = 'array' THEN t."normalizedJson"->'organicResults' ELSE '[]'::jsonb END
        ) item WHERE item->>'domain' IN ('flatkey.ai','rackrate.org','modelfit.cc') OR
          item->>'domain' LIKE '%.flatkey.ai' OR item->>'domain' LIKE '%.rackrate.org' OR item->>'domain' LIKE '%.modelfit.cc'), '[]'::jsonb)
      ) END AS "normalizedJson"
    FROM market_tasks t JOIN selected_tasks selected ON selected.id = t.id
    ORDER BY t."runCreatedAt" DESC, t."updatedAt" DESC, t.id DESC
  `);
}

// Reads only our persisted SERP ledger. Opening a page never contacts a paid
// provider, creates a run or treats a Labs/GSC/Ahrefs record as a SERP check.
export async function loadSerpResults(site = "all", region: SearchRegionCode = "US", languageCode = SERP_MARKET_LANGUAGE[region], device = "desktop",
  existingCohort?: { targets: SerpTarget[]; hash: string }): Promise<SerpResultsResponse> {
  const cohort = existingCohort ?? await loadSerpTargetCohort(site);
  const tasks = cohort.targets.length ? await loadSerpTasks(region, languageCode, device) : [];
  const items = buildSerpKeywordResults(cohort.targets, tasks);
  const completeDates = items.filter(item => item.status === "RANKED" || item.status === "OUTSIDE_TOP100").flatMap(item => item.checkedAt ? [item.checkedAt] : []);
  return { schemaVersion: 1, source: SERP_SOURCE, site, region, languageCode, device, depth: 100, cohortHash: cohort.hash,
    summary: summarizeSerpResults(items), items, latestCompletedAt: completeDates.sort().at(-1) ?? null,
    currentPeriod: serpPeriod(), movementSummary: summarizeSerpMovements(items) };
}
