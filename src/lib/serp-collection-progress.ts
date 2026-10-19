export type SerpCollectionProgress = {
  runId: string; periodLabel: string; status: string; totalKeywords: number; completedKeywords: number;
  totalQueries: number; completedQueries: number; submittedQueries: number; waitingQueries: number;
  plannedQueries: number; processingQueries: number; failedQueries: number;
  startedAt: string; completedAt: string | null; checkedAt: string;
  rankedKeywordCount: number;
  rankedKeywords: {keyword:string;region:string;rank:number;url:string;checkedAt:string}[];
};

export const collectionIsActive = (status: string) => ["PLANNED", "RUNNING"].includes(status);
