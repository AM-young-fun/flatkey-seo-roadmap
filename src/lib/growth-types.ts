/** Read-only growth projection. IDs identify the original site/word/market/language,
 * never a best-country allocation. Adding fields does not mutate source cohorts. */
export type GrowthMembership = "formal" | "opportunity" | "review";
export type GrowthLanguageStatus = "match" | "mismatch" | "unknown";
export type GrowthRankSource = "serp" | "database" | "gsc";
export type GrowthCaptureState = "ranked" | "outside100" | "incomplete" | "failed" | "unqueried";
/** Current trafficGoal means the Flatkey-only 3000 target, separate from data observation. */
export type GrowthSite = { domain: string; name: string; execution: boolean; keywordGoals: boolean; trafficGoal: boolean; dataOnly: boolean; dataReadiness?: { ga4Configured: boolean; sourceTimezone: string | null; reason: string; persistentGa4Configured?: boolean; collectorGa4Configured?: boolean; sourcePropertyId?: string | null; sourceVerifiedAt?: string | null; configurationSource?: string; metadataVerification?: string; apiPermissionVerified?: boolean; persistedPropertyMatches?: boolean | null } };
export type GrowthMarket = { country: string; language: string; label: string; priority: "primary" | "secondary" | "legacy"; plannedShare: number | null };
/** Same-page links preserve the original task's main keyword and scope. A
 * candidate is navigation evidence only, never a market assignment/approval. */
export type GrowthTaskRelation = {
  taskId: string; originalKeyword: string | null; country: string | null; language: string | null;
  pageUrl: string; source: "task_page" | "publication"; publicationId?: string;
  sourceKeywordId: string; status: "confirmed" | "candidate"; reason: string;
};
export type GrowthTarget = {
  id: string; keywordId: string | null; site: string; topicId: string | null; topicName: string | null;
  relatedTopicIds?: string[];
  keyword: string; country: string | null; language: string | null; membership: GrowthMembership;
  pageState: "published" | "planned" | "unmapped"; publishedUrls: string[]; plannedUrls: string[];
  workState: "planned" | "in_progress" | "completed" | "unknown";
  rank: number | null; rankUrl: string | null; rankSource: GrowthRankSource | null; checkedAt: string | null;
  captureScope?: string | null; capturePeriodKey?: string | null; captureRunId?: string | null;
  sourcePool?: string; membershipSource?: "stored_formal" | "committed_task" | "research" | "review";
  sourceActive?: boolean; aliasKeywordIds?: string[]; memberProvenance?: { keywordId: string; keyword: string; pool: string; active: boolean }[];
  wordLanguage?: string | null; planningProofs?: { kind: "formal_plan" | "publication"; id: string; taskId: string; country: string; language: string }[];
  relatedObservations?: { country: string; language: string | null; rank: number; url: string; source: GrowthRankSource; checkedAt: string | null; languageStatus: GrowthLanguageStatus }[];
  relatedObservationCount?: number;
  taskRelations?: GrowthTaskRelation[];
  languageStatus: GrowthLanguageStatus; languageReason: string; captureState: GrowthCaptureState;
  /** A fresh exact SERP + original word language match. Database/GSC evidence is shown separately. */
  rankEligible: boolean; observationEligible: boolean; monitoringEligible: boolean; taskIds: string[]; reason: string;
};
export type GrowthTopicMarket = { country: string | null; language: string | null; formalCount: number; publishedCount: number; rankedCount: number; top50Count: number };
export type GrowthTopic = {
  id: string; topicId: string; site: string; name: string; parentIds: string[]; targetIds: string[];
  formalCount: number; publishedCount: number; rankedCount: number; top50Count: number; markets: GrowthTopicMarket[];
  relatedCount?: number;
};
export type GrowthMonitoringQuery = { id: string; site: string; sites?: string[]; keyword: string; country: string; language: string; targetIds: string[]; urls: string[]; reason: string; approved: false; maxCostMicros: number | null };
export type GrowthHistoricalPeriod = { id: string; label: string; scope: string; cohortHash: string | null; originalTargetCount: number | null; originalQueryCount: number | null; checkedQueries: number; matchedRankedTargets: number; unknownLanguageTargets: number; mismatchedLanguageTargets: number; comparable: false; rawSnapshotPreserved: true };
export type GrowthWorkspace = {
  version: "growth-v1.5"; generatedAt: string; sites: GrowthSite[]; markets: GrowthMarket[];
  topics: GrowthTopic[]; targets: GrowthTarget[]; opportunities: GrowthTarget[];
  quarter?: { targetIds: string[]; keywordCount: number; hash: string };
  /** Approved, still-valid hotspot targets are extra; never grow quarterly N. */
  hotspotTargetIds?: string[];
  reconciliation: {
    formalCount: number; opportunityCount: number; reviewCount: number; totalCount: number;
    /** Raw word-text union across sites; not the formal target denominator. */
    uniqueKeywordCount: number; siteKeywordCount?: number; rankedCount: number; top50Count: number; publishedCount: number;
    countryCounts: { country: string; count: number; share: number | null }[];
    historicalLanguageReview: { version: string; rawSnapshotsPreserved: true; rows: number; matched: number; mismatched: number; unknown: number; comparableTrend: false; reason: string; periods?: GrowthHistoricalPeriod[] };
    sources: { name: string; available: boolean; reason: string | null }[]; notes: string[];
  };
  monitoringQuote: { approved: false; paidRequests: 0; queryCount: number; reusedCount: number; heldCount: number; maxCostMicros: number | null; queries: GrowthMonitoringQuery[]; reason: string };
};
