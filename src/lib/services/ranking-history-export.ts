import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { historicalExportTargets, type HistoricalExportSelection } from "@/lib/ranking-history-export";
import type { SerpTaskRead, SerpTrendCohort } from "@/lib/serp-results";
import type { SearchRegionCode } from "@/lib/seo";

/** Only SELECTs existing saved history; no provider, poll, re-normalize or write. */
export async function loadHistoricalRankingExport(selection: HistoricalExportSelection) {
  const run = await prisma.serpMonitorRun.findUnique({ where: { id: selection.run.runId }, select: {
    id: true, scope: true, periodKey: true, periodLabel: true, periodStart: true, periodEnd: true, createdAt: true,
    cohortJson: true, cohortHash: true, targetCount: true, queryCount: true, status: true,
  } });
  if (!run || run.scope !== selection.run.scope || run.periodKey !== selection.run.periodKey) throw new Error("SAVED_HISTORY_LEDGER_UNAVAILABLE");
  const metadata = { runId: run.id, periodKey: run.periodKey, originalLabel: run.periodLabel, displayLabel: selection.run.label,
    scope: run.scope, cohortHash: run.cohortHash, originalTargetCount: run.targetCount, originalQueryCount: run.queryCount, status: run.status };
  const base = { version: "saved-historical-serp-export-v1", readOnly: true, newQueries: 0, productionWrites: 0, run: metadata } as const;
  if (selection.kind === "cohort") {
    const targets = historicalExportTargets(run.cohortJson);
    const markets = await prisma.$queryRaw<Array<{ region: SearchRegionCode }>>(Prisma.sql`
      /* saved-history-export:cohort-markets */
      SELECT DISTINCT t.region FROM "SerpMonitorTask" t JOIN "SerpMonitorRun" r ON r.id = t."runId"
      WHERE t."runId" = ${run.id} AND t.region IN ('US','JP','ES','BR')
        AND COALESCE(t."requestJson"->>'language_code', r."configJson"->>'languageCode') =
          CASE t.region WHEN 'US' THEN 'en' WHEN 'JP' THEN 'ja' WHEN 'ES' THEN 'es' WHEN 'BR' THEN 'pt' END
        AND COALESCE(t."requestJson"->>'device', r."configJson"->>'device') = 'desktop'
        AND COALESCE(t."requestJson"->>'depth', r."configJson"->>'depth') = '100' ORDER BY t.region
    `);
    const cohort: SerpTrendCohort = { runId: run.id, periodKey: run.periodKey, runScope: selection.run.scope,
      runTargetCount: run.targetCount, runCreatedAt: run.createdAt, targets, regions: markets.map(row => row.region) };
    return { ...base, kind: "cohort", cohorts: [cohort], frozenTargetCount: targets.length, partial: false };
  }
  const rows = await prisma.$queryRaw<SerpTaskRead[]>(Prisma.sql`
    /* saved-history-export:tasks */
    SELECT t.id, t."runId", t.keyword, t.region, t."targetsJson", t.state, t."checkedAt", t."providerTaskId", t."errorCode", t."updatedAt",
      r."createdAt" AS "runCreatedAt", r."periodKey", r."periodLabel", r."periodStart", r."periodEnd", r.scope AS "runScope", r."targetCount" AS "runTargetCount",
      CASE WHEN t."normalizedJson" IS NOT NULL THEN jsonb_build_object(
        'normalizationVersion', t."normalizedJson"->'normalizationVersion', 'captureComplete', t."normalizedJson"->'captureComplete',
        'organicCount', t."normalizedJson"->'organicCount', 'coveredThroughRank', t."normalizedJson"->'coveredThroughRank',
        'queryStatus', t."normalizedJson"->'queryStatus', 'correctedKeyword', t."normalizedJson"->'correctedKeyword',
        'spellType', t."normalizedJson"->'spellType', 'pagesCount', t."normalizedJson"->'pagesCount',
        'completeDepth', t."normalizedJson"->'completeDepth', 'rankingVerified', t."normalizedJson"->'rankingVerified',
        'maxOrganicRank', t."normalizedJson"->'maxOrganicRank', 'checkedAt', t."normalizedJson"->'checkedAt', 'googleUrl', t."normalizedJson"->'googleUrl',
        'organicResults', COALESCE((SELECT jsonb_agg(item) FROM jsonb_array_elements(
          CASE WHEN jsonb_typeof(t."normalizedJson"->'organicResults') = 'array' THEN t."normalizedJson"->'organicResults' ELSE '[]'::jsonb END
        ) item WHERE item->>'domain' IN ('flatkey.ai','rackrate.org','modelfit.cc') OR
          item->>'domain' LIKE '%.flatkey.ai' OR item->>'domain' LIKE '%.rackrate.org' OR item->>'domain' LIKE '%.modelfit.cc'), '[]'::jsonb)
      ) END AS "normalizedJson"
    FROM "SerpMonitorTask" t JOIN "SerpMonitorRun" r ON r.id = t."runId"
    WHERE t."runId" = ${run.id} AND t.region IN ('US','JP','ES','BR')
      AND COALESCE(t."requestJson"->>'language_code', r."configJson"->>'languageCode') =
        CASE t.region WHEN 'US' THEN 'en' WHEN 'JP' THEN 'ja' WHEN 'ES' THEN 'es' WHEN 'BR' THEN 'pt' END
      AND COALESCE(t."requestJson"->>'device', r."configJson"->>'device') = 'desktop'
      AND COALESCE(t."requestJson"->>'depth', r."configJson"->>'depth') = '100'
    ORDER BY t.id LIMIT ${selection.limit + 1} OFFSET ${selection.offset}
  `);
  const hasMore = rows.length > selection.limit, tasks = rows.slice(0, selection.limit).map(row => ({ ...row, targetsJson: historicalExportTargets(row.targetsJson) }));
  return { ...base, kind: "tasks", tasks, pagination: { offset: selection.offset, limit: selection.limit,
    nextOffset: hasMore ? selection.offset + tasks.length : null }, partial: selection.offset > 0 || hasMore };
}
