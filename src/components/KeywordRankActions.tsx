"use client";

import { Button, Tooltip } from "antd";
import { optimizedPageCaptureProcessing } from "@/lib/optimized-keyword-details";
import type { OptimizedKeywordPage, useOptimizedPageCapture } from "./useOptimizedPageCapture";

export function KeywordRankActions({ pages, capture }: { pages: OptimizedKeywordPage[]; capture: ReturnType<typeof useOptimizedPageCapture> }) {
  if (!pages.length) return <span className="muted">—</span>;
  const { data, busy, busyAction, start, retry } = capture;
  return <div className="evidenceSummary">{pages.map(page => {
    const pending = optimizedPageCaptureProcessing(page, busy);
    const retryable = (page.retryableTaskCount ?? 0) > 0 && ["FAILED", "PARTIAL"].includes(page.run?.status ?? "");
    const noTargets = !page.queryCount && !retryable;
    const counts = page.run?.taskCounts ?? {};
    const progress = [
      `已返回 ${(counts.COMPLETE ?? 0) + (counts.INCOMPLETE ?? 0)}/${page.run?.queryCount ?? page.queryCount} 项`,
      counts.PLANNED ? `等待提交 ${counts.PLANNED} 项` : "",
      counts.SUBMITTING ? `正在提交 ${counts.SUBMITTING} 项` : "",
      counts.QUEUED ? `等待结果 ${counts.QUEUED} 项` : "",
      counts.RECEIVED ? `正在处理结果 ${counts.RECEIVED} 项` : "",
      counts.FAILED ? `失败 ${counts.FAILED} 项` : "",
    ].filter(Boolean).join(" · ");
    const failed = page.run?.status === "FAILED", partial = page.run?.status === "PARTIAL";
    const failureCount = page.run?.taskCounts.FAILED ?? 0;
    const receipt = pending ? busy === page.id ? busyAction === "retry" ? "正在重试读取原任务结果，不会重新扣费。" : "正在提交抓取任务，稍后自动获取结果。" : `${progress}。完成后自动更新排名。`
      : failed ? `抓取失败${failureCount ? `（${failureCount}/${page.run?.queryCount} 个任务失败）` : ""}，本次未更新排名。`
      : partial ? "部分任务未取得有效结果，对应排名保留历史结果。"
      : noTargets ? `该页有 ${page.sourceKeywordCount} 个关联词，暂无已核实的正式关键词。` : "";
    const allowance = page.usedToday ? "今日次数已使用，北京时间明日零点后可再次抓取。" : "";
    const disabled = Boolean(pending || busy || data?.activeRunId || !data?.connectionConfigured || !data.externalEnabled ||
      !retryable && (page.usedToday || noTargets || page.queryCount > 100));
    const tip = pending ? `排名处理中，现有名次为上次有效结果；返回有效结果后自动更新。${allowance}`
      : retryable ? `重试取回原任务中 ${page.retryableTaskCount} 项失败结果，不提交新的抓取，不再次计费。`
      : page.run?.status === "UNKNOWN" ? "供应商接收结果或费用暂时无法确认，请核对原记录，不能重复提交。" : page.usedToday ? `${receipt || "今日采集已结束，排名以有效结果为准。"}${allowance}`
      : data?.activeRunId ? "请等待当前页面采集结束。" : !data?.connectionConfigured ? "请先在数据管理保存 DataForSEO 连接。"
      : !data.externalEnabled ? "外部请求已暂停。" : !page.queryCount ? "该页面尚无已核实的正式关键词，请先核对页面关联。"
      : page.queryCount > 100 ? "该页面关键词超过单次抓取上限，请先精简关联词。"
      : `抓取该页面 ${page.targets.length} 个关键词的四国排名，费用上限 $${(page.maxCostMicros / 1_000_000).toFixed(3)}。同一页面的关联词共享每日一次额度。`;
    const label = pending ? "处理中" : retryable ? "重试取结果" : page.run?.status === "UNKNOWN" ? "需核对"
      : page.usedToday ? failed ? "今日抓取失败" : partial ? "今日部分完成" : page.run?.status === "COMPLETED" ? "今日已完成" : "今日已提交" : noTargets ? "待核对" : "抓取排名";
    return <div key={page.id}>
      {pages.length > 1 ? <a className="observedUrl" href={page.url} target="_blank" rel="noreferrer">{new URL(page.url).pathname}</a> : null}
      <Tooltip title={tip}><span><Button size="small" type={page.usedToday ? "default" : "primary"} disabled={disabled} loading={busy === page.id || Boolean(pending)} onClick={() => void (retryable ? retry(page) : start(page))}>{label}</Button></span></Tooltip>
      {retryable && !pending ? <small>可重试原任务，不再次计费。</small> : null}
      {receipt ? <small role="status">{pending || noTargets || page.usedToday ? "" : "上次"}{receipt}</small> : null}
    </div>;
  })}</div>;
}
