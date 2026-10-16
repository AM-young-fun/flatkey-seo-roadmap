import type { SearchRegionCode } from "./seo";

export type RankingDiscoveryPool = "FORMAL" | "RESEARCH" | "NEW_CANDIDATE" | "AMBIGUOUS";
export type RankingDiscoveryPage = {
  url: string; rank: number; rankAbsolute: number | null; title: string | null;
  sourceSerpUpdatedAt: string | null; collectedAt: string; checkUrl: string | null;
};
export type RankingDiscoveryRow = {
  keyword: string; keywordId: string | null; pool: RankingDiscoveryPool;
  relevance: "relevant" | "review"; reviewReason: string | null;
  rank: number; url: string; title: string | null; sourceSerpUpdatedAt: string | null;
  collectedAt: string; volume: number | null; pages: RankingDiscoveryPage[];
};
export type RankingDiscoveryResponse = {
  available: boolean;
  reason: null | "NO_SNAPSHOT" | "OUT_OF_SCOPE" | "INVALID_SNAPSHOT";
  requested: { site: string; region: SearchRegionCode };
  snapshot: null | {
    runId: string; siteDomain: "flatkey.ai"; region: "US"; languageCode: "en";
    collectedAt: string; sourceSerpDateMin: string | null; sourceSerpDateMax: string | null;
    requestedLimit: number; returnedItems: number; totalMatchingCount: number; truncated: boolean;
    realTimeSerpFetch: false;
  };
  rows: RankingDiscoveryRow[];
  stats: {
    uniqueDiscoveredKeywords: number; uniqueBusinessKeywords: number; intentReview: number;
    returnedItems: number; filteredUnrelated: number; policyExcluded: number;
    formal: number; research: number; newCandidates: number; ambiguous: number;
    buckets: [number, number, number, number];
  };
  brandCoverage: { formalTerms: number; returnedTerms: number; unobservedTerms: string[] };
};
