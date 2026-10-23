export type SerpTaskState = "PLANNED" | "SUBMITTING" | "QUEUED" | "RECEIVED" | "COMPLETE" | "INCOMPLETE" | "FAILED" | "UNKNOWN";
export type SerpRunState = "PLANNED" | "RUNNING" | "COMPLETED" | "PARTIAL" | "FAILED" | "UNKNOWN";
export type SerpRegion = "US" | "JP" | "ES" | "BR";
export type SerpMonitorConfiguration = {
  region: SerpRegion; languageCode: "en" | "ja" | "es" | "pt"; locationCode: 2840 | 2392 | 2724 | 2076; device: "desktop";
  regions: SerpRegion[];
  depth: 100; intervalDays: 14; paidEnabled: boolean;
  schedule: "BIWEEKLY_TUESDAY"; scheduleDays: [4]; timezone: "Asia/Shanghai"; localTime: "08:00";
  maxRunCostMicros: number; maxMonthCostMicros: number; revision: number; nextDueAt: string | null;
};
export type SerpQuote = {
  targetCount: number; queryCount: number; sharedQueriesSaved: number;
  keywordQueryCount: number; markets: SerpRegion[]; marketCount: number;
  perQueryMaxCostMicros: number; maxCostMicros: number;
  annualRuns: 26; annualCostMicros: number; monthlyAverageMicros: number;
  batchCount: number; provider: "dataforseo_serp"; mode: "standard";
  pricingUrl: string; pricedAt: "2026-10-16";
};
export type SerpMonitorRunDto = {
  id: string; scope: "SCHEDULED" | "SAMPLE" | "OPTIMIZED_PAGE"; status: SerpRunState; targetCount: number; queryCount: number;
  estimatedCostMicros: number; reservedCostMicros: number; actualCostMicros: number | null;
  startedAt: string; completedAt: string | null; errorCode: string | null;
  periodKey: string; periodLabel: string; periodStart: string; periodEnd: string;
  taskCounts: Partial<Record<SerpTaskState, number>>;
};
export type SerpMonitorStatus = {
  config: SerpMonitorConfiguration;
  cronConfigured: boolean;
  gate: { environmentEnabled: boolean; persistedEnabled: boolean; canSpend: boolean };
  connection: { configured: boolean; loginMasked: string | null };
  cohort: { hash: string; targetCount: number; queryCount: number; allTargetCount: number; heldTargetCount: number; bySite: Record<string, number> };
  quote: SerpQuote;
  budget: { monthReservedCostMicros: number; monthLimitMicros: number };
  runs: SerpMonitorRunDto[];
};
export type SerpMonitorPreview = {
  action: "preview"; cohortHash: string; quote: SerpQuote;
  configuration: SerpMonitorConfiguration; paidEnabled: false;
  message: string;
};
export type SerpOrganicResult = { url: string; domain: string; title: string | null; rankGroup: number; rankAbsolute: number | null };
export type SerpNormalizedResult = {
  normalizationVersion: 2; captureComplete: boolean; organicCount: number; coveredThroughRank: number;
  queryStatus: "EXACT" | "AUTOCORRECTED"; correctedKeyword: string | null; spellType: string | null; pagesCount: number | null;
  providerTaskId: string; keyword: string; locationCode: number; languageCode: string; device: string;
  checkedAt: string; googleUrl: string | null; organicResults: SerpOrganicResult[];
  completeDepth: boolean; rankingVerified: boolean; maxOrganicRank: number;
};
