"use client";
import { useCallback, useEffect, useState } from "react";
import { REGION_CODES } from "@/lib/seo";
import type { SerpMonitorPreview, SerpMonitorStatus } from "@/lib/serp-monitor-types";

const money = (micros: number) => `$${(micros / 1_000_000).toFixed(3).replace(/0+$/, "").replace(/\.$/, "")}`;
const time = (value: string | null) => value ? new Date(value).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" }) : "待授权后安排";
const stateLabels: Record<string, string> = { PLANNED: "计划已保存", RUNNING: "采集中", COMPLETED: "已完成", PARTIAL: "已结束，部分数据异常", FAILED: "失败", UNKNOWN: "提交结果待核实" };

export function SerpMonitorPanel() {
  const [status, setStatus] = useState<SerpMonitorStatus | null>(null);
  const [preview, setPreview] = useState<SerpMonitorPreview | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const read = useCallback(async () => {
    const response = await fetch("/api/serp-monitor", { cache: "no-store" });
    if (response.status === 401) { window.location.assign("/login"); return; }
    const result = await response.json();
    if (!response.ok) throw new Error(result.message ?? "SERP计划读取失败");
    setStatus(result);
  }, []);
  useEffect(() => { let active = true; const refresh = () => { void read().catch(error => { if (active) setError(error instanceof Error ? error.message : "读取失败"); }); }; refresh(); window.addEventListener("dataforseo-connection-updated", refresh); window.addEventListener("seo-rankings-updated", refresh); return () => { active = false; window.removeEventListener("dataforseo-connection-updated", refresh); window.removeEventListener("seo-rankings-updated", refresh); }; }, [read]);
  async function act(action: "preview" | "configure" | "refresh") {
    setBusy(action); setError(""); setNotice("");
    try {
      if (action === "refresh") { await read(); return; }
      const response = await fetch("/api/serp-monitor", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(action === "preview" ? { action } : { action, paidEnabled: false, maxRunCostMicros: 50_000_000, maxMonthCostMicros: 100_000_000, ...(status ? { expectedRevision: status.config.revision } : {}) }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message ?? "操作失败");
      if (action === "preview") setPreview(result);
      else { setStatus(result); setNotice("每月两期的更新规则已保存，付费执行保持关闭，未提交抓取任务。"); }
    } catch (error) { setError(error instanceof Error ? error.message : "操作失败"); }
    finally { setBusy(""); }
  }
  return <section className="dataforseoPanel" id="serp-monitor" aria-labelledby="serp-monitor-heading">
    <div className="dataforseoHeading"><div><h2 id="serp-monitor-heading">排名更新设置</h2><p>DataForSEO SERP · 美国、日本、西班牙、巴西 · 桌面端 · 前100</p></div><button className="okrRefresh" disabled={Boolean(busy)} onClick={() => void act("refresh")}>刷新状态</button></div>
    {error ? <p className="loadError" role="alert">{error}</p> : null}{notice ? <p className="cacheNotice" role="status">{notice}</p> : null}
    {!status && !error ? <p className="muted">正在读取连接与实测计划…</p> : null}
    {status ? <>
      <div className="dataforseoStats serpPlanStats"><div><span>已有合适页面 · 可监控</span><strong>{(status.quote.queryCount / REGION_CODES.length).toLocaleString()} 词</strong><small>待优化词继续监控，研究候选不付费</small></div><div><span>更新周期</span><strong>每月1日、16日</strong><small>上海时间10:30 · 下一期：{time(status.config.nextDueAt)}</small></div><div><span>定时执行</span><strong>{status.gate.canSpend ? "已授权" : "已关闭"}</strong><small>API连接：{status.connection.configured ? "已配置" : "待配置"}</small><small>定时调度认证：{status.cronConfigured ? "已配置" : "待配置"}</small></div></div>
      <p className="serpSimpleNotice">保存计划和预览费用不会提交付费抓取任务。</p>
      <div className="dataforseoActions"><button className="okrRefresh" disabled={Boolean(busy)} onClick={() => void act("preview")}>{busy === "preview" ? "正在计算…" : "预览费用"}</button><button className="managePrimary" disabled={Boolean(busy) || !status} onClick={() => void act("configure")}>{busy === "configure" ? "正在保存…" : "保存计划"}</button></div>
      <p className="chartNote">可监控词四国每期预算上限 {money(status.quote.maxCostMicros)} · 每月两期上限 {money(status.quote.monthlyAverageMicros)}。</p>
      <details className="simpleExplanation"><summary>查看范围与计费说明</summary><p>{Object.entries(status.cohort.bySite).map(([domain, count]) => `${domain} ${count}词`).join(" · ")}。只纳入已核实有合适页面的正式词；页面上线并核实后自动加入。去重后 {status.quote.queryCount.toLocaleString()} 次Google查询，同词的多个网站和页面共用结果。预算按当前可监控范围动态计算，付费执行需另行授权。</p></details>
    </> : null}
    {preview ? <div className="dataforseoPreview" aria-label="SERP费用预览"><h3>费用预览 · 未执行抓取</h3><p>{(preview.quote.queryCount / REGION_CODES.length).toLocaleString()} 个页面已就绪的关键词 · 去重后 {preview.quote.queryCount.toLocaleString()} 次Google查询 · 每词前100</p><p>单轮预算 <strong>{money(preview.quote.maxCostMicros)}</strong> · 每月两期，月度 <strong>{money(preview.quote.monthlyAverageMicros)}</strong> · 全年24期 <strong>{money(preview.quote.annual24RunsMicros)}</strong></p><a className="textLink" href={preview.quote.pricingUrl} target="_blank" rel="noreferrer">查看官方价格 →</a><p className="chartNote">报价基于每10条结果$0.0006、前100每次查询$0.006；仅含接口费用。此预览不会创建付费任务。</p></div> : null}
    <details className="dataforseoRuns"><summary>排名采集记录（{status?.runs.length ?? "—"}）</summary>{status?.runs.length ? status.runs.map(run => <article key={run.id}><strong>{run.periodLabel.split(" · ")[0]} · {stateLabels[run.status] ?? run.status}</strong><p>{run.targetCount} 个目标 · {run.queryCount} 次查询 · 开始于 {time(run.startedAt)} · {run.status === "COMPLETED" ? "结算费用" : "当前费用（含未结算）"} {run.actualCostMicros == null ? "待确认" : money(run.actualCostMicros)}</p></article>) : <p className="muted">尚未执行SERP抓取，暂无采集记录。</p>}</details>
  </section>;
}
