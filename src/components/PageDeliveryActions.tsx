"use client";

import { useState, type FormEvent } from "react";
import { approvalReviewReadiness, pageBelongsToSite, reviewPreviewUrl, workflowCodeSourceSchema, workflowApprovalEffectiveItemStatus, type WorkflowApproval, type WorkflowPublication, type WorkflowTask } from "@/lib/seo-workflow";
import styles from "./SeoWorkWorkspace.module.css";

type Props = {
  task: WorkflowTask;
  approvals: WorkflowApproval[];
  publications: WorkflowPublication[];
  mutate: (body: object) => Promise<{ record: unknown }>;
  onSaved: () => void;
};

export function PageDeliveryActions({ task, approvals, publications, mutate, onSaved }: Props) {
  const taskHref = new URL("/work?" + new URLSearchParams({ week: task.weekStart }), "https://flatkey-seo-roadmap.vercel.app");
  taskHref.hash = "task-" + task.id;
  const taskApprovals = approvals.flatMap(approval => approval.items.filter(item => item.taskId === task.id).map(item => ({ approval, item })));
  const approved = taskApprovals.find(({ approval, item }) =>
    item.contentVersion === task.contentVersion && approvalReviewReadiness(item).ready &&
    workflowApprovalEffectiveItemStatus(approval, item.id, approvals) === "approved");
  const published = publications.find(row => row.taskId === task.id && row.contentVersion === task.contentVersion && ["published", "verified"].includes(row.status));
  const receipt = published;
  const [editing, setEditing] = useState(false);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [pageUrl, setPageUrl] = useState(task.pageUrl ?? "");
  const [preview, setPreview] = useState(reviewPreviewUrl(task.artifactUrl, task.pageUrl) ?? "");
  const [contentVersion, setContentVersion] = useState(task.contentVersion ?? "");
  const [repository, setRepository] = useState(task.codeSource?.repository ?? (task.siteDomain === "flatkey.ai" ? "solvea-plg/flatkey" : ""));
  const [branch, setBranch] = useState(task.codeSource?.branch ?? "");
  const [showBrief, setShowBrief] = useState(false);
  const taskPreview = task.evidence.some(entry => entry.url === task.artifactUrl && entry.label === "测试预览 · " + task.contentVersion)
    ? reviewPreviewUrl(task.artifactUrl, task.pageUrl) : null;
  const submittedPreview = taskApprovals.find(({ approval, item }) =>
    item.pageUrl === task.pageUrl && item.contentVersion === task.contentVersion && item.previewContentVersion === item.contentVersion &&
    workflowApprovalEffectiveItemStatus(approval, item.id, approvals) !== "superseded" &&
    reviewPreviewUrl(item.previewUrl, item.pageUrl))?.item.previewUrl;
  const reviewPreview = taskPreview ?? submittedPreview;
  const brief = [
    "请在本地 Codex 中处理 Flatkey SEO 页面任务 " + task.id,
    "平台任务 " + taskHref,
    "任务 " + task.title,
    "正式 URL " + (task.pageUrl ?? "待确认"),
    "国家 / 语言 / 关键词 " + [task.country, task.language, task.keyword].filter(Boolean).join(" / "),
    "问题与下一步 " + task.nextAction,
    ...task.acceptanceCriteria.map(item => "- " + item),
    ...[...task.evidence, ...(task.research?.evidence ?? [])].filter(item => item.url).map(item => "- " + item.label + " " + item.url),
    ...(task.codeSource ? ["当前分支 " + task.codeSource.repository + ":" + task.codeSource.branch] : []),
    "核对现有页面和优化前数据，在该页面的独立分支完成并部署测试环境。回填仓库、分支、完整提交 SHA、测试链接、改动简介、桌面和手机截图，提交逐页审批。",
  ].join("\n");

  async function copy() {
    try { await navigator.clipboard.writeText(brief); setMessage("已复制，粘贴到对应项目的本地 Codex。"); }
    catch { setShowBrief(true); setMessage("请手动复制任务说明。"); }
  }

  async function savePreview(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      const url = reviewPreviewUrl(preview.trim(), task.pageUrl);
      if (!url) throw new Error("请输入独立测试环境的 HTTPS 地址。");
      const target = pageUrl.trim();
      if (!pageBelongsToSite(target, task.siteDomain) || (task.kind !== "landing" && task.pageUrl && target !== task.pageUrl)) throw new Error("请使用任务对应的正式页面地址。");
      const parsedSource = workflowCodeSourceSchema.safeParse({ repository, branch, commitSha: contentVersion });
      if (!parsedSource.success) throw new Error("请填写仓库、独立工作分支和测试环境完整提交 SHA。");
      const codeSource = parsedSource.data;
      const version = codeSource.commitSha;
      if (taskApprovals.some(({ approval, item }) => approval.status !== "draft" && item.contentVersion === version && item.previewUrl !== url)) {
        throw new Error("该版本已有审批记录。请使用新部署版本提交更新。");
      }
      const { version: revision, recordedAt: _recordedAt, updatedAt: _updatedAt, ...record } = task;
      const evidence = [...record.evidence.filter(row => row.label !== "测试预览 · " + version).slice(-99),
        { label: "测试预览 · " + version, url, observedAt: new Date().toISOString() }];
      await mutate({ requestId: crypto.randomUUID(), action: "save_task", expectedVersion: revision,
        record: { ...record, pageUrl: target, contentVersion: version, codeSource, artifactUrl: url, status: "drafting", evidence } });
      setEditing(false);
      onSaved();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "测试预览未保存。");
    } finally { setBusy(false); }
  }

  return <>
    <div className={styles.toolbarActions}>
      <button type="button" className={styles.secondary} onClick={() => void copy()}>复制给本地 Codex</button>
      {!receipt && !["published", "verified", "observing", "blocked", "failed"].includes(task.status) ? <button type="button" className={styles.secondary} onClick={() => setEditing(true)}>回填测试预览</button> : null}
    </div>
    {showBrief ? <textarea aria-label="本地 Codex 任务说明" rows={8} value={brief} readOnly /> : null}
    {reviewPreview ? <p><a href={reviewPreview} target="_blank" rel="noreferrer">打开测试预览 ↗</a></p>
      : !receipt && (task.status === "review_pending" || taskApprovals.length > 0) ? <p className={styles.muted}>测试预览待补齐</p> : null}
    {receipt ? <p role="status">{receipt.status === "verified" ? "正式页已核验" : "发布待核验"} · {receipt.contentVersion}</p> : null}
    {task.codeSource ? <p>工作分支 <a href={`https://github.com/${task.codeSource.repository}/tree/${encodeURIComponent(task.codeSource.branch)}`} target="_blank" rel="noreferrer">{task.codeSource.branch} ↗</a> · <code>{task.codeSource.commitSha.slice(0, 12)}</code></p> : null}
    {task.codeSource && task.branchObservation && task.branchObservation.headSha !== task.codeSource.commitSha ? <p className={styles.warning}>
      分支已有新提交 <a href={`https://github.com/${task.codeSource.repository}/compare/${task.codeSource.commitSha}...${task.branchObservation.headSha}`} target="_blank" rel="noreferrer">{task.branchObservation.headSha.slice(0, 12)} · 查看改动</a>。执行任务会更新预览、截图并重新送审。
    </p> : null}
    {approved && !receipt && (!task.branchObservation || task.branchObservation.headSha === task.codeSource?.commitSha) ? <p role="status">{approved.item.codeSource ? "此版本已批准，等待发布回执。" : "历史审批缺少独立分支和提交记录。"}</p> : null}
    {editing && !receipt ? <form className={styles.reviewForm} onSubmit={event => void savePreview(event)}>
      {task.kind === "landing" || !task.pageUrl ? <label>正式页面地址<input type="url" required value={pageUrl} onChange={event => setPageUrl(event.target.value)} /></label> : null}
      <label>测试预览链接<input type="url" required value={preview} onChange={event => setPreview(event.target.value)} /></label>
      <label>GitHub 仓库<input required maxLength={200} value={repository} readOnly={Boolean(task.codeSource)} onChange={event => setRepository(event.target.value)} placeholder="owner/repository" /></label>
      <label>页面独立分支<input required maxLength={180} value={branch} readOnly={Boolean(task.codeSource)} onChange={event => setBranch(event.target.value)} placeholder="codex/页面任务名" /></label>
      <label>测试环境提交 SHA<input required minLength={40} maxLength={40} value={contentVersion} onChange={event => setContentVersion(event.target.value)} /></label>
      <button type="submit" className={styles.primary} disabled={busy}>保存测试预览</button>
      <button type="button" className={styles.secondary} disabled={busy} onClick={() => setEditing(false)}>关闭</button>
    </form> : null}
    {message ? <p role="status">{message}</p> : null}
  </>;
}
