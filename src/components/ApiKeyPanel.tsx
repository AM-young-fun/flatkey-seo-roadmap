"use client";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { BookOpen, ChevronDown, Copy, EyeOff, KeyRound, Plus, RefreshCw } from "lucide-react";
import { Select } from "antd";
import { API_KEYS_PATH, KEYWORD_EXPORT_API_PATH, type ExportApiKey } from "@/lib/keyword-export";
import { PAGE_AUDIT_DOMAINS } from "@/lib/page-audit";

export function ApiKeyPanel() {
  const [keys, setKeys] = useState<ExportApiKey[]>([]);
  const [name, setName] = useState("");
  const [siteDomain, setSiteDomain] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [revealed, setRevealed] = useState<{ id: string; secret: string } | null>(null);
  const [confirmRevoke, setConfirmRevoke] = useState<string | null>(null);
  const secretInput = useRef<HTMLInputElement>(null);
  const readKeys = useCallback(async () => {
    const response = await fetch(API_KEYS_PATH, { cache: "no-store" });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message ?? "API Key 列表读取失败");
    setKeys(result.keys);
  }, []);
  useEffect(() => {
    void readKeys().catch(failure => setError(failure instanceof Error ? failure.message : "读取失败")).finally(() => setLoading(false));
  }, [readKeys]);
  async function post(body: Record<string, unknown>) {
    const response = await fetch(API_KEYS_PATH, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message ?? "API Key 操作失败");
    return result;
  }
  async function run(action: () => Promise<void>) {
    setBusy(true); setError(""); setNotice("");
    try { await action(); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "操作失败，请重试"); }
    finally { setBusy(false); }
  }
  function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void run(async () => {
      const result = await post({ action: "create", name: name.trim(), siteDomain: siteDomain || null });
      setRevealed({ id: result.key.id, secret: result.secret }); setName("");
      // Keep the successful creation visible even if refreshing later fails.
      setKeys(current => [result.key, ...current]); setNotice("API Key 已创建，可点击复制使用。");
    });
  }
  function copy(key: ExportApiKey, command = false) {
    void run(async () => {
      const secret = revealed?.id === key.id ? revealed.secret : (await post({ action: "reveal", id: key.id })).secret as string;
      setRevealed({ id: key.id, secret });
      const query = key.siteDomain ? `?siteDomain=${key.siteDomain}` : "";
      const value = command ? `curl '${window.location.origin}${KEYWORD_EXPORT_API_PATH}${query}' \\\n  -H 'X-API-Key: ${secret}'` : secret;
      try { await navigator.clipboard.writeText(value); setNotice(command ? "请求示例已复制（含 API Key）。" : "API Key 已复制。"); }
      catch {
        setNotice("浏览器未允许自动复制，请从下方密钥框选择并手动复制。");
        window.setTimeout(() => { secretInput.current?.focus(); secretInput.current?.select(); }, 0);
      }
    });
  }
  const date = (value: string | null) => value ? new Date(value).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" }) : "尚未使用";
  const activeCount = keys.filter(key => !key.revokedAt).length;
  return <section className="dataforseoPanel apiKeyPanel managementSection" aria-labelledby="api-key-heading">
    <div className="managementSectionHeading">
      <div className="managementSectionTitle"><span className="managementIcon"><KeyRound size={18} /></span><h2 id="api-key-heading">API Key</h2><span className="managementBadge">{activeCount} 个可用</span></div>
      <button type="button" className="managementIconButton" aria-label="刷新 API Key" title="刷新" disabled={busy || loading} onClick={() => void run(readKeys)}><RefreshCw size={15} /></button>
    </div>
    {error ? <p className="loadError" role="alert">{error}</p> : null}
    {notice ? <p className="cacheNotice" role="status">{notice}</p> : null}
    <form className="apiKeyCreate" onSubmit={create}>
      <label className="manageField"><span>密钥名称</span><input value={name} onChange={event => setName(event.target.value)} placeholder="例如：内容自动化" required maxLength={80} disabled={busy} /></label>
      <label className="manageField"><span>网站范围</span><Select aria-label="允许导出的网站" value={siteDomain} onChange={setSiteDomain} disabled={busy} suffixIcon={<ChevronDown size={14} />} options={[{ value: "", label: "全部网站" }, ...PAGE_AUDIT_DOMAINS.map(domain => ({ value: domain, label: domain }))]} /></label>
      <button type="submit" className="managePrimary" disabled={busy || loading || !name.trim()}><Plus size={15} />创建密钥</button>
    </form>
    {revealed ? <div className="apiKeySecret"><label className="manageField"><span>API Key</span><input ref={secretInput} aria-label="当前 API Key" readOnly value={revealed.secret} onFocus={event => event.currentTarget.select()} autoComplete="off" spellCheck={false} /></label><button type="button" className="managementIconButton" aria-label="隐藏 API Key" title="隐藏" onClick={() => setRevealed(null)}><EyeOff size={16} /></button></div> : null}
    {loading ? <p className="muted" role="status">正在读取 API Key…</p> : keys.length ? <div className="apiKeyTableWrap"><table className="apiKeyTable"><thead><tr><th>名称</th><th>网站</th><th>最近使用</th><th>操作</th></tr></thead><tbody>{keys.map(key => <tr key={key.id}><td><div className="apiKeyName"><strong>{key.name}</strong><span className={`apiKeyState ${key.revokedAt ? "isRevoked" : ""}`}>{key.revokedAt ? "已停用" : "可用"}</span></div><small>{key.prefix}</small></td><td data-label="网站">{key.siteDomain ?? "全部网站"}</td><td data-label="最近使用">{date(key.lastUsedAt)}</td><td><div className="apiKeyRowActions">{key.revokedAt ? <span className="muted">停用于 {date(key.revokedAt)}</span> : <><button type="button" className="okrRefresh apiKeyCopy" disabled={busy} onClick={() => copy(key)}><Copy size={13} />复制</button><button type="button" className="okrRefresh" disabled={busy} onClick={() => copy(key, true)}>请求示例</button>{confirmRevoke === key.id ? <><button type="button" className="okrRefresh" disabled={busy} onClick={() => void run(async () => { await post({ action: "revoke", id: key.id }); setKeys(current => current.map(row => row.id === key.id ? { ...row, revokedAt: new Date().toISOString() } : row)); if (revealed?.id === key.id) setRevealed(null); setConfirmRevoke(null); setNotice("API Key 已停用。"); })}>确认停用</button><button type="button" className="okrRefresh" disabled={busy} onClick={() => setConfirmRevoke(null)}>取消</button></> : <button type="button" className="okrRefresh apiKeyRevoke" disabled={busy} onClick={() => setConfirmRevoke(key.id)}>停用</button>}</>}</div></td></tr>)}</tbody></table></div> : !error ? <div className="apiKeyEmpty"><KeyRound size={22} /><div><strong>还没有密钥</strong><span>创建后即可复制并调用导出接口</span></div></div> : null}
    <details className="apiKeyDocs"><summary><span><BookOpen size={15} />接口说明</span><span className="managementSummaryMeta">关键词导出<ChevronDown size={14} /></span></summary>
      <div className="apiKeyDocsBody"><div className="apiKeyEndpoint"><span>GET</span><code>{KEYWORD_EXPORT_API_PATH}</code></div>
        <p>导出尚未获得前 100 排名的业务目标词、规划词和候选词。包含启用的正式词与候选词，不要求已分配主题或规划。</p>
        <p>已有绑定或规划仅限博客文章；绑定到模型、产品、文档等其他页面的词整条排除。没有绑定页面的词继续保留。</p>
        <pre>{`curl 'https://flatkey-seo-roadmap.vercel.app${KEYWORD_EXPORT_API_PATH}?region=US' \\\n  -H 'X-API-Key: 你的密钥'`}</pre>
        <dl><div><dt>siteDomain</dt><dd>网站筛选，省略时使用密钥授权范围</dd></div><div><dt>region</dt><dd>US / JP / ES / BR；默认 all，任一地区有排名即排除</dd></div><div><dt>format</dt><dd>json（默认）或 csv</dd></div></dl>
        <p>每个网站关键词返回一条，附带页面、排名依据和规划；分别标明已确认前100之外、已采集但未命中、未采集，以及采集结果需核实。</p>
      </div>
    </details>
  </section>;
}
