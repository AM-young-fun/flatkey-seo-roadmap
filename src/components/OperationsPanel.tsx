"use client";
import { useEffect, useRef, useState } from "react";
import { CalendarClock, Cloud, History, RefreshCw } from "lucide-react";
import type { OperationsStatus } from "@/lib/operations";
import type { CollectionSchedulePreview, CollectionCycleProgress } from "@/lib/collection-control";

const time = (value: string | null) => value ? new Date(value).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }) : "尚无记录";
const heartbeat = { UNCONFIRMED: "尚未确认调度成功", HEALTHY: "线上调度正常", OVERDUE: "较长时间未收到调度记录", ERROR: "最近执行异常" };
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
  return <section className="operationsPanel" aria-labelledby="operations-title">
    <div className="operationsHeading"><div><h2 id="operations-title"><CalendarClock size={19} />运行计划与记录</h2><p>北京时间 · 线上项目执行</p></div><button type="button" className="okrRefresh" disabled={busy} onClick={() => void read()}><RefreshCw size={14} />{busy ? "读取中" : "刷新"}</button></div>
    {error ? <p className="loadError" role="alert">{error}</p> : null}
    {notice ? <p className="cacheNotice" role="status">{notice}</p> : null}
    {!data && !error ? <p className="muted">正在读取运行计划…</p> : null}
    {data ? <>
      <div className="operationsControl"><div><strong>隔周自动更新</strong><p>从账户余额扣除接口费 · 已有合适页面的正式词 · 四国前100</p></div><button type="button" role="switch" aria-checked={data.controls.enabled} aria-label="隔周自动更新" className={`operationsSwitch ${data.controls.enabled ? "isOn" : ""}`} disabled={!data.controls.enabled && Boolean(working)} onClick={() => data.controls.enabled ? void pause() : void showPreview()}><span />{data.controls.enabled ? "已开启" : "已关闭"}</button></div>
      {data.controls.enabled ? <p className="chartNote">SERP单轮上限 {money(data.controls.maxRunCostMicros)} · 月度上限 {money(data.controls.maxMonthCostMicros)} · 新词发现另计，每轮最多 $1.584。</p> : null}
      {!preview ? <button type="button" className="okrRefresh" disabled={Boolean(working) || data.controls.emergencyStopped} onClick={() => void showPreview()}>{working === "preview" ? "正在核对范围与余额…" : working ? "本轮执行中…" : "预览本轮范围与费用"}</button> : null}
      {preview ? <div className="operationsPreview"><h3>{preview.periodLabel} · 四国采集</h3><p>{preview.keywordCount.toLocaleString()} 个去重关键词 · {preview.queryCount.toLocaleString()} 次实际排名查询</p><p>新词发现最多 {money(preview.discoveryMaxCostMicros)} + 实际排名最多 {money(preview.serpMaxCostMicros)} = 本轮最多 <strong>{money(preview.totalMaxCostMicros)}</strong></p><p>可用余额 {money(preview.balanceMicros)} · SERP月度上限 {money(preview.maxMonthSerpCostMicros)}。新增词使费用超出上限时暂停，等待确认。</p><div className="dataforseoActions"><button type="button" className="managePrimary" disabled={Boolean(working)} onClick={() => void enable(true)}>{working === "run" ? "后台采集中…" : "开启更新并执行本期"}</button><button type="button" className="okrRefresh" disabled={Boolean(working)} onClick={() => void enable(false)}>仅开启定时</button><button type="button" className="okrRefresh" disabled={Boolean(working)} onClick={() => setPreview(null)}>收起</button></div></div> : null}
      <div className="operationsHeartbeat"><Cloud size={16} /><strong>{heartbeat[data.scheduler.state]}</strong><span>{data.scheduler.configured ? data.scheduler.cadence : "调度认证尚未配置"}</span><span>最近完成：{time(data.scheduler.lastCompletedAt)}</span></div>
      <div className="operationsGrid">{data.plans.map(plan => <article key={plan.id}><div className="operationsCardHeading"><h3>{plan.name}</h3><span>{plan.state}</span></div><strong className="operationsCadence">{plan.cadence}</strong><p>{plan.location}</p>{plan.nextAt ? <p>下一计划时间：{time(plan.nextAt)}</p> : null}<small>{plan.note}</small></article>)}</div>
      <details className="operationsHistory"><summary><History size={16} />最近执行记录 <span>{data.records.length}</span></summary>{data.records.length ? <div className="operationsRecords">{data.records.map(record => <article key={record.id}><div><strong>{record.name}</strong><span>{record.state}</span></div><p>{time(record.startedAt)}{record.completedAt ? ` → ${time(record.completedAt)}` : ""} · {record.detail}</p>{record.failedDiscoveryId ? <div className="dataforseoActions"><button type="button" className="okrRefresh" disabled={Boolean(working)} onClick={() => void inspect(record.failedDiscoveryId!)}>查看异常原因</button><button type="button" className="okrRefresh" disabled={Boolean(working)} onClick={() => void inspect(record.failedDiscoveryId!, true)}>继续导入（不收费）</button></div> : null}</article>)}</div> : <p className="muted">尚无执行记录。配置了计划不代表已经执行。</p>}{diagnostic ? <pre style={{whiteSpace:"pre-wrap",overflowWrap:"anywhere",fontSize:12}}>{diagnostic}</pre> : null}</details>
    </> : null}
  </section>;
}
