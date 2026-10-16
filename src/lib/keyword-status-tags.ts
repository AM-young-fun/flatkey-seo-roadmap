import type { PageAuditVerdict } from "./page-audit";
import type { RankSummary } from "./types";
import { validSitePage } from "./keyword-volume-review";

type PageTagInput = {
  siteDomain: string; mappingStatus?: string; targetUrls?: string[]; candidateUrls?: string[];
  latestPageAuditVerdict?: PageAuditVerdict | null;
};
export type KeywordPageTag = { key: "MATCHED" | "BUILD" | "EXPAND" | "MISMATCH" | "REVIEW"; label: string; color: string; tooltip: string };
export type KeywordRankingTag = { key: "TOP_10" | "TOP_30" | "TOP_50" | "TOP_100" | "UNRANKED" | "PENDING" | "QUEUED" | "FAILED" | "INCOMPLETE"; label: string; color: string; tooltip: string };

export function keywordPageTag(target: PageTagInput): KeywordPageTag {
  const targets = [...new Set((target.targetUrls ?? []).filter(url => validSitePage(url, target.siteDomain)).map(value => {
    const url = new URL(value); url.hash = ""; url.pathname = url.pathname.replace(/\/$/, "") || "/"; return url.href;
  }))];
  const candidates = (target.candidateUrls ?? []).filter(url => url.trim());
  const verdict = target.latestPageAuditVerdict;
  if (target.mappingStatus === "READY" && targets.length && (!verdict || verdict === "VERIFIED")) {
    return { key: "MATCHED", label: targets.length > 1 ? `已匹配 ${targets.length} 页` : "已匹配页面", color: "green", tooltip: `已有 ${targets.length} 个经核验、与该词意图匹配的本站目标页面；每页独立核验，关键词只计一次。页面匹配与搜索排名分别判断。` };
  }
  if (verdict === "MISMATCH" || (!verdict && target.mappingStatus === "NEEDS_REMAP")) {
    return { key: "MISMATCH", label: "候选·页面错配", color: "red", tooltip: "已核实页面与关键词搜索意图错配，需重新关联或建设对应内容；现有地址保留作核查记录。" };
  }
  if (verdict === "CONTENT_GAP" || (!verdict && target.mappingStatus === "NEEDS_EXPANSION")) {
    return { key: "EXPAND", label: "候选·需补内容", color: "orange", tooltip: "页面可以访问，但正文尚未完整满足该词的搜索意图；补齐内容并复核后才能计入已匹配页面。" };
  }
  if (verdict === "MISSING" || verdict === "NO_MATCH" || (!targets.length && !candidates.length && !verdict && ["NEEDS_BUILD", "UNMAPPED", undefined].includes(target.mappingStatus))) {
    return { key: "BUILD", label: "候选·待建设", color: "gold", tooltip: verdict === "MISSING" ? "本轮已确认目标页面缺失，保留关键词待建设；旧地址仅作历史候选记录。" : verdict === "NO_MATCH" ? "已核对本轮公开页面清单，未找到与该词意图匹配的实际页面；保留关键词待建设。" : "尚无已发布的目标页面或待核实页面地址，保留关键词待建设。" };
  }
  return { key: "REVIEW", label: "候选·页面待核实", color: "orange", tooltip: verdict === "REVIEW" ? "本轮页面证据尚不充分，目标或候选地址保留待核实；不视为已匹配，也不判定页面不存在。" : "已有目标或候选关联尚未通过页面与意图核验，保留待核实。" };
}

export function keywordRankingTag(summary: Pick<RankSummary, "source" | "rank" | "rankStatus" | "checkedAt" | "depthIncomplete"> | null | undefined): KeywordRankingTag {
  if (summary?.source !== "dataforseo_serp") return { key: "PENDING", label: "待采集", color: "default", tooltip: "尚无该地区有效的 DataForSEO SERP 实测；Labs、GSC、Ahrefs 历史证据不用于主排名标签，不能据此确认没有排名。" };
  if (summary.rankStatus === "failed") return { key: "FAILED", label: "采集失败", color: "red", tooltip: "本轮 SERP 采集失败，无法判断本站排名；保留关键词和历史证据。" };
  if (summary.rankStatus === "incomplete") return { key: "INCOMPLETE", label: "采集未完成", color: "orange", tooltip: "本轮尚未取得完整前100结果；部分已找到的页面保留为证据，不判定没有排名。" };
  if (summary.rankStatus === "queued") return { key: "QUEUED", label: "采集中", color: "blue", tooltip: "本轮请求已提交，正在等待 DataForSEO SERP 结果。" };
  const rank = summary.rank;
  if (rank != null && Number.isInteger(rank) && rank >= 1 && rank <= 100) {
    const bucket = rank <= 10 ? { key: "TOP_10", label: "前10", color: "green", range: "1–10" }
      : rank <= 30 ? { key: "TOP_30", label: "前30", color: "blue", range: "11–30" }
      : rank <= 50 ? { key: "TOP_50", label: "前50", color: "gold", range: "31–50" }
      : { key: "TOP_100", label: "前100", color: "orange", range: "51–100" };
    return { key: bucket.key as KeywordRankingTag["key"], label: bucket.label, color: bucket.color, tooltip: `DataForSEO SERP 自然排名实测 #${rank}，属于 ${bucket.range} 名区间；同轮多个页面取最佳自然名次，每词仅显示一个排名区间标签。${summary.depthIncomplete ? "本轮已核实名次，但返回不足100个自然结果，不能据此排除其他页面。" : ""}` };
  }
  const outside = summary.rankStatus === "outside_top100" || (rank != null && Number.isInteger(rank) && rank > 100);
  return outside ? { key: "UNRANKED", label: "暂无前100排名", color: "default", tooltip: "本轮已成功核验前100个自然结果，未找到本站页面；此标签不表示网页未收录。" }
    : { key: "PENDING", label: "待采集", color: "default", tooltip: "尚无本轮有效的 SERP 实测结果，不能据此确认没有排名。" };
}
