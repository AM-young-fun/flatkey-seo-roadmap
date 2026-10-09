import { NextResponse } from "next/server";
import type {
  DashboardKeyword,
  DashboardResponse,
  DashboardTopic,
  SyncRunSummary
} from "@/lib/types";
import { isDatabaseConfigured } from "@/lib/env";
import { getDemoDashboard } from "@/lib/demo-data";
import { prisma } from "@/lib/prisma";
import { REGION_CODES, type SearchRegionCode } from "@/lib/seo";
import { markStaleRankingSyncRuns } from "@/lib/services/sync-rankings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function emptyRanks(): DashboardKeyword["latestRanks"] {
  return REGION_CODES.reduce(
    (accumulator, region) => {
      accumulator[region] = null;
      return accumulator;
    },
    {} as DashboardKeyword["latestRanks"]
  );
}

function emptyMarketVolumes(): DashboardKeyword["marketVolumes"] {
  return REGION_CODES.reduce(
    (accumulator, region) => {
      accumulator[region] = null;
      return accumulator;
    },
    {} as DashboardKeyword["marketVolumes"]
  );
}

export async function GET() {
  if (!isDatabaseConfigured()) {
    return NextResponse.json(getDemoDashboard());
  }

  await markStaleRankingSyncRuns();

  const [topics, keywords, latestRun] = await Promise.all([
    prisma.topic.findMany({
      where: {
        active: true
      },
      include: {
        childEdges: {
          select: {
            parentId: true
          }
        }
      },
      orderBy: [
        {
          type: "asc"
        },
        {
          text: "asc"
        }
      ]
    }),
    prisma.keyword.findMany({
      where: {
        active: true,
        topicId: {
          not: null
        }
      },
      include: {
        topic: {
          select: {
            id: true,
            text: true
          }
        },
        snapshots: {
          orderBy: {
            checkedAt: "desc"
          },
          take: 18
        },
        diffs: {
          orderBy: {
            createdAt: "desc"
          },
          take: 18
        },
        volumes: {
          where: {
            source: {
              in: ["ahrefs", "csv"]
            }
          },
          orderBy: {
            fetchedAt: "desc"
          },
          take: 40
        },
        childEdges: {
          select: {
            parentId: true
          }
        }
      },
      orderBy: [
        {
          type: "asc"
        },
        {
          text: "asc"
        }
      ]
    }),
    prisma.syncRun.findFirst({
      orderBy: {
        startedAt: "desc"
      }
    })
  ]);

  const topicParentIdsById = new Map<string, string[]>();
  const topicVolumesById = new Map<string, DashboardTopic["marketVolumes"]>();

  topics.forEach((topic) => {
    topicParentIdsById.set(
      topic.id,
      topic.childEdges.length > 0
        ? topic.childEdges.map((edge) => edge.parentId)
        : topic.parentId
          ? [topic.parentId]
          : []
    );
    topicVolumesById.set(topic.id, emptyMarketVolumes());
  });

  function volumeForRegion(
    keyword: (typeof keywords)[number],
    region: SearchRegionCode
  ): number | null {
    return (
      keyword.volumes.find((item) => item.region === region && item.source === "ahrefs")?.volume ??
      keyword.volumes.find((item) => item.region === region && item.source === "csv")?.volume ??
      keyword.volumes.find((item) => item.region === region)?.volume ??
      (region === "US" && keyword.defaultVolume > 0 ? keyword.defaultVolume : null)
    );
  }

  function addVolumeToTopic(
    topicId: string | null,
    region: SearchRegionCode,
    volume: number,
    seen = new Set<string>()
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
    const latestRanks = emptyRanks();
    const marketVolumes = emptyMarketVolumes();

    for (const region of REGION_CODES) {
      marketVolumes[region] = volumeForRegion(keyword, region);

      if (marketVolumes[region]) {
        addVolumeToTopic(keyword.topicId, region, marketVolumes[region]);
      }
    }

    for (const region of REGION_CODES) {
      const snapshot = keyword.snapshots.find((item) => item.region === region);
      const diff =
        keyword.diffs.find(
          (item) => item.region === region && (!snapshot?.runId || item.runId === snapshot.runId)
        ) ?? keyword.diffs.find((item) => item.region === region);

      latestRanks[region] = snapshot
        ? {
            rank: snapshot.rank,
            bucket: snapshot.bucket,
            url: snapshot.url,
            title: snapshot.title,
            searchVolume: marketVolumes[region],
            checkedAt: snapshot.checkedAt.toISOString(),
            previousRank: diff?.previousRank ?? null,
            rankDelta: diff?.rankDelta ?? null,
            changed: diff?.changed ?? false
          }
        : null;
    }

    const knownRegionalVolumes = REGION_CODES.map(
      (region: SearchRegionCode) => marketVolumes[region]
    ).filter(
      (volume): volume is number => volume !== null
    );

    return {
      id: keyword.id,
      text: keyword.text,
      type: keyword.type,
      topicId: keyword.topicId,
      topicText: keyword.topic?.text ?? null,
      parentId: keyword.parentId,
      parentIds:
        keyword.childEdges.length > 0
          ? keyword.childEdges.map((edge) => edge.parentId)
          : keyword.parentId
            ? [keyword.parentId]
            : [],
      active: keyword.active,
      lastSyncedAt: keyword.lastSyncedAt?.toISOString() ?? null,
      volume: knownRegionalVolumes.length > 0 ? Math.max(...knownRegionalVolumes) : 0,
      marketVolumes,
      latestRanks
    };
  });

  const dashboardTopics: DashboardTopic[] = topics.map((topic) => {
    const marketVolumes = topicVolumesById.get(topic.id) ?? emptyMarketVolumes();
    const knownRegionalVolumes = REGION_CODES.map(
      (region: SearchRegionCode) => marketVolumes[region]
    ).filter((volume): volume is number => volume !== null);

    return {
      id: topic.id,
      text: topic.text,
      type: topic.type,
      parentId: topic.parentId,
      parentIds: topicParentIdsById.get(topic.id) ?? [],
      active: topic.active,
      volume: knownRegionalVolumes.length > 0 ? Math.max(...knownRegionalVolumes) : 0,
      marketVolumes
    };
  });

  const response: DashboardResponse = {
    usingDemoData: false,
    targetDomain: process.env.SEO_TARGET_DOMAIN || null,
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
          errorMessage: latestRun.errorMessage
        }
      : null
  };

  return NextResponse.json(response);
}
