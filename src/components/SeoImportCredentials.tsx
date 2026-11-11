"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Check, Copy, KeyRound, RefreshCw } from "lucide-react";
import { PageHeader } from "./PageHeader";
import { UiSelect } from "./UiSelect";
import workspace from "./SeoWorkspace.module.css";
import styles from "./SeoImportCredentials.module.css";

type ImportToken = {
  id: string; name: string; prefix: string; createdAt: string;
  expiresAt: string | null; lastUsedAt: string | null; revokedAt: string | null;
};
type TokenList = { tokens: ImportToken[]; legacy: { configured: boolean; managed: false }; storage: "database" };
type OneTimeSecret = { id: string; name: string; value: string };
class CredentialRequestError extends Error {}

function isToken(value: unknown): value is ImportToken {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<ImportToken>;
  return [item.id, item.name, item.prefix, item.createdAt].every(field => typeof field === "string") &&
    [item.expiresAt, item.lastUsedAt, item.revokedAt].every(field => field === null || typeof field === "string");
}

function isTokenList(value: unknown): value is TokenList {
  if (!value || typeof value !== "object") return false;
  const data = value as Partial<TokenList>;
  return data.storage === "database" && Array.isArray(data.tokens) && data.tokens.every(isToken) &&
    typeof data.legacy?.configured === "boolean" && data.legacy.managed === false;
}

function dateLabel(value: string | null, empty: string): string {
  if (!value) return empty;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "时间待确认";
  return new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(date);
}

function responseMessage(status: number, fallback: string): string {
  if (status === 401 || status === 403) return "登录已失效或没有操作权限，请重新登录后再试。";
  if (status === 503) return "接入凭据暂时不可用，请确认平台的数据存储已就绪后重试。";
  if (status === 429) return "操作较频繁，请稍后再试。";
  return fallback;
}

