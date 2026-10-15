import { databaseErrorCode, retryDatabaseRead, settleReads } from "@/lib/database-read";
import { NextResponse } from "next/server";
import type { KeywordObservation } from "@prisma/client";
import type {
  DashboardKeyword,
  DashboardResponse,
  DashboardTopic,
  SyncRunSummary,
} from "@/lib/types";
import { isDatabaseConfigured } from "@/lib/env";
import { getDemoDashboard } from "@/lib/demo-data";
import { prisma } from "@/lib/prisma";
import { getRankBucket, REGION_CODES, type SearchRegionCode } from "@/lib/seo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function emptyRanks(): DashboardKeyword["latestRanks"] {
  return REGION_CODES.reduce(
    (accumulator, region) => {
      accumulator[region] = null;
      return accumulator;
    },
    {} as DashboardKeyword["latestRanks"],
  );
}

function emptyMarketVolumes(): DashboardKeyword["marketVolumes"] {
  return REGION_CODES.reduce(
    (accumulator, region) => {
      accumulator[region] = null;
      return accumulator;
    },
    {} as DashboardKeyword["marketVolumes"],
  );
}

async function loadDashboard(siteDomain: string, source: string) {
  if (!isDatabaseConfigured()) {
    return getDemoDashboard();
  }

  const [
    topics,
    keywords,
    latestRun,
    importedRanks,
    importedVolumes,
    latestImport,
  ] = await settleReads([
    prisma.topic.findMany({
      where: {
        active: true, sites: { some: { siteDomain } },
      },
      include: {
        childEdges: {
          select: {
            parentId: true,
          },
        },
      },
      orderBy: [
        {
          type: "asc",
        },
        {
          text: "asc",
        },
      ],
    }),
    prisma.keyword.findMany({
      where: {
        active: true,
        siteLinks: { some: { siteDomain, active: true, topicId: { not: null } } },
      },
      include: {
        siteLinks: { where: { siteDomain }, include: { topic: true, topicAssignments: { include: { topic: true } } } },
        topic: {
          select: {
            id: true,
            text: true,
          },
        },
        volumes: {
          where: {
            source: {
              in: ["ahrefs", "csv"],
            },
          },
          orderBy: {
            fetchedAt: "desc",
          },
          take: 40,
        },
        childEdges: {
          select: {
            parentId: true,
          },
        },
      },
      orderBy: [
        {
          type: "asc",
        },
        {
          text: "asc",
        },
      ],
    }),
    prisma.syncRun.findFirst({
      orderBy: {
        startedAt: "desc",
      },
    }),
    // DISTINCT ON executes in PostgreSQL, so frequent refreshes do not transfer
    // the entire observation history just to select the latest rows.
    prisma.$queryRaw<KeywordObservation[]>`
      SELECT DISTINCT ON (o."keywordId", o."region") o.*
      FROM "KeywordObservation" o
      JOIN "Keyword" k ON k."id" = o."keywordId"
      WHERE o."rankReported" = true AND (o.rank IS NOT NULL OR o."rankStatus" = 'outside_top100') AND o."siteDomain" = ${siteDomain} AND (o."source" = ${source} OR (${source} = 'combined' AND o."source" IN ('ahrefs', 'gsc'))) AND k."active" = true
      ORDER BY o."keywordId", o."region", CASE WHEN o."source" = 'ahrefs' AND o."rankStatus" <> 'no_data' THEN 0 WHEN o."source" = 'gsc' THEN 1 ELSE 2 END, o."collectedAt" DESC, o."importedAt" DESC
    `,
    prisma.$queryRaw<KeywordObservation[]>`
      SELECT DISTINCT ON (o."keywordId", o."region") o.*
      FROM "KeywordObservation" o
      JOIN "Keyword" k ON k."id" = o."keywordId"
      WHERE o."volume" IS NOT NULL AND o."source" = 'ahrefs' AND k."active" = true
      ORDER BY o."keywordId", o."region", o."collectedAt" DESC, o."importedAt" DESC
    `,
    prisma.rankingImport.findFirst({ where: { siteDomain }, orderBy: { importedAt: "desc" } }),
  ]);

  const topicParentIdsById = new Map<string, string[]>();
  const topicVolumesById = new Map<string, DashboardTopic["marketVolumes"]>();

  const browserRanks = new Map<string, (typeof importedRanks)[number]>();
  // Prefer the newest observation; GSC and Ahrefs keep their source and period.
  for (const row of importedRanks) {
    const key = `${row.keywordId}:${row.region}`;
    if (!browserRanks.has(key)) browserRanks.set(key, row);
  }
  const browserVolumes = new Map(
    importedVolumes.map((row) => [`${row.keywordId}:${row.region}`, row]),
  );

  topics.forEach((topic) => {
    topicParentIdsById.set(
      topic.id,
      topic.childEdges.length > 0
        ? topic.childEdges.map((edge) => edge.parentId)
        : topic.parentId
          ? [topic.parentId]
          : [],
    );
    topicVolumesById.set(topic.id, emptyMarketVolumes());
  });

  function volumeForRegion(
    keyword: (typeof keywords)[number],
    region: SearchRegionCode,
  ): number | null {
    const imported = browserVolumes.get(`${keyword.id}:${region}`);
    const stored = keyword.volumes.find(
      (item) => item.region === region && item.source === "ahrefs",
    );
    if (imported && (!stored || imported.collectedAt >= stored.fetchedAt))
      return imported.volume;
    return (
      stored?.volume ??
      keyword.volumes.find(
        (item) => item.region === region && item.source === "csv",
      )?.volume ??
      keyword.volumes.find((item) => item.region === region)?.volume ??
      (region === "US" && keyword.defaultVolume > 0
        ? keyword.defaultVolume
        : null)
    );
  }

  function addVolumeToTopic(
    topicId: string | null,
    region: SearchRegionCode,
    volume: number,
    seen = new Set<string>(),
  ) {
    if (!topicId || seen.has(topicId)) {
      return;
    }

    seen.add(topicId);
    const topicVolumes = topicVolumesById.get(topicId);

    if (topicVolumes) {
      topicVolumes[region] = (topicVolumes[region] ?? 0) + volume;
    }

    (topicParentIdsById.get(topicId) ?? []).forEach((parentId) => {
      addVolumeToTopic(parentId, region, volume, seen);
    });
  }

  const dashboardKeywords: DashboardKeyword[] = keywords.map((keyword) => {
    const membership = keyword.siteLinks[0];
    const latestRanks = emptyRanks();
    const marketVolumes = emptyMarketVolumes();

    for (const region of REGION_CODES) {
      marketVolumes[region] = volumeForRegion(keyword, region);

      if (marketVolumes[region]) {
        addVolumeToTopic(keyword.topicId, region, marketVolumes[region]);
      }
    }

    for (const region of REGION_CODES) {
      const observation = browserRanks.get(`${keyword.id}:${region}`);
      latestRanks[region] = observation ? {
        rank: observation.rank, bucket: getRankBucket(observation.rank), source: observation.source as "gsc" | "ahrefs",
        periodStart: observation.periodStart?.toISOString().slice(0,10) ?? null,
        periodEnd: observation.periodEnd?.toISOString().slice(0,10) ?? null,
        url: observation.url, title: null, searchVolume: marketVolumes[region], checkedAt: observation.collectedAt.toISOString(),
        dataUpdatedAt: observation.dataUpdatedAt?.toISOString() ?? null, rankStatus: observation.rankStatus,
        previousRank: null, rankDelta: null, changed: false,
      } : null;
    }

    const knownRegionalVolumes = REGION_CODES.map(
      (region: SearchRegionCode) => marketVolumes[region],
    ).filter((volume): volume is number => volume !== null);

    return {
      id: keyword.id,
      text: keyword.text,
      type: keyword.type,
      topicId: membership?.topicId ?? keyword.topicId,
      topicText: membership?.topic?.text ?? keyword.topic?.text ?? null,
      topicTexts: [...new Set([membership?.topic?.text, ...(membership?.topicAssignments.map((assignment) => assignment.topic.text) ?? [])].filter((text): text is string => Boolean(text)))],
      origin: membership?.origin ?? "PLANNED",
      targetUrls: membership?.targetUrls ?? [],
      parentId: keyword.parentId,
      parentIds:
        keyword.childEdges.length > 0
          ? keyword.childEdges.map((edge) => edge.parentId)
          : keyword.parentId
            ? [keyword.parentId]
            : [],
      active: keyword.active,
      lastSyncedAt:
        [
          keyword.lastSyncedAt?.toISOString(),
          ...REGION_CODES.map((region) => latestRanks[region]?.checkedAt),
          ...REGION_CODES.map((region) =>
            browserVolumes
              .get(`${keyword.id}:${region}`)
              ?.collectedAt.toISOString(),
          ),
        ]
          .filter((value): value is string => Boolean(value))
          .sort()
          .at(-1) ?? null,
      volume:
        knownRegionalVolumes.length > 0 ? Math.max(...knownRegionalVolumes) : 0,
      marketVolumes,
      latestRanks,
    };
  });

  const dashboardTopics: DashboardTopic[] = topics.map((topic) => {
    const marketVolumes =
      topicVolumesById.get(topic.id) ?? emptyMarketVolumes();
    const knownRegionalVolumes = REGION_CODES.map(
      (region: SearchRegionCode) => marketVolumes[region],
    ).filter((volume): volume is number => volume !== null);

    return {
      id: topic.id,
      text: topic.text,
      type: topic.type,
      parentId: topic.parentId,
      parentIds: topicParentIdsById.get(topic.id) ?? [],
      active: topic.active,
      volume:
        knownRegionalVolumes.length > 0 ? Math.max(...knownRegionalVolumes) : 0,
      marketVolumes,
    };
  });

  const response: DashboardResponse = {
    latestImportAt: latestImport?.importedAt.toISOString() ?? null,
    usingDemoData: false,
    targetDomain: siteDomain,
    regions: REGION_CODES,
    topics: dashboardTopics,
    keywords: dashboardKeywords,
    latestRun: latestRun
      ? {
          id: latestRun.id,
          status: latestRun.status,
          startedAt: latestRun.startedAt.toISOString(),
          finishedAt: latestRun.finishedAt?.toISOString() ?? null,
          provider: latestRun.provider,
          summary: latestRun.summary as SyncRunSummary | null,
          errorMessage: latestRun.errorMessage,
        }
      : null,
  };

  return response;
}

