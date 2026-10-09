import type { RankBucket, SearchRegionCode } from "@/lib/seo";

export type KeywordType = "MAIN" | "LONG_TAIL";

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
  parentId: string | null;
  parentIds: string[];
  active: boolean;
  volume: number;
  marketVolumes: Record<SearchRegionCode, number | null>;
  latestRanks: Record<SearchRegionCode, RankSummary | null>;
};

export type DashboardRun = {
  id: string;
  status: "RUNNING" | "SUCCESS" | "PARTIAL" | "FAILED";
  startedAt: string;
  finishedAt: string | null;
  provider: string;
  summary: unknown;
  errorMessage: string | null;
};

export type DashboardResponse = {
  usingDemoData: boolean;
  targetDomain: string | null;
  regions: SearchRegionCode[];
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
