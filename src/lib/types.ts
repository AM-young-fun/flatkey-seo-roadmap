import type { RankBucket, SearchRegionCode } from "@/lib/seo";

export type KeywordType = "MAIN" | "LONG_TAIL";
export type TopicType = "MAIN" | "SUB_TOPIC";
export type RankingSource = "gsc" | "ahrefs" | "dataforseo_labs" | "dataforseo_serp";
export type RankingStatus = "ranked" | "outside_top100" | "not_found_capture" | "query_changed" | "no_data" | "pending" | "queued" | "failed" | "incomplete";
export type RankingReportingPeriod = { start: string; end: string; label: string };

export type RankingPageEvidence = {
  url: string;
  rank: number | null;
  clicks: number | null;
  impressions: number | null;
  ctr: number | null;
  periodStart: string | null;
  periodEnd: string | null;
  dataDate: string | null;
  checkedAt: string;
  importedAt: string | null;
  dataUpdatedAt: string | null;
  serpVerification: "unverified" | "verified";
  rankGroup?: number;
  rankAbsolute?: number | null;
};

export type RankingEvidence = {
  source: RankingSource;
  // A page report never supplies the site's query-level average or position.
  scope: "query" | "pages" | "daily";
  rank: number | null;
  rankStatus: RankingStatus;
  clicks: number | null;
  impressions: number | null;
  ctr: number | null;
  url: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  dataDate: string | null;
  checkedAt: string;
  importedAt: string | null;
  dataUpdatedAt: string | null;
  pages: RankingPageEvidence[];
  daily?: RankingDailyEvidence[];
  serpVerification: "unverified" | "verified";
  runId?: string | null;
  providerTaskId?: string | null;
  googleUrl?: string | null;
  periodKey?: string | null;
  periodLabel?: string | null;
  depthIncomplete?: boolean;
  runScope?: "SCHEDULED" | "SAMPLE" | null;
  runTargetCount?: number | null;
  captureComplete?: boolean;
  organicCount?: number | null;
  coveredThroughRank?: number | null;
  queryStatus?: "EXACT" | "AUTOCORRECTED" | null;
  correctedKeyword?: string | null;
  spellType?: string | null;
  pagesCount?: number | null;
};

export type RankingDailyEvidence = Omit<RankingPageEvidence, "url"> & {
  date: string;
  source: RankingSource;
  rankStatus: RankingStatus;
  url: string | null;
  pages: RankingPageEvidence[];
};

export type RegionalVolumeReview = {
  status: "positive" | "sustained_zero" | "unknown" | "stale" | "incomplete";
  latestVolume: number | null;
  latestDataDate: string | null;
  sampleCount: number;
  zeroSamples: number;
  zeroSpanDays: number;
  largestGapDays: number | null;
  lastPositiveDate: string | null;
  hasPositiveVolume: boolean;
  isSustainedZero: boolean;
  reason: string;
};

export type KeywordVolumeReview = {
  status: "protected" | "new_term" | "candidate" | "insufficient_evidence";
  isCandidate: boolean;
  label: string;
  reasons: string[];
  firstTrackedAt: string | null;
  trackedDays: number | null;
  regions: Record<SearchRegionCode, RegionalVolumeReview>;
};

export type RankSummary = {
  dataUpdatedAt?: string | null;
  dataDate?: string | null;
  serpVerification?: "unverified" | "verified";
  clicks?: number | null;
  impressions?: number | null;
  ctr?: number | null;
  rankStatus?: string;
  source?: RankingSource | "serpapi";
  periodStart?: string | null;
  periodEnd?: string | null;
  rank: number | null;
  bucket: RankBucket;
  url: string | null;
  title: string | null;
  searchVolume: number | null;
  checkedAt: string | null;
  previousRank: number | null;
  rankDelta: number | null;
  changed: boolean;
  runId?: string | null;
  providerTaskId?: string | null;
  googleUrl?: string | null;
  errorCode?: string | null;
  periodKey?: string | null;
  periodLabel?: string | null;
  previousPeriodKey?: string | null;
  previousPeriodLabel?: string | null;
  previousRankStatus?: "ranked" | "outside_top100" | null;
  previousCheckedAt?: string | null;
  movement?: "UP" | "DOWN" | "UNCHANGED" | "NEW_IN_TOP100" | "DROPPED_OUT" | "FIRST_CHECK" | "NOT_COMPARABLE";
  depthIncomplete?: boolean;
  runScope?: "SCHEDULED" | "SAMPLE" | null;
  runTargetCount?: number | null;
  captureComplete?: boolean;
  organicCount?: number | null;
  coveredThroughRank?: number | null;
  queryStatus?: "EXACT" | "AUTOCORRECTED" | null;
  correctedKeyword?: string | null;
  spellType?: string | null;
  pagesCount?: number | null;
};

export type DashboardKeyword = {
  id: string;
  text: string;
  type: KeywordType;
  topicId: string | null;
  topicText: string | null;
  siteDomain?: string;
  siteName?: string;
  topicTexts?: string[];
  origin?: string;
  targetUrls?: string[];
  parentId: string | null;
  parentIds: string[];
  active: boolean;
  lastSyncedAt: string | null;
  volume: number;
  marketVolumes: Record<SearchRegionCode, number | null>;
  latestRanks: Record<SearchRegionCode, RankSummary | null>;
  rankingEvidence?: Record<SearchRegionCode, RankingEvidence[]>;
  firstTrackedAt?: string | null;
  volumeReview?: KeywordVolumeReview;
  volumeReviewLabel?: string;
  monitoringEligible?: boolean;
  monitoringHoldReason?: string | null;
  monitoringHoldCode?: string | null;
};

export type DashboardTopic = {
  id: string;
  text: string;
  type: TopicType;
  parentId: string | null;
  parentIds: string[];
  active: boolean;
  volume: number;
  marketVolumes: Record<SearchRegionCode, number | null>;
};

export type SyncRunSummary = {
  keywords?: number;
  regions?: number;
  totalChecks?: number;
  processed?: number;
  currentKeyword?: string | null;
  currentRegion?: SearchRegionCode | null;
  resumed?: boolean;
  resumedRunId?: string | null;
  skippedDaily?: number;
  skippedCompleted?: number;
  startedAt?: string;
  updatedAt?: string;
  snapshots?: number;
  diffs?: number;
  volumes?: number;
  errors?: Array<{
    keyword?: string;
    region?: SearchRegionCode;
    message?: string;
  }>;
  warnings?: Array<{
    keyword?: string;
    region?: SearchRegionCode;
    message?: string;
  }>;
};

export type DashboardRun = {
  id: string;
  status: "RUNNING" | "SUCCESS" | "PARTIAL" | "FAILED";
  startedAt: string;
  finishedAt: string | null;
  provider: string;
  summary: SyncRunSummary | null;
  errorMessage: string | null;
};

export type DashboardResponse = {
  serpOverview?: import("./serp-results").SerpAllRegionsResponse;
  reportingPeriod?: RankingReportingPeriod;
  latestImportAt?: string | null;
  usingDemoData: boolean;
  targetDomain: string | null;
  regions: SearchRegionCode[];
  topics: DashboardTopic[];
  keywords: DashboardKeyword[];
  latestRun: DashboardRun | null;
};

export type GoogleRankResult = {
  rank: number | null;
  url: string | null;
  title: string | null;
  rawCount: number;
  provider: string;
};

export type AhrefsVolumeResult = {
  volume: number;
  source: "ahrefs" | "demo";
};
