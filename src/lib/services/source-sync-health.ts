import { prisma } from "@/lib/prisma";
import { SOURCE_SYNC_SOURCES } from "@/lib/source-sync";
import { buildSourceSyncHealth, type SourceSyncHealthResponse } from "@/lib/source-sync-health";

export async function loadSourceSyncHealth(): Promise<SourceSyncHealthResponse> {
  // Metadata only: this does not read a DingTalk document, inspect credentials,
  // update a source timestamp or invoke a ranking/search-volume provider.
  const rows = await prisma.keywordSourceRow.groupBy({
    by: ["sourceId"],
    where: { siteDomain: "flatkey.ai", sourceId: { in: Object.keys(SOURCE_SYNC_SOURCES) } },
    _count: { _all: true },
    _max: { observedAt: true, updatedAt: true },
  });
  return buildSourceSyncHealth(rows.map(row => ({
    sourceId: row.sourceId,
    rowCount: row._count._all,
    lastChangedAt: row._max.updatedAt,
    lastChangedSourceReadAt: row._max.observedAt,
  })));
}
