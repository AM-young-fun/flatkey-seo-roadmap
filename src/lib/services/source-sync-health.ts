import { prisma } from "@/lib/prisma";
import { SOURCE_SYNC_SOURCES } from "@/lib/source-sync";
import { buildSourceSyncHealth, type SourceSyncHealthResponse } from "@/lib/source-sync-health";
import { collectorRunSchema } from "@/lib/collector-runs";

export async function loadSourceSyncHealth(): Promise<SourceSyncHealthResponse> {
  // Metadata only: this does not read a DingTalk document, inspect credentials,
  // update a source timestamp or invoke a ranking/search-volume provider.
  const [rows,lastCheck] = await Promise.all([prisma.keywordSourceRow.groupBy({
    by: ["sourceId"],
    where: { siteDomain: "flatkey.ai", sourceId: { in: Object.keys(SOURCE_SYNC_SOURCES) } },
    _count: { _all: true },
    _max: { observedAt: true, updatedAt: true },
  }),prisma.collectorRun.findFirst({where:{kind:"SHEETS"},orderBy:{updatedAt:"desc"},select:{status:true,periodStart:true,sourceChecks:true,completedAt:true,checkedItems:true}})]);
  const health=buildSourceSyncHealth(rows.map(row => ({
    sourceId: row.sourceId,
    rowCount: row._count._all,
    lastChangedAt: row._max.updatedAt,
    lastChangedSourceReadAt: row._max.observedAt,
  })));
  if(lastCheck?.completedAt && collectorRunSchema.safeParse({kind:"SHEETS",status:lastCheck.status,periodStart:lastCheck.periodStart,sourceChecks:lastCheck.sourceChecks,checkedItems:lastCheck.checkedItems}).success && lastCheck.status==="COMPLETED")health.dailyCheck={...health.dailyCheck,confirmed:true,lastCompletedAt:lastCheck.completedAt.toISOString()};
  return health;
}
