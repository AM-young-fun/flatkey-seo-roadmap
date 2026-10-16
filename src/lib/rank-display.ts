import type { DashboardKeyword, RankSummary } from "./types";
import type { SearchRegionCode } from "./seo";

export const DISPLAY_BUCKETS = [
  { key: "TOP_10", label: "前 10", range: "1–10", color: "#10b981" },
  { key: "TOP_30", label: "前 30", range: "11–30", color: "#3b82f6" },
  { key: "TOP_50", label: "前 50", range: "31–50", color: "#f59e0b" },
  { key: "TOP_100", label: "前 100", range: "51–100", color: "#f97316" },
  {
    key: "NOT_FOUND",
    label: "暂无前 100 排名",
    range: "已实测前 100，未找到本站",
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
  if (!summary) return "待采集";
  if (summary.rankStatus === "failed") return "采集失败";
  if (summary.rankStatus === "incomplete") return "采集未完成";
  if (summary.rankStatus === "queued") return "采集中";
  if (summary.rank == null)
    return summary.rankStatus === "outside_top100" ? "暂无前 100 排名" : "待采集";
  return `${summary.source === "gsc" ? "均值 " : "#"}${Number(summary.rank.toFixed(1))}`;
}

export function matchesRanking(summary: RankSummary | null | undefined, scope: string) {
  const rank = summary?.rank;
  if (scope === "ALL") return true;
  if (scope === "FAILED") return summary?.rankStatus === "failed";
  if (scope === "INCOMPLETE") return summary?.rankStatus === "incomplete";
  if (scope === "QUEUED") return summary?.rankStatus === "queued";
  if (scope === "PENDING") return !summary || ["pending", "no_data", undefined].includes(summary.rankStatus) && rank == null;
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
  if (!summary) return "尚未执行该地区的 Google SERP 实测，不能判断是否进入前100";
  if (summary.source === "dataforseo_serp") {
    const state = summary.rankStatus === "failed" ? "采集失败，不代表没有排名" : summary.rankStatus === "incomplete" ? "前100采集未完成，不据此判断是否无排名"
      : summary.rankStatus === "queued" ? "已提交，等待结果" : summary.serpVerification === "verified"
        ? summary.depthIncomplete ? "Google 自然名次已核实，但不足100个自然结果" : "Google 自然排名实测（前100）" : "等待有效实测结果";
    return `DataForSEO SERP · ${state}${summary.checkedAt ? ` · 采集于 ${summary.checkedAt}` : ""}`;
  }
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
    (keyword) => matchesRanking(keyword.latestRanks[region], "PENDING"),
  ).length;
  const outside = keywords.filter(keyword => matchesRanking(keyword.latestRanks[region], "OUTSIDE")).length;
  const failed = keywords.filter(keyword => matchesRanking(keyword.latestRanks[region], "FAILED")).length;
  const incomplete = keywords.filter(keyword => matchesRanking(keyword.latestRanks[region], "INCOMPLETE")).length;
  const queued = keywords.filter(keyword => matchesRanking(keyword.latestRanks[region], "QUEUED")).length;
  const percent = (count: number) => (total ? (count / total) * 100 : 0);
  return {
    total,
    ranked,
    unranked: total - ranked,
    pending,
    outside,
    failed,
    incomplete,
    queued,
    checked: ranked + outside,
    percent,
    buckets: DISPLAY_BUCKETS.map((bucket) => ({
      ...bucket,
      count: bucket.key === "NOT_FOUND" ? outside : ranks.filter((rank) => rank != null && displayBucket(rank).key === bucket.key).length,
    })),
    thresholds: [10, 30, 50, 100].map((limit) => ({
      limit,
      count: ranks.filter((rank) => rank != null && rank >= 1 && rank <= limit)
        .length,
    })),
  };
}
