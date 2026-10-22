import { Prisma } from "@prisma/client";
import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { settleReads } from "@/lib/database-read";
import { isDatabaseConfigured } from "@/lib/env";
import { getRankBucket, REGION_CODES, type SearchRegionCode } from "@/lib/seo";
import { buildRankingEvidence, labsReportingPeriod, latestQueryEvidence, rankingReportingPeriod, type RankingObservationRow, type RankingPageRow } from "@/lib/ranking-evidence";
import { assessKeywordVolume, type VolumeReviewSample } from "@/lib/keyword-volume-review";
import { keywordRelevance } from "@/lib/keyword-relevance";
import { loadRecentRankingReportPeriod } from "@/lib/services/ranking-report-period";
import type { DashboardKeyword, DashboardResponse, DashboardTopic, RankingEvidence, RankingReportingPeriod, SyncRunSummary } from "@/lib/types";
import { loadSerpResults, loadSerpTasks, summarizeAllRegionResults } from "@/lib/services/serp-results";
import { SERP_MARKET_LANGUAGE, serpRankSummary, serpRankingEvidence } from "@/lib/serp-results";
import { loadSerpMonitoringCohort } from "@/lib/services/serp-targets";
import { timedRead } from "@/lib/read-profile";
import { keywordBusiness } from "@/lib/keyword-business";
import { loadCloudGpuKeywordTexts } from "@/lib/services/keyword-business";

const SITES = ["flatkey.ai", "rackrate.org", "modelfit.cc"];
const NAMES: Record<string, string> = { "flatkey.ai": "Flatkey", "rackrate.org": "RackRate", "modelfit.cc": "ModelFit" };
type TopicRow = Pick<DashboardTopic, "id" | "text" | "type" | "parentId" | "parentIds"> & { siteDomain: string };
type KeywordRow = Pick<DashboardKeyword, "id" | "text" | "type" | "parentId" | "parentIds" | "topicId" | "topicText"> & {
  siteDomain: string; topicTexts: string[]; origin: string; targetUrls: string[];
  defaultVolume: number; lastSyncedAt: Date | null;
  firstTrackedAt?: Date; hasSearchActivity?: boolean; hasObservedPage?: boolean; sourceLanguages?: string[];
};
type VolumeRow = { keywordId: string; region: SearchRegionCode; volume: number; fetchedAt: Date; volumeHistory?: VolumeReviewSample[] };
type RankRow = RankingObservationRow;
const emptyVolumes = () => Object.fromEntries(REGION_CODES.map(region => [region, null])) as DashboardKeyword["marketVolumes"];

