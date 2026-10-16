"use client";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Database, Loader2, RefreshCw } from "lucide-react";
import {
  DATAFORSEO_API_PATH, type DataForSeoMutation, type DataForSeoMutationResult,
  type DataForSeoPreview, type DataForSeoRunDto, type DataForSeoRunResult, type DataForSeoStatus,
} from "@/lib/dataforseo-management";
import { dashboardStore } from "@/lib/dashboard-client";

const money = (micros: number | null | undefined) => micros == null ? "待确认" : `$${(micros / 1_000_000).toFixed(6).replace(/0+$/, "").replace(/\.$/, "")}`;
const time = (value: string) => new Date(value).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" });
const labels = { PENDING: "请求处理中", UNKNOWN: "结果未确认", FAILED: "请求失败", RECEIVED: "响应已保存 · 待入库", IMPORT_FAILED: "响应已保存 · 入库失败", COMPLETED: "结果已入库" };
const PENDING_KEY = "dataforseo-unconfirmed-request";
const pendingRequest = {
  read() { try { return sessionStorage.getItem(PENDING_KEY); } catch { return null; } },
  save(requestId: string) { try { sessionStorage.setItem(PENDING_KEY, requestId); } catch { /* The server ledger still prevents another paid request. */ } },
  clear() { try { sessionStorage.removeItem(PENDING_KEY); } catch { /* Storage may be disabled. */ } },
};
class DataforSeoRequestError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

