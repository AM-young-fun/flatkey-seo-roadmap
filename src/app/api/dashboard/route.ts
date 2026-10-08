import { NextResponse } from "next/server";
import type { DashboardKeyword, DashboardResponse } from "@/lib/types";
import { isDatabaseConfigured } from "@/lib/env";
import { getDemoDashboard } from "@/lib/demo-data";
import { prisma } from "@/lib/prisma";
import { REGION_CODES, type SearchRegionCode } from "@/lib/seo";

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

export async function GET() {
  if (!isDatabaseConfigured()) {
    return NextResponse.json(getDemoDashboard());
  }

  const [keywords, latestRun] = await Promise.all([
    prisma.keyword.findMany({
      where: {
        active: true
      },
      include: {
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
          orderBy: {
            fetchedAt: "desc"
          },
          take: 18
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

  const dashboardKeywords: DashboardKeyword[] = keywords.map((keyword) => {
    const latestRanks = emptyRanks();

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
            searchVolume: snapshot.searchVolume,
            checkedAt: snapshot.checkedAt.toISOString(),
            previousRank: diff?.previousRank ?? null,
            rankDelta: diff?.rankDelta ?? null,
            changed: diff?.changed ?? false
          }
        : null;
    }

    const regionalVolumes = REGION_CODES.map((region: SearchRegionCode) => {
      const fromSnapshot = latestRanks[region]?.searchVolume ?? 0;
      const fromVolume = keyword.volumes.find((item) => item.region === region)?.volume ?? 0;
      return Math.max(fromSnapshot, fromVolume);
    });

    return {
      id: keyword.id,
      text: keyword.text,
      type: keyword.type,
      parentId: keyword.parentId,
      active: keyword.active,
      volume: Math.max(keyword.defaultVolume, ...regionalVolumes),
      latestRanks
    };
  });

  const response: DashboardResponse = {
    usingDemoData: false,
    targetDomain: process.env.SEO_TARGET_DOMAIN || null,
    regions: REGION_CODES,
    keywords: dashboardKeywords,
    latestRun: latestRun
      ? {
          id: latestRun.id,
          status: latestRun.status,
          startedAt: latestRun.startedAt.toISOString(),
          finishedAt: latestRun.finishedAt?.toISOString() ?? null,
          provider: latestRun.provider,
          summary: latestRun.summary,
          errorMessage: latestRun.errorMessage
        }
      : null
  };

  return NextResponse.json(response);
}
