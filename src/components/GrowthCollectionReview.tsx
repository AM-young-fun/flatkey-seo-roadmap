"use client";
import Link from "@/components/SeoLink";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { GrowthCollectionState } from "@/lib/growth-collection";
import { serpPeriod } from "@/lib/serp-periods";
import { FeedbackButton } from "./FeedbackButton";
import styles from "./GrowthCollectionReview.module.css";
import { SeoAnchor } from "@/components/SeoAnchor";


type View = { state: GrowthCollectionState | null; run: { id: string; status: string; actualCostMicros: number | null } | null };
const dollars = (micros: number) => `$${(micros / 1e6).toFixed(3)}`;
export function GrowthCollectionReview() {
  const [periodKey] = useState(() => serpPeriod().key);
  const [view, setView] = useState<View | null>(null), [error, setError] = useState("");
  const [busy, setBusy] = useState(false), [confirmed, setConfirmed] = useState(false), [page, setPage] = useState(0);
  const load = useCallback(async () => {
    try { const response = await fetch(`/api/seo/growth/collection?periodKey=${encodeURIComponent(periodKey)}`, { cache: "no-store" }); const data = await response.json(); if (!response.ok) throw new Error(data.message || "清单读取未完成"); setView(data); setError(""); }
    catch (error) { setError(error instanceof Error ? error.message : "清单读取未完成"); }
  }, [periodKey]);
  useEffect(() => { void load(); }, [load]);
  const state = view?.state, manifest = state?.manifest;
  const markets = useMemo(() => { const rows = new Map<string, { language: string; queries: number; cost: number }>(); for (const query of manifest?.queries ?? []) { const row = rows.get(query.country) ?? { language: query.language, queries: 0, cost: 0 }; row.queries++; row.cost += query.maxCostMicros; rows.set(query.country, row); } return [...rows]; }, [manifest]);
  const mutate = async (action: "prepare" | "approve") => {
    if (busy || action === "approve" && (!manifest || !confirmed)) return;
    setBusy(true);
    try {
      const command = { action, requestId: `review-${crypto.randomUUID()}`, expectedVersion: state?.version ?? 0, periodKey,
        ...(action === "approve" && manifest ? { manifestHash: manifest.hash, maxCostMicros: manifest.maxCostMicros, reason: "用户在清单审核页逐项核对国家、语言、查询及单次费用后确认" } : {}) };
      const response = await fetch("/api/seo/growth/collection", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(command) }); const data = await response.json(); if (!response.ok) throw new Error(data.message || "清单操作未完成");
      setConfirmed(false); setPage(0); await load();
    } catch (error) { setError(error instanceof Error ? error.message : "清单操作未完成"); setConfirmed(false); } finally { setBusy(false); }
  };
  return <section className={styles.panel}><header><div><h1>采集清单审核</h1><p>正式规划中已建页面的目标词优先复用本期结果，新增查询先核对国家、语言和费用。</p></div><div><Link href="/opportunities">返回话题列表 →</Link><p><FeedbackButton pending={busy} pendingLabel="正在读取原版本…" onClick={() => void load()}>刷新已保存清单</FeedbackButton></p></div></header>
    {error ? <p role="alert" className={styles.error}>{error}</p> : null}
    {!view && !error ? <p role="status">正在读取本期清单…</p> : null}
    {view ? <><p>采集期：{manifest?.periodLabel ?? periodKey}</p>
      {!state ? <><p>本期尚无冻结清单。生成清单会核对现有结果并保存待审版本。</p><FeedbackButton pending={busy} pendingLabel="正在核对已有结果…" onClick={() => void mutate("prepare")}>生成本期待审清单</FeedbackButton></> : <>
        <div className={styles.metrics}><p><span>正式已建页目标</span><strong>{manifest!.targets.length}</strong></p><p><span>本期复用</span><strong>{manifest!.reused.length}</strong></p><p><span>新增查询</span><strong>{manifest!.queries.length}</strong></p><p><span>本期费用上限</span><strong>{dollars(manifest!.maxCostMicros)}</strong></p></div>
        <table><thead><tr><th>国家</th><th>语言</th><th>查询数</th><th>费用上限</th></tr></thead><tbody>{markets.map(([country, row]) => <tr key={country}><td>{country}</td><td>{row.language}</td><td>{row.queries}</td><td>{dollars(row.cost)}</td></tr>)}</tbody></table>
        <p>清单生成于 {manifest!.preparedAt}；首次批准有效至 {manifest!.expiresAt}。每条查询绑定其真实页面，同词同市场跨站共享一次查询。</p>
        {manifest!.held.length ? <details><summary>本次未纳入查询的目标（{manifest!.held.length}）</summary><ul>{manifest!.held.map(row => <li key={row.targetId}>{row.targetId}：{row.reason}</li>)}</ul></details> : null}
        <h2>完整新增查询清单</h2><div className={styles.scroll}><table><thead><tr><th>原关键词</th><th>国家 / 语言</th><th>目标页面</th><th>单次上限</th></tr></thead><tbody>{manifest!.queries.slice(page * 50, page * 50 + 50).map(query => <tr key={query.key}><td>{query.keyword}</td><td>{query.country} / {query.language}</td><td>{query.targetIds.flatMap(id => manifest!.targets.find(row => row.id === id)?.publishedUrls ?? []).filter((url, index, rows) => rows.indexOf(url) === index).map(url => <p key={url}><SeoAnchor href={url} target="_blank" rel="noreferrer">{url}</SeoAnchor></p>)}</td><td>{dollars(query.maxCostMicros)}</td></tr>)}</tbody></table></div>
        {manifest!.queries.length > 50 ? <div className={styles.actions}><button disabled={page === 0} onClick={() => setPage(value => value - 1)}>上一页</button><span>{page + 1} / {Math.ceil(manifest!.queries.length / 50)}</span><button disabled={(page + 1) * 50 >= manifest!.queries.length} onClick={() => setPage(value => value + 1)}>下一页</button></div> : null}
        {state.approval ? <p>该确切清单已批准，上限 {dollars(state.approval.maxCostMicros)}。{view.run ? `原采集记录：${view.run.status}；实际费用 ${view.run.actualCostMicros == null ? "尚无费用回执" : dollars(view.run.actualCostMicros)}。` : "到原定时点后按此清单执行。"}</p> : <><label className={styles.confirm}><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} />我已核对本期完整查询及国家语言，批准本次最高 {dollars(manifest!.maxCostMicros)}，由原采集流程按该清单执行。</label><div className={styles.actions}><FeedbackButton pending={busy} pendingLabel="正在保存批准…" disabled={!confirmed} onClick={() => void mutate("approve")}>批准此清单及费用</FeedbackButton><FeedbackButton pending={busy} pendingLabel="正在重新核对…" onClick={() => void mutate("prepare")}>重新核对并生成待审版本</FeedbackButton></div></>}
      </>}
    </> : null}
  </section>;
}
