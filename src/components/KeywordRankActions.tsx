"use client";

import { Button, Tooltip } from "antd";
import type { OptimizedKeywordPage, useOptimizedPageCapture } from "./useOptimizedPageCapture";

export function KeywordRankActions({ pages, capture }: { pages: OptimizedKeywordPage[]; capture: ReturnType<typeof useOptimizedPageCapture> }) {
  if (!pages.length) return <span className="muted">—</span>;
  const { data, busy, start } = capture;
  return <div className="evidenceSummary">{pages.map(page => {
    const pending = page.run && ["PLANNED", "RUNNING"].includes(page.run.status);
    const disabled = Boolean(busy || data?.activeRunId || page.usedToday || !page.queryCount || page.queryCount > 100 || !data?.connectionConfigured || !data.externalEnabled);
    const tip = page.run?.status === "UNKNOWN" ? "供应商接收结果或费用暂时无法确认，请核对原记录，不能重复提交。" : page.usedToday ? "该页面今日已抓取，北京时间明日零点后可再次抓取。"
      : data?.activeRunId ? "请等待当前页面采集结束。" : !data?.connectionConfigured ? "请先在数据管理保存 DataForSEO 连接。"
      : !data.externalEnabled ? "外部请求已暂停。" : !page.queryCount ? "该页面尚无已核实的正式关键词，请先核对页面关联。"
      : page.queryCount > 100 ? "该页面关键词超过单次抓取上限，请先精简关联词。"
      : `抓取该页面 ${page.targets.length} 个关键词的四国排名，费用上限 $${(page.maxCostMicros / 1_000_000).toFixed(3)}。同一页面的关联词共享每日一次额度。`;
    return <div key={page.id}>{pages.length > 1 ? <a className="observedUrl" href={page.url} target="_blank" rel="noreferrer">{new URL(page.url).pathname}</a> : null}<Tooltip title={tip}><span><Button size="small" type={page.usedToday ? "default" : "primary"} disabled={disabled} loading={busy === page.id || Boolean(pending)} onClick={() => void start(page)}>{pending ? "采集中" : page.run?.status === "UNKNOWN" ? "需核对" : page.usedToday ? "今日已抓取" : "抓取排名"}</Button></span></Tooltip></div>;
  })}</div>;
}
