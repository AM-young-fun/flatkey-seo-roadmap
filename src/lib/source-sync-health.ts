import { SOURCE_SYNC_SOURCES, type SourceSyncPayload } from "./source-sync";

export type SourceSyncHealthSource = {
  sourceId: SourceSyncPayload["sourceId"];
  label: string;
  sheetName: string;
  url: string;
  storedRows: number;
  lastChangedAt: string | null;
  // Source read time of a stored, changed row. Unchanged reads intentionally
  // write nothing, so this must never be presented as a completed daily check.
  lastChangedSourceReadAt: string | null;
  status: "NO_BASELINE" | "BASELINE_AVAILABLE";
};

export type SourceSyncHealthResponse = {
  siteDomain: "flatkey.ai";
  connection: {
    mode: "EXTERNAL_COLLECTOR";
    serverPullConfigured: boolean;
    needsDingTalkAuthorization: false;
  };
  dailyCheck: {
    timezone: "Asia/Shanghai";
    expectedLocalTime: "10:30";
    confirmed: boolean;
    lastCompletedAt: string | null;
  };
  sources: SourceSyncHealthSource[];
  checks?: {sourceId:string;completedAt:string|null;status:string;detail:string|null}[];
};

export type SourceHealthMetadata = {
  sourceId: string;
  rowCount: number;
  lastChangedAt: Date | string | null;
  lastChangedSourceReadAt: Date | string | null;
};

const labels: Record<SourceSyncPayload["sourceId"], { label: string; sheetName: string }> = {
  api_main: { label: "API 内容协作表", sheetName: "总表" },
  cloud_main: { label: "云服务内容协作表", sheetName: "总表" },
  optimization: { label: "SEO 优化协作表", sheetName: "SEO优化清单" },
};

function iso(value: Date | string | null): string | null {
  if (!value) return null;
  const time = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

export function buildSourceSyncHealth(metadata: SourceHealthMetadata[]): SourceSyncHealthResponse {
  const bySource = new Map(metadata.map(row => [row.sourceId, row]));
  return {
    siteDomain: "flatkey.ai",
    connection: { mode: "EXTERNAL_COLLECTOR", serverPullConfigured: false, needsDingTalkAuthorization: false },
    dailyCheck: { timezone: "Asia/Shanghai", expectedLocalTime: "10:30", confirmed: false, lastCompletedAt: null },
    sources: (Object.keys(SOURCE_SYNC_SOURCES) as SourceSyncPayload["sourceId"][]).map(sourceId => {
      const row = bySource.get(sourceId);
      const storedRows = row && Number.isInteger(row.rowCount) && row.rowCount > 0 ? row.rowCount : 0;
      return {
        sourceId, ...labels[sourceId], url: SOURCE_SYNC_SOURCES[sourceId].url, storedRows,
        lastChangedAt: storedRows ? iso(row?.lastChangedAt ?? null) : null,
        lastChangedSourceReadAt: storedRows ? iso(row?.lastChangedSourceReadAt ?? null) : null,
        status: storedRows ? "BASELINE_AVAILABLE" : "NO_BASELINE",
      };
    }),
  };
}
