export type PublishedKeywordRank = "outside100" | "ranked" | "pending";

export const publishedKeywordRankLabels: Record<PublishedKeywordRank, string> = {
  outside100: "已核实未进前100",
  ranked: "已有有效排名",
  pending: "排名待核",
};
