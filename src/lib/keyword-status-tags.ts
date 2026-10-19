import type { PageAuditVerdict } from "./page-audit";
import type { RankSummary } from "./types";
import { validSitePage } from "./keyword-volume-review";

type PageTagInput = {
  siteDomain: string; mappingStatus?: string; targetUrls?: string[]; candidateUrls?: string[];
  latestPageAuditVerdict?: PageAuditVerdict | null;
};
export type KeywordPageTag = { key: "MATCHED" | "BUILD" | "EXPAND" | "MISMATCH" | "REVIEW"; label: string; color: string; tooltip: string };
export type KeywordRankingTag = { key: "TOP_10" | "TOP_30" | "TOP_50" | "TOP_100" | "UNRANKED" | "NOT_FOUND_CAPTURE" | "QUERY_CHANGED" | "PENDING" | "QUEUED" | "FAILED" | "INCOMPLETE"; label: string; color: string; tooltip: string };

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
    return { key: "EXPAND", label: "候选·待优化（已有页面）", color: "orange", tooltip: "已有可以访问的页面，需要在该页面补充或优化内容以满足关键词意图；完成优化并复核后计入已匹配页面，无需另建页面。" };
  }
  if (verdict === "MISSING" || verdict === "NO_MATCH" || (!targets.length && !candidates.length && !verdict && ["NEEDS_BUILD", "UNMAPPED", undefined].includes(target.mappingStatus))) {
    return { key: "BUILD", label: "候选·待建设（无合适页面）", color: "gold", tooltip: verdict === "MISSING" ? "本轮已确认目标页面缺失，需要新建合适页面；关键词保留，旧地址仅作历史核查记录。" : verdict === "NO_MATCH" ? "已核对本轮公开页面清单，未找到与关键词意图匹配的合适页面，需要新建页面；关键词保留。" : "尚无已发布的合适目标页面或待核实页面地址，需要新建页面；关键词保留。" };
  }
  return { key: "REVIEW", label: "候选·页面待核实", color: "orange", tooltip: verdict === "REVIEW" ? "本轮页面证据尚不充分，目标或候选地址保留待核实；不视为已匹配，也不判定页面不存在。" : "已有目标或候选关联尚未通过页面与意图核验，保留待核实。" };
}

export function keywordRankingTag(summary: Pick<RankSummary, "source" | "rank" | "rankStatus" | "checkedAt" | "depthIncomplete" | "coveredThroughRank" | "organicCount" | "correctedKeyword"> | null | undefined): KeywordRankingTag {
  if (summary?.source !== "dataforseo_serp") return { key: "PENDING", label: "待采集", color: "default", tooltip: "尚无该地区有效的 DataForSEO SERP 实测；Labs、GSC、Ahrefs 历史证据不用于主排名标签，不能据此确认没有排名。" };
  if (summary.rankStatus === "failed") return { key: "FAILED", label: "采集失败", color: "red", tooltip: "本轮 SERP 采集失败，无法判断本站排名；保留关键词和历史证据。" };
  if (summary.rankStatus === "incomplete") return { key: "INCOMPLETE", label: "数据异常", color: "orange", tooltip: "回执解析或查询配置校验异常；需要修复具体异常后重新核对，不能判断有无排名。" };
  if (summary.rankStatus === "not_found_capture") return { key: "NOT_FOUND_CAPTURE", label: "本次未命中", color: "default", tooltip: `本次采集已完成，${summary.coveredThroughRank ? `连续检查了前${summary.coveredThroughRank}个自然名次` : `返回${summary.organicCount ?? 0}条自然结果`}，没有找到本站页面；不据此声称完整前100无排名。` };
  if (summary.rankStatus === "query_changed") return { key: "QUERY_CHANGED", label: "Google已纠词", color: "orange", tooltip: `Google将本次搜索改为“${summary.correctedKeyword ?? "供应商未提供的搜索词"}”；采集已完成，但该结果不能冒充原关键词的排名。` };
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

// Keep collection diagnostics in the evidence view, separate from ranking results.
export function keywordRankingResultTag(summary: Parameters<typeof keywordRankingTag>[0]):
  { key: "TOP_10" | "TOP_30" | "TOP_50" | "TOP_100" | "UNRANKED" | "UNKNOWN"; label: string; color: string; tooltip: string } {
  const tag = keywordRankingTag(summary);
  switch (tag.key) {
    case "TOP_10": case "TOP_30": case "TOP_50": case "TOP_100": case "UNRANKED": return { ...tag, key: tag.key };
    default: return { key: "UNKNOWN", label: "暂无排名数据", color: "default", tooltip: tag.tooltip };
  }
}
