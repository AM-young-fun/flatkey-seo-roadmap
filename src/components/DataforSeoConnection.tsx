"use client";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Database, Loader2, RefreshCw } from "lucide-react";
import {
  DATAFORSEO_API_PATH, type DataForSeoMutation, type DataForSeoMutationResult,
  type DataForSeoStatus,
} from "@/lib/dataforseo-management";

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
  const [verification, setVerification] = useState<{ balanceMicros: number; checkedAt: string } | null>(null);
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
      await readStatus();
    } catch (failure) { setError(failure instanceof Error ? failure.message : "状态读取失败"); }
    finally { setBusy(""); }
  }
  async function connect(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy("connect"); setError(""); setNotice(""); setVerification(null);
    try {
      setStatus(await post({ action: "connect", apiLogin, apiPassword }) as DataForSeoStatus);
      setApiLogin(""); onChanged(); window.dispatchEvent(new Event("dataforseo-connection-updated")); setNotice("API 凭据已保存，付费执行保持关闭。");
    } catch (failure) { setError(failure instanceof Error ? failure.message : "保存失败"); }
    finally { setApiPassword(""); setBusy(""); }
  }
  async function disconnect() {
    setBusy("disconnect"); setError(""); setVerification(null);
    try { setStatus(await post({ action: "disconnect" }) as DataForSeoStatus); onChanged(); window.dispatchEvent(new Event("dataforseo-connection-updated")); setNotice("已移除 API 凭据，已存排名与运行记录保留。"); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "移除失败"); }
    finally { setBusy(""); }
  }
  async function verifyConnection() {
    setBusy("verify"); setError(""); setNotice(""); setVerification(null);
    try {
      const response = await fetch("/api/serp-monitor", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "sampleBalance" }) });
      if (response.status === 401) { window.location.assign("/login"); return; }
      const result = await response.json();
      if (!response.ok) throw new Error(result.message ?? "连接与余额验证失败，请检查 API 凭据后重试。");
      if (result.action !== "sampleBalance" || !Number.isSafeInteger(result.balanceMicros) || result.balanceMicros < 0 || typeof result.checkedAt !== "string" || !Number.isFinite(Date.parse(result.checkedAt)) || typeof result.scheduledPaidEnabled !== "boolean") throw new Error("验证回执不完整，尚未确认账户余额。");
      setVerification({ balanceMicros: result.balanceMicros, checkedAt: result.checkedAt });
    } catch (failure) { setError(failure instanceof Error ? failure.message : "连接与余额验证失败"); }
    finally { setBusy(""); }
  }
  const connected = status?.connection.configured && status.connection.canDecrypt;
  return <section className="dataforseoPanel" aria-labelledby="dataforseo-heading">
    <div className="dataforseoHeading"><div className="manageCardHeading"><span className="manageCardIcon"><Database size={19} /></span><div><h2 id="dataforseo-heading">DataForSEO API连接</h2><p>排名采集使用此连接。</p></div></div><button type="button" className="okrRefresh" disabled={Boolean(busy)} onClick={() => void refreshStatus()}><RefreshCw size={13} /> 刷新状态</button></div>
    {loading ? <p className="muted" role="status">正在读取连接状态…</p> : null}
    {error ? <p className="loadError" role="alert">{error}</p> : null}
    {notice ? <p className="cacheNotice" role="status">{notice}</p> : null}
    {status ? <div className="dataforseoStats"><div><span>API 凭据</span><strong>{connected ? "已配置" : status.connection.configured ? "无法解密 · 请重新保存" : "未配置"}</strong><small>{status.connection.loginMasked ?? "尚未保存 API Login"}</small></div></div> : null}
    <form className="dataforseoCredentials" onSubmit={connect}>
      <label className="manageField"><span>API Login</span><input type="text" autoComplete="off" value={apiLogin} onChange={event => setApiLogin(event.target.value)} placeholder={status?.connection.loginMasked ? `已配置：${status.connection.loginMasked}` : "DataForSEO API Login"} maxLength={256} disabled={Boolean(busy)} /></label>
      <label className="manageField"><span>API Password</span><input type="password" autoComplete="new-password" value={apiPassword} onChange={event => setApiPassword(event.target.value)} placeholder={status?.connection.configured ? "输入新密码以替换，已有密码不回显" : "输入 API Password"} maxLength={512} disabled={Boolean(busy)} /></label>
      <button className="managePrimary" type="submit" disabled={Boolean(busy) || !apiLogin.trim() || !apiPassword.trim()}>{busy === "connect" ? <Loader2 size={15} className="spin" /> : null}保存凭据</button>
      {status?.connection.configured ? <button type="button" className="okrRefresh" disabled={Boolean(busy)} onClick={() => void disconnect()}>移除凭据</button> : null}
    </form>
    <p className="chartNote">保存凭据不会执行抓取，密码不回显。</p>
    <div className="dataforseoActions"><button type="button" className="okrRefresh" disabled={Boolean(busy) || !connected} onClick={() => void verifyConnection()}>{busy === "verify" ? "正在验证…" : "验证连接与余额"}</button></div>
    {verification ? <p className="cacheNotice" role="status">认证成功 · 可用余额 <strong>{new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 6 }).format(verification.balanceMicros / 1_000_000)}</strong><br /><small>{new Date(verification.checkedAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}（北京时间） · 仅查询账户信息，未执行付费抓取。</small></p> : null}
  </section>;
}