async function loadSummary(source: string): Promise<DashboardResponse> {
  if (!isDatabaseConfigured()) return getDemoDashboard();
  const domains = ["flatkey.ai", "rackrate.org", "modelfit.cc"];
  const names = ["Flatkey", "RackRate", "ModelFit"];
  const parts: DashboardResponse[] = [];
  for (const domain of domains) parts.push(await loadDashboard(domain, source));
  return {
    usingDemoData: false, targetDomain: "全部网站", regions: REGION_CODES, latestRun: null,
    latestImportAt: parts.map((part) => part.latestImportAt).filter((date): date is string => Boolean(date)).sort().at(-1) ?? null,
    topics: parts.flatMap((part, index) => part.topics.map((topic) => ({ ...topic, id: `${domains[index]}:${topic.id}`, parentId: topic.parentId ? `${domains[index]}:${topic.parentId}` : null, parentIds: topic.parentIds.map((id) => `${domains[index]}:${id}`) }))),
    keywords: parts.flatMap((part, index) => part.keywords.map((keyword) => ({ ...keyword, siteDomain: domains[index], siteName: names[index], id: `${domains[index]}:${keyword.id}`, topicId: keyword.topicId ? `${domains[index]}:${keyword.topicId}` : null, parentId: keyword.parentId ? `${domains[index]}:${keyword.parentId}` : null, parentIds: keyword.parentIds.map((id) => `${domains[index]}:${id}`) }))),
  };
}