export function DataforSeoConnection({ onChanged }: { onChanged: () => void }) {
  const [status, setStatus] = useState<DataForSeoStatus | null>(null);
  const [preview, setPreview] = useState<DataForSeoPreview | null>(null);
  const [apiLogin, setApiLogin] = useState("");
  const [apiPassword, setApiPassword] = useState("");
  const [busy, setBusy] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [uncertain, setUncertain] = useState<string | null>(null);
  const readStatus = useCallback(async () => {
    const response = await fetch(DATAFORSEO_API_PATH, { cache: "no-store" });
    if (response.status === 401) { window.location.assign("/login"); throw new Error("登录已失效"); }
    if (!response.ok) throw new Error("DataForSEO 状态读取失败，请刷新状态");
    const value = await response.json() as DataForSeoStatus;
    setStatus(value);
    const saved = pendingRequest.read();
    const known = value.runs.find(run => run.requestId === saved);
    if (known && !["PENDING", "UNKNOWN"].includes(known.status)) {
      pendingRequest.clear(); setUncertain(null);
    } else setUncertain(previous => {
      const current = saved ?? previous;
      const currentRun = value.runs.find(run => run.requestId === current);
      return currentRun && !["PENDING", "UNKNOWN"].includes(currentRun.status) ? null : current;
    });
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
    event.preventDefault(); setBusy("connect"); setError(""); setNotice(""); setPreview(null);
    try {
      setStatus(await post({ action: "connect", apiLogin, apiPassword }) as DataForSeoStatus);
      setApiLogin(""); setNotice("API 凭据已保存。费用预览与实际更新需要分别操作。");
    } catch (failure) { setError(failure instanceof Error ? failure.message : "保存失败"); }
    finally { setApiPassword(""); setBusy(""); }
  }
  async function disconnect() {
    setBusy("disconnect"); setError(""); setPreview(null);
    try { setStatus(await post({ action: "disconnect" }) as DataForSeoStatus); setNotice("已移除 API 凭据，已存排名与运行记录保留。"); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "移除失败"); }
    finally { setBusy(""); }
  }
  async function previewUpdate() {
    setBusy("preview"); setError(""); setNotice(""); setPreview(null);
    try { setPreview(await post({ action: "preview", requestId: `flatkey-us-en-${crypto.randomUUID()}` }) as DataForSeoPreview); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "费用预览失败"); }
    finally { setBusy(""); }
  }
  async function finishCachedImport(initial: DataForSeoRunResult, maxReplays = 8) {
    let result = initial;
    for (let index = 0; index < maxReplays && result.status === "RECEIVED"; index++) {
      setNotice(`供应商响应已保存，正在从缓存分批入库 ${index + 1} / ${maxReplays}；已导入观测 ${result.run.summary?.importedObservations ?? 0} 条。此步骤不再请求供应商。`);
      result = await post({ action: "replay", requestId: initial.requestId }) as DataForSeoRunResult;
      setStatus(previous => previous ? { ...previous, runs: [result.run, ...previous.runs.filter(run => run.requestId !== result.requestId)] } : previous);
    }
    return result;
  }
  async function update() {
    if (!preview) return;
    const planned = preview;
    if (Date.parse(planned.expiresAt) <= Date.now()) { setPreview(null); setError("费用预览已过期，请重新预览。本次未发送更新请求。"); return; }
    setBusy("update"); setError(""); setNotice(""); setPreview(null);
    pendingRequest.save(planned.requestId); setUncertain(planned.requestId);
    try {
      const received = await post({ action: "update", requestId: planned.requestId, previewToken: planned.previewToken }) as DataForSeoRunResult;
      const result = await finishCachedImport(received);
      setNotice(result.status === "COMPLETED" ? "更新完成，结果已保存到数据库。" : `本次状态：${labels[result.status]}。请查看运行记录。`);
      if (!["PENDING", "UNKNOWN"].includes(result.status)) { pendingRequest.clear(); setUncertain(null); }
      dashboardStore.clear(); window.dispatchEvent(new Event("seo-rankings-updated")); onChanged();
      await readStatus();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "请求结果未确认，可能已经计费。请刷新状态，不要重新付费提交。");
      const refreshed = await readStatus().catch(() => null);
      if (refreshed?.runs.some(run => run.requestId === planned.requestId && run.status === "COMPLETED")) {
        setError(""); setNotice("已从运行记录确认本次更新完成，结果已入库。");
        dashboardStore.clear(); window.dispatchEvent(new Event("seo-rankings-updated")); onChanged();
      }
      if (failure instanceof DataforSeoRequestError && failure.status < 500 && refreshed && !refreshed.runs.some(run => run.requestId === planned.requestId)) {
        pendingRequest.clear(); setUncertain(null);
      }
    } finally { setBusy(""); }
  }
  async function replay(run: DataForSeoRunDto) {
    setBusy(run.requestId); setError(""); setNotice("");
    try {
      const resumed = await post({ action: "replay", requestId: run.requestId }) as DataForSeoRunResult;
      const result = await finishCachedImport(resumed, 7);
      setNotice(result.status === "COMPLETED" ? "已从保存的响应完成入库，没有再次请求 DataForSEO。" : `本次状态：${labels[result.status]}`);
      dashboardStore.clear(); window.dispatchEvent(new Event("seo-rankings-updated")); onChanged(); await readStatus();
    } catch (failure) { setError(failure instanceof Error ? failure.message : "缓存入库失败"); }
    finally { setBusy(""); }
  }
  const blocked = Boolean(uncertain || status?.runs.some(run => run.status === "PENDING" || run.status === "UNKNOWN"));
  const connected = status?.connection.configured && status.connection.canDecrypt;
  return <section className="dataforseoPanel" aria-labelledby="dataforseo-heading">
    <div className="dataforseoHeading"><div className="manageCardHeading"><span className="manageCardIcon"><Database size={19} /></span><div><h2 id="dataforseo-heading">DataForSEO 排名更新</h2><p>Google 自然结果数据库 · Flatkey · 美国 / 英语 · 最多 1,000 条</p></div></div><button type="button" className="okrRefresh" disabled={Boolean(busy)} onClick={() => void refreshStatus()}><RefreshCw size={13} /> 刷新状态</button></div>
    {loading ? <p className="muted" role="status">正在读取连接、预算与运行记录…</p> : null}
    {error ? <p className="loadError" role="alert">{error}</p> : null}
    {notice ? <p className="cacheNotice" role="status">{notice}</p> : null}
    {status ? <div className="dataforseoStats"><div><span>API 凭据</span><strong>{connected ? "已配置" : status.connection.configured ? "无法解密 · 请重新保存" : "未配置"}</strong><small>{status.connection.loginMasked ?? "尚未保存 API Login"}</small></div><div><span>本系统试用预算剩余额度</span><strong>{money(status.trialBudget.remainingMicros)}</strong><small>总额度 {money(status.trialBudget.limitMicros)} · 已使用 / 预留 {money(status.trialBudget.usedMicros)}</small></div><div><span>单次费用上限</span><strong>{money(status.quote.maxCostMicros)}</strong><small>最多 {status.quote.limit.toLocaleString()} 条，不自动翻页</small></div><div><span>更新频率</span><strong>手动更新</strong><small>建议每 14 天；自动付费未启用</small></div></div> : null}
    <form className="dataforseoCredentials" onSubmit={connect}>
      <label className="manageField"><span>API Login</span><input type="text" autoComplete="off" value={apiLogin} onChange={event => setApiLogin(event.target.value)} placeholder={status?.connection.loginMasked ? `已配置：${status.connection.loginMasked}` : "DataForSEO API Login"} maxLength={256} disabled={Boolean(busy)} /></label>
      <label className="manageField"><span>API Password</span><input type="password" autoComplete="new-password" value={apiPassword} onChange={event => setApiPassword(event.target.value)} placeholder={status?.connection.configured ? "输入新密码以替换，已有密码不回显" : "输入 API Password"} maxLength={512} disabled={Boolean(busy)} /></label>
      <button className="managePrimary" type="submit" disabled={Boolean(busy) || !apiLogin.trim() || !apiPassword.trim()}>{busy === "connect" ? <Loader2 size={15} className="spin" /> : null}保存凭据</button>
      {status?.connection.configured ? <button type="button" className="okrRefresh" disabled={Boolean(busy)} onClick={() => void disconnect()}>移除凭据</button> : null}
    </form>
    <p className="chartNote">保存凭据不会请求供应商。密码不回显；单次更新先预览费用，再手动发起一次请求。本系统试用预算不代表供应商账户实时余额，不自动充值；未知结果保留费用预留。</p>
    {blocked ? <div className="dataforseoUnknown" role="status"><strong>存在处理中的请求或未确认结果</strong><p>可能已经计费，暂不发起新的付费请求。请刷新状态；UNKNOWN 不自动重试。{uncertain ? ` 请求 ID：${uncertain}` : ""}</p></div> : null}
    <div className="dataforseoActions"><button type="button" className="okrRefresh" disabled={!connected || Boolean(busy) || blocked || !status || status.trialBudget.remainingMicros < status.quote.maxCostMicros} onClick={() => void previewUpdate()}>{busy === "preview" ? "正在预览…" : "预览更新费用"}</button><span className="chartNote">只更新数据库已收录的名次；这不是逐词实时 SERP 抓取。</span></div>
    {preview ? <div className="dataforseoPreview"><h3>本次更新费用预览</h3><p>Flatkey · 美国 / 英语 · 最多 {preview.quote.limit.toLocaleString()} 条 · 单次上限 <strong>{money(preview.quote.maxCostMicros)}</strong> · 当前预算剩余 {money(preview.trialBudget.remainingMicros)}</p><p className="chartNote">预览有效至 {time(preview.expiresAt)}。按已知业务词去重匹配；未知词保留为候选，业务无关词不进入正式排名。</p><button className="managePrimary" type="button" disabled={Boolean(busy) || blocked} onClick={() => void update()}>手动更新关键词排名（最高 {money(preview.quote.maxCostMicros)}）</button></div> : null}
    <details className="dataforseoRuns" open={Boolean(status?.runs.length)}><summary>已存运行记录（{status?.runs.length ?? "—"}）</summary>{status?.runs.length ? <div className="dataforseoRunList">{status.runs.map(run => <article key={run.requestId}><div className="dataforseoRunHeading"><strong>{labels[run.status]}</strong><span>{time(run.startedAt)}</span></div><p>费用：{run.actualCostMicros == null ? `未确认，预留 ${money(run.budgetCostMicros)}` : money(run.actualCostMicros)}</p>{run.summary ? <><p>返回 {run.summary.returnedItems} 条；有效自然结果 {run.summary.normalizedRows} 条；去重后匹配已有业务词 {run.summary.matchedExisting} 个{run.summary.matchedPages != null ? `，对应关键词与排名页面 ${run.summary.matchedPages} 对` : ""}；未知候选 {run.summary.unknownCandidates} 个；过滤无关词 {run.summary.unrelatedFiltered} 个。</p><p className="chartNote">同一个词的多个页面逐页保留名次与来源日期，关键词只计一次。导入观测记录 {run.summary.importedObservations} 条（含待核验）；未返回的正式词 {run.summary.missingFormal} 个，保留为待核验。{run.summary.truncated ? `供应商共有 ${run.summary.totalMatchingCount} 条匹配结果，本次未继续翻页。` : ""}</p></> : null}{["UNKNOWN", "PENDING"].includes(run.status) ? <p className="dataforseoRunWarning">结果未确认，可能已计费。同一请求不会再次发送付费请求。</p> : null}{run.status === "FAILED" ? <p className="dataforseoRunWarning">本次失败不会自动重试，同一请求 ID 不会再次发送付费请求。</p> : null}{run.errorCode ? <p className="chartNote">状态代码：{run.errorCode}</p> : null}{["RECEIVED", "IMPORT_FAILED"].includes(run.status) ? <button type="button" className="okrRefresh" disabled={Boolean(busy)} onClick={() => void replay(run)}>从已保存响应重新入库（不付费）</button> : null}<a className="okrRefresh" href={`${DATAFORSEO_API_PATH}?requestId=${encodeURIComponent(run.requestId)}`} download>下载本次关键词与页面</a><small className="dataforseoRequestId">请求 ID：{run.requestId}</small></article>)}</div> : status ? <p className="muted">尚未发起排名更新。</p> : <p className="muted">读取成功后显示运行记录。</p>}</details>
  </section>;
}
