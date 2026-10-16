"use client";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Database, Loader2, RefreshCw } from "lucide-react";
import {
  DATAFORSEO_API_PATH, type DataForSeoMutation, type DataForSeoMutationResult,
  type DataForSeoRunDto, type DataForSeoRunResult, type DataForSeoStatus,
} from "@/lib/dataforseo-management";
import { dashboardStore } from "@/lib/dashboard-client";

const money = (micros: number | null | undefined) => micros == null ? "待确认" : `$${(micros / 1_000_000).toFixed(6).replace(/0+$/, "").replace(/\.$/, "")}`;
const time = (value: string) => new Date(value).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" });
const labels = { PENDING: "请求处理中", UNKNOWN: "结果未确认", FAILED: "请求失败", RECEIVED: "响应已保存 · 待入库", IMPORT_FAILED: "响应已保存 · 入库失败", COMPLETED: "结果已入库" };
class DataforSeoRequestError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

export function DataforSeoConnection({ onChanged }: { onChanged: () => void }) {
  const [status, setStatus] = useState<DataForSeoStatus | null>(null);
  const [apiLogin, setApiLogin] = useState("");
  const [apiPassword, setApiPassword] = useState("");
  const [busy, setBusy] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const readStatus = useCallback(async () => {
    const response = await fetch(DATAFORSEO_API_PATH, { cache: "no-store" });
    if (response.status === 401) { window.location.assign("/login"); throw new Error("登录已失效"); }
    if (!response.ok) throw new Error("DataForSEO 状态读取失败，请刷新状态");
    const value = await response.json() as DataForSeoStatus;
    setStatus(value);
    return value;
  }, []);
  useEffect(() => {
    let active = true;
    void readStatus().catch(failure => { if (active) setError(failure instanceof Error ? failure.message : "状态读取失败"); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [readStatus]);
  async function post(mutation: DataForSeoMutation) {
    const response = await fetch(DATAFORSEO_API_PATH, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(mutation) });
    const result = await response.json().catch(() => ({})) as DataForSeoMutationResult & { message?: string };
    if (!response.ok) throw new DataforSeoRequestError(result.message ?? "操作未确认，请先刷新状态；不要重复提交付费请求", response.status);
    return result;
  }
  async function refreshStatus() {
    setBusy("status"); setError("");
    try {
      const refreshed = await readStatus();
      if (refreshed.runs.some(run => run.status === "COMPLETED" && !status?.runs.some(previous => previous.requestId === run.requestId && previous.status === "COMPLETED"))) {
        dashboardStore.clear(); window.dispatchEvent(new Event("seo-rankings-updated")); onChanged();
        setNotice("已从运行记录确认结果入库，正在刷新排名。");
      }
    } catch (failure) { setError(failure instanceof Error ? failure.message : "状态读取失败"); }
    finally { setBusy(""); }
  }
  async function connect(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy("connect"); setError(""); setNotice("");
    try {
      setStatus(await post({ action: "connect", apiLogin, apiPassword }) as DataForSeoStatus);
      setApiLogin(""); window.dispatchEvent(new Event("dataforseo-connection-updated")); setNotice("API 凭据已保存。可在上方查看SERP计划，付费执行保持关闭。");
    } catch (failure) { setError(failure instanceof Error ? failure.message : "保存失败"); }
    finally { setApiPassword(""); setBusy(""); }
  }
  async function disconnect() {
    setBusy("disconnect"); setError("");
    try { setStatus(await post({ action: "disconnect" }) as DataForSeoStatus); window.dispatchEvent(new Event("dataforseo-connection-updated")); setNotice("已移除 API 凭据，已存排名与运行记录保留。"); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "移除失败"); }
    finally { setBusy(""); }
  }
  async function finishCachedImport(initial: DataForSeoRunResult, maxReplays = 12) {
    let result = initial;
    for (let index = 0; index < maxReplays && result.status === "RECEIVED"; index++) {
      setNotice(`供应商响应已保存，正在从缓存分批入库 ${index + 1} / ${maxReplays}；已导入观测 ${result.run.summary?.importedObservations ?? 0} 条。此步骤不再请求供应商。`);
      result = await post({ action: "replay", requestId: initial.requestId }) as DataForSeoRunResult;
      setStatus(previous => previous ? { ...previous, runs: [result.run, ...previous.runs.filter(run => run.requestId !== result.requestId)] } : previous);
    }
    return result;
  }
  async function replay(run: DataForSeoRunDto) {
    setBusy(run.requestId); setError(""); setNotice("");
    try {
      const resumed = await post({ action: "replay", requestId: run.requestId }) as DataForSeoRunResult;
      const result = await finishCachedImport(resumed, 11);
      setNotice(result.status === "COMPLETED" ? "已从保存的响应完成入库，没有再次请求 DataForSEO。" : `本次状态：${labels[result.status]}`);
      dashboardStore.clear(); window.dispatchEvent(new Event("seo-rankings-updated")); onChanged(); await readStatus();
    } catch (failure) { setError(failure instanceof Error ? failure.message : "缓存入库失败"); }
    finally { setBusy(""); }
  }
  const blocked = Boolean(status?.runs.some(run => run.status === "PENDING" || run.status === "UNKNOWN"));
  const connected = status?.connection.configured && status.connection.canDecrypt;
  return <section className="dataforseoPanel" aria-labelledby="dataforseo-heading">
    <div className="dataforseoHeading"><div className="manageCardHeading"><span className="manageCardIcon"><Database size={19} /></span><div><h2 id="dataforseo-heading">DataForSEO API连接与历史记录</h2><p>SERP计划共用此连接；历史Labs数据库记录仅供参考。</p></div></div><button type="button" className="okrRefresh" disabled={Boolean(busy)} onClick={() => void refreshStatus()}><RefreshCw size={13} /> 刷新状态</button></div>
    {loading ? <p className="muted" role="status">正在读取连接、预算与运行记录…</p> : null}
    {error ? <p className="loadError" role="alert">{error}</p> : null}
    {notice ? <p className="cacheNotice" role="status">{notice}</p> : null}
    {status ? <div className="dataforseoStats"><div><span>API 凭据</span><strong>{connected ? "已配置" : status.connection.configured ? "无法解密 · 请重新保存" : "未配置"}</strong><small>{status.connection.loginMasked ?? "尚未保存 API Login"}</small></div><div><span>历史Labs已使用 / 预留</span><strong>{money(status.trialBudget.usedMicros)}</strong><small>历史试用账本，非供应商实时余额</small></div></div> : null}
    <form className="dataforseoCredentials" onSubmit={connect}>
      <label className="manageField"><span>API Login</span><input type="text" autoComplete="off" value={apiLogin} onChange={event => setApiLogin(event.target.value)} placeholder={status?.connection.loginMasked ? `已配置：${status.connection.loginMasked}` : "DataForSEO API Login"} maxLength={256} disabled={Boolean(busy)} /></label>
      <label className="manageField"><span>API Password</span><input type="password" autoComplete="new-password" value={apiPassword} onChange={event => setApiPassword(event.target.value)} placeholder={status?.connection.configured ? "输入新密码以替换，已有密码不回显" : "输入 API Password"} maxLength={512} disabled={Boolean(busy)} /></label>
      <button className="managePrimary" type="submit" disabled={Boolean(busy) || !apiLogin.trim() || !apiPassword.trim()}>{busy === "connect" ? <Loader2 size={15} className="spin" /> : null}保存凭据</button>
      {status?.connection.configured ? <button type="button" className="okrRefresh" disabled={Boolean(busy)} onClick={() => void disconnect()}>移除凭据</button> : null}
    </form>
    <p className="chartNote">保存凭据不会请求供应商，密码不回显。SERP费用与运行状态请查看上方实测计划；以下是历史Labs记录，不参与实际排名统计。</p>
    {blocked ? <div className="dataforseoUnknown" role="status"><strong>存在处理中的请求或未确认结果</strong><p>可能已经计费，暂不发起新的付费请求。请刷新状态；UNKNOWN 不自动重试。</p></div> : null}
    <details className="dataforseoRuns" open={Boolean(status?.runs.length)}><summary>历史Labs运行记录（{status?.runs.length ?? "—"}）</summary>{status?.runs.length ? <div className="dataforseoRunList">{status.runs.map(run => <article key={run.requestId}><div className="dataforseoRunHeading"><strong>{labels[run.status]}</strong><span>{time(run.startedAt)}</span></div><p>费用：{run.actualCostMicros == null ? `未确认，预留 ${money(run.budgetCostMicros)}` : money(run.actualCostMicros)}</p>{run.summary ? <><p>返回 {run.summary.returnedItems} 条；有效自然结果 {run.summary.normalizedRows} 条；去重后匹配现有词库 {run.summary.matchedExisting} 个{run.summary.matchedPages != null ? `，对应关键词与排名页面 ${run.summary.matchedPages} 对` : ""}；未知候选 {run.summary.unknownCandidates} 个；过滤无关词 {run.summary.unrelatedFiltered} 个。</p><p className="chartNote">匹配词数包含正式目标和研究候选；排名概览仅统计正式目标。同一个词的多个页面逐页保留名次与来源日期，关键词只计一次。导入观测记录 {run.summary.importedObservations} 条（含待核验）；未返回的正式词 {run.summary.missingFormal} 个，保留为待核验。{run.summary.missingResearch ? `另有上轮已返回、本轮未检出的研究候选 ${run.summary.missingResearch} 个，记录待核验，关键词仍保留。` : ""}{run.summary.truncated ? `供应商共有 ${run.summary.totalMatchingCount} 条匹配结果，本次未继续翻页。` : ""}</p></> : null}{["UNKNOWN", "PENDING"].includes(run.status) ? <p className="dataforseoRunWarning">结果未确认，可能已计费。同一请求不会再次发送付费请求。</p> : null}{run.status === "FAILED" ? <p className="dataforseoRunWarning">本次失败不会自动重试，同一请求 ID 不会再次发送付费请求。</p> : null}{run.errorCode ? <p className="chartNote">状态代码：{run.errorCode}</p> : null}{["RECEIVED", "IMPORT_FAILED"].includes(run.status) ? <button type="button" className="okrRefresh" disabled={Boolean(busy)} onClick={() => void replay(run)}>从已保存响应重新入库（不付费）</button> : null}<a className="okrRefresh" href={`${DATAFORSEO_API_PATH}?requestId=${encodeURIComponent(run.requestId)}`} download>下载本次关键词与页面</a><small className="dataforseoRequestId">请求 ID：{run.requestId}</small></article>)}</div> : status ? <p className="muted">尚无历史Labs运行记录。</p> : <p className="muted">读取成功后显示运行记录。</p>}</details>
  </section>;
}
