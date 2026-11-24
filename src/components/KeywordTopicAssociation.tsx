"use client";

import { useEffect, useRef, useState } from "react";
import { PageHeader } from "./PageHeader";
import { FeedbackButton } from "./FeedbackButton";
import Link from "./AppLink";
import type { TopicAssociationIdentity } from "@/lib/site-topic-association";
import { associationBrowserTransport, associationIdentityQuery, createAssociationReview, emptyAssociationReview,
  type AssociationReview } from "@/lib/site-topic-association-client";
import layout from "./SeoWorkspace.module.css";
import styles from "./KeywordTopicAssociation.module.css";

function topicLabel(id: unknown, view: AssociationReview) {
  return typeof id === "string" ? view.preview?.topicLabels?.[id] ?? `话题名称未取得（${id}）` : "无主话题";
}
export function TopicAssociationReviewPanel({ identity, view, onPreview, onConfirm, onReconcile }: {
  identity: TopicAssociationIdentity; view: AssociationReview;
  onPreview: () => void; onConfirm: () => void; onReconcile: () => void;
}) {
  const preview = view.preview, busy = ["reading", "saving", "verifying"].includes(view.phase);
  return <section className={styles.card} aria-label="关键词话题关联预览">
    <h2>仅新增本站话题关联</h2>
    <p className={styles.note}>本次只追加下方目标话题。原主话题、已有关联、正式池、页面和原任务完整保留。</p>
    <dl className={styles.identity}><div><dt>站点</dt><dd>{String(preview?.state.site?.name ?? identity.siteDomain)} <small>{identity.siteDomain}</small></dd></div>
      <div><dt>原关键词</dt><dd>{identity.keyword}</dd></div></dl>
    {preview ? <>
      <dl className={styles.identity}>
        <div><dt>本站原主话题</dt><dd>{topicLabel(preview.state.member?.topicId, view)}</dd></div>
        <div><dt>全局原主话题</dt><dd>{topicLabel(preview.state.keyword?.topicId, view)} <small>保留原归属</small></dd></div>
        <div><dt>已有本站关联</dt><dd>{preview.state.assignments.length ? <ul>{preview.state.assignments.map(edge => <li key={String(edge.topicId)}>{topicLabel(edge.topicId, view)}</li>)}</ul> : "暂无关联"}</dd></div>
        <div className={styles.target}><dt>本次目标话题</dt><dd>{String(preview.state.topic?.text ?? identity.topicId)}<small>{identity.topicId}</small></dd></div>
      </dl>
      {view.phase === "ready" ? <p>{preview.edgeExists ? "该关联已经存在，本次确认将复用原关联。" : "确认后仅新增这一条关联。"}</p> : null}
    </> : <p className={styles.note}>先读取当前真实状态，再确认本次关联。</p>}
    {view.phase === "saved" && view.receipt ? <div role="status" className={styles.success}>
      <strong>{view.receipt.status === "created" ? "已新增关联，完整读回一致" : "已复用原关联，完整读回一致"}</strong>
      <p>本次新增 {view.receipt.createdEdge ? 1 : 0} 条；原主话题及其他保护字段已核对。</p>
    </div> : null}
    {view.error ? <p role="alert" className={styles.error}>{view.error}</p> : null}
    <div className={styles.actions}>
      <FeedbackButton pending={view.phase === "reading"} pendingLabel="读取当前关联…" disabled={busy || view.phase === "uncertain"} onClick={onPreview}>读取关联预览</FeedbackButton>
      <FeedbackButton pending={view.phase === "saving"} pendingLabel="保存原请求…" disabled={view.phase !== "ready"} onClick={onConfirm}>{preview?.edgeExists ? "确认复用已有关联" : "确认仅新增此关联"}</FeedbackButton>
      {view.phase === "uncertain" || view.phase === "verifying" ? <FeedbackButton pending={view.phase === "verifying"} pendingLabel="核对原请求…" disabled={busy} onClick={onReconcile}>核对原请求</FeedbackButton> : null}
    </div>
    {view.requestId ? <details className={styles.receipt}><summary>本次请求回执</summary><p>{view.requestId}</p>
      {view.receipt ? <p>原回执时间：{view.receipt.appliedAt}；原回执新增 {view.receipt.createdEdge ? 1 : 0} 条。</p> : <p>尚未取得已确认回执；结果未核实期间只核对原请求。</p>}</details> : null}
  </section>;
}

export function KeywordTopicAssociation({ identity }: { identity: TopicAssociationIdentity | null }) {
  const [view, setView] = useState<AssociationReview>(emptyAssociationReview);
  const controller = useRef<ReturnType<typeof createAssociationReview> | null>(null);
  useEffect(() => {
    if (!identity) return;
    let active = true;
    const key = "seo-topic-association:" + associationIdentityQuery(identity);
    const next = createAssociationReview(identity, associationBrowserTransport(), {
      read: () => { const value = sessionStorage.getItem(key); return value ? JSON.parse(value) : null; },
      write: command => sessionStorage.setItem(key, JSON.stringify(command)), clear: () => sessionStorage.removeItem(key),
    }, () => "topic-association:" + crypto.randomUUID(), nextView => { if (active) setView(nextView); });
    controller.current = next; setView(next.snapshot());
    return () => { active = false; controller.current = null; };
  }, [identity]);
  return <main className={layout.shell}><PageHeader active="keywords" marketControl={false} />
    <div className={layout.titleRow}><h1 className={layout.title}>关键词话题关联</h1><Link href="/opportunities">返回关键词目标</Link></div>
    {identity ? <TopicAssociationReviewPanel identity={identity} view={view}
      onPreview={() => { void controller.current?.preview(); }} onConfirm={() => { void controller.current?.confirm(); }} onReconcile={() => { void controller.current?.reconcile(); }} />
      : <section className={styles.card}><p role="alert">管理链接须包含准确的站点、关键词ID、原词和目标话题ID四项身份，请使用已确认的关联链接进入。</p></section>}
  </main>;
}
