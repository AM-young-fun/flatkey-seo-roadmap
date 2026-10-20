"use client";
import { useEffect, useRef, useState } from "react";
import { CalendarClock, ChevronDown, Cloud, History, RefreshCw } from "lucide-react";
import { Switch } from "antd";
import type { OperationsStatus } from "@/lib/operations";
import type { CollectionSchedulePreview, CollectionCycleProgress } from "@/lib/collection-control";

const time = (value: string | null) => value ? new Date(value).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }) : "尚无记录";
const heartbeat = { UNCONFIRMED: "调度待确认", HEALTHY: "调度正常", OVERDUE: "调度超时", ERROR: "执行异常" };
const money = (value: number) => `$${(value / 1e6).toFixed(3).replace(/0+$/, "").replace(/\.$/, "")}`;
export function OperationsPanel() {
  const [data, setData] = useState<OperationsStatus | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [working, setWorking] = useState("");
  const [preview, setPreview] = useState<CollectionSchedulePreview | null>(null);
  const [notice, setNotice] = useState("");
  const [diagnostic, setDiagnostic] = useState("");
  const stopped = useRef(false);
  async function post(body: object) {
    const response = await fetch("/api/operations", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message ?? "操作失败");
    return result;
  }
  async function read() {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/operations", { cache: "no-store" });
      if (response.status === 401) { window.location.assign("/login"); return; }
      const value = await response.json();
      if (!response.ok) throw new Error(value.message ?? "读取失败");
      setData(value);
    } catch (error) { setError(error instanceof Error ? error.message : "读取失败"); }
    finally { setBusy(false); }
  }
  useEffect(() => { void read(); return () => { stopped.current = true; }; }, []);
  async function showPreview() {
    setWorking("preview"); setError(""); setNotice("");
    try { setPreview(await post({ action: "previewSchedule" })); }
    catch (error) { setError(error instanceof Error ? error.message : "费用读取失败"); }
    finally { setWorking(""); }
  }
  async function pause() {
    stopped.current = true; setError("");
    try { const result = await post({ action: "pauseSchedule" }); setNotice(result.message); setPreview(null); await read(); }
    catch (error) { setError(error instanceof Error ? error.message : "暂停失败"); }
  }
  async function inspect(requestId: string, replay = false) {
    setWorking("repair"); setError("");
    try {
      const value = await post({ action: replay ? "replayDiscovery" : "inspectDiscovery", requestId });
      setDiagnostic(JSON.stringify(value, null, 2));
      if (replay) { await read(); setNotice(value.status === "COMPLETED" ? "已从保存的响应恢复导入，没有重新付费抓取。" : "已检查保存的响应，未重新付费；异常信息见下方。"); }
    } catch (error) { setError(error instanceof Error ? error.message : "无法读取异常信息"); }
    finally { setWorking(""); }
  }
  async function enable(runNow: boolean) {
    if (!preview) return;
    setWorking("run"); setError(""); stopped.current = false;
    try {
      const result = await post({ action: "enableSchedule", previewToken: preview.previewToken });
      setNotice(result.message); await read();
      if (runNow) {
        while (!stopped.current) {
          const progress = await post({ action: "runCycle", previewToken: preview.previewToken }) as CollectionCycleProgress;
          setNotice(`${progress.message}${progress.remainingQueries === undefined ? "" : ` 剩余 ${progress.remainingQueries.toLocaleString()} 次查询。`}`);
          window.dispatchEvent(new Event("seo-rankings-updated"));
          if (progress.finished) break;
          await new Promise(resolve => setTimeout(resolve, 3000));
        }
      }
      setPreview(null); await read();
    } catch (error) { stopped.current = true; await read(); setError(error instanceof Error ? error.message : "执行异常，请查看原记录"); }
    finally { setWorking(""); }
  }
  return <section className="operationsPanel managementSection" aria-labelledby="operations-title">
    <div className="managementSectionHeading">
      <div className="managementSectionTitle"><span className="managementIcon"><CalendarClock size={18} /></span><h2 id="operations-title">运行计划</h2></div>
      <div className="managementHeadingActions">{!preview ? <button type="button" className="okrRefresh" disabled={Boolean(working) || !data || data.controls.emergencyStopped} onClick={() => void showPreview()}>{working === "preview" ? "核对中…" : working ? "执行中…" : "范围与费用"}</button> : null}<button type="button" className="managementIconButton" aria-label="刷新运行计划" title="刷新" disabled={busy} onClick={() => void read()}><RefreshCw size={15} className={busy ? "spin" : ""} /></button></div>
    </div>
    {error ? <p className="loadError" role="alert">{error}</p> : null}
    {notice ? <p className="cacheNotice" role="status">{notice}</p> : null}
    {!data && !error ? <p className="managementLoading" role="status">正在读取运行计划…</p> : null}
    {data ? <>
      <div className="operationsControl"><div><strong>隔周自动更新</strong><span>Flatkey · 四国排名与新词发现</span></div><div className="operationsToggle"><span>{data.controls.enabled ? "已开启" : "已关闭"}</span><Switch aria-label="隔周自动更新" checked={data.controls.enabled} disabled={!data.controls.enabled && Boolean(working)} onChange={() => data.controls.enabled ? void pause() : void showPreview()} /></div></div>
      {preview ? <div className="operationsPreview"><h3>{preview.periodLabel}</h3><div className="operationsPreviewMetrics"><div><span>关键词</span><strong>{preview.keywordCount.toLocaleString()}</strong></div><div><span>查询次数</span><strong>{preview.queryCount.toLocaleString()}</strong></div><div><span>本轮费用上限</span><strong>{money(preview.totalMaxCostMicros)}</strong></div><div><span>可用余额</span><strong>{money(preview.balanceMicros)}</strong></div></div><p>新词发现 {money(preview.discoveryMaxCostMicros)} + 排名查询 {money(preview.serpMaxCostMicros)} · SERP 月度上限 {money(preview.maxMonthSerpCostMicros)}，超限自动暂停。</p><div className="dataforseoActions"><button type="button" className="managePrimary" disabled={Boolean(working)} onClick={() => void enable(true)}>{working === "run" ? "后台采集中…" : "开启并执行本期"}</button><button type="button" className="okrRefresh" disabled={Boolean(working)} onClick={() => void enable(false)}>仅开启定时</button><button type="button" className="okrRefresh" disabled={Boolean(working)} onClick={() => setPreview(null)}>取消</button></div></div> : null}
      <div className="operationsGrid">{data.plans.map(plan => <article key={plan.id}><div className="operationsCardHeading"><h3>{plan.name}</h3><span>{plan.state}</span></div><strong className="operationsCadence">{plan.cadence}</strong><p>{plan.location}</p>{plan.currentExecution ? <p>{plan.currentExecution}</p> : null}<div className="operationsNext"><span>下次执行</span><span>{plan.nextAt ? time(plan.nextAt) : "—"}</span></div></article>)}</div>
      <div className={`operationsHeartbeat state-${data.scheduler.state.toLowerCase()}`}><Cloud size={14} /><strong>{heartbeat[data.scheduler.state]}</strong><span>{data.scheduler.lastCompletedAt ? `最近完成 ${time(data.scheduler.lastCompletedAt)}` : "暂无完成记录"}</span></div>
      <div className="operationsFooters"><details className="operationsHistory"><summary><span><History size={14} />执行记录<em>{data.records.length}</em></span><ChevronDown size={14} /></summary>{data.records.length ? <div className="operationsRecords">{data.records.map(record => <article key={record.id}><div><strong>{record.name}</strong><span>{record.state}</span></div><p>{time(record.startedAt)}{record.completedAt ? ` → ${time(record.completedAt)}` : ""} · {record.detail}</p>{record.failedDiscoveryId ? <div className="dataforseoActions"><button type="button" className="okrRefresh" disabled={Boolean(working)} onClick={() => void inspect(record.failedDiscoveryId!)}>查看异常</button><button type="button" className="okrRefresh" disabled={Boolean(working)} onClick={() => void inspect(record.failedDiscoveryId!, true)}>继续导入（免费）</button></div> : null}</article>)}</div> : <p className="managementLoading">暂无执行记录</p>}{diagnostic ? <pre className="operationsDiagnostic">{diagnostic}</pre> : null}</details>
      <details className="operationsPlanDetails"><summary><span>计划详情</span><ChevronDown size={14} /></summary><div className="operationsPlanNotes"><p>{data.scheduler.configured ? data.scheduler.cadence : "调度认证未配置"}</p>{data.plans.map(plan => <div key={plan.id}><strong>{plan.name}</strong><p>{plan.location} · {plan.note}</p></div>)}{data.controls.enabled ? <p>SERP 单轮 {money(data.controls.maxRunCostMicros)} / 月度 {money(data.controls.maxMonthCostMicros)}；新词发现每轮 {money(data.controls.discoveryMaxCostMicros)}。</p> : null}</div></details></div>
    </> : null}
  </section>;
}