export function assembleDashboard(
  site: string, topics: TopicRow[], rows: KeywordRow[], ranks: RankRow[], volumes: VolumeRow[], latestImportAt: string | null,
  latestRun: DashboardResponse["latestRun"] = null,
  pages: RankingPageRow[] = [],
  reportingPeriod: RankingReportingPeriod | null = null,
  rankingSource = "dataforseo_labs",
): DashboardResponse {
  const all = site === "all";
  const scoped = (domain: string, id: string) => all ? `${domain}:${id}` : id;
  const topicMap = new Map<string, DashboardTopic>();
  for (const topic of topics) {
    topicMap.set(`${topic.siteDomain}:${topic.id}`, {
      id: scoped(topic.siteDomain, topic.id), text: topic.text, type: topic.type, active: true,
      parentId: topic.parentId ? scoped(topic.siteDomain, topic.parentId) : null,
      parentIds: (topic.parentIds.length ? topic.parentIds : topic.parentId ? [topic.parentId] : []).map(id => scoped(topic.siteDomain, id)),
      marketVolumes: emptyVolumes(), volume: 0,
    });
  }
  const ranksByKey = new Map<string, RankRow[]>();
  const pagesByKey = new Map<string, RankingPageRow[]>();
  for (const rank of ranks) {
    const key = `${rank.siteDomain}:${rank.keywordId}:${rank.region}`;
    ranksByKey.set(key, [...(ranksByKey.get(key) ?? []), rank]);
  }
  for (const page of pages) {
    const key = `${page.siteDomain}:${page.keywordId}:${page.region}`;
    pagesByKey.set(key, [...(pagesByKey.get(key) ?? []), page]);
  }
  const volumeMap = new Map(volumes.map(row => [`${row.keywordId}:${row.region}`, row]));
  const keywords: DashboardKeyword[] = rows.filter(row => keywordRelevance(row.siteDomain, row.text).status !== "unrelated").map(row => {
    const latestRanks = Object.fromEntries(REGION_CODES.map(region => [region, null])) as DashboardKeyword["latestRanks"];
    const rankingEvidence = Object.fromEntries(REGION_CODES.map(region => [region, [] as RankingEvidence[]])) as NonNullable<DashboardKeyword["rankingEvidence"]>;
    const marketVolumes = emptyVolumes();
    const updated = row.lastSyncedAt ? [row.lastSyncedAt.toISOString()] : [];
    for (const region of REGION_CODES) {
      const volume = volumeMap.get(`${row.id}:${region}`);
      // defaultVolume can be the maximum across countries. It cannot prove US
      // demand or fill a missing country-specific measurement.
      marketVolumes[region] = volume?.volume ?? null;
      if (volume) updated.push(volume.fetchedAt.toISOString());
      const key = `${row.siteDomain}:${row.id}:${region}`;
      const queryRows = ranksByKey.get(key) ?? [], pageRows = pagesByKey.get(key) ?? [];
      rankingEvidence[region] = ["dataforseo_labs", "dataforseo_serp"].includes(rankingSource) ? [
        ...buildRankingEvidence(queryRows.filter(row => row.source === "dataforseo_labs"), pageRows.filter(row => row.source === "dataforseo_labs")),
        // Keep raw legacy reports in the historical drawer, even a 28-day
        // report outside the current Labs collection window.
        ...buildRankingEvidence(queryRows.filter(row => row.source !== "dataforseo_labs"), pageRows.filter(row => row.source !== "dataforseo_labs")),
      ] : buildRankingEvidence(queryRows, pageRows, reportingPeriod);
      for (const evidence of rankingEvidence[region]) {
        updated.push(evidence.checkedAt, ...evidence.pages.map(page => page.checkedAt));
      }
      const rank = latestQueryEvidence(rankingEvidence[region].filter(row => rankingSource === "combined" || row.source === rankingSource));
      if (rank) {
        latestRanks[region] = {
          rank: rank.rank, bucket: getRankBucket(rank.rank), source: rank.source,
          periodStart: rank.periodStart, periodEnd: rank.periodEnd,
          url: rank.url, title: null, searchVolume: marketVolumes[region], checkedAt: rank.checkedAt,
          dataUpdatedAt: rank.dataUpdatedAt, dataDate: rank.dataDate, rankStatus: rank.rankStatus,
          clicks: rank.clicks, impressions: rank.impressions, ctr: rank.ctr, serpVerification: "unverified",
          previousRank: null, rankDelta: null, changed: false,
        };
      }
      const seen = new Set<string>();
      const addVolume = (topicId: string | null) => {
        if (!topicId || seen.has(topicId)) return;
        seen.add(topicId);
        const topic = topicMap.get(`${row.siteDomain}:${topicId}`);
        if (!topic) return;
        topic.marketVolumes[region] = (topic.marketVolumes[region] ?? 0) + (marketVolumes[region] ?? 0);
        for (const parent of topic.parentIds) addVolume(all ? parent.slice(row.siteDomain.length + 1) : parent);
      };
      if (marketVolumes[region] != null) addVolume(row.topicId);
    }
    const firstTrackedAt = row.firstTrackedAt?.toISOString() ?? null;
    const volumeReview = assessKeywordVolume({ text: row.text, siteDomain: row.siteDomain,
      topicTexts: [row.topicText ?? "", ...row.topicTexts], targetUrls: row.targetUrls,
      firstTrackedAt, marketVolumes, rankingEvidence,
      histories: Object.fromEntries(REGION_CODES.map(region => [region, volumeMap.get(`${row.id}:${region}`)?.volumeHistory ?? []])),
      hasSearchActivity: row.hasSearchActivity, hasObservedPage: row.hasObservedPage,
    });
    return {
      id: scoped(row.siteDomain, row.id), text: row.text, type: row.type, active: true,
      siteDomain: row.siteDomain, siteName: NAMES[row.siteDomain] ?? row.siteDomain,
      topicId: row.topicId ? scoped(row.siteDomain, row.topicId) : null, topicText: row.topicText,
      topicTexts: [...new Set([row.topicText, ...row.topicTexts].filter((value): value is string => Boolean(value)))],
      origin: row.origin, targetUrls: row.targetUrls, sourceLanguages: row.sourceLanguages ?? [],
      parentId: row.parentId ? scoped(row.siteDomain, row.parentId) : null,
      parentIds: (row.parentIds.length ? row.parentIds : row.parentId ? [row.parentId] : []).map(id => scoped(row.siteDomain, id)),
      lastSyncedAt: updated.sort().at(-1) ?? null,
      volume: Math.max(0, ...REGION_CODES.map(region => marketVolumes[region] ?? 0)), marketVolumes, latestRanks, rankingEvidence,
      firstTrackedAt, volumeReview,
    };
  });
  for (const topic of topicMap.values()) topic.volume = Math.max(0, ...REGION_CODES.map(region => topic.marketVolumes[region] ?? 0));
  return { usingDemoData: false, targetDomain: all ? "全部网站" : site, regions: REGION_CODES,
    keywords, topics: [...topicMap.values()], latestImportAt, latestRun,
    ...(reportingPeriod ? { reportingPeriod } : {}) };
}

