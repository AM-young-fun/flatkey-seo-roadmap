"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowUpRight, ChevronDown, FileSpreadsheet, RefreshCw } from "lucide-react";
import { SOURCE_SYNC_API_PATH } from "@/lib/source-sync";
import type { SourceSyncHealthResponse } from "@/lib/source-sync-health";

const time = (value: string | null) => value ? new Date(value).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" }) : "未记录";
const shortTime = (value: string | null) => value ? new Date(value).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }) : "暂无";

export function SourceSyncStatus() {
  const [health, setHealth] = useState<SourceSyncHealthResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const read = useCallback(async (signal?: AbortSignal) => {
    const response = await fetch(SOURCE_SYNC_API_PATH, { cache: "no-store", signal });
    if (response.status === 401) { window.location.assign("/login"); return; }
    const value = await response.json() as SourceSyncHealthResponse & { message?: string };
    if (!response.ok) throw new Error(value.message ?? "协作表状态读取失败");
    setHealth(value);
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    void read(controller.signal).catch(failure => {
      if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : "协作表状态读取失败");
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [read]);
  async function refresh() {
    setLoading(true); setError("");
    try { await read(); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "协作表状态读取失败"); }
    finally { setLoading(false); }
  }
  return <section className="dataforseoPanel sourceSyncPanel managementSection" aria-labelledby="source-sync-heading">
    <div className="managementSectionHeading"><div className="managementSectionTitle"><span className="managementIcon"><FileSpreadsheet size={18} /></span><h2 id="source-sync-heading">来源同步</h2></div><button type="button" className="managementIconButton" aria-label="刷新同步状态" title="刷新" disabled={loading} onClick={() => void refresh()}><RefreshCw size={15} className={loading ? "spin" : ""} /></button></div>
    {error ? <p className="loadError" role="alert">{error}</p> : null}
    {loading ? <p className="muted" role="status">正在读取已保存的来源状态…</p> : null}
    <div className="sourceSyncSchedule"><span>每日 10:30</span><span className={`managementBadge ${health?.dailyCheck.confirmed?"":"isPending"}`}>{health?.dailyCheck.confirmed?`检查完成 ${shortTime(health.dailyCheck.lastCompletedAt)}`:health?.connection.serverPullConfigured?"采集器在线":"等待采集器连接"}</span></div>
    {health ? <div className="sourceSyncList">{health.sources.map(source => <article key={source.sourceId}><div><a href={source.url} target="_blank" rel="noreferrer">{source.label}<ArrowUpRight size={13} /></a><small>{source.status === "NO_BASELINE" ? "待建立基线" : `最近变更 ${shortTime(source.lastChangedAt)}`}</small></div><strong>{source.storedRows.toLocaleString()}<span>行</span></strong></article>)}</div> : null}
    <details className="sourceSyncDetails"><summary><span>同步详情</span><ChevronDown size={14} /></summary>
      {health ? <ul>{health.sources.map(source => <li key={source.sourceId}><strong>{source.label} · {source.sheetName}</strong>：最近内容入库 {time(source.lastChangedAt)}；已变更行的来源读取时间 {time(source.lastChangedSourceReadAt)}。</li>)}</ul> : null}
      {health?.checks?.map(check=><p key={check.sourceId} className="chartNote">{health.sources.find(row=>row.sourceId===check.sourceId)?.label}：{check.detail??"等待执行"}</p>)}
      <p className="chartNote">刷新只读取已保存状态。每日检查完成时间来自独立执行记录；未变化行不重写。新增词先保留研究，表格缺行不会删除词库或覆盖人工关联。</p>
    </details>
  </section>;
}
