export type PublishedKeywordRank = "outside100" | "ranked" | "pending";

export const publishedKeywordRankLabels: Record<PublishedKeywordRank, string> = {
  outside100: "已核实未进前100",
  ranked: "已有有效排名",
  pending: "排名待核",
};

export const publishedRankFilters = [
  { value: "all", label: "全部排名状态" }, { value: "ranked", label: publishedKeywordRankLabels.ranked },
  { value: "top10", label: "第 1–10 名", min: 1, max: 10 },
  { value: "top30", label: "第 11–30 名", min: 11, max: 30 },
  { value: "top50", label: "第 31–50 名", min: 31, max: 50 },
  { value: "top100", label: "第 51–100 名", min: 51, max: 100 },
  { value: "outside100", label: publishedKeywordRankLabels.outside100 },
  { value: "pending", label: publishedKeywordRankLabels.pending },
] as const;

export type PublishedRankFilter = typeof publishedRankFilters[number]["value"];
