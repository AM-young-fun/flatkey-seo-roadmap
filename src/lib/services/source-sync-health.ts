import { prisma } from "@/lib/prisma";
import { SOURCE_SYNC_SOURCES } from "@/lib/source-sync";
import { buildSourceSyncHealth, type SourceSyncHealthResponse } from "@/lib/source-sync-health";

export async function loadSourceSyncHealth(): Promise<SourceSyncHealthResponse> {
  // Metadata only: this does not read a DingTalk document, inspect credentials,
  // update a source timestamp or invoke a ranking/search-volume provider.
  const [rows,config,checks] = await Promise.all([prisma.keywordSourceRow.groupBy({
    by: ["sourceId"],
    where: { siteDomain: "flatkey.ai", sourceId: { in: Object.keys(SOURCE_SYNC_SOURCES) } },
    _count: { _all: true },
    _max: { observedAt: true, updatedAt: true },
  }),prisma.projectAutomation.findUnique({where:{id:"default"},select:{workerSeenAt:true}}),prisma.projectJob.findMany({where:{kind:"SHEETS"},orderBy:{dueAt:"desc"},take:3,select:{sourceId:true,status:true,completedAt:true,detail:true,periodStart:true}})]);
  const health=buildSourceSyncHealth(rows.map(row => ({
    sourceId: row.sourceId,
    rowCount: row._count._all,
    lastChangedAt: row._max.updatedAt,
    lastChangedSourceReadAt: row._max.observedAt,
  })));
  health.connection.serverPullConfigured=Boolean(config?.workerSeenAt && Date.now()-config.workerSeenAt.getTime()<5*60000);
  health.checks=checks.map(row=>({sourceId:row.sourceId!,completedAt:row.completedAt?.toISOString()??null,status:row.status,detail:row.detail}));
  const completed=checks.length===3&&checks.every(row=>row.status==="COMPLETED"&&row.periodStart===checks[0].periodStart);
  health.dailyCheck.confirmed=completed;
  health.dailyCheck.lastCompletedAt=completed?checks.map(row=>row.completedAt!.toISOString()).sort().at(-1)!:null;
  return health;
}
