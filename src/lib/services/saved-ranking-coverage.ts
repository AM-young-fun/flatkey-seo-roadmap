import { prisma } from "@/lib/prisma";
import { summarizeSavedRankings, type CoverageSelection } from "@/lib/saved-ranking-coverage";

export async function loadSavedRankingCoverage(selection: CoverageSelection) {
  const runs = await prisma.dataForSeoRun.findMany({ where: { siteDomain: "flatkey.ai", requestId: { in: selection.runIds } },
    select: { requestId: true, siteDomain: true, status: true, normalized: true, collectedAt: true, completedAt: true } });
  return summarizeSavedRankings(selection, runs);
}