const cache = new Map<string, { value: DashboardResponse; expiresAt: number }>();
const pending = new Map<string, Promise<DashboardResponse>>();
export async function GET(request?: Request) {
  const params = request ? new URL(request.url).searchParams : new URLSearchParams();
  const siteDomain = params.get("site") ?? "all";
  const source = params.get("source") ?? "combined";
  if (!["all", "flatkey.ai", "rackrate.org", "modelfit.cc"].includes(siteDomain) || !["gsc", "ahrefs", "combined"].includes(source)) return NextResponse.json({ message: "参数无效" }, { status: 400 });
  const region = (params.get("region") ?? "US") as SearchRegionCode;
  if (!REGION_CODES.includes(region)) return NextResponse.json({ message: "地区无效" }, { status: 400 });
  const key = `${siteDomain}:${source}:${region}`;
  try {
    const cached = cache.get(key);
    if (cached && cached.expiresAt > Date.now()) return NextResponse.json(cached.value, { headers: { "Cache-Control": "private, no-store" } });
    if (!pending.has(key)) pending.set(key, retryDatabaseRead(() => siteDomain === "all" ? loadSummary(source) : loadDashboard(siteDomain, source)).then((value) => {
      cache.set(key, { value, expiresAt: Date.now() + 30000 });
      return value;
    }).finally(() => pending.delete(key)));
    return NextResponse.json(await pending.get(key), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    const code = databaseErrorCode(error);
    console.error("Dashboard read failed", { code });
    return NextResponse.json({ message: "数据暂时无法读取", code }, { status: 503, headers: { "Cache-Control": "no-store", "Retry-After": "2" } });
  }
}
