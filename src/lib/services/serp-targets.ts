import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { eligibleSerpTargets, SERP_TARGET_SITES, type SerpTarget, type SerpTargetCandidate } from "@/lib/serp-targets";

export async function loadSerpTargetCohort(site = "all"): Promise<{ targets: SerpTarget[]; hash: string }> {
  const domains = Prisma.join(site === "all" ? [...SERP_TARGET_SITES] : [site]);
  const rows = await prisma.$queryRaw<Array<SerpTargetCandidate & { targetUrls: string[] }>>(Prisma.sql`
    /* serp-monitor:cohort */
    SELECT sk."siteDomain", sk."keywordId", k.text, sk.active,
      k.active AS "keywordActive", s.active AS "siteActive", sk."topicId", sk.pool, sk."targetUrls"
    FROM "SiteKeyword" sk JOIN "Keyword" k ON k.id = sk."keywordId"
    JOIN "SeoSite" s ON s.domain = sk."siteDomain"
    WHERE sk."siteDomain" IN (${domains}) AND sk.active = true AND k.active = true AND s.active = true
      AND sk."topicId" IS NOT NULL AND (sk."siteDomain" <> 'flatkey.ai' OR sk.pool = 'FORMAL')
    ORDER BY sk."siteDomain", sk."keywordId"
  `);
  const targets = eligibleSerpTargets(rows).map(row => ({
    keywordId: row.keywordId, keyword: row.text, siteDomain: row.siteDomain,
    targetUrls: [...new Set(row.targetUrls ?? [])].sort(),
  })).sort((a, b) => a.siteDomain.localeCompare(b.siteDomain) || a.keywordId.localeCompare(b.keywordId));
  return { targets, hash: createHash("sha256").update(JSON.stringify(targets)).digest("hex") };
}
