import { prisma } from "@/lib/prisma";
import type { SearchRegionCode } from "@/lib/seo";

export type OverviewEntry = { siteDomain: string; keywordId: string; volume: number | null };

// Select in PostgreSQL before fetching keyword details and rank summaries.
export async function overviewScope(region: SearchRegionCode): Promise<OverviewEntry[]> {
  return prisma.$queryRaw<OverviewEntry[]>`
    SELECT sk."siteDomain", sk."keywordId",
      COALESCE(v.volume, CASE WHEN ${region} = 'US' THEN NULLIF(k."defaultVolume", 0) ELSE NULL END) AS volume
    FROM "SiteKeyword" sk JOIN "Keyword" k ON k.id = sk."keywordId"
    LEFT JOIN LATERAL (
      SELECT volume FROM (
        SELECT "volume" AS volume, "fetchedAt" AS date,
          CASE WHEN "source" = 'ahrefs' THEN 0 ELSE 1 END AS priority
        FROM "KeywordVolume" WHERE "keywordId" = k.id AND "region" = ${region}::"SearchRegion" AND "source" IN ('ahrefs', 'csv')
        UNION ALL
        SELECT "volume" AS volume, "collectedAt" AS date, 0 AS priority
        FROM "KeywordObservation" WHERE "keywordId" = k.id AND "region" = ${region}::"SearchRegion" AND "source" = 'ahrefs' AND "volume" IS NOT NULL
      ) candidates ORDER BY priority, date DESC LIMIT 1
    ) v ON true
    WHERE sk."active" = true AND sk."topicId" IS NOT NULL AND k."active" = true
      AND sk."siteDomain" IN ('flatkey.ai', 'rackrate.org', 'modelfit.cc')
    ORDER BY volume DESC NULLS LAST, k."text" ASC, sk."siteDomain" ASC
    LIMIT 500
  `;
}