export async function loadDashboard(site: string, source = "dataforseo_serp", period: "week" | "history" = "week", now = new Date(), includeResearch = false,
  options: { currentOnly?: boolean; keywordId?: string } = {}): Promise<DashboardResponse> {
  if (!isDatabaseConfigured()) throw new Error("数据库未配置，暂时无法读取真实数据");
  const snapshotSource = ["dataforseo_labs", "dataforseo_serp"].includes(source);
  const week = snapshotSource ? { ...labsReportingPeriod(now), ...(source === "dataforseo_serp" ? { label: "最近有效 Google SERP 实测 · 隔周周一晚24:00更新" } : {}) }
    : period === "week" && isDatabaseConfigured() ? await loadRecentRankingReportPeriod(now) : rankingReportingPeriod(now);
  const reportingPeriod = period === "week" ? week : null;
  const domains = Prisma.join(site === "all" ? SITES : [site]);
  const splitDaily = Prisma.raw(period === "week" && !snapshotSource ? "true" : "false");
  // Keyword details also need evidence for active research candidates, including
  // those without a topic. The overview keeps its formal-target cohort.
  const poolScope = includeResearch
    ? Prisma.sql`((sk."siteDomain" = 'flatkey.ai' AND sk.pool IN ('FORMAL','RESEARCH')) OR (sk."siteDomain" <> 'flatkey.ai' AND sk."topicId" IS NOT NULL))`
    : Prisma.sql`(sk."siteDomain" <> 'flatkey.ai' OR sk.pool = 'FORMAL') AND sk."topicId" IS NOT NULL`;
  const membershipScope = Prisma.sql`(${poolScope}) ${options.keywordId ? Prisma.sql`AND k.id = ${options.keywordId}` : Prisma.empty}`;
  const currentOnly = source === "dataforseo_serp" && options.currentOnly === true;
  const latestQueries = Prisma.sql`
    ${Prisma.raw(period === "week" ? "/* dashboard:weekly */" : "/* dashboard:history */")}
    SELECT DISTINCT ON (o."siteDomain", o."keywordId", o.region, o.source,
      CASE WHEN ${splitDaily} AND o.source = 'gsc' AND o."periodStart" = o."periodEnd" THEN o."periodEnd" END)
      o.id, o."siteDomain", o."keywordId", o.region, o.rank, o.source, o."periodStart", o."periodEnd",
      o.url, o.clicks, o.impressions, o.ctr, o."collectedAt", o."dataUpdatedAt", o."rankStatus", o."importedAt", o."captureId", capture.status AS "captureStatus"
    FROM "KeywordObservation" o JOIN "Keyword" k ON k.id = o."keywordId"
    JOIN "SiteKeyword" sk ON sk."siteDomain" = o."siteDomain" AND sk."keywordId" = o."keywordId"
    LEFT JOIN "RankingCapture" capture ON capture.id = o."captureId" AND capture."siteDomain" = o."siteDomain" AND capture.region = o.region AND capture.source = o.source
    WHERE o."siteDomain" IN (${domains}) AND o."rankReported" = true
      AND (o.source <> 'dataforseo_labs' OR capture.status = 'COMPLETE')
      AND (o.source = ${source} OR (${source} = 'dataforseo_labs' AND o.source IN ('gsc','ahrefs'))
        OR (${source} = 'dataforseo_serp' AND o.source IN ('gsc','ahrefs','dataforseo_labs'))
        OR (${source} = 'combined' AND o.source IN ('gsc','ahrefs','dataforseo_labs')))
      AND (${period === "history" || source === "dataforseo_serp"} OR
        (${source} = 'dataforseo_labs' AND o.source IN ('gsc','ahrefs')) OR
        o.source = 'dataforseo_labs' OR
        (o.source = 'gsc' AND ((o."periodStart" = ${week.start}::date AND o."periodEnd" = ${week.end}::date)
          OR (o."periodStart" = o."periodEnd" AND o."periodEnd" BETWEEN ${week.start}::date AND ${week.end}::date)))
        OR (o.source = 'ahrefs' AND o."dataUpdatedAt" IS NOT NULL AND
          (o."dataUpdatedAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Shanghai')::date BETWEEN ${week.start}::date AND ${week.end}::date))
      AND k.active = true AND sk.active = true AND ${membershipScope}
    ORDER BY o."siteDomain", o."keywordId", o.region, o.source,
      CASE WHEN ${splitDaily} AND o.source = 'gsc' AND o."periodStart" = o."periodEnd" THEN o."periodEnd" END,
      CASE WHEN o.source = 'dataforseo_labs' THEN o."collectedAt"
        WHEN o.source = 'ahrefs' THEN COALESCE(o."dataUpdatedAt", o."periodEnd"::timestamp, o."collectedAt")
        ELSE COALESCE(o."periodEnd"::timestamp, o."dataUpdatedAt", o."collectedAt") END DESC,
      o."dataUpdatedAt" DESC NULLS LAST, o."collectedAt" DESC, o."importedAt" DESC, o.id DESC
  `;
  // One set of flat reads serves every site. PostgreSQL reduces historical
  // observations to current values before transferring them to the server.
  const [topics, keywords, ranks, volumes, latestImport, latestRun, pages, cloudKeywords] = await timedRead("dashboard.inventory", () => settleReads([
    prisma.$queryRaw<TopicRow[]>(Prisma.sql`
      /* dashboard:topics */
      SELECT st."siteDomain", t.id, t.text, t.type, t."parentId",
        ARRAY(SELECT e."parentId" FROM "TopicRelation" e WHERE e."childId" = t.id) AS "parentIds"
      FROM "SiteTopic" st JOIN "Topic" t ON t.id = st."topicId"
      WHERE st."siteDomain" IN (${domains}) AND t.active = true
      ORDER BY st."siteDomain", t.type, t.text
    `),
    prisma.$queryRaw<KeywordRow[]>(Prisma.sql`
      /* dashboard:keywords */
      WITH source_languages AS (
        SELECT source."siteDomain", lower(trim(word->>'keyword')) AS text,
          array_agg(DISTINCT source.snapshot->>'language') AS languages
        FROM "KeywordSourceRow" source
        CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(source.snapshot->'keywords') = 'array'
          THEN source.snapshot->'keywords' ELSE '[]'::jsonb END) word
        WHERE source."siteDomain" IN (${domains}) AND source."sourceId" IN ('api_main','cloud_main','optimization')
          AND NULLIF(trim(source.snapshot->>'language'), '') IS NOT NULL
          AND word->>'relevance' IS DISTINCT FROM 'UNRELATED'
        GROUP BY source."siteDomain", lower(trim(word->>'keyword'))
      )
      SELECT sk."siteDomain", k.id, k.text, k.type, sk."topicId", t.text AS "topicText",
        k."parentId", k."defaultVolume", k."lastSyncedAt", sk.origin, sk."targetUrls",
        COALESCE(source.languages, ARRAY[]::text[]) AS "sourceLanguages",
        sk."createdAt" AS "firstTrackedAt",
        (EXISTS(SELECT 1 FROM "KeywordObservation" o WHERE o."siteDomain" = sk."siteDomain" AND o."keywordId" = k.id
            AND o.source IN ('gsc','ahrefs') AND (o.clicks > 0 OR o.impressions > 0))
          OR EXISTS(SELECT 1 FROM "KeywordPageObservation" p WHERE p."siteDomain" = sk."siteDomain" AND p."keywordId" = k.id
            AND p.source IN ('gsc','ahrefs') AND (p.clicks > 0 OR p.impressions > 0))) AS "hasSearchActivity",
        (EXISTS(SELECT 1 FROM "KeywordObservation" o WHERE o."siteDomain" = sk."siteDomain" AND o."keywordId" = k.id
            AND o.source IN ('gsc','ahrefs','dataforseo_labs') AND o.rank >= 1 AND o.url ~* '^https?://')
          OR EXISTS(SELECT 1 FROM "KeywordPageObservation" p WHERE p."siteDomain" = sk."siteDomain" AND p."keywordId" = k.id
            AND p.source IN ('gsc','ahrefs','dataforseo_labs') AND p.rank >= 1 AND p.url ~* '^https?://')) AS "hasObservedPage",
        ARRAY(SELECT e."parentId" FROM "KeywordRelation" e WHERE e."childId" = k.id) AS "parentIds",
        ARRAY(SELECT DISTINCT a.text FROM "SiteKeywordTopic" s JOIN "Topic" a ON a.id = s."topicId"
          WHERE s."siteDomain" = sk."siteDomain" AND s."keywordId" = k.id ORDER BY a.text) AS "topicTexts"
      FROM "SiteKeyword" sk JOIN "Keyword" k ON k.id = sk."keywordId"
      JOIN "SeoSite" current_site ON current_site.domain = sk."siteDomain" AND current_site.active = true
      LEFT JOIN "Topic" t ON t.id = sk."topicId"
      LEFT JOIN source_languages source ON source."siteDomain" = sk."siteDomain" AND source.text = lower(trim(k.text))
      WHERE sk."siteDomain" IN (${domains}) AND sk.active = true AND ${membershipScope} AND k.active = true
      ORDER BY sk."siteDomain", k.type, k.text
    `),
    currentOnly ? Promise.resolve([] as RankRow[]) : prisma.$queryRaw<RankRow[]>(Prisma.sql`
      /* dashboard:ranks */
      ${latestQueries}
    `),
    prisma.$queryRaw<VolumeRow[]>(Prisma.sql`
      /* dashboard:volumes */
      WITH eligible AS (
        SELECT DISTINCT k.id FROM "Keyword" k JOIN "SiteKeyword" sk ON sk."keywordId" = k.id
        WHERE k.active = true AND sk.active = true AND ${membershipScope} AND sk."siteDomain" IN (${domains})
      ), candidates AS (
        SELECT v."keywordId", v.region, v.volume, v.source, v."fetchedAt", NULL::timestamp AS "importedAt", 1 AS preference,
          v."observedAt" AS "sourceDataDate"
        FROM "KeywordVolume" v JOIN eligible k ON k.id = v."keywordId"
        WHERE v.source IN ('ahrefs','csv') AND v.region IS NOT NULL
        UNION ALL
        SELECT o."keywordId", o.region, o.volume, o.source, o."collectedAt", o."importedAt", 0 AS preference,
          CASE WHEN o.source = 'dataforseo_labs' THEN NULL::timestamp ELSE o."dataUpdatedAt" END AS "sourceDataDate"
        FROM "KeywordObservation" o JOIN eligible k ON k.id = o."keywordId"
        WHERE o.source IN ('ahrefs','dataforseo_labs') AND o.volume IS NOT NULL
          AND (o.source <> 'dataforseo_labs' OR EXISTS(SELECT 1 FROM "RankingCapture" capture
            WHERE capture.id = o."captureId" AND capture.status = 'COMPLETE' AND capture."siteDomain" = o."siteDomain" AND capture.source = o.source AND capture.region = o.region))
      ), current_values AS (
        SELECT DISTINCT ON ("keywordId", region) "keywordId", region, volume, "fetchedAt" FROM candidates
        ORDER BY "keywordId", region, COALESCE("sourceDataDate", "fetchedAt") DESC,
          CASE WHEN source = 'dataforseo_labs' THEN 0 WHEN source = 'ahrefs' THEN 1 ELSE 2 END, preference, "importedAt" DESC NULLS LAST
      ), daily_samples AS (
        -- Reimports of the same source data day count once. Positive demand
        -- wins over a conflicting zero; undated Ahrefs zeros prove no age.
        SELECT "keywordId", region, "sourceDataDate"::date AS day, MAX(volume) AS volume
        FROM candidates GROUP BY "keywordId", region, "sourceDataDate"::date
      ), histories AS (
        SELECT "keywordId", region, jsonb_agg(jsonb_build_object('volume', volume,
          'dataDate', TO_CHAR(day, 'YYYY-MM-DD')) ORDER BY day NULLS LAST) AS "volumeHistory"
        FROM daily_samples GROUP BY "keywordId", region
      )
      SELECT c.*, h."volumeHistory" FROM current_values c JOIN histories h
        ON h."keywordId" = c."keywordId" AND h.region = c.region
    `),
    prisma.rankingImport.findFirst({ where: { siteDomain: { in: site === "all" ? SITES : [site] } }, orderBy: { importedAt: "desc" }, select: { importedAt: true } }),
    site === "all" ? Promise.resolve(null) : prisma.syncRun.findFirst({ orderBy: { startedAt: "desc" } }),
    currentOnly ? Promise.resolve([] as RankingPageRow[]) : prisma.$queryRaw<RankingPageRow[]>(Prisma.sql`
      /* dashboard:pages */
      WITH latest_queries AS (${latestQueries}), eligible_pages AS (
        SELECT p.*, CASE WHEN p.source = 'dataforseo_labs' THEN 'COMPLETE' END AS "captureStatus" FROM "KeywordPageObservation" p
        JOIN "Keyword" k ON k.id = p."keywordId"
        JOIN "SiteKeyword" sk ON sk."siteDomain" = p."siteDomain" AND sk."keywordId" = p."keywordId"
        WHERE p."siteDomain" IN (${domains}) AND k.active = true AND sk.active = true AND ${membershipScope}
          AND (p.source <> 'dataforseo_labs' OR EXISTS(SELECT 1 FROM "KeywordObservation" owner
            JOIN "RankingCapture" capture ON capture.id = owner."captureId"
            WHERE owner."siteDomain" = p."siteDomain" AND owner."keywordId" = p."keywordId" AND owner.region = p.region AND owner.source = p.source
              AND owner."collectedAt" = p."collectedAt" AND capture.status = 'COMPLETE'
              AND capture."siteDomain" = owner."siteDomain" AND capture.region = owner.region AND capture.source = owner.source))
          AND (p.source = ${source} OR (${source} = 'dataforseo_labs' AND p.source IN ('gsc','ahrefs'))
            OR (${source} = 'dataforseo_serp' AND p.source IN ('gsc','ahrefs','dataforseo_labs'))
            OR (${source} = 'combined' AND p.source IN ('gsc','ahrefs','dataforseo_labs')))
          AND (${period === "history" || source === "dataforseo_serp"} OR
            (${source} = 'dataforseo_labs' AND p.source IN ('gsc','ahrefs')) OR
            p.source = 'dataforseo_labs' OR
            (p.source = 'gsc' AND ((p."periodStart" = ${week.start}::date AND p."periodEnd" = ${week.end}::date)
              OR (p."periodStart" = p."periodEnd" AND p."periodEnd" BETWEEN ${week.start}::date AND ${week.end}::date)))
            OR (p.source = 'ahrefs' AND p."dataUpdatedAt" IS NOT NULL AND
              (p."dataUpdatedAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Shanghai')::date BETWEEN ${week.start}::date AND ${week.end}::date))
      ), latest_pages AS (
        SELECT DISTINCT ON (p."siteDomain", p."keywordId", p.region, p.source,
          CASE WHEN ${splitDaily} AND p.source = 'gsc' AND p."periodStart" = p."periodEnd" THEN p."periodEnd" END) p.*
        FROM eligible_pages p
        ORDER BY p."siteDomain", p."keywordId", p.region, p.source,
          CASE WHEN ${splitDaily} AND p.source = 'gsc' AND p."periodStart" = p."periodEnd" THEN p."periodEnd" END,
          CASE WHEN p.source = 'dataforseo_labs' THEN p."collectedAt"
            WHEN p.source = 'ahrefs' THEN COALESCE(p."dataUpdatedAt", p."periodEnd"::timestamp, p."collectedAt")
            ELSE COALESCE(p."periodEnd"::timestamp, p."dataUpdatedAt", p."collectedAt") END DESC,
          p."dataUpdatedAt" DESC NULLS LAST, p."collectedAt" DESC, p."importedAt" DESC, p.id DESC
      ), reports AS (
        SELECT "siteDomain", "keywordId", region, source, "periodStart", "periodEnd" FROM latest_queries
        UNION SELECT "siteDomain", "keywordId", region, source, "periodStart", "periodEnd" FROM latest_pages
      )
      SELECT DISTINCT ON (p."siteDomain", p."keywordId", p.region, p.source, p."periodStart", p."periodEnd", p.url) p.*
      FROM eligible_pages p JOIN reports r ON r."siteDomain" = p."siteDomain" AND r."keywordId" = p."keywordId"
        AND r.region = p.region AND r.source = p.source
        AND r."periodStart" IS NOT DISTINCT FROM p."periodStart" AND r."periodEnd" IS NOT DISTINCT FROM p."periodEnd"
      ORDER BY p."siteDomain", p."keywordId", p.region, p.source, p."periodStart", p."periodEnd", p.url,
        CASE WHEN p.source = 'dataforseo_labs' THEN p."collectedAt"
          WHEN p.source = 'ahrefs' THEN COALESCE(p."dataUpdatedAt", p."periodEnd"::timestamp, p."collectedAt")
          ELSE COALESCE(p."periodEnd"::timestamp, p."dataUpdatedAt", p."collectedAt") END DESC,
        p."dataUpdatedAt" DESC NULLS LAST, p."collectedAt" DESC, p."importedAt" DESC, p.id DESC
    `),
    loadCloudGpuKeywordTexts(),
  ], ["topics", "keywords", "ranks", "volumes", "import", "run", "pages", "business"]));
  const dashboard = assembleDashboard(site, topics, keywords, ranks, volumes, latestImport?.importedAt.toISOString() ?? null,
    latestRun ? { ...latestRun, startedAt: latestRun.startedAt.toISOString(), finishedAt: latestRun.finishedAt?.toISOString() ?? null, summary: latestRun.summary as SyncRunSummary | null } : null,
    pages, reportingPeriod, source);
  for (const keyword of dashboard.keywords) keyword.businessCategory = keywordBusiness(keyword, cloudKeywords);
  if (source !== "dataforseo_serp") return dashboard;
  const cohort = { hash: "", targets: dashboard.keywords.map(keyword => ({
    keywordId: site === "all" ? keyword.id.slice((keyword.siteDomain?.length ?? 0) + 1) : keyword.id,
    keyword: keyword.text, siteDomain: keyword.siteDomain!, targetUrls: [...new Set(keyword.targetUrls ?? [])].sort(),
  })).sort((a, b) => a.siteDomain.localeCompare(b.siteDomain) || a.keywordId.localeCompare(b.keywordId)) };
  cohort.hash = createHash("sha256").update(JSON.stringify(cohort.targets)).digest("hex");
  const [monitoring, tasks] = await settleReads([timedRead("dashboard.page-readiness", () => loadSerpMonitoringCohort(site, includeResearch ? undefined : cohort)), loadSerpTasks("all")], ["monitoring", "serp-tasks"]);
  const snapshots = await settleReads(REGION_CODES.map(region => loadSerpResults(site, region, SERP_MARKET_LANGUAGE[region], "desktop", cohort, monitoring, tasks.filter(task => task.region === region))), REGION_CODES.map(region => `serp:${region}`));
  if (!includeResearch && !options.keywordId) dashboard.serpOverview = summarizeAllRegionResults(site, cohort, monitoring, snapshots);
  for (const snapshot of snapshots) {
    const results = new Map(snapshot.items.map(item => [`${item.siteDomain}:${item.keywordId}`, item]));
    for (const keyword of dashboard.keywords) {
      const id = site === "all" ? keyword.id : `${keyword.siteDomain}:${keyword.id}`, result = results.get(id);
      // An unmatched or failed new SERP check never falls back to a historic
      // database hit or an average position from a different source.
      keyword.latestRanks[snapshot.region] = result ? serpRankSummary(result, keyword.marketVolumes[snapshot.region]) : null;
      if (result) {
        keyword.monitoringEligible = result.monitoringEligible;
        keyword.monitoringHoldReason = result.monitoringHoldReason;
        keyword.monitoringHoldCode = result.monitoringHoldCode;
        const evidence = serpRankingEvidence(result);
        if (evidence) {
          keyword.rankingEvidence![snapshot.region].unshift(evidence);
          if (!keyword.lastSyncedAt || evidence.checkedAt > keyword.lastSyncedAt) keyword.lastSyncedAt = evidence.checkedAt;
        }
      }
    }
  }
  return dashboard;
}