export function SeoImportCredentials() {
  const [data, setData] = useState<TokenList | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [actionError, setActionError] = useState("");
  const [notice, setNotice] = useState("");
  const [name, setName] = useState("");
  const [expiresInDays, setExpiresInDays] = useState("90");
  const [busy, setBusy] = useState<"create" | "revoke" | null>(null);
  const [secret, setSecret] = useState<OneTimeSecret | null>(null);
  const [copyMessage, setCopyMessage] = useState("");
  const [copied, setCopied] = useState(false);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const actionPending = useRef(false);
  const loadRequest = useRef<AbortController | null>(null);
  const mounted = useRef(true);

  const refresh = useCallback(async () => {
    loadRequest.current?.abort();
    const controller = new AbortController();
    loadRequest.current = controller;
    setLoading(true); setLoadError("");
    try {
      const response = await fetch("/api/import-tokens", { cache: "no-store", signal: controller.signal });
      if (!response.ok) throw new CredentialRequestError(responseMessage(response.status, "暂时无法读取凭据列表，请刷新重试。"));
      const result: unknown = await response.json();
      if (!isTokenList(result)) throw new CredentialRequestError("凭据列表返回不完整，请刷新重试。");
      if (!controller.signal.aborted && mounted.current) setData(result);
    } catch (error) {
      if (!controller.signal.aborted && mounted.current) setLoadError(error instanceof CredentialRequestError ? error.message : "暂时无法读取凭据列表，请确认连接正常后刷新重试。");
    } finally {
      if (!controller.signal.aborted && mounted.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void refresh();
    return () => { mounted.current = false; loadRequest.current?.abort(); };
  }, [refresh]);

  async function createToken(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedName = name.trim();
    if (actionPending.current || secret || !data) return;
    if (!trimmedName) { setActionError("请为这份凭据填写一个便于识别的名称。"); return; }
    actionPending.current = true;
    loadRequest.current?.abort(); setLoading(false);
    setBusy("create"); setActionError(""); setNotice("");
    try {
      // A creation request is sent once. An uncertain response must be checked in the list, never retried automatically.
      const response = await fetch("/api/import-tokens", {
        method: "POST", cache: "no-store", headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "create", name: trimmedName, expiresInDays: expiresInDays === "never" ? null : Number(expiresInDays) }),
      });
      if (!response.ok) throw new CredentialRequestError(responseMessage(response.status, "生成未确认成功，请先刷新列表检查，再决定是否重新生成。"));
      const result = await response.json() as { token?: unknown; secret?: unknown };
      if (!isToken(result.token) || typeof result.secret !== "string" || !result.secret) throw new CredentialRequestError("生成结果不完整，请先刷新列表检查；无法保存的新凭据可停用后重新生成。");
      if (!mounted.current) return;
      const token = result.token;
      setData(current => current ? { ...current, tokens: [token, ...current.tokens.filter(item => item.id !== token.id)] } : current);
      // The complete value lives only in this component's memory and is discarded when hidden or unmounted.
      setSecret({ id: token.id, name: token.name, value: result.secret });
      setCopyMessage(""); setCopied(false); setName("");
    } catch (error) {
      if (mounted.current) setActionError(error instanceof CredentialRequestError ? error.message : "生成未确认成功，已停止重试。请先刷新列表检查；若出现无法保存的新凭据，请停用后再生成。");
    } finally {
      actionPending.current = false;
      if (mounted.current) setBusy(null);
    }
  }

  async function revokeToken(token: ImportToken) {
    if (actionPending.current) return;
    actionPending.current = true;
    loadRequest.current?.abort(); setLoading(false);
    setBusy("revoke"); setActionError(""); setNotice("");
    try {
      const response = await fetch("/api/import-tokens", {
        method: "POST", cache: "no-store", headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "revoke", id: token.id }),
      });
      if (!response.ok) throw new CredentialRequestError(responseMessage(response.status, "停用未确认成功，请刷新列表核对状态后重试。"));
      const result = await response.json() as { revoked?: unknown };
      if (result.revoked !== true) throw new CredentialRequestError("停用未确认成功，请刷新列表核对状态。");
      if (!mounted.current) return;
      setSecret(current => current?.id === token.id ? null : current);
      setCopyMessage(""); setCopied(false); setConfirmId(null);
      setData(current => current ? { ...current, tokens: current.tokens.map(item => item.id === token.id ? { ...item, revokedAt: new Date().toISOString() } : item) } : current);
      setNotice(`“${token.name}”已停用。使用它的任务需要更换凭据后才能继续。`);
      void refresh();
    } catch (error) {
      if (mounted.current) setActionError(error instanceof CredentialRequestError ? error.message : "停用未确认成功，请刷新列表核对状态后重试。");
    } finally {
      actionPending.current = false;
      if (mounted.current) setBusy(null);
    }
  }

  async function copySecret() {
    if (!secret) return;
    try {
      await navigator.clipboard.writeText(secret.value);
      setCopied(true); setCopyMessage("已复制，请粘贴到安全的保存位置或任务配置中。");
    } catch {
      setCopied(false); setCopyMessage("浏览器没有允许复制。请选中上方完整凭据，手动复制保存。");
    }
  }

  return <main className={workspace.shell}>
    <PageHeader active="credentials" />
    <div className={workspace.titleRow}><div><h1 className={workspace.title}>接入凭据</h1><p className={styles.subtitle}>管理采集任务的连接权限。</p></div></div>
    <div className={styles.content}>
      <p className={styles.scope}>将凭据填入任务配置 <code>SEO_IMPORT_TOKEN</code>，仅用于数据导入，不授予审批或发布权限。</p>
      {data?.legacy.configured ? <aside className={styles.legacy}><strong>现有任务凭据继续有效</strong><p>旧配置继续有效。确认新凭据可用后，再迁移对应任务。</p></aside> : null}
      <section className={styles.card} aria-labelledby="create-credential-title">
        <h2 id="create-credential-title"><KeyRound size={18} aria-hidden="true" />生成新凭据</h2>
        <form onSubmit={createToken} className={styles.form}>
          <label className={styles.nameField} htmlFor="credential-name">名称<input id="credential-name" value={name} onChange={event => setName(event.target.value)} placeholder="例如：每日数据采集" maxLength={80} autoComplete="off" required disabled={busy !== null || Boolean(secret)} /></label>
          <div className={styles.expiryField}><label htmlFor="credential-expiry">有效期</label><UiSelect id="credential-expiry" aria-label="有效期" value={expiresInDays} onChange={setExpiresInDays} disabled={busy !== null || Boolean(secret)} options={[{ value: "30", label: "30 天" }, { value: "90", label: "90 天（推荐）" }, { value: "365", label: "365 天" }, { value: "never", label: "长期有效" }]} /></div>
          <button className={styles.primary} type="submit" disabled={!data || loading || busy !== null || Boolean(secret)}>{busy === "create" ? "正在生成…" : "生成凭据"}</button>
        </form>
        {secret ? <div className={styles.secret} aria-labelledby="new-credential-title">
          <h3 id="new-credential-title">“{secret.name}”已生成，请立即保存</h3>
          <p>完整凭据只显示这一次。收起、刷新或离开页面后，无法再次查看。</p>
          <label className={styles.secretLabel} htmlFor="new-credential-value">完整凭据</label>
          <textarea id="new-credential-value" value={secret.value} readOnly spellCheck={false} autoComplete="off" rows={3} onFocus={event => event.target.select()} />
          <div className={styles.actions}><button type="button" className={styles.secondary} onClick={() => void copySecret()}>{copied ? <Check size={15} aria-hidden="true" /> : <Copy size={15} aria-hidden="true" />}{copied ? "已复制" : "复制完整凭据"}</button><button type="button" className={styles.secondary} onClick={() => { setSecret(null); setCopyMessage(""); setCopied(false); }}>已安全保存，收起</button></div>
          {copyMessage ? <p className={styles.copyMessage} role="status">{copyMessage}</p> : null}
        </div> : null}
      </section>
      {actionError ? <p className={styles.error} role="alert">{actionError}</p> : null}
      {notice ? <p className={styles.notice} role="status">{notice}</p> : null}
      <section className={styles.card} aria-labelledby="credentials-list-title" aria-busy={loading}>
        <div className={styles.listHeading}><h2 id="credentials-list-title">已生成的凭据{data ? <span>{data.tokens.length}</span> : null}</h2><button type="button" className={styles.secondary} disabled={loading || busy !== null} onClick={() => void refresh()}><RefreshCw size={14} aria-hidden="true" />{loading ? "正在读取…" : "刷新"}</button></div>
        <p className={styles.hint}>仅展示凭据前缀 · 时间为北京时间</p>
        {loadError ? <p className={styles.error} role="alert">{loadError}{data ? " 下方保留上次读取结果，最新状态尚待确认。" : ""}</p> : null}
        {!data && loading ? <p className={styles.empty} role="status">正在读取凭据列表…</p> : null}
        {data?.tokens.length === 0 ? <p className={styles.empty}>暂无凭据。在上方为采集任务生成。</p> : null}
        {data && data.tokens.length > 0 ? <ul className={styles.tokenList}>{data.tokens.map(token => {
          const state = token.revokedAt ? "revoked" : token.expiresAt && new Date(token.expiresAt).getTime() <= Date.now() ? "expired" : "active";
          return <li key={token.id} className={styles.token}>
            <div className={styles.tokenHeading}><div><h3>{token.name}</h3><code>{token.prefix}…</code></div><span className={styles.status} data-status={state}>{state === "revoked" ? "已停用" : state === "expired" ? "已过期" : "可使用"}</span></div>
            <dl className={styles.dates}><div><dt>创建时间</dt><dd>{dateLabel(token.createdAt, "待确认")}</dd></div><div><dt>最近使用</dt><dd>{dateLabel(token.lastUsedAt, "尚未使用")}</dd></div><div><dt>到期时间</dt><dd>{dateLabel(token.expiresAt, "长期有效")}</dd></div></dl>
            {token.revokedAt ? <p className={styles.hint}>停用于 {dateLabel(token.revokedAt, "待确认")}</p> : confirmId === token.id ? <div className={styles.confirmation}><p>确认停用“{token.name}”？使用这份凭据的任务将无法继续连接，请先确认已完成更换。</p><div className={styles.actions}><button type="button" className={styles.danger} disabled={busy !== null} onClick={() => void revokeToken(token)}>{busy === "revoke" ? "正在停用…" : "确认停用"}</button><button type="button" className={styles.secondary} disabled={busy !== null} onClick={() => setConfirmId(null)}>取消</button></div></div> : <button type="button" className={styles.stop} disabled={busy !== null} onClick={() => { setConfirmId(token.id); setActionError(""); }}>停用</button>}
          </li>;
        })}</ul> : null}
      </section>
    </div>
  </main>;
}
