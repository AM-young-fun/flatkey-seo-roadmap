import { Prisma, type KeywordObservation } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { settleReads } from "@/lib/database-read";
import { isDatabaseConfigured } from "@/lib/env";
import { getDemoDashboard } from "@/lib/demo-data";
import { getRankBucket, REGION_CODES, type SearchRegionCode } from "@/lib/seo";
import type { DashboardKeyword, DashboardResponse, DashboardTopic, SyncRunSummary } from "@/lib/types";

const SITES = ["flatkey.ai", "rackrate.org", "modelfit.cc"];
const NAMES: Record<string, string> = { "flatkey.ai": "Flatkey", "rackrate.org": "RackRate", "modelfit.cc": "ModelFit" };
type TopicRow = Pick<DashboardTopic, "id" | "text" | "type" | "parentId" | "parentIds"> & { siteDomain: string };
type KeywordRow = Pick<DashboardKeyword, "id" | "text" | "type" | "parentId" | "parentIds" | "topicId" | "topicText"> & {
  siteDomain: string; topicTexts: string[]; origin: string; targetUrls: string[];
  defaultVolume: number; lastSyncedAt: Date | null;
};
type VolumeRow = { keywordId: string; region: SearchRegionCode; volume: number; fetchedAt: Date };
type RankRow = Pick<KeywordObservation, "keywordId" | "region" | "rank" | "source" | "periodStart" | "periodEnd" | "url" | "collectedAt" | "dataUpdatedAt" | "rankStatus"> & { siteDomain: string };
const emptyVolumes = () => Object.fromEntries(REGION_CODES.map(region => [region, null])) as DashboardKeyword["marketVolumes"];

