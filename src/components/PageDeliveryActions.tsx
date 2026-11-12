"use client";

import Link from "next/link";
import { useRef, useState, type FormEvent } from "react";
import { approvalReviewReadiness, pageBelongsToSite, workflowApprovalEffectiveItemStatus, type WorkflowApproval, type WorkflowPublication, type WorkflowTask } from "@/lib/seo-workflow";
import styles from "./SeoWorkWorkspace.module.css";

type Props = {
  task: WorkflowTask;
  approvals: WorkflowApproval[];
  publications: WorkflowPublication[];
  mutate: (body: object) => Promise<{ record: unknown }>;
  onSaved: () => void;
};

function previewLink(value: string, site: string) {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.port || url.hash ||
      url.hostname === site || url.hostname === "www." + site ||
      url.hostname === "localhost" || !url.hostname.includes(".") ||
      /^[\d.]+$/.test(url.hostname) || url.hostname.endsWith(".local")) {
    throw new Error("请输入独立测试环境的 HTTPS 地址。");
  }
  return url.toString();
}

export function PageDeliveryActions({ task, approvals, publications, mutate, onSaved }: Props) {
  const taskHref = new URL("/work?" + new URLSearchParams({ week: task.weekStart }), "https://flatkey-seo-roadmap.vercel.app");
  taskHref.hash = "task-" + task.id;
  const taskApprovals = approvals.flatMap(approval => approval.items.filter(item => item.taskId === task.id).map(item => ({ approval, item })));
  const approved = taskApprovals.find(({ approval, item }) =>
    item.contentVersion === task.contentVersion && approvalReviewReadiness(item).ready &&
    workflowApprovalEffectiveItemStatus(approval, item.id, approvals) === "approved");
  const published = publications.find(row => row.taskId === task.id && row.contentVersion === task.contentVersion && ["published", "verified"].includes(row.status));
  const [newReceipt, setNewReceipt] = useState<WorkflowPublication>();
  const receipt = published ?? newReceipt;
  const [mode, setMode] = useState<"preview" | "publish" | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [pageUrl, setPageUrl] = useState(task.pageUrl ?? "");
  const [preview, setPreview] = useState(task.artifactUrl ?? "");
  const [contentVersion, setContentVersion] = useState(task.contentVersion ?? "");
  const [publishedAt, setPublishedAt] = useState("");
  const [deployment, setDeployment] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [showBrief, setShowBrief] = useState(false);
  const publishAttempt = useRef<{ identity: string; body: object } | null>(null);
  const taskPreview = task.evidence.some(entry => entry.url === task.artifactUrl && entry.label === "测试预览 · " + task.contentVersion);
  const brief = [
    "请在本地 Codex 中处理 Flatkey SEO 页面任务 " + task.id,
    "平台任务 " + taskHref,
    "任务 " + task.title,
    "正式 URL " + (task.pageUrl ?? "待确认"),
    "国家 / 语言 / 关键词 " + [task.country, task.language, task.keyword].filter(Boolean).join(" / "),
    "问题与下一步 " + task.nextAction,
    ...task.acceptanceCriteria.map(item => "- " + item),
    ...[...task.evidence, ...(task.research?.evidence ?? [])].filter(item => item.url).map(item => "- " + item.label + " " + item.url),
    "核对现有页面和优化前数据，在独立分支完成并部署测试环境。回填测试链接、实际部署版本、改动简介、桌面和手机截图，交负责人查看。生产由负责人自行发布。",
  ].join("\n");
  const approvalHref = "/work?" + new URLSearchParams({ panel: "approvals", newApproval: "1", taskId: task.id, ...(taskPreview ? { fromPreview: "1" } : {}) });

  async function copy() {
    try { await navigator.clipboard.writeText(brief); setMessage("已复制，粘贴到对应项目的本地 Codex。"); }
    catch { setShowBrief(true); setMessage("请手动复制任务说明。"); }
  }

  async function savePreview(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      const url = previewLink(preview.trim(), task.siteDomain);
      const target = pageUrl.trim();
      if (!pageBelongsToSite(target, task.siteDomain) || (task.kind !== "landing" && task.pageUrl && target !== task.pageUrl)) throw new Error("请使用任务对应的正式页面地址。");
      const version = contentVersion.trim();
      if (!version) throw new Error("请填写实际部署版本。");
      if (taskApprovals.some(({ approval, item }) => approval.status !== "draft" && item.contentVersion === version && item.previewUrl !== url)) {
        throw new Error("该版本已有审批记录。请使用新部署版本提交更新。");
      }
      const { version: revision, recordedAt: _recordedAt, updatedAt: _updatedAt, ...record } = task;
      const evidence = [...record.evidence.filter(row => row.label !== "测试预览 · " + version).slice(-99),
        { label: "测试预览 · " + version, url, observedAt: new Date().toISOString() }];
      await mutate({ requestId: crypto.randomUUID(), action: "save_task", expectedVersion: revision,
        record: { ...record, pageUrl: target, contentVersion: version, artifactUrl: url, status: "drafting", evidence } });
      setMode(null);
      onSaved();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "测试预览未保存。");
    } finally { setBusy(false); }
  }

  async function markPublished(event: FormEvent) {
    event.preventDefault();
    if (!approved || !confirmed || receipt || busy) return;
    setBusy(true);
    setMessage("");
    try {
      const { approval, item } = approved;
      const input = publishedAt.trim();
      if (!/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2})?$/.test(input)) throw new Error("请输入北京时间，例如 2026-11-12 15:42:00。");
      const date = new Date(input.replace(" ", "T") + "+08:00");
      if (!Number.isFinite(date.getTime()) || date.getTime() > Date.now()) throw new Error("请填写实际的北京时间，发布时间不能晚于现在。");
      const publicationTime = date.toISOString();
      const identity = JSON.stringify([approval.id, item.id, publicationTime, deployment.trim()]);
      if (publishAttempt.current?.identity !== identity) {
        const uuid = crypto.randomUUID();
        const evidence = [{ label: "人工登记生产发布", url: item.pageUrl, observedAt: new Date().toISOString() }];
        if (deployment.trim()) evidence.push({ label: "生产部署记录", url: deployment.trim(), observedAt: new Date().toISOString() });
        publishAttempt.current = { identity, body: {
          requestId: uuid, action: "record_publication", expectedVersion: 0,
          record: {
            id: "manual-" + uuid, taskId: task.id, approvalId: approval.id, approvalItemId: item.id,
            weekStart: task.weekStart, runId: "manual-" + uuid, siteDomain: task.siteDomain,
            pageUrl: item.pageUrl, country: task.country, language: item.language, keyword: task.keyword,
            title: task.title, contentVersion: item.contentVersion, kind: task.kind,
            sourcePublicationId: null, publishedAt: publicationTime, verifiedAt: null,
            status: "published", liveCheck: null, evidence, failureReason: null,
          },
        } };
      }
      const saved = await mutate(publishAttempt.current.body);
      setNewReceipt(saved.record as WorkflowPublication);
      setMode(null);
      setMessage("已登记，等待定时任务核验正式页。");
      onSaved();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "发布未登记，请刷新核对后重试。");
    } finally { setBusy(false); }
  }

  return <>
    <div className={styles.toolbarActions}>
      <button type="button" className={styles.secondary} onClick={() => void copy()}>复制给本地 Codex</button>
      {!receipt && !["published", "verified", "observing", "blocked", "failed"].includes(task.status) ? <button type="button" className={styles.secondary} onClick={() => setMode("preview")}>回填测试预览</button> : null}
      {taskPreview && !taskApprovals.some(({ item }) => item.contentVersion === task.contentVersion) && !receipt ? <Link className={styles.secondary} href={approvalHref}>填写改动与截图</Link> : null}
      {approved && !receipt ? <button type="button" className={styles.primary} onClick={() => setMode("publish")}>已发布</button> : null}
    </div>
    {showBrief ? <textarea aria-label="本地 Codex 任务说明" rows={8} value={brief} readOnly /> : null}
    {taskPreview && task.artifactUrl ? <p><a href={task.artifactUrl} target="_blank" rel="noreferrer">打开测试预览 ↗</a></p> : null}
    {receipt ? <p role="status">{receipt.status === "verified" ? "正式页已核验" : "发布待核验"} · {receipt.contentVersion}</p> : null}
    {mode === "preview" && !receipt ? <form className={styles.reviewForm} onSubmit={event => void savePreview(event)}>
      {task.kind === "landing" || !task.pageUrl ? <label>正式页面地址<input type="url" required value={pageUrl} onChange={event => setPageUrl(event.target.value)} /></label> : null}
      <label>测试预览链接<input type="url" required value={preview} onChange={event => setPreview(event.target.value)} /></label>
      <label>测试环境部署版本<input required maxLength={200} value={contentVersion} onChange={event => setContentVersion(event.target.value)} /></label>
      <button type="submit" className={styles.primary} disabled={busy}>保存测试预览</button>
      <button type="button" className={styles.secondary} disabled={busy} onClick={() => setMode(null)}>关闭</button>
    </form> : null}
    {mode === "publish" && approved && !receipt ? <form className={styles.reviewForm} onSubmit={event => void markPublished(event)}>
      <p>{approved.item.pageUrl} · {approved.item.contentVersion}</p>
      <label>实际发布时间（北京时间）<input type="text" required maxLength={19} placeholder="YYYY-MM-DD HH:mm:ss" value={publishedAt} onChange={event => setPublishedAt(event.target.value)} /></label>
      <label>生产部署记录链接（可选）<input type="url" value={deployment} onChange={event => setDeployment(event.target.value)} /></label>
      <label className={styles.checkbox}><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} />我已将此版本发布到生产</label>
      <button type="submit" className={styles.primary} disabled={!confirmed || busy}>登记发布</button>
      <button type="button" className={styles.secondary} disabled={busy} onClick={() => setMode(null)}>关闭</button>
    </form> : null}
    {message ? <p role="status">{message}</p> : null}
  </>;
}
