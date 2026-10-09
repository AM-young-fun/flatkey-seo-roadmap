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
  totalChecks: number;
  processed: number;
  currentKeyword: string | null;
  currentRegion: SearchRegionCode | null;
  resumed: boolean;
  resumedRunId: string | null;
  skippedDaily: number;
  skippedCompleted: number;
  startedAt: string;
  updatedAt: string;
  snapshots: number;
  diffs: number;
  volumes: number;
  errors: SyncError[];
  warnings: SyncError[];
};

const SYNC_STALE_AFTER_MS = 6 * 60 * 1000;
const SYNC_MISSING_PROGRESS_STALE_AFTER_MS = 90 * 1000;
const PROGRESS_UPDATE_INTERVAL = 5;
const SYNC_DAY_UTC_OFFSET_MINUTES = 8 * 60;

function asSearchRegion(region: SearchRegionCode): SearchRegion {
  return region as SearchRegion;
}

function asRankBucket(bucket: ReturnType<typeof getRankBucket>): PrismaRankBucket {
  return bucket as PrismaRankBucket;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function startOfSyncDay(date: Date): Date {
  const offsetMs = SYNC_DAY_UTC_OFFSET_MINUTES * 60 * 1000;
  const shiftedDate = new Date(date.getTime() + offsetMs);
  const shiftedStart = Date.UTC(
    shiftedDate.getUTCFullYear(),
    shiftedDate.getUTCMonth(),
    shiftedDate.getUTCDate()
  );

  return new Date(shiftedStart - offsetMs);
}

function endOfSyncDay(date: Date): Date {
  return new Date(startOfSyncDay(date).getTime() + 24 * 60 * 60 * 1000);
}

function checkKey(keywordId: string, region: SearchRegionCode | SearchRegion): string {
  return `${keywordId}:${region}`;
}

function wasSyncedOnDay(
  lastSyncedAt: Date | null,
  dayStart: Date,
  dayEnd: Date
): boolean {
  return Boolean(lastSyncedAt && lastSyncedAt >= dayStart && lastSyncedAt < dayEnd);
}

export async function markStaleRankingSyncRuns() {
  if (!isDatabaseConfigured()) {
    return;
  }

  const now = new Date();

  await prisma.syncRun.updateMany({
    where: {
      status: RunStatus.RUNNING,
      startedAt: {
        lt: new Date(now.getTime() - SYNC_STALE_AFTER_MS)
      }
    },
    data: {
      status: RunStatus.FAILED,
      finishedAt: now,
      errorMessage: "Sync stopped before completion"
    }
  });

  await prisma.$executeRaw`
    UPDATE "SyncRun"
    SET
      "status" = 'FAILED'::"RunStatus",
      "finishedAt" = ${now},
      "errorMessage" = 'Sync stopped before progress tracking started'
    WHERE "status" = 'RUNNING'::"RunStatus"
      AND "summary" IS NULL
      AND "startedAt" < ${new Date(now.getTime() - SYNC_MISSING_PROGRESS_STALE_AFTER_MS)}
  `;
}

export async function runDailyRankingSync() {
  if (!isDatabaseConfigured()) {
    const now = new Date().toISOString();

    return {
      status: RunStatus.FAILED,
      runId: null,
      summary: {
        keywords: 0,
        regions: REGION_CODES.length,
        totalChecks: 0,
        processed: 0,
        currentKeyword: null,
        currentRegion: null,
        resumed: false,
        resumedRunId: null,
        skippedDaily: 0,
        skippedCompleted: 0,
        startedAt: now,
        updatedAt: now,
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

  await markStaleRankingSyncRuns();

  const runningRun = await prisma.syncRun.findFirst({
    where: {
      status: RunStatus.RUNNING
    },
    orderBy: {
      startedAt: "desc"
    }
  });

  if (runningRun) {
    return {
      status: RunStatus.RUNNING,
      runId: runningRun.id,
      summary: runningRun.summary
    };
  }

  const now = new Date();
  const dayStart = startOfSyncDay(now);
  const dayEnd = endOfSyncDay(now);
  const targetDomain = envString("SEO_TARGET_DOMAIN");
  const provider = envString("GOOGLE_SEARCH_PROVIDER", "serpapi");
  const resumableRun = await prisma.syncRun.findFirst({
    where: {
      status: {
        in: [RunStatus.FAILED, RunStatus.PARTIAL]
      },
      provider,
      startedAt: {
        gte: dayStart,
        lt: dayEnd
      }
    },
    orderBy: {
      startedAt: "desc"
    }
  });
  const run = resumableRun
    ? await prisma.syncRun.update({
        where: {
          id: resumableRun.id
        },
        data: {
          status: RunStatus.RUNNING,
          finishedAt: null,
          errorMessage: null
        }
      })
    : await prisma.syncRun.create({
        data: {
          status: RunStatus.RUNNING,
          provider,
          regions: REGION_CODES.map(asSearchRegion)
        }
      });
  const startedAt = run.startedAt.toISOString();

  const [existingDiffs, existingSnapshots, existingVolumes] = await Promise.all([
    prisma.rankingDiff.findMany({
      where: {
        runId: run.id
      },
      select: {
        keywordId: true,
        region: true
      }
    }),
    prisma.rankingSnapshot.count({
      where: {
        runId: run.id
      }
    }),
    prisma.keywordVolume.count({
      where: {
        runId: run.id
      }
    })
  ]);
  const completedChecks = new Set(
    existingDiffs.map((diff) => checkKey(diff.keywordId, diff.region))
  );

  const summary: SyncSummary = {
    keywords: 0,
    regions: REGION_CODES.length,
    totalChecks: 0,
    processed: completedChecks.size,
    currentKeyword: null,
    currentRegion: null,
    resumed: Boolean(resumableRun),
    resumedRunId: resumableRun?.id ?? null,
    skippedDaily: 0,
    skippedCompleted: completedChecks.size,
    startedAt,
    updatedAt: startedAt,
    snapshots: existingSnapshots,
    diffs: existingDiffs.length,
    volumes: existingVolumes,
    errors: [],
    warnings: []
  };

  async function persistRunningSummary(force = false) {
    if (!force && summary.processed % PROGRESS_UPDATE_INTERVAL !== 0) {
      return;
    }

    summary.updatedAt = new Date().toISOString();

    await prisma.syncRun.update({
      where: {
        id: run.id
      },
      data: {
        status: RunStatus.RUNNING,
        summary
      }
    });
  }

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
    summary.totalChecks = keywords.length * REGION_CODES.length;
    const activeKeywordIds = new Set(keywords.map((keyword) => keyword.id));

    for (const key of Array.from(completedChecks)) {
      const keywordId = key.split(":")[0];

      if (!activeKeywordIds.has(keywordId)) {
        completedChecks.delete(key);
      }
    }

    summary.processed = completedChecks.size;
    summary.skippedCompleted = completedChecks.size;
    await persistRunningSummary(true);

    for (const keyword of keywords) {
      const syncedToday = wasSyncedOnDay(keyword.lastSyncedAt, dayStart, dayEnd);

      if (syncedToday) {
        for (const region of REGION_CODES) {
          if (completedChecks.has(checkKey(keyword.id, region))) {
            continue;
          }

          summary.processed += 1;
          summary.skippedDaily += 1;
          summary.currentKeyword = keyword.text;
          summary.currentRegion = region;
          await persistRunningSummary(summary.processed === summary.totalChecks);
        }

        continue;
      }

      for (const region of REGION_CODES) {
        const currentCheckKey = checkKey(keyword.id, region);

        if (completedChecks.has(currentCheckKey)) {
          continue;
        }

        summary.currentKeyword = keyword.text;
        summary.currentRegion = region;
        const errorsBefore = summary.errors.length;
        let completed = false;

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
          completed = true;
          completedChecks.add(currentCheckKey);

        } catch (error) {
          summary.errors.push({
            keyword: keyword.text,
            region,
            message: errorMessage(error)
          });
        } finally {
          summary.processed += 1;
          await persistRunningSummary(
            completed || summary.processed === summary.totalChecks || summary.errors.length > errorsBefore
          );
        }
      }

      const keywordCompleted = REGION_CODES.every((region) =>
        completedChecks.has(checkKey(keyword.id, region))
      );

      if (keywordCompleted) {
        const runVolumes = await prisma.keywordVolume.findMany({
          where: {
            keywordId: keyword.id,
            runId: run.id,
            source: "ahrefs"
          },
          select: {
            volume: true
          }
        });

        await prisma.keyword.update({
          where: {
            id: keyword.id
          },
          data: {
            ...(runVolumes.length > 0
              ? { defaultVolume: Math.max(...runVolumes.map((item) => item.volume)) }
              : {}),
            lastSyncedAt: new Date()
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
    summary.currentKeyword = null;
    summary.currentRegion = null;
    summary.updatedAt = new Date().toISOString();

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
    summary.updatedAt = new Date().toISOString();

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
