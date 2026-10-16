import type { DashboardKeyword, RankSummary } from "./types";
import type { SearchRegionCode } from "./seo";

export const DISPLAY_BUCKETS = [
  { key: "TOP_10", label: "前 10", range: "1–10", color: "#10b981" },
  { key: "TOP_30", label: "前 30", range: "11–30", color: "#3b82f6" },
  { key: "TOP_50", label: "前 50", range: "31–50", color: "#f59e0b" },
  { key: "TOP_100", label: "前 100", range: "51–100", color: "#f97316" },
  {
    key: "NOT_FOUND",
    label: "未有排名",
    range: "无前 100 排名",
    color: "#94a3b8",
  },
] as const;

export function displayBucket(rank: number | null | undefined) {
  const index =
    rank != null && rank >= 1
      ? rank <= 10
        ? 0
        : rank <= 30
          ? 1
          : rank <= 50
            ? 2
            : rank <= 100
              ? 3
              : 4
      : 4;
  return DISPLAY_BUCKETS[index];
}

export function displayRank(summary: RankSummary | null | undefined) {
  if (!summary) return "未采集";
  if (summary.rank == null)
    return summary.rankStatus === "outside_top100" ? "前 100 外" : "暂无数据";
  return `${summary.source === "gsc" ? "均值 " : "#"}${Number(summary.rank.toFixed(1))}`;
}

export function matchesRanking(summary: RankSummary | null | undefined, scope: string) {
  const rank = summary?.rank;
  if (scope === "ALL") return true;
  if (scope === "OUTSIDE") return summary?.rankStatus === "outside_top100" || (rank != null && rank > 100);
  if (scope === "UNKNOWN") return rank == null && summary?.rankStatus !== "outside_top100";
  if (rank == null || rank < 1) return false;
  if (scope === "TOP100") return rank <= 100;
  if (scope === "TOP10") return rank <= 10;
  if (scope === "11_30") return rank > 10 && rank <= 30;
  if (scope === "31_50") return rank > 30 && rank <= 50;
  if (scope === "51_100") return rank > 50 && rank <= 100;
  return false;
}

export function rankDescription(summary: RankSummary | null | undefined) {
  if (!summary) return "尚未采集该地区数据";
  const source =
    summary.source === "gsc"
      ? "GSC 平均排名"
      : summary.source === "dataforseo_labs"
        ? "DataForSEO 数据库名次"
      : summary.source === "ahrefs"
        ? "Ahrefs 排名"
        : "Google 排名";
  return `${source}${summary.dataUpdatedAt ? ` · 来源更新于 ${summary.dataUpdatedAt.slice(0,10)}` : ""}${summary.periodStart ? ` · ${summary.periodStart} 至 ${summary.periodEnd}` : ""} · 当前 Google 搜索未核验`;
}

export function rankingStats(
  keywords: DashboardKeyword[],
  region: SearchRegionCode,
) {
  const total = keywords.length;
  const ranks = keywords.map((keyword) => keyword.latestRanks[region]?.rank);
  const ranked = ranks.filter(
    (rank) => rank != null && rank >= 1 && rank <= 100,
  ).length;
  const pending = keywords.filter(
    (keyword) => matchesRanking(keyword.latestRanks[region], "UNKNOWN"),
  ).length;
  const percent = (count: number) => (total ? (count / total) * 100 : 0);
  return {
    total,
    ranked,
    unranked: total - ranked,
    pending,
    outside: total - ranked - pending,
    percent,
    buckets: DISPLAY_BUCKETS.map((bucket) => ({
      ...bucket,
      count: ranks.filter((rank) => displayBucket(rank).key === bucket.key)
        .length,
    })),
    thresholds: [10, 30, 50, 100].map((limit) => ({
      limit,
      count: ranks.filter((rank) => rank != null && rank >= 1 && rank <= limit)
        .length,
    })),
  };
}
