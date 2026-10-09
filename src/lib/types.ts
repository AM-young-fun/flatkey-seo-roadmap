import type { RankBucket, SearchRegionCode } from "@/lib/seo";

export type KeywordType = "MAIN" | "LONG_TAIL";
export type TopicType = "MAIN" | "SUB_TOPIC";

export type RankSummary = {
  rank: number | null;
  bucket: RankBucket;
  url: string | null;
  title: string | null;
  searchVolume: number | null;
  checkedAt: string | null;
  previousRank: number | null;
  rankDelta: number | null;
  changed: boolean;
};

export type DashboardKeyword = {
  id: string;
  text: string;
  type: KeywordType;
  topicId: string | null;
  topicText: string | null;
  parentId: string | null;
  parentIds: string[];
  active: boolean;
  lastSyncedAt: string | null;
  volume: number;
  marketVolumes: Record<SearchRegionCode, number | null>;
  latestRanks: Record<SearchRegionCode, RankSummary | null>;
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