export function assembleDashboard(
  site: string, topics: TopicRow[], rows: KeywordRow[], ranks: RankRow[], volumes: VolumeRow[], latestImportAt: string | null,
  latestRun: DashboardResponse["latestRun"] = null,
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
  const rankMap = new Map(ranks.map(row => [`${row.siteDomain}:${row.keywordId}:${row.region}`, row]));
  const volumeMap = new Map(volumes.map(row => [`${row.keywordId}:${row.region}`, row]));
  const keywords: DashboardKeyword[] = rows.map(row => {
    const latestRanks = Object.fromEntries(REGION_CODES.map(region => [region, null])) as DashboardKeyword["latestRanks"];
    const marketVolumes = emptyVolumes();
    const updated = row.lastSyncedAt ? [row.lastSyncedAt.toISOString()] : [];
    for (const region of REGION_CODES) {
      const volume = volumeMap.get(`${row.id}:${region}`);
      marketVolumes[region] = volume?.volume ?? (region === "US" && row.defaultVolume > 0 ? row.defaultVolume : null);
      if (volume) updated.push(volume.fetchedAt.toISOString());
      const rank = rankMap.get(`${row.siteDomain}:${row.id}:${region}`);
      if (rank) {
        updated.push(rank.collectedAt.toISOString());
        latestRanks[region] = {
          rank: rank.rank, bucket: getRankBucket(rank.rank), source: rank.source as "gsc" | "ahrefs",
          periodStart: rank.periodStart?.toISOString().slice(0, 10) ?? null,
          periodEnd: rank.periodEnd?.toISOString().slice(0, 10) ?? null,
          url: rank.url, title: null, searchVolume: marketVolumes[region], checkedAt: rank.collectedAt.toISOString(),
          dataUpdatedAt: rank.dataUpdatedAt?.toISOString() ?? null, rankStatus: rank.rankStatus,
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
    return {
      id: scoped(row.siteDomain, row.id), text: row.text, type: row.type, active: true,
      ...(all ? { siteDomain: row.siteDomain, siteName: NAMES[row.siteDomain] } : {}),
      topicId: row.topicId ? scoped(row.siteDomain, row.topicId) : null, topicText: row.topicText,
      topicTexts: [...new Set([row.topicText, ...row.topicTexts].filter((value): value is string => Boolean(value)))],
      origin: row.origin, targetUrls: row.targetUrls,
      parentId: row.parentId ? scoped(row.siteDomain, row.parentId) : null,
      parentIds: (row.parentIds.length ? row.parentIds : row.parentId ? [row.parentId] : []).map(id => scoped(row.siteDomain, id)),
      lastSyncedAt: updated.sort().at(-1) ?? null,
      volume: Math.max(0, ...REGION_CODES.map(region => marketVolumes[region] ?? 0)), marketVolumes, latestRanks,
    };
  });
  for (const topic of topicMap.values()) topic.volume = Math.max(0, ...REGION_CODES.map(region => topic.marketVolumes[region] ?? 0));
  return { usingDemoData: false, targetDomain: all ? "全部网站" : site, regions: REGION_CODES,
    keywords, topics: [...topicMap.values()], latestImportAt, latestRun };
}

export async function loadDashboard(site: string, source: string): Promise<DashboardResponse> {
  if (!isDatabaseConfigured()) return getDemoDashboard();
  const domains = Prisma.join(site === "all" ? SITES : [site]);
  // One set of flat reads serves every site. PostgreSQL reduces historical
  // observations to current values before transferring them to the server.
  const [topics, keywords, ranks, volumes, latestImport, latestRun] = await settleReads([
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
      SELECT sk."siteDomain", k.id, k.text, k.type, sk."topicId", t.text AS "topicText",
        k."parentId", k."defaultVolume", k."lastSyncedAt", sk.origin, sk."targetUrls",
        ARRAY(SELECT e."parentId" FROM "KeywordRelation" e WHERE e."childId" = k.id) AS "parentIds",
        ARRAY(SELECT DISTINCT a.text FROM "SiteKeywordTopic" s JOIN "Topic" a ON a.id = s."topicId"
          WHERE s."siteDomain" = sk."siteDomain" AND s."keywordId" = k.id ORDER BY a.text) AS "topicTexts"
      FROM "SiteKeyword" sk JOIN "Keyword" k ON k.id = sk."keywordId"
      LEFT JOIN "Topic" t ON t.id = sk."topicId"
      WHERE sk."siteDomain" IN (${domains}) AND sk.active = true AND sk."topicId" IS NOT NULL AND k.active = true
      ORDER BY sk."siteDomain", k.type, k.text
    `),
    prisma.$queryRaw<RankRow[]>(Prisma.sql`
      /* dashboard:ranks */
      SELECT DISTINCT ON (o."siteDomain", o."keywordId", o.region)
        o."siteDomain", o."keywordId", o.region, o.rank, o.source, o."periodStart", o."periodEnd",
        o.url, o."collectedAt", o."dataUpdatedAt", o."rankStatus"
      FROM "KeywordObservation" o JOIN "Keyword" k ON k.id = o."keywordId"
      JOIN "SiteKeyword" sk ON sk."siteDomain" = o."siteDomain" AND sk."keywordId" = o."keywordId"
      WHERE o."siteDomain" IN (${domains}) AND o."rankReported" = true
        AND (o.rank IS NOT NULL OR o."rankStatus" = 'outside_top100')
        AND (o.source = ${source} OR (${source} = 'combined' AND o.source IN ('gsc','ahrefs')))
        AND k.active = true AND sk.active = true AND sk."topicId" IS NOT NULL
      ORDER BY o."siteDomain", o."keywordId", o.region, o."collectedAt" DESC,
        CASE WHEN o.source = 'ahrefs' AND o."rankStatus" <> 'no_data' THEN 0 WHEN o.source = 'gsc' THEN 1 ELSE 2 END,
        o."importedAt" DESC
    `),
    prisma.$queryRaw<VolumeRow[]>(Prisma.sql`
      /* dashboard:volumes */
      WITH eligible AS (
        SELECT DISTINCT k.id FROM "Keyword" k JOIN "SiteKeyword" sk ON sk."keywordId" = k.id
        WHERE k.active = true AND sk.active = true AND sk."topicId" IS NOT NULL AND sk."siteDomain" IN (${domains})
      ), candidates AS (
        SELECT v."keywordId", v.region, v.volume, v.source, v."fetchedAt", NULL::timestamp AS "importedAt", 1 AS preference
        FROM "KeywordVolume" v JOIN eligible k ON k.id = v."keywordId"
        WHERE v.source IN ('ahrefs','csv') AND v.region IS NOT NULL
        UNION ALL
        SELECT o."keywordId", o.region, o.volume, o.source, o."collectedAt", o."importedAt", 0 AS preference
        FROM "KeywordObservation" o JOIN eligible k ON k.id = o."keywordId"
        WHERE o.source = 'ahrefs' AND o.volume IS NOT NULL
      )
      SELECT DISTINCT ON ("keywordId", region) "keywordId", region, volume, "fetchedAt" FROM candidates
      ORDER BY "keywordId", region, CASE WHEN source = 'ahrefs' THEN 0 ELSE 1 END,
        "fetchedAt" DESC, preference, "importedAt" DESC NULLS LAST
    `),
    prisma.rankingImport.findFirst({ where: { siteDomain: { in: site === "all" ? SITES : [site] } }, orderBy: { importedAt: "desc" }, select: { importedAt: true } }),
    site === "all" ? Promise.resolve(null) : prisma.syncRun.findFirst({ orderBy: { startedAt: "desc" } }),
  ]);
  return assembleDashboard(site, topics, keywords, ranks, volumes, latestImport?.importedAt.toISOString() ?? null,
    latestRun ? { ...latestRun, startedAt: latestRun.startedAt.toISOString(), finishedAt: latestRun.finishedAt?.toISOString() ?? null, summary: latestRun.summary as SyncRunSummary | null } : null);
}
