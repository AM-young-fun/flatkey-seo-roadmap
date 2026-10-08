import {
  RankBucket as PrismaRankBucket,
  RunStatus,
  SearchRegion
} from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { envString, isDatabaseConfigured } from "@/lib/env";
import {
  getRankBucket,
  REGION_CODES,
  type SearchRegionCode
} from "@/lib/seo";
import { fetchAhrefsVolume } from "@/lib/providers/ahrefs";
import { fetchGoogleRanking } from "@/lib/providers/google";

type SyncError = {
  keyword: string;
  region: SearchRegionCode;
  message: string;
};

type SyncSummary = {
  keywords: number;
  regions: number;
  snapshots: number;
  diffs: number;
  volumes: number;
  errors: SyncError[];
  warnings: SyncError[];
};

function asSearchRegion(region: SearchRegionCode): SearchRegion {
  return region as SearchRegion;
}

function asRankBucket(bucket: ReturnType<typeof getRankBucket>): PrismaRankBucket {
  return bucket as PrismaRankBucket;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function runDailyRankingSync() {
  if (!isDatabaseConfigured()) {
    return {
      status: RunStatus.FAILED,
      runId: null,
      summary: {
        keywords: 0,
        regions: REGION_CODES.length,
        snapshots: 0,
        diffs: 0,
        volumes: 0,
        errors: [
          {
            keyword: "*",
            region: "US" as SearchRegionCode,
            message: "DATABASE_URL is not configured"
          }
        ],
        warnings: []
      } satisfies SyncSummary
    };
  }

  const targetDomain = envString("SEO_TARGET_DOMAIN");
  const provider = envString("GOOGLE_SEARCH_PROVIDER", "serpapi");
  const run = await prisma.syncRun.create({
    data: {
      status: RunStatus.RUNNING,
      provider,
      regions: REGION_CODES.map(asSearchRegion)
    }
  });

  const summary: SyncSummary = {
    keywords: 0,
    regions: REGION_CODES.length,
    snapshots: 0,
    diffs: 0,
    volumes: 0,
    errors: [],
    warnings: []
  };

  try {
    const keywords = await prisma.keyword.findMany({
      where: {
        active: true
      },
      orderBy: [
        {
          type: "asc"
        },
        {
          text: "asc"
        }
      ]
    });

    summary.keywords = keywords.length;

    for (const keyword of keywords) {
      const ahrefsVolumes: number[] = [];

      for (const region of REGION_CODES) {
        try {
          const previousSnapshot = await prisma.rankingSnapshot.findFirst({
            where: {
              keywordId: keyword.id,
              region: asSearchRegion(region)
            },
            orderBy: {
              checkedAt: "desc"
            }
          });

          const ranking = await fetchGoogleRanking(keyword.text, region, targetDomain);
          let volume: number | null = null;

          try {
            const ahrefs = await fetchAhrefsVolume(keyword.text, region);
            if (ahrefs.source === "ahrefs") {
              volume = ahrefs.volume;
              ahrefsVolumes.push(ahrefs.volume);
            } else {
              summary.warnings.push({
                keyword: keyword.text,
                region,
                message: "Ahrefs volume unavailable; skipped demo fallback"
              });
            }
          } catch (error) {
            summary.warnings.push({
              keyword: keyword.text,
              region,
              message: `Ahrefs volume fallback: ${errorMessage(error)}`
            });
          }

          if (volume !== null) {
            await prisma.keywordVolume.create({
              data: {
                keywordId: keyword.id,
                runId: run.id,
                region: asSearchRegion(region),
                volume,
                source: "ahrefs"
              }
            });

            summary.volumes += 1;
          }

          const bucket = getRankBucket(ranking.rank);
          const currentBucket = asRankBucket(bucket);
          const previousRank = previousSnapshot?.rank ?? null;
          const previousBucket = previousSnapshot?.bucket ?? null;
          const rankDelta =
            previousRank !== null && ranking.rank !== null ? previousRank - ranking.rank : null;
          const changed = Boolean(
            previousSnapshot &&
              (previousSnapshot.rank !== ranking.rank || previousSnapshot.bucket !== currentBucket)
          );

          await prisma.rankingSnapshot.create({
            data: {
              keywordId: keyword.id,
              runId: run.id,
              region: asSearchRegion(region),
              rank: ranking.rank,
              bucket: currentBucket,
              url: ranking.url,
              title: ranking.title,
              searchVolume: volume
            }
          });

          summary.snapshots += 1;

          await prisma.rankingDiff.create({
            data: {
              keywordId: keyword.id,
              runId: run.id,
              region: asSearchRegion(region),
              previousRank,
              currentRank: ranking.rank,
              rankDelta,
              previousBucket,
              currentBucket,
              changed
            }
          });

          summary.diffs += 1;

        } catch (error) {
          summary.errors.push({
            keyword: keyword.text,
            region,
            message: errorMessage(error)
          });
        }
      }

      if (ahrefsVolumes.length > 0) {
        await prisma.keyword.update({
          where: {
            id: keyword.id
          },
          data: {
            defaultVolume: Math.max(...ahrefsVolumes)
          }
        });
      }
    }

    const status =
      summary.errors.length === 0
        ? RunStatus.SUCCESS
        : summary.snapshots > 0
          ? RunStatus.PARTIAL
          : RunStatus.FAILED;

    await prisma.syncRun.update({
      where: {
        id: run.id
      },
      data: {
        status,
        finishedAt: new Date(),
        summary,
        errorMessage:
          summary.errors.length > 0
            ? summary.errors
                .slice(0, 3)
                .map((error) => `${error.keyword}/${error.region}: ${error.message}`)
                .join("; ")
            : null
      }
    });

    return {
      status,
      runId: run.id,
      summary
    };
  } catch (error) {
    const message = errorMessage(error);

    await prisma.syncRun.update({
      where: {
        id: run.id
      },
      data: {
        status: RunStatus.FAILED,
        finishedAt: new Date(),
        errorMessage: message,
        summary
      }
    });

    throw error;
  }
}
