import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { REGION_CODES, type SearchRegionCode } from "@/lib/seo";
import { aggregateSerpRegionResults, buildSerpKeywordResults, SERP_MARKET_LANGUAGE, SERP_SOURCE, summarizeSerpMovements, summarizeSerpResults, summarizeSerpSampleResults, summarizeSerpMonitoring, withSerpMonitoringEligibility, type SerpResultsResponse, type SerpTaskRead, type SerpTrendCohort, type SerpRunScope, type SerpMonitoringReadCohort, type SerpAllRegionsResponse } from "@/lib/serp-results";
import { loadSerpTargetCohort, loadSerpMonitoringCohort } from "@/lib/services/serp-targets";
import type { SerpTarget } from "@/lib/serp-targets";
import { serpPeriod } from "@/lib/serp-periods";

export async function loadSerpTrendCohorts(region: SearchRegionCode | "all", start: string, end: string, languageCode = region === "all" ? "en" : SERP_MARKET_LANGUAGE[region], device = "desktop"): Promise<SerpTrendCohort[]> {
  const taskMarket = region === "all" ? Prisma.sql`t.region IN ('US','JP','ES','BR')
    AND COALESCE(t."requestJson"->>'language_code', r."configJson"->>'languageCode') =
      CASE t.region WHEN 'US' THEN 'en' WHEN 'JP' THEN 'ja' WHEN 'ES' THEN 'es' WHEN 'BR' THEN 'pt' END` :
    Prisma.sql`t.region = ${region} AND COALESCE(t."requestJson"->>'language_code', r."configJson"->>'languageCode') = ${languageCode}`;
  const configuredMarket = region === "all" ? Prisma.sql`(r."configJson"->'regions' ?| ARRAY['US','JP','ES','BR'] OR
    (r."configJson"->>'region' IN ('US','JP','ES','BR') AND r."configJson"->>'languageCode' =
      CASE r."configJson"->>'region' WHEN 'US' THEN 'en' WHEN 'JP' THEN 'ja' WHEN 'ES' THEN 'es' WHEN 'BR' THEN 'pt' END))` :
    Prisma.sql`(r."configJson"->'regions' @> jsonb_build_array(${region}::text) OR
      (r."configJson"->>'region' = ${region} AND r."configJson"->>'languageCode' = ${languageCode}))`;
  const rows = await prisma.$queryRaw<Array<{ runId: string; periodKey: string; cohortJson: unknown; runScope: SerpRunScope; runTargetCount: number; runCreatedAt: Date; regions?: SearchRegionCode[] }>>(Prisma.sql`
    /* serp-monitor:trend-cohorts */
    SELECT r.id AS "runId", r."periodKey", r."cohortJson", r.scope AS "runScope", r."targetCount" AS "runTargetCount", r."createdAt" AS "runCreatedAt",
      ARRAY(SELECT DISTINCT mt.region FROM "SerpMonitorTask" mt WHERE mt."runId" = r.id AND mt.region IN ('US','JP','ES','BR')
        AND COALESCE(mt."requestJson"->>'language_code', r."configJson"->>'languageCode') =
          CASE mt.region WHEN 'US' THEN 'en' WHEN 'JP' THEN 'ja' WHEN 'ES' THEN 'es' WHEN 'BR' THEN 'pt' END
        AND COALESCE(mt."requestJson"->>'device', r."configJson"->>'device') = ${device}
        AND COALESCE(mt."requestJson"->>'depth', r."configJson"->>'depth') = '100') AS regions
    FROM "SerpMonitorRun" r
    WHERE (EXISTS (
      SELECT 1 FROM "SerpMonitorTask" t WHERE t."runId" = r.id AND ${taskMarket}
        AND COALESCE(t."requestJson"->>'device', r."configJson"->>'device') = ${device}
        AND COALESCE(t."requestJson"->>'depth', r."configJson"->>'depth') = '100'
    ) OR (
      ${configuredMarket}
      AND r."configJson"->>'device' = ${device} AND r."configJson"->>'depth' = '100'
    )) AND ((r."periodStart" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Shanghai')::date <= ${end}::date OR EXISTS (
      SELECT 1 FROM "SerpMonitorTask" early WHERE early."runId" = r.id
        AND (early."checkedAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Shanghai')::date BETWEEN ${start}::date AND ${end}::date
    )) AND r."periodEnd" >= ${start}::date
    ORDER BY r."periodKey", r."createdAt"
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
    return { runId: row.runId, periodKey: row.periodKey, targets: [...targets.values()], runScope: row.runScope ?? "SCHEDULED",
      runTargetCount: row.runTargetCount, runCreatedAt: row.runCreatedAt, regions: row.regions };
  });
}

export async function loadSerpTasks(region: SearchRegionCode | "all", languageCode = region === "all" ? "en" : SERP_MARKET_LANGUAGE[region], device = "desktop", start?: string, end?: string, includeRunId?: string): Promise<SerpTaskRead[]> {
  const historical = Boolean(start || end);
  const market = region === "all" ? Prisma.sql`t.region IN ('US','JP','ES','BR') AND
    COALESCE(t."requestJson"->>'language_code', r."configJson"->>'languageCode') =
      CASE t.region WHEN 'US' THEN 'en' WHEN 'JP' THEN 'ja' WHEN 'ES' THEN 'es' WHEN 'BR' THEN 'pt' END`
    : Prisma.sql`t.region = ${region} AND COALESCE(t."requestJson"->>'language_code', r."configJson"->>'languageCode') = ${languageCode}`;
  return prisma.$queryRaw<SerpTaskRead[]>(Prisma.sql`
    /* serp-monitor:results */
    WITH market_tasks AS (
      SELECT t.id, t."runId", t.keyword, t.region, t."targetsJson", t.state, t."normalizedJson", t."checkedAt",
        t."providerTaskId", t."errorCode", t."updatedAt", r."createdAt" AS "runCreatedAt",
        r."periodKey", r."periodLabel", r."periodStart", r."periodEnd", r.scope AS "runScope", r."targetCount" AS "runTargetCount"
      FROM "SerpMonitorTask" t JOIN "SerpMonitorRun" r ON r.id = t."runId"
      WHERE ${market}
        AND COALESCE(t."requestJson"->>'device', r."configJson"->>'device') = ${device}
        AND COALESCE(t."requestJson"->>'depth', r."configJson"->>'depth') = '100'
        AND (${!end} OR t."runId" = ${includeRunId ?? ""} OR (t."checkedAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Shanghai')::date <= ${end ?? "9999-12-31"}::date
          OR (t."checkedAt" IS NULL AND r."periodStart" <= ${end ?? "9999-12-31"}::date))
    ), expanded_tasks AS (
      SELECT t.*, target->>'siteDomain' AS "targetSite", target->>'keywordId' AS "targetKeyword",
        (t."checkedAt" IS NOT NULL AND t.state IN ('COMPLETE', 'INCOMPLETE')
          AND COALESCE(t."normalizedJson"->>'queryStatus', 'EXACT') = 'EXACT'
          AND (t."normalizedJson"->>'rankingVerified' = 'true' OR
            (t.state = 'COMPLETE' AND t."normalizedJson"->>'rankingVerified' IS NULL))
          AND (t."normalizedJson"->>'completeDepth' = 'true' OR EXISTS (
            SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(t."normalizedJson"->'organicResults') = 'array' THEN t."normalizedJson"->'organicResults' ELSE '[]'::jsonb END) item
            WHERE item->>'domain' = target->>'siteDomain' OR item->>'domain' LIKE '%.' || (target->>'siteDomain')
          ))
        ) AS verified
      FROM market_tasks t CROSS JOIN LATERAL jsonb_array_elements(
        CASE WHEN jsonb_typeof(t."targetsJson") = 'array' THEN t."targetsJson" ELSE '[]'::jsonb END
      ) target
    ), verified_periods AS (
      SELECT id, region, "targetSite", "targetKeyword", DENSE_RANK() OVER (
        PARTITION BY region, "targetSite", "targetKeyword" ORDER BY "periodKey" DESC
      ) AS n FROM expanded_tasks WHERE verified
    ), prior_verified_periods AS (
      SELECT id, region, "targetSite", "targetKeyword", DENSE_RANK() OVER (
        PARTITION BY region, "targetSite", "targetKeyword" ORDER BY "periodKey" DESC
      ) AS n FROM expanded_tasks WHERE verified AND
        ("checkedAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Shanghai')::date < ${start ?? "1970-01-01"}::date
    ), ranked_tasks AS (
      SELECT t.*, ROW_NUMBER() OVER w AS n
      FROM expanded_tasks t WINDOW w AS (PARTITION BY region, "targetSite", "targetKeyword" ORDER BY "periodKey" DESC, "runCreatedAt" DESC, "updatedAt" DESC, id DESC ROWS UNBOUNDED PRECEDING)
    ), selected_tasks AS (
      SELECT DISTINCT id FROM ranked_tasks WHERE
        (${historical} AND (("checkedAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Shanghai')::date >= ${start ?? "1970-01-01"}::date
          OR ("checkedAt" IS NULL AND "periodEnd" >= ${start ?? "1970-01-01"}::date) OR (verified AND EXISTS (
            SELECT 1 FROM prior_verified_periods p WHERE p.id = ranked_tasks.id AND p."targetSite" = ranked_tasks."targetSite"
              AND p."targetKeyword" = ranked_tasks."targetKeyword" AND p.n <= 2
          )))) OR
        (${!historical} AND (n = 1 OR (verified AND EXISTS (
          SELECT 1 FROM verified_periods p WHERE p.id = ranked_tasks.id AND p."targetSite" = ranked_tasks."targetSite"
            AND p."targetKeyword" = ranked_tasks."targetKeyword" AND p.n <= 2
        ))))
    )
    SELECT t.id, t."runId", t.keyword, t.region, t."targetsJson", t.state, t."checkedAt", t."providerTaskId", t."errorCode", t."runCreatedAt", t."updatedAt",
      t."periodKey", t."periodLabel", t."periodStart", t."periodEnd", t."runScope", t."runTargetCount",
      CASE WHEN t."normalizedJson" IS NOT NULL THEN jsonb_build_object(
        'normalizationVersion', t."normalizedJson"->'normalizationVersion', 'captureComplete', t."normalizedJson"->'captureComplete',
        'organicCount', t."normalizedJson"->'organicCount', 'coveredThroughRank', t."normalizedJson"->'coveredThroughRank',
        'queryStatus', t."normalizedJson"->'queryStatus', 'correctedKeyword', t."normalizedJson"->'correctedKeyword',
        'spellType', t."normalizedJson"->'spellType', 'pagesCount', t."normalizedJson"->'pagesCount',
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
  existingCohort?: { targets: SerpTarget[]; hash: string }, existingMonitoring?: SerpMonitoringReadCohort, existingTasks?: SerpTaskRead[]): Promise<SerpResultsResponse> {
  const cohort = existingCohort ?? await loadSerpTargetCohort(site);
  // The dashboard may include research candidates for its historical drawer.
  // Never offer that broader display cohort to the paid-monitoring selector.
  const monitoring = existingMonitoring ?? await loadSerpMonitoringCohort(site, existingCohort ? undefined : cohort);
  const tasks = existingTasks ?? (cohort.targets.length ? await loadSerpTasks(region, languageCode, device) : []);
  const currentRunId = [...tasks].filter(task => task.runScope === "SCHEDULED")
    .sort((a,b) => new Date(b.runCreatedAt).getTime()-new Date(a.runCreatedAt).getTime())[0]?.runId;
  const items = withSerpMonitoringEligibility(buildSerpKeywordResults(cohort.targets, tasks, {currentRunId}), monitoring);
  const completeDates = items.filter(item => item.captureComplete).flatMap(item => item.checkedAt ? [item.checkedAt] : []);
  return { schemaVersion: 1, source: SERP_SOURCE, site, region, languageCode, device, depth: 100, cohortHash: cohort.hash,
    summary: summarizeSerpResults(items), items, latestCompletedAt: completeDates.sort().at(-1) ?? null,
    currentPeriod: serpPeriod(), movementSummary: summarizeSerpMovements(items), sampleSummary: summarizeSerpSampleResults(items),
    monitoring: summarizeSerpMonitoring(items, monitoring) };
}

export async function loadSerpAllRegionResults(site = "all"): Promise<SerpAllRegionsResponse> {
  const cohort = await loadSerpTargetCohort(site);
  const [monitoring, tasks] = await Promise.all([loadSerpMonitoringCohort(site, cohort), cohort.targets.length ? loadSerpTasks("all") : Promise.resolve([])]);
  const results = await Promise.all(REGION_CODES.map(region => loadSerpResults(site, region, SERP_MARKET_LANGUAGE[region], "desktop", cohort, monitoring, tasks.filter(task => task.region === region))));
  return summarizeAllRegionResults(site, cohort, monitoring, results);
}

export function summarizeAllRegionResults(site: string, cohort: { targets: SerpTarget[]; hash: string }, monitoring: SerpMonitoringReadCohort,
  results: SerpResultsResponse[]): SerpAllRegionsResponse {
  const aggregated = aggregateSerpRegionResults(results, cohort.targets);
  // Display deduplication never changes the original site memberships, task
  // evidence, monitoring hash, paid query quote or immutable reporting cohort.
  return { schemaVersion: 1, source: SERP_SOURCE, site, region: "all", cohortHash: cohort.hash, currentPeriod: serpPeriod(),
    summary: aggregated.summary, latestCompletedAt: results.flatMap(result => result.latestCompletedAt ? [result.latestCompletedAt] : []).sort().at(-1) ?? null,
    monitoring: { ...aggregated.monitoring, hash: monitoring.hash },
    regions: aggregated.countries.map(country => {
      const original = results.find(result => result.region === country.region)!;
      const countryMonitoring = summarizeSerpMonitoring(country.items, { ...monitoring,
        targets: country.items.filter(item => item.monitoringEligible), allTargetCount: aggregated.monitoring.allTargetCount,
        heldTargetCount: aggregated.monitoring.heldTargetCount });
      return { region: country.region, languageCode: original.languageCode, device: original.device, depth: original.depth,
        summary: country.summary, monitoring: countryMonitoring, latestCompletedAt: original.latestCompletedAt,
        rankedCount: country.rankedCount, targetSharePercent: country.targetSharePercent, rankingRecordSharePercent: country.rankingRecordSharePercent };
    }) };
}
