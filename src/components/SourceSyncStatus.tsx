"use client";

import { useCallback, useEffect, useState } from "react";
import { FileSpreadsheet, RefreshCw } from "lucide-react";
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
  return <section className="dataforseoPanel" aria-labelledby="source-sync-heading">
    <div className="dataforseoHeading">
      <div className="manageCardHeading"><span className="manageCardIcon"><FileSpreadsheet size={19} /></span><div><h2 id="source-sync-heading">三张协作表同步</h2><p>每天 10:30 · 北京时间</p></div></div>
      <button type="button" className="okrRefresh" disabled={loading} onClick={() => void refresh()}><RefreshCw size={13} />刷新同步状态</button>
    </div>
    {error ? <p className="loadError" role="alert">{error}</p> : null}
    {loading ? <p className="muted" role="status">正在读取已保存的来源状态…</p> : null}
    <p className="chartNote">沿用现有采集器增量同步；尚无每日完整检查的线上回执。</p>
    {health ? <div className="sourceSyncGrid">{health.sources.map(source => <article key={source.sourceId}>
      <a href={source.url} target="_blank" rel="noreferrer"><strong>{source.label}</strong></a>
      <p><strong>{source.storedRows.toLocaleString()}</strong> 行已存{source.status === "NO_BASELINE" ? " · 待建立基线" : ""}</p>
      <small>最近变更 {shortTime(source.lastChangedAt)}</small>
    </article>)}</div> : null}
    <details className="sourceSyncDetails"><summary>同步明细与筛选规则</summary>
      {health ? <ul>{health.sources.map(source => <li key={source.sourceId}><strong>{source.label} · {source.sheetName}</strong>：最近内容入库 {time(source.lastChangedAt)}；已变更行的来源读取时间 {time(source.lastChangedSourceReadAt)}。</li>)}</ul> : null}
      <p className="chartNote">刷新状态只读取已存数据，不会重新读取协作表。未变化行不重写，因此上述时间不代表最近每日检查。新增和变化逐词核实业务相关性、完成状态、实际页面与意图；表格缺行不会删除词库或覆盖人工关联。排名与新词发现独立安排在隔周周二 10:30，付费执行尚未开启。</p>
    </details>
  </section>;
}
