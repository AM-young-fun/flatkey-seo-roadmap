"use client";
import { useEffect, useRef, useState } from "react";
import type { QuarterMembershipSelection } from "@/lib/quarter-membership";
import { identityApi, identityJson } from "@/lib/pre-freeze-identities-client";
import { verifyMembershipOperation, type MembershipApply, type MembershipPreview, type MembershipReceipt } from "@/lib/quarter-membership-client";
import { FeedbackButton } from "./FeedbackButton";
import styles from "./GrowthGoalSummary.module.css";

const storageKey = "seo-quarter-membership:2026-close";
type Pending = { command: MembershipApply; original: MembershipPreview };
export function QuarterMembershipReview({ onChanged }: { onChanged: () => Promise<void> }) {
  const [selection, setSelection] = useState<QuarterMembershipSelection | null>(null), [preview, setPreview] = useState<MembershipPreview | null>(null);
  const [pending, setPending] = useState<Pending | null>(null), [receipt, setReceipt] = useState<MembershipReceipt | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const requestId = useRef(""), locked = useRef(false);
  useEffect(() => { try { const raw = sessionStorage.getItem(storageKey); if (raw) { const saved = JSON.parse(raw) as Pending;
    if (saved.command?.action === "apply" && saved.original?.manifest) { setPending(saved); setSelection(saved.command.selection); setPreview(saved.original); requestId.current = saved.command.requestId; setError("存在尚未核实的原成员请求，只核对原回执，不重新提交"); }
  } } catch { setError("原成员请求记录读取未完成，请先核对浏览器存储"); } }, []);
  const run = async (action: () => Promise<void>) => { if (locked.current) return; locked.current = true; setBusy(true); setError("");
    try { await action(); } catch (error) { setError(error instanceof Error ? error.message : "尚未完成，请核对原请求"); } finally { locked.current = false; setBusy(false); } };
  const load = (file?: File) => run(async () => {
    if (!file || pending) return; if (file.size > 1_900_000) throw Error("完整成员审核包须小于1.9MB");
    const raw = JSON.parse(await file.text()), value = raw.review?.selection ?? raw.selection ?? raw;
    if (value?.version !== "quarter-membership-v1" || typeof value.sourceHash !== "string" || !Array.isArray(value.members)
      || value.members.some((row: QuarterMembershipSelection["members"][number]) => !row || [row.siteDomain, row.keywordId, row.keyword, row.topicId].some(field => typeof field !== "string"))) throw Error("请选择原quarter-membership完整1600名单，或包含同一selection的身份审核包");
    setSelection(value); setPreview(null); setReceipt(null); requestId.current = "human-membership:" + crypto.randomUUID();
  });
  const readPreview = () => run(async () => {
    if (!selection || pending) return;
    setPreview(await identityJson(identityApi, { action: "preview", requestId: requestId.current, selection }));
  });
  const apply = (reconcile = false) => run(async () => {
    if (!selection || !preview || receipt && !pending || pending && !reconcile) return;
    const operation = pending ?? { original: preview, command: { action: "apply" as const, requestId: requestId.current, selection: preview.manifest, selectionHash: preview.selectionHash, expectedStateHash: preview.stateHash } };
    sessionStorage.setItem(storageKey, JSON.stringify(operation)); setPending(operation);
    const result = await verifyMembershipOperation(operation.command, operation.original, !reconcile);
    if (result.receipt) setReceipt(result.receipt);
    if (result.status === "verified" || result.status === "rejected") {
      try { sessionStorage.removeItem(storageKey); } catch { /* Reload can still safely read the same original receipt. */ }
      setPending(null); if (result.status === "verified") await onChanged(); else { setPreview(null); setError(result.error); }
    } else setError(result.error);
  });
  return <details><summary>核定同一1600原词的正式成员与已审话题</summary>
    <p>先沿原接口核定完整名单：只将所选真实RESEARCH成员纳入FORMAL，保留原词ID、主父、已有边、市场、任务和未入选历史词；不会自动补市场、批准季度或冻结。随后再完成下方身份审核与待审方案。</p>
    <label>原1600成员清单 <input type="file" aria-label="季度正式成员审核包" accept="application/json,.json" disabled={busy || Boolean(pending)} onChange={event => void load(event.target.files?.[0])} /></label>
    {selection ? <><p>原清单SHA：{selection.sourceHash}；来源：{selection.sourceReference}；成员记录 {selection.members.length} 条。</p>
      <details><summary>查看全部原词与已审话题</summary><div className={styles.scroll}><table><thead><tr><th>站点</th><th>原词 / 原ID</th><th>已审TopicMap话题ID</th></tr></thead><tbody>{selection.members.map(row => <tr key={`${row.siteDomain}:${row.keywordId}`}><td>{row.siteDomain}</td><td>{row.keyword}<small>{row.keywordId}</small></td><td>{row.topicId}</td></tr>)}</tbody></table></div></details>
      {preview ? <p>真实预览：{preview.uniqueWords}个唯一原词，{preview.membershipCount}条站点成员；待纳入FORMAL {preview.changed}条，其余原样复用。名单哈希：{preview.selectionHash}</p> : null}
      <div className={styles.actions}><FeedbackButton pending={busy} disabled={Boolean(pending) || Boolean(receipt)} onClick={() => void readPreview()}>读取正式成员预览</FeedbackButton>
        <FeedbackButton pending={busy} disabled={!preview || Boolean(pending) || Boolean(receipt)} onClick={() => void apply()}>确认此1600名单的正式成员</FeedbackButton>
        {pending ? <FeedbackButton pending={busy} onClick={() => void apply(true)}>核对原成员请求回执</FeedbackButton> : null}</div></> : null}
    {error ? <p role="alert" className={styles.error}>{error}</p> : null}
    {receipt?.readbackVerified ? <p role="status">原成员审计及当前成员完整读回一致；本次纳入 {receipt.changed} 条，原季度分母尚未冻结。</p> : null}
  </details>;
}
