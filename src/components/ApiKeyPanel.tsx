"use client";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Copy, KeyRound, Plus, RefreshCw } from "lucide-react";
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
  return <section className="dataforseoPanel apiKeyPanel" aria-labelledby="api-key-heading">
    <div className="dataforseoHeading"><div className="manageCardHeading"><span className="manageCardIcon"><KeyRound size={19} /></span><div><h2 id="api-key-heading">API Key · 关键词导出</h2><p>仅导出已确认没有前100排名的关键词，不限是否绑定页面。</p></div></div><button type="button" className="okrRefresh" disabled={busy || loading} onClick={() => void run(readKeys)}><RefreshCw size={13} />刷新</button></div>
    {error ? <p className="loadError" role="alert">{error}</p> : null}
    {notice ? <p className="cacheNotice" role="status">{notice}</p> : null}
    <form className="apiKeyCreate" onSubmit={create}>
      <label className="manageField"><span>密钥名称</span><input value={name} onChange={event => setName(event.target.value)} placeholder="例如：内容自动化" required maxLength={80} disabled={busy} /></label>
      <label className="manageField"><span>允许导出的网站</span><select value={siteDomain} onChange={event => setSiteDomain(event.target.value)} disabled={busy}><option value="">全部网站</option>{PAGE_AUDIT_DOMAINS.map(domain => <option key={domain} value={domain}>{domain}</option>)}</select></label>
      <button type="submit" className="managePrimary" disabled={busy || loading || !name.trim()}><Plus size={15} />创建 API Key</button>
    </form>
    {revealed ? <div className="apiKeySecret"><label className="manageField"><span>当前 API Key（请妥善保管）</span><input ref={secretInput} aria-label="当前 API Key" readOnly value={revealed.secret} onFocus={event => event.currentTarget.select()} autoComplete="off" spellCheck={false} /></label><button type="button" className="okrRefresh" onClick={() => setRevealed(null)}>隐藏</button></div> : null}
    {loading ? <p className="muted" role="status">正在读取 API Key…</p> : keys.length ? <div className="apiKeyTableWrap"><table className="apiKeyTable"><thead><tr><th>密钥名称 / 标识</th><th>网站范围</th><th>最近使用（北京时间）</th><th>操作</th></tr></thead><tbody>{keys.map(key => <tr key={key.id}><td><strong>{key.name}</strong><small>{key.prefix} · {key.revokedAt ? "已停用" : "可使用"}</small></td><td>{key.siteDomain ?? "全部网站"}</td><td>{date(key.lastUsedAt)}</td><td><div className="apiKeyRowActions">{key.revokedAt ? <span className="muted">停用于 {date(key.revokedAt)}</span> : <><button type="button" className="okrRefresh" disabled={busy} onClick={() => copy(key)}><Copy size={13} />复制 API Key</button><button type="button" className="okrRefresh" disabled={busy} onClick={() => copy(key, true)}>复制请求示例</button>{confirmRevoke === key.id ? <><button type="button" className="okrRefresh" disabled={busy} onClick={() => void run(async () => { await post({ action: "revoke", id: key.id }); setKeys(current => current.map(row => row.id === key.id ? { ...row, revokedAt: new Date().toISOString() } : row)); if (revealed?.id === key.id) setRevealed(null); setConfirmRevoke(null); setNotice("API Key 已停用。"); })}>确认停用</button><button type="button" className="okrRefresh" disabled={busy} onClick={() => setConfirmRevoke(null)}>取消</button></> : <button type="button" className="okrRefresh" disabled={busy} onClick={() => setConfirmRevoke(key.id)}>停用</button>}</>}</div></td></tr>)}</tbody></table></div> : !error ? <p className="muted">尚未创建 API Key。创建后即可复制并调用接口。</p> : null}
    <details className="apiKeyDocs"><summary>接口接入说明</summary><p>GET <code>{KEYWORD_EXPORT_API_PATH}</code></p><p>请求头：<code>X-API-Key: 你的 API Key</code>，也支持 <code>Authorization: Bearer 你的 API Key</code>。</p><p>可选参数：<code>siteDomain=flatkey.ai</code> 筛选网站，<code>region=US</code> 筛选地区，<code>format=csv</code> 下载 CSV；默认返回 JSON、汇总四个地区。网站限定密钥省略 siteDomain 时自动使用其授权网站。</p><pre>{`curl 'https://你的部署域名${KEYWORD_EXPORT_API_PATH}?siteDomain=flatkey.ai&format=csv' \\\n  -H 'X-API-Key: 你的 API Key' \\\n  -o content-opportunities.csv`}</pre><p>已进入前100的词全部排除，包括第51–100名。是否绑定页面不影响筛选。仅返回已确认没有前100排名的词；未采集、采集失败、纠词和证据不足的词不返回。默认四地区均确认无排名才返回，可用 region 指定地区。同词在不同网站分别返回。</p><p>返回 <code>hasPage</code>、<code>pageUrls</code>、<code>currentRank</code> 和 <code>isTop100</code>。前100和排名未知的词已被排除，因此 isTop100 固定为 false；任务进度随数据返回。</p><p className="chartNote">密钥仅可读取此导出接口；停用后不能再请求。更改网页登录密码后，旧密钥将无法再次复制，需停用并新建。</p></details>
  </section>;
}
