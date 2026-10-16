import type { Prisma } from "@prisma/client";
import { keywordRelevance } from "@/lib/keyword-relevance";
import { assessKeywordVolume, validSitePage, type VolumeReviewSample } from "@/lib/keyword-volume-review";
import { REGION_CODES, type SearchRegionCode } from "@/lib/seo";

type CleanupCandidate = {
  keywordId: string;
  protected?: boolean;
  text: string;
  firstTrackedAt: Date | null;
  restoredAt: Date | null;
  defaultVolume: number;
  targetUrls: string[];
  topicTexts: string[];
  hasSearchActivity: boolean;
  observedUrls: string[];
  volumeHistory: Array<VolumeReviewSample & { region: string }>;
};
export type KeywordCleanupResult = {
  checked: number;
  archived: number;
  recommended: number;
  unrelated: number;
  sustainedZero: number;
  kept: number;
  records: Array<{ id: string; text: string; reason: string; kind: "unrelated" | "sustained_zero" }>;
  recordsTruncated: boolean;
};

// Daily imports screen the inventory without removing candidates or targets.
// A missing report, zero demand or changed rank is never permission to archive.
export async function cleanupSiteKeywords(transaction: Prisma.TransactionClient, siteDomain: string, now = new Date()): Promise<KeywordCleanupResult> {
  const candidates = await transaction.$queryRaw<CleanupCandidate[]>`
    /* keyword-cleanup:candidates */
    WITH eligible AS (
      SELECT sk."keywordId", k.text, sk.protected, sk."createdAt" AS "firstTrackedAt", sk."restoredAt", k."defaultVolume", sk."targetUrls",
        ARRAY(SELECT DISTINCT t.text FROM "Topic" t WHERE t.id = sk."topicId" OR t.id IN (
          SELECT a."topicId" FROM "SiteKeywordTopic" a WHERE a."siteDomain" = sk."siteDomain" AND a."keywordId" = sk."keywordId"
        )) AS "topicTexts",
        (EXISTS(SELECT 1 FROM "KeywordObservation" o WHERE o."siteDomain" = sk."siteDomain" AND o."keywordId" = sk."keywordId"
            AND o.source IN ('gsc','ahrefs') AND (o.clicks > 0 OR o.impressions > 0))
          OR EXISTS(SELECT 1 FROM "KeywordPageObservation" p WHERE p."siteDomain" = sk."siteDomain" AND p."keywordId" = sk."keywordId"
            AND p.source IN ('gsc','ahrefs') AND (p.clicks > 0 OR p.impressions > 0))) AS "hasSearchActivity",
        ARRAY(SELECT o.url FROM "KeywordObservation" o WHERE o."siteDomain" = sk."siteDomain" AND o."keywordId" = sk."keywordId"
            AND o.source IN ('gsc','ahrefs') AND o.rank >= 1 AND o.url IS NOT NULL
          UNION SELECT p.url FROM "KeywordPageObservation" p WHERE p."siteDomain" = sk."siteDomain" AND p."keywordId" = sk."keywordId"
            AND p.source IN ('gsc','ahrefs') AND p.rank >= 1) AS "observedUrls"
      FROM "SiteKeyword" sk JOIN "Keyword" k ON k.id = sk."keywordId"
      WHERE sk."siteDomain" = ${siteDomain} AND sk.active = true
    ), samples AS (
      SELECT v."keywordId", v.region::text AS region, v.volume, v."observedAt" AS "dataDate"
      FROM "KeywordVolume" v JOIN eligible e ON e."keywordId" = v."keywordId"
      WHERE v.source IN ('csv','ahrefs') AND v.region IS NOT NULL
      UNION ALL
      SELECT o."keywordId", o.region::text AS region, o.volume, o."dataUpdatedAt" AS "dataDate"
      FROM "KeywordObservation" o JOIN eligible e ON e."keywordId" = o."keywordId"
      WHERE o.source = 'ahrefs' AND o.volume IS NOT NULL
    ), histories AS (
      SELECT "keywordId", jsonb_agg(jsonb_build_object('region', region, 'volume', volume,
        'dataDate', TO_CHAR("dataDate", 'YYYY-MM-DD'))) AS "volumeHistory"
      FROM samples GROUP BY "keywordId"
    ) SELECT e.*, COALESCE(h."volumeHistory", '[]'::jsonb) AS "volumeHistory"
      FROM eligible e LEFT JOIN histories h ON h."keywordId" = e."keywordId"
      ORDER BY e."keywordId"
  `;
  const archived: KeywordCleanupResult["records"] = [];
  for (const row of candidates) {
    if (row.protected) continue;
    const relevance = keywordRelevance(siteDomain, row.text);
    if (relevance.status === "unrelated") {
      archived.push({ id: row.keywordId, text: row.text, reason: `业务无关：${relevance.reason ?? "搜索意图与本站业务无关"}`, kind: "unrelated" });
      continue;
    }
    const histories: Partial<Record<SearchRegionCode, VolumeReviewSample[]>> = {};
    for (const region of REGION_CODES) histories[region] = (row.volumeHistory ?? []).filter(sample => sample.region === region);
    const review = assessKeywordVolume({
      text: row.text, siteDomain, firstTrackedAt: row.firstTrackedAt?.toISOString() ?? null,
      restoredAt: row.restoredAt?.toISOString() ?? null,
      targetUrls: row.targetUrls ?? [], topicTexts: row.topicTexts ?? [], histories,
      marketVolumes: { US: row.defaultVolume > 0 ? row.defaultVolume : null },
      hasSearchActivity: row.hasSearchActivity,
      hasObservedPage: (row.observedUrls ?? []).some(url => validSitePage(url, siteDomain)), now,
    });
    if (review.isCandidate) archived.push({ id: row.keywordId, text: row.text,
      reason: `持续零声量：${review.reasons.join("；")}`, kind: "sustained_zero" });
  }
  return {
    checked: candidates.length, archived: 0, recommended: archived.length, unrelated: archived.filter(row => row.kind === "unrelated").length,
    sustainedZero: archived.filter(row => row.kind === "sustained_zero").length, kept: candidates.length,
    records: archived.slice(0, 500), recordsTruncated: archived.length > 500,
  };
}
