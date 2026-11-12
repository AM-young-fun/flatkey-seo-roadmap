"use client";

import { approvalReviewReadiness, approvalItemNeedsHuman } from "@/lib/seo-workflow";
import Link from "next/link";
import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { ExternalLink, ImageIcon, Plus, RefreshCw } from "lucide-react";
import { workflowApprovalEffectiveItemStatus, workflowApprovalStatus, WORKFLOW_SITES, type WorkflowApproval, type WorkflowSnapshot, type WorkflowTask } from "@/lib/seo-workflow";
import { UiSelect } from "./UiSelect";
import { numberText, shanghaiStamp, useSeoRead } from "./useSeoAnalytics";
import styles from "./SeoWorkWorkspace.module.css";
import review from "./SeoPageApprovals.module.css";
import workspace from "./SeoWorkspace.module.css";

type ApprovalItem = WorkflowApproval["items"][number];
type ApprovalDecision = Omit<WorkflowApproval["decisions"][number], "recordedAt">;
type ApprovalInput = Omit<WorkflowApproval, "version" | "updatedAt" | "recordedAt" | "submittedRecordedAt" | "decisions"> & { decisions: ApprovalDecision[] };
type EditItem = ApprovalItem & { evidenceUrl: string; evidenceArtifact: string; desktopScreenshot: string; mobileScreenshot: string };
const labels: Record<string, string> = { automatic_history: "免审历史", draft: "草稿", pending: "待审批", partially_reviewed: "逐项处理", approved: "已批准", rejected: "已拒绝", changes_requested: "要求修改", withdrawn: "已撤回", superseded: "已被新单替换" };
const languages = ["en", "ja", "pt-BR", "es-ES", "zh", "fr", "de", "it", "ru", "vi", "ko"];
const siteLabels: Record<string, string> = { "flatkey.ai": "Flatkey", "jev-llm.com": "JEV LLM", "mochichatbot.com": "MochiChatbot", "modelfit.cc": "ModelFit", "rackrate.org": "RackRate" };
const stamp = (value: string | null) => value ? shanghaiStamp(value) : "尚未提交";
const href = (id: string) => `/approvals?approvalId=${encodeURIComponent(id)}`;
const safeUrl = (value: string | null | undefined) => { try { const url = new URL(value ?? ""); return url.protocol === "https:" && !url.username && !url.password ? url.toString() : null; } catch { return null; } };
const recordInput = (approval: WorkflowApproval): ApprovalInput => {
  const { version: _version, updatedAt: _updatedAt, recordedAt: _recordedAt, submittedRecordedAt: _submittedRecordedAt, decisions, ...record } = approval;
  return { ...record, decisions: decisions.map(({ recordedAt: _recordedAt, ...decision }) => decision) };
};

function ApprovalBadge({ status }: { status: string }) {
  return <span className={review.badge} data-state={status}>{labels[status] ?? status}</span>;
}

function Evidence({ items }: { items: ApprovalItem["evidence"] }) {
  return <ul className={styles.evidence}>{items.map((item, index) => <li key={index}>
    {safeUrl(item.url) ? <a href={item.url} target="_blank" rel="noreferrer">{item.label}<ExternalLink size={12} aria-hidden="true" /></a> : <span>{item.label}</span>}
    {item.artifact ? <code>{item.artifact}</code> : null}<small>{stamp(item.observedAt)}</small>
  </li>)}</ul>;
}

function ScreenshotLinks({ items }: { items: ApprovalItem["evidence"] }) {
  const urls = new Set<string>();
  for (const item of items) {
    const url = safeUrl(item.url);
    if (url && (/截图|截屏|screenshot|screen capture/i.test(item.label) || /\.(?:png|jpe?g|webp|gif|avif|bmp|heic)$/i.test(new URL(url).pathname))) urls.add(url);
  }
  return [...urls].map((url, index) => <a key={url} href={url} target="_blank" rel="noreferrer">
    <ImageIcon size={14} aria-hidden="true" />查看截图{urls.size > 1 ? ` ${index + 1}` : ""}
  </a>);
}

function ReviewScreenshots({ approvalId, item, editable, onRefresh }: { approvalId: string; item: ApprovalItem; editable: boolean; onRefresh: () => void }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [capturedVersion, setCapturedVersion] = useState(item.previewContentVersion ?? "");
  const uploads = item.evidence.filter(row => row.url?.startsWith("https://flatkey-seo-roadmap.vercel.app/api/seo/review-assets/"));
  async function upload(file: File | undefined, viewport: "desktop" | "mobile") {
    if (!file || busy) return;
    setError(""); setBusy(true);
    try {
      if (!capturedVersion.trim()) throw new Error("请填写截图实际部署版本，不要用待审版本代替。");
      if (!["image/png", "image/jpeg"].includes(file.type) || file.size > 1024 * 1024) throw new Error("请选择不超过 1 MB 的 PNG 或 JPEG 截图。");
      const data = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(",")[1]); reader.onerror = () => reject(new Error("截图读取失败")); reader.readAsDataURL(file); });
      const response = await fetch("/api/seo/review-assets", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ approvalId, itemId: item.id, contentVersion: item.contentVersion, capturedVersion: capturedVersion.trim(), viewport, mime: file.type, data }) });
      const result = await response.json();
      if (!response.ok || !result.asset?.sha256 || !result.approvalVersion) throw new Error(result.message ?? "截图未保存，请重试。");
      onRefresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "截图上传失败"); }
    finally { setBusy(false); }
  }
  if (!editable && !uploads.length) return null;
  return <div className={review.screenshots}>
    {editable ? <label className={review.selectLabel}>截图实际部署版本<input maxLength={200} value={capturedVersion} onChange={event => setCapturedVersion(event.target.value)} placeholder="截图所对应的实际部署 SHA" /></label> : null}
    {editable && capturedVersion && capturedVersion !== item.contentVersion ? <small className={styles.muted}>截图与待审版本不同，仅作审阅资料，不满足同版本发布条件。</small> : null}
    {editable ? <div className={review.actions}>{(["desktop", "mobile"] as const).map(viewport => <label className={review.uploadButton} key={viewport}>{busy ? "上传中…" : viewport === "desktop" ? "上传桌面截图" : "上传手机截图"}<input aria-label={viewport === "desktop" ? "上传桌面截图" : "上传手机截图"} type="file" accept="image/png,image/jpeg" disabled={busy} onChange={event => { void upload(event.target.files?.[0], viewport); event.target.value = ""; }} /></label>)}<small className={styles.muted}>PNG / JPEG · 每张 ≤1 MB · 仅登录后可见</small></div> : null}
    {error ? <p role="alert" className={styles.warning}>{error}</p> : null}
    {uploads.length ? <div className={review.screenshotGrid}>{uploads.map(row => <a href={row.url} key={row.url} target="_blank" rel="noreferrer"><Image src={row.url!} unoptimized width={240} height={160} alt={row.label} /><span>{row.label}</span></a>)}</div> : null}
  </div>;
}

function useApprovalWrite() {
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [conflict, setConflict] = useState(false);
  const pending = useRef<{ identity: string; body: object } | null>(null), inFlight = useRef(false);
  async function save(identity: string, build: () => ApprovalInput, expectedVersion: number) {
    if (inFlight.current) return null;
    inFlight.current = true; setBusy(true); setError("");
    try {
      // Keep the exact request, including timestamps, for a network retry.
      if (pending.current?.identity !== identity) pending.current = { identity, body: { requestId: crypto.randomUUID(), action: "save_approval", expectedVersion, record: build() } };
      if (new TextEncoder().encode(JSON.stringify(pending.current.body)).byteLength > 512 * 1024) throw new Error("本单超过 512 KB，请按源文和译文拆分审批单后提交。");
      const response = await fetch("/api/seo/workflow", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(pending.current.body) });
      const result = await response.json();
      if (!response.ok) { if (["version_conflict", "idempotency_conflict"].includes(result.code)) setConflict(true); throw new Error(result.message ?? "审批记录未保存，请保留内容后重试。"); }
      if (!result.stored || result.kind !== "approval" || !result.record?.id) throw new Error("尚未收到完整保存回执，请重试确认。");
      pending.current = null;
      return result.record as WorkflowApproval;
    } catch (cause) { setError(cause instanceof Error ? cause.message : "审批记录未保存。"); return null; }
    finally { inFlight.current = false; setBusy(false); }
  }
  return { save, busy, error, conflict };
}

function WriteError({ error, conflict, onRefresh }: { error: string; conflict: boolean; onRefresh: () => void }) {
  return error ? <div className={styles.warning} role="alert"><div><p>{error}</p>{conflict ? <><p>该记录已变更。当前操作未覆盖他人的决定；请刷新并重新核对最新内容。</p><button type="button" className={styles.secondary} onClick={onRefresh}>读取最新审批记录</button></> : null}</div></div> : null;
}

function emptyItem(task?: WorkflowTask): EditItem {
  return { id: `item-${crypto.randomUUID()}`, taskId: task?.id ?? "", operation: task?.kind === "optimization" ? "update" : "new", pageUrl: task?.pageUrl ?? "", language: task?.language ?? "en", contentVersion: task?.contentVersion ?? "", baseContentVersion: null, changeSummary: "", beforeSummary: null, afterSummary: "", draftUrl: task?.artifactUrl ?? null, previewUrl: null, previewContentVersion: null, reviewContent: null, reviewFormat: "markdown", beforeContent: null, evidence: [], evidenceUrl: "", evidenceArtifact: "", desktopScreenshot: "", mobileScreenshot: "" };
}

function ApprovalEditor({ weekStart, tasks, allApprovals, initialTask, original, revision, onSaved, onCancel, onRefresh }: {
  weekStart: string; tasks: WorkflowTask[]; allApprovals: WorkflowApproval[]; initialTask?: WorkflowTask; original?: WorkflowApproval; revision?: WorkflowApproval;
  onSaved: (record: WorkflowApproval) => void; onCancel: () => void; onRefresh: () => void;
}) {
  const source = original ?? revision;
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus(); }, []);
  const [id] = useState(() => original?.id ?? `approval-${crypto.randomUUID()}`);
  const [title, setTitle] = useState(source?.title ?? (initialTask ? `页面审批 · ${initialTask.title}` : ""));
  const [site, setSite] = useState(source?.siteDomain ?? initialTask?.siteDomain ?? "flatkey.ai"), [requestedBy, setRequestedBy] = useState(original?.requestedBy ?? "");
  const [items, setItems] = useState<EditItem[]>(() => source ? source.items.map(item => ({ ...item, id: original ? item.id : `item-${crypto.randomUUID()}`, evidenceUrl: "", evidenceArtifact: "", desktopScreenshot: "", mobileScreenshot: "" })) : [emptyItem(initialTask)]);
  const [confirmed, setConfirmed] = useState(false), [localError, setLocalError] = useState("");
  const write = useApprovalWrite();
  const availableTasks = tasks.filter(task => task.siteDomain === site);
  const replacedApprovals = allApprovals.filter(approval => approval.id !== id && approval.siteDomain === site && approval.status !== "draft" && approval.items.some(previous => items.some(item => item.pageUrl.trim() === previous.pageUrl && item.language.trim() === previous.language)));
  function updateItem(index: number, update: Partial<EditItem>) { setItems(current => current.map((item, i) => i === index ? { ...item, ...update } : item)); setConfirmed(false); }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setLocalError("");
    const target = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    const desiredStatus = target?.value === "draft" ? "draft" : "pending";
    if (desiredStatus === "pending" && !confirmed) { setLocalError("请先确认本单包含每个页面和语言的具体待审版本。"); return; }
    if (items.some(item => !availableTasks.some(task => task.id === item.taskId))) { setLocalError("请为每个页面选择当前站点的真实工作任务；任务不足时先新增工作任务。"); return; }
    if (items.some(item => !item.reviewContent?.trim() && !item.draftUrl && !item.previewUrl)) { setLocalError("每个页面都需要完整审稿内容、稿件链接或可访问的预览，不能只填写摘要或本地产物路径。"); return; }
    const identity = JSON.stringify({ id, title, site, requestedBy, items, desiredStatus, version: original?.version ?? 0 });
    const saved = await write.save(identity, () => {
      const now = new Date().toISOString();
      return {
        id, ...(source?.channel || initialTask?.channel ? { channel: source?.channel ?? initialTask?.channel } : {}), weekStart: original?.weekStart ?? weekStart, siteDomain: site, title: title.trim(), requestedBy: requestedBy.trim(), submittedAt: desiredStatus === "pending" ? now : null,
        status: desiredStatus, decisions: [], supersedesApprovalIds: [...new Set([...(original?.supersedesApprovalIds ?? []), ...(revision ? [revision.id] : []), ...replacedApprovals.map(approval => approval.id)])],
        items: items.map(({ evidenceUrl, evidenceArtifact, desktopScreenshot, mobileScreenshot, ...item }) => ({ ...item, pageUrl: item.pageUrl.trim(), language: item.language.trim(), contentVersion: item.contentVersion.trim(),
          baseContentVersion: item.operation === "update" ? item.baseContentVersion?.trim() || null : null, beforeSummary: item.operation === "update" ? item.beforeSummary?.trim() || null : null,
          changeSummary: item.changeSummary.trim(), afterSummary: item.afterSummary.trim(), reviewContent: item.reviewContent?.trim() || null, beforeContent: item.operation === "update" ? item.beforeContent?.trim() || null : null,
          draftUrl: item.draftUrl?.trim() || null, previewUrl: item.previewUrl?.trim() || null,
          evidence: [...item.evidence,
            ...(desktopScreenshot.trim() ? [{ label: "桌面截图 · " + item.contentVersion, url: desktopScreenshot.trim(), observedAt: now }] : []),
            ...(mobileScreenshot.trim() ? [{ label: "手机截图 · " + item.contentVersion, url: mobileScreenshot.trim(), observedAt: now }] : []), { label: "本次页面审批内容快照", artifact: `approval:${id}:item:${item.id}`, observedAt: now },
            ...(evidenceUrl.trim() || evidenceArtifact.trim() ? [{ label: "页面来源与变更证据", ...(evidenceUrl.trim() ? { url: evidenceUrl.trim() } : {}), ...(evidenceArtifact.trim() ? { artifact: evidenceArtifact.trim() } : {}), observedAt: now }] : [])],
        })), evidence: [...(original?.evidence ?? []), { label: desiredStatus === "pending" ? "页面审批提交" : "页面审批草稿", artifact: `approval:${id}`, observedAt: now }],
      };
    }, original?.version ?? 0);
    if (saved) onSaved(saved);
  }
  return <section className={review.editor} aria-label="提交页面审批单">
    <div className={styles.sectionHeading}><h2 ref={heading} tabIndex={-1}>{original ? "编辑审批草稿" : revision ? "改稿后重新提交" : "新建页面审批单"}</h2><button type="button" className={styles.secondary} onClick={onCancel} disabled={write.busy}>关闭编辑</button></div>

    {revision ? <p className={styles.warning}>新单将关联并替换 {revision.id}。请填写实际改稿版本；原单的决定不会自动批准新稿。</p> : null}
    <form onSubmit={event => void submit(event)}>
      <fieldset disabled={write.busy || write.conflict} className={review.fieldset}>
        <div className={styles.formGrid}>
          <label className={styles.spanAll}>审批单标题<input required maxLength={500} value={title} onChange={event => setTitle(event.target.value)} /></label>
          <label>站点<UiSelect aria-label="审批站点" value={site} disabled={Boolean(source || initialTask)} onChange={value => { setSite(value as typeof site); setItems([emptyItem()]); setConfirmed(false); }} options={WORKFLOW_SITES.map(value => ({ value, label: siteLabels[value] }))} /></label>
          <label>提交人<input required maxLength={200} value={requestedBy} onChange={event => setRequestedBy(event.target.value)} /></label>
        </div>
        <p className={styles.muted}>归档工作周 {original?.weekStart ?? weekStart} · 同站点的页面和语言可一起提交。</p>
        {items.map((item, index) => <fieldset className={review.itemEditor} key={item.id}>
          <legend>页面 {index + 1}</legend>
          <div className={review.itemTools}><strong>{item.language} · {item.operation === "new" ? "新增" : "修改"}</strong>{items.length > 1 ? <button type="button" className={styles.secondary} onClick={() => { setItems(current => current.filter((_, i) => i !== index)); setConfirmed(false); }}>移除此项</button> : null}</div>
          <div className={styles.formGrid}>
            <label className={styles.spanAll}>关联任务<UiSelect aria-label={`页面${index + 1}关联任务`} value={item.taskId} onChange={value => { const task = availableTasks.find(task => task.id === value); updateItem(index, { taskId: value, ...(task ? { pageUrl: task.pageUrl ?? item.pageUrl, language: task.language ?? item.language, contentVersion: task.contentVersion ?? item.contentVersion, draftUrl: task.artifactUrl ?? item.draftUrl } : {}) }); }} options={[{ value: "", label: "选择已登记的任务" }, ...availableTasks.map(task => ({ value: task.id, label: `${task.title} · ${task.weekStart}` }))]} /></label>
            <label>变更类型<UiSelect aria-label={`页面${index + 1}变更类型`} value={item.operation} onChange={value => updateItem(index, { operation: value as "new" | "update" })} options={[{ value: "new", label: "新增页面 / 新译文" }, { value: "update", label: "修改已存在页面" }]} /></label>
            <label>页面语言<input required list="approval-languages" pattern="[a-z]{2,3}(-[A-Za-z0-9]{2,8})*" maxLength={20} value={item.language} onChange={event => updateItem(index, { language: event.target.value })} placeholder="en / ja / pt-BR / es-ES" /></label>
            <label className={styles.spanAll}>目标正式 URL<input required type="url" value={item.pageUrl} onChange={event => updateItem(index, { pageUrl: event.target.value })} placeholder={`https://${site}/…`} /></label>
            <label className={item.operation === "new" ? styles.spanAll : undefined}>待审内容版本<input required maxLength={200} value={item.contentVersion} onChange={event => updateItem(index, { contentVersion: event.target.value })} placeholder="完整稿件哈希或代码提交 SHA" /></label>
            {item.operation === "update" ? <label>修改前内容版本<input required maxLength={200} value={item.baseContentVersion ?? ""} onChange={event => updateItem(index, { baseContentVersion: event.target.value })} placeholder="真实线上稿件或代码版本" /></label> : null}
            <label className={styles.spanAll}>本次变更摘要<textarea required rows={2} maxLength={5000} value={item.changeSummary} onChange={event => updateItem(index, { changeSummary: event.target.value })} /></label>
            {item.operation === "update" ? <label>修改前<textarea required rows={3} maxLength={5000} value={item.beforeSummary ?? ""} onChange={event => updateItem(index, { beforeSummary: event.target.value })} /></label> : null}
            <label className={item.operation === "new" ? styles.spanAll : undefined}>修改后 / 新增内容说明<textarea required rows={3} maxLength={5000} value={item.afterSummary} onChange={event => updateItem(index, { afterSummary: event.target.value })} /></label>
            <label>稿件链接<input type="url" value={item.draftUrl ?? ""} onChange={event => updateItem(index, { draftUrl: event.target.value || null })} placeholder="可访问的具体版本稿件" /></label>
            <label>测试 / 预览链接<input type="url" value={item.previewUrl ?? ""} onChange={event => updateItem(index, { previewUrl: event.target.value || null })} placeholder="可访问的页面预览" /></label>
            <label>内嵌内容格式<UiSelect aria-label={`页面${index + 1}内容格式`} value={item.reviewFormat} onChange={value => updateItem(index, { reviewFormat: value as ApprovalItem["reviewFormat"] })} options={[{ value: "markdown", label: "Markdown 全文" }, { value: "diff", label: "完整变更 Diff" }, { value: "text", label: "纯文本全文" }]} /></label>
            <p className={styles.muted}>内嵌完整正文或 Diff 后，审批人可直接在平台阅读。请提供可读正文、Diff 或可访问链接。</p>
            {item.operation === "update" ? <label className={styles.spanAll}>修改前完整内容（选填）<textarea rows={6} maxLength={120000} value={item.beforeContent ?? ""} onChange={event => updateItem(index, { beforeContent: event.target.value || null })} /></label> : null}
            <label className={styles.spanAll}>完整审稿内容<textarea rows={10} maxLength={120000} value={item.reviewContent ?? ""} onChange={event => updateItem(index, { reviewContent: event.target.value || null })} placeholder="粘贴这个版本的完整正文或完整代码 Diff；不要仅粘贴摘要。" /></label>
            <label>测试部署对应内容版本<input value={item.previewContentVersion ?? ""} onChange={event => updateItem(index, { previewContentVersion: event.target.value || null })} placeholder="与本单内容版本一致" /></label>
            <label>桌面截图链接<input type="url" value={item.desktopScreenshot} onChange={event => updateItem(index, { desktopScreenshot: event.target.value })} /></label>
            <label>手机截图链接<input type="url" value={item.mobileScreenshot} onChange={event => updateItem(index, { mobileScreenshot: event.target.value })} /></label>
            <label>补充证据链接（选填）<input type="url" value={item.evidenceUrl} onChange={event => updateItem(index, { evidenceUrl: event.target.value })} /></label>
            <label>产物路径 / 版本证据（选填）<input maxLength={2000} value={item.evidenceArtifact} onChange={event => updateItem(index, { evidenceArtifact: event.target.value })} /></label>
          </div>
          {item.evidence.length ? <details><summary>保留的来源证据</summary><Evidence items={item.evidence} /></details> : null}
        </fieldset>)}
        <datalist id="approval-languages">{languages.map(language => <option value={language} key={language} />)}</datalist>
        <button type="button" className={styles.secondary} onClick={() => { setItems(current => [...current, emptyItem()]); setConfirmed(false); }}><Plus size={14} />添加页面或译文</button>
        {replacedApprovals.length ? <div className={styles.warning}><div><p>提交后将替换以下旧单中的相同页面与语言项，旧批准不会沿用到新稿：</p><ul>{replacedApprovals.map(approval => <li key={approval.id}><Link href={href(approval.id)} target="_blank">{approval.title} · {approval.id} ↗</Link></li>)}</ul></div></div> : null}
        <label className={styles.checkbox}><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} />我确认每一项均有准确 URL、语言、版本和可读审稿内容。提交后内容锁定，改稿须另建审批单。</label>
        <div className={review.actions}><button type="submit" value="draft" className={styles.secondary}>保存草稿</button><button type="submit" value="pending" className={styles.primary} disabled={!confirmed}>{write.busy ? "保存中…" : `提交 ${items.length} 项待审批`}</button></div>
      </fieldset>
      {localError ? <p className={styles.warning} role="alert">{localError}</p> : null}<WriteError error={write.error} conflict={write.conflict} onRefresh={onRefresh} />
    </form>
  </section>;
}

function DecisionForm({ id, approval, allApprovals, tasks, onSaved, onRefresh }: { id: string; approval: WorkflowApproval; allApprovals: WorkflowApproval[]; tasks: WorkflowTask[]; onSaved: (approval: WorkflowApproval) => void; onRefresh: () => void }) {
  const [decision, setDecision] = useState<ApprovalDecision["decision"]>(() => approval.items.some(item => workflowApprovalEffectiveItemStatus(approval, item.id, allApprovals) === "pending") ? "approved" : "withdrawn"), [selected, setSelected] = useState<string[]>([]), [reviewer, setReviewer] = useState(""), [note, setNote] = useState(""), [confirmed, setConfirmed] = useState(false);
  const write = useApprovalWrite();
  const eligible = approval.items.filter(item => approvalItemNeedsHuman(item, tasks) && workflowApprovalEffectiveItemStatus(approval, item.id, allApprovals) === (decision === "withdrawn" ? "approved" : "pending"));
  const selectedItems = eligible.filter(item => selected.includes(item.id));
  const hasPending = approval.items.some(item => approvalItemNeedsHuman(item, tasks) && workflowApprovalEffectiveItemStatus(approval, item.id, allApprovals) === "pending"), hasApproved = approval.items.some(item => approvalItemNeedsHuman(item, tasks) && workflowApprovalEffectiveItemStatus(approval, item.id, allApprovals) === "approved");
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!confirmed || !selectedItems.length || !reviewer.trim() || !note.trim()) return;
    const identity = JSON.stringify({ id: approval.id, version: approval.version, selected: selectedItems.map(item => item.id), decision, reviewer, note });
    const saved = await write.save(identity, () => {
      const now = new Date().toISOString(), input = recordInput(approval);
      const decisions = [...input.decisions, { id: `decision-${crypto.randomUUID()}`, itemIds: selectedItems.map(item => item.id), decision, decidedBy: reviewer.trim(), decidedAt: now, note: note.trim(), evidence: [{ label: "平台页面版本明确审核", artifact: `approval:${approval.id}:record:${approval.version}`, observedAt: now }] }];
      return { ...input, decisions, status: workflowApprovalStatus(decisions, input.items) };
    }, approval.version);
    if (saved) onSaved(saved);
  }
  if (!hasPending && !hasApproved) return <p className={styles.muted}>本单已无可审核项。要求修改或拒绝的内容请改稿后重新提交，原决定保留。</p>;
  return <form id={id} tabIndex={-1} className={styles.reviewForm} onSubmit={event => void submit(event)}>
    <h4>记录本次审核决定</h4><p className={styles.muted}>审核决定只适用于所选 URL、语言和版本。发布与上线验收另行执行。</p>
    <fieldset disabled={write.busy || write.conflict} className={review.fieldset}>
      <label className={review.selectLabel}>审批结果<UiSelect aria-label="审批结果" value={decision} onChange={value => { setDecision(value as typeof decision); setSelected([]); setConfirmed(false); }} options={[...(hasPending ? [{ value: "approved", label: "批准所选项" }, { value: "changes_requested", label: "要求修改" }, { value: "rejected", label: "拒绝所选项" }] : []), ...(hasApproved ? [{ value: "withdrawn", label: "撤回已批准项" }] : [])]} /></label>
      {!eligible.length ? <p className={styles.muted}>当前决定没有可选项。请选择“撤回已批准项”查看撤回范围。</p> : <>
        <div className={review.actions}><button type="button" className={styles.secondary} onClick={() => { setSelected(eligible.map(item => item.id)); setConfirmed(false); }}>{decision === "withdrawn" ? "选择全部已批准项" : "选择全部待审批项"}</button><button type="button" className={styles.secondary} onClick={() => { setSelected([]); setConfirmed(false); }}>取消选择</button><span className={styles.muted}>已选 {selectedItems.length} / {eligible.length} 项</span></div>
        <div className={review.selections}>{eligible.map(item => <label className={styles.checkbox} key={item.id}><input type="checkbox" checked={selected.includes(item.id)} onChange={event => { setSelected(current => event.target.checked ? [...current, item.id] : current.filter(id => id !== item.id)); setConfirmed(false); }} /><span><strong>{item.language} · {item.operation === "new" ? "新增" : "修改"}</strong><span>{item.pageUrl}</span><code>{item.contentVersion}</code></span></label>)}</div>
      </>}
      <div className={styles.formGrid}><label>审核人<input required maxLength={200} value={reviewer} onChange={event => setReviewer(event.target.value)} /></label><label className={styles.spanAll}>决定理由 / 需修改的具体内容<textarea required rows={3} maxLength={5000} value={note} onChange={event => setNote(event.target.value)} /></label></div>
      <label className={styles.checkbox}><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} />我已阅读所选 {selectedItems.length} 项的具体版本、前后改动和稿件，明确记录“{labels[decision]}”决定。</label>
      {decision === "approved" && selectedItems.some(item => !approvalReviewReadiness(item).ready) ? <p role="alert">所选版本缺少同版本测试链接或桌面/手机截图，请改稿补齐后新建审批单。</p> : null}
      <button type="submit" className={styles.primary} disabled={!confirmed || !selectedItems.length || !reviewer.trim() || !note.trim() || decision === "approved" && selectedItems.some(item => !approvalReviewReadiness(item).ready)}>{write.busy ? "记录中…" : `确认${labels[decision]} ${selectedItems.length} 项`}</button>
    </fieldset><WriteError error={write.error} conflict={write.conflict} onRefresh={onRefresh} />
  </form>;
}

function ApprovalCard({ approval, allApprovals, tasks, focused, onSaved, onRefresh, onEdit, onRevise }: { approval: WorkflowApproval; allApprovals: WorkflowApproval[]; tasks: WorkflowTask[]; focused: boolean; onSaved: (approval: WorkflowApproval) => void; onRefresh: () => void; onEdit: () => void; onRevise: () => void }) {
  const [open, setOpen] = useState(focused);
  const itemStates = approval.items.map(item => workflowApprovalEffectiveItemStatus(approval, item.id, allApprovals));
  const pending = approval.items.filter((item, i) => itemStates[i] === "pending" && approvalItemNeedsHuman(item, tasks)).length;
  const automaticHistory = approval.items.every(item => !approvalItemNeedsHuman(item, tasks));
  const effectiveStatus = itemStates.every(status => status === "superseded") ? "superseded" : approval.status;
  const canDecide = !automaticHistory && (pending > 0 || itemStates.includes("approved"));
  const decisionFormId = `decision-form-${approval.id}`;
  return <details className={`${styles.record} ${focused ? review.focused : ""}`} id={`approval-${approval.id}`} open={open} onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>
      <span><strong>{approval.title}</strong><small>{siteLabels[approval.siteDomain]} · {approval.requestedBy} · {stamp(approval.submittedAt)}</small></span>
      <span className={styles.taskMeta}><ApprovalBadge status={automaticHistory ? "automatic_history" : effectiveStatus} /><small>{pending ? `待审 ${pending} / ${approval.items.length} 项` : `${approval.items.length} 个版本`}</small></span>
    </summary>
    <div className={styles.detail}>
      <div className={review.actions}><Link href={href(approval.id)}>审批单固定链接 ↗</Link>{canDecide ? <a href={`#${decisionFormId}`}>记录审核决定 ↓</a> : null}<ScreenshotLinks items={approval.evidence} /></div>
      {approval.items.map((item, index) => {
        const task = tasks.find(task => task.id === item.taskId);
        const mismatch = Boolean(task?.pageUrl === item.pageUrl && task?.language === item.language && task?.contentVersion && task.contentVersion !== item.contentVersion);
        const preview = safeUrl(item.previewUrl), draft = safeUrl(item.draftUrl);
        return <section key={item.id} className={review.itemDetail} aria-label={`审批页面 ${index + 1}`}>
          <div className={styles.sectionHeading}><h3>{item.operation === "new" ? "新增页面" : "修改页面"} · {item.language}</h3><ApprovalBadge status={approvalItemNeedsHuman(item, tasks) ? itemStates[index] : "automatic_history"} /></div>
          <a className={review.targetUrl} href={item.pageUrl} target="_blank" rel="noreferrer">{item.pageUrl} ↗</a>
          <div className={review.actions}>
            {preview ? <a href={preview} target="_blank" rel="noreferrer">打开测试页面 <ExternalLink size={13} aria-hidden="true" /></a> : <span className={styles.muted}>未提供测试链接</span>}
            {draft ? <a href={draft} target="_blank" rel="noreferrer">打开稿件 <ExternalLink size={13} aria-hidden="true" /></a> : null}
            <ScreenshotLinks items={item.evidence} />
          </div>
          <ReviewScreenshots approvalId={approval.id} item={item} editable={approval.status === "draft"} onRefresh={onRefresh} />
          <h4>变更摘要</h4><p className={review.preserveLines}>{item.changeSummary}</p>
          <dl className={styles.metadata}><div><dt>本次待审版本</dt><dd><code>{item.contentVersion}</code></dd></div>{item.baseContentVersion ? <div><dt>修改前版本</dt><dd><code>{item.baseContentVersion}</code></dd></div> : null}</dl>
          {mismatch ? <p className={styles.warning}>关联任务已有新版本。此单仅适用于上述版本，请为新版本另建审批单。</p> : null}
          <details className={review.content}>
            <summary>前后改动与审稿内容</summary>
            <div className={review.beforeAfter}>{item.beforeSummary ? <div><h4>修改前</h4><p>{item.beforeSummary}</p></div> : <div><h4>修改前</h4><p className={styles.muted}>新增页面，尚无旧版。</p></div>}<div><h4>修改后 / 新增内容</h4><p>{item.afterSummary}</p></div></div>
            {item.beforeContent ? <details className={review.content}><summary>修改前完整内容 · {item.beforeContent.length.toLocaleString("zh-CN")} 字符</summary><pre>{item.beforeContent}</pre></details> : null}
            {item.reviewContent ? <><h4>{item.reviewFormat === "diff" ? "完整变更 Diff" : "完整审稿内容"} · {item.reviewContent.length.toLocaleString("zh-CN")} 字符</h4><pre>{item.reviewContent}</pre></> : <p className={styles.muted}>请在测试页面或稿件中核对版本。若无法访问，可要求修改。</p>}
          </details>
          <details className={review.content}><summary>关联任务、页面效果与证据</summary>
            <p>关联任务 {task ? <Link href={`/work?week=${task.weekStart}#task-${task.id}`}>{task.title}</Link> : item.taskId} · <Link href={"/pages?" + new URLSearchParams({ site: approval.siteDomain, pageUrl: item.pageUrl })}>页面效果</Link></p>
            <Evidence items={item.evidence} />
          </details>
        </section>;
      })}
      <details className={review.content}><summary>审核历史 · {approval.decisions.length} 条</summary>{approval.decisions.length ? <ol className={review.decisions}>{approval.decisions.map(decision => <li key={decision.id}><div><ApprovalBadge status={decision.decision} /><strong>{decision.decidedBy}</strong><small>{stamp(decision.decidedAt)} · 入库 {stamp(decision.recordedAt)}</small></div><p>适用页面：{decision.itemIds.map(id => { const item = approval.items.find(item => item.id === id); return item ? `${item.language} ${item.pageUrl}` : id; }).join("；")}</p><p className={review.preserveLines}>{decision.note}</p><details><summary>审核证据</summary><Evidence items={decision.evidence} /></details></li>)}</ol> : <p className={styles.muted}>尚无人工审批决定。</p>}</details>
      {automaticHistory ? <p className={styles.muted}>此页面按当前规则自动执行。本单仅保留历史，不计待审批；原审核决定未改写。</p> : approval.status === "draft" ? <button type="button" className={styles.primary} onClick={onEdit}>编辑草稿并提交审批</button> : <><DecisionForm id={decisionFormId} key={`${approval.id}:${approval.version}`} approval={approval} allApprovals={allApprovals} tasks={tasks} onSaved={onSaved} onRefresh={onRefresh} /><button type="button" className={styles.secondary} onClick={onRevise}>改稿后新建审批单</button></>}
      <details className={review.recordEvidence}><summary>审批单信息与来源证据</summary>
        <dl className={styles.metadata}><div><dt>单号 / 记录版本</dt><dd>{approval.id} / {approval.version}</dd></div><div><dt>归档工作周</dt><dd>{approval.weekStart}</dd></div><div><dt>提交入库</dt><dd>{stamp(approval.submittedRecordedAt)}</dd></div></dl>
        {approval.supersedesApprovalIds.length ? <p>替换原审批单 {approval.supersedesApprovalIds.map(id => <Link key={id} href={href(id)} className={review.inlineLink}>{id}</Link>)}</p> : null}
        <Evidence items={approval.evidence} /></details>
    </div>
  </details>;
}

export function SeoPageApprovals({ weekStart }: { weekStart: string }) {
  const params = useSearchParams(), router = useRouter();
  const selectedId = params.get("approvalId"), initialTaskId = params.get("taskId");
  const result = useSeoRead<WorkflowSnapshot>(`/api/seo/workflow?week=${weekStart}&allHistory=true`);
  const [scope, setScope] = useState("pending"), [site, setSite] = useState("all"), [query, setQuery] = useState("");
  const [editor, setEditor] = useState<{ id: string; mode: "new" | "edit" | "revise"; record?: WorkflowApproval } | null>(() => params.get("newApproval") === "1" ? { id: "new", mode: "new" } : null);
  const [notice, setNotice] = useState("");
  const newButton = useRef<HTMLButtonElement>(null);
  function closeEditor() { setEditor(null); requestAnimationFrame(() => newButton.current?.focus()); }
  const data = result.data, approvals = data?.approvals ?? [], allApprovals = approvals;
  const pending = approvals.filter(approval => approval.items.some(item => approvalItemNeedsHuman(item, data?.tasks ?? []) && workflowApprovalEffectiveItemStatus(approval, item.id, allApprovals) === "pending"));
  function refresh() { result.retry(); }
  function saved(record: WorkflowApproval) { setEditor(null); setNotice(record.status === "draft" ? "草稿已保存，尚未提交审批。" : "审批记录已保存。"); refresh(); router.push(href(record.id), { scroll: false }); }
  const focused = approvals.find(approval => approval.id === selectedId);
  const editingRecord = editor?.mode === "edit" ? approvals.find(approval => approval.id === editor.record?.id) ?? editor.record : editor?.record;
  const editUnavailable = editor?.mode === "edit" && editingRecord?.status !== "draft";
  const filtered = approvals.filter(approval => {
    const effectiveSuperseded = approval.items.every(item => workflowApprovalEffectiveItemStatus(approval, item.id, approvals) === "superseded");
    const matchesState = scope === "all" || (scope === "pending" ? pending.includes(approval) : (effectiveSuperseded ? "superseded" : approval.status) === scope);
    return (site === "all" || approval.siteDomain === site) && matchesState && [approval.title, approval.id, approval.requestedBy, ...approval.items.flatMap(item => [item.pageUrl, item.language, item.contentVersion])].some(value => value.toLowerCase().includes(query.trim().toLowerCase()));
  });
  const shown = focused ? [focused, ...filtered.filter(approval => approval.id !== focused.id)] : filtered;
  return <>
    <div className={workspace.titleRow}>
      <h1 className={workspace.title}>页面审批</h1>
      <div className={styles.toolbarActions}>
        <button type="button" className={styles.secondary} onClick={refresh}><RefreshCw size={14} aria-hidden="true" />刷新</button>
        <button ref={newButton} type="button" className={styles.primary} disabled={!data || Boolean(editor)} onClick={() => setEditor({ id: crypto.randomUUID(), mode: "new" })}><Plus size={14} aria-hidden="true" />新建审批单</button>
      </div>
    </div>
    {notice ? <p role="status" className={review.notice}>{notice}</p> : null}
    {result.error ? <div className={styles.empty} role="alert"><p>{result.error}</p><button type="button" className={styles.secondary} onClick={refresh}>重试读取审批单</button></div> : !data ? <p className={styles.empty} role="status">正在读取跨周审批记录…</p> : <>
      {data.storage === "local_preview" ? <p className={styles.warning}>本地预览 · 操作仅保存到本地。</p> : null}
      <section className={`${styles.summary} ${styles.summaryPair}`} aria-label="跨周待审批摘要">
        <div><span>待审批单 · 全部工作周</span><strong>{numberText(data.summary.pendingApprovals)}</strong></div>
        <div><span>待审页面版本</span><strong>{numberText(data.summary.pendingApprovalItems)}</strong></div>
      </section>
      {editor ? editUnavailable ? <p className={styles.warning}>该草稿已由其他人提交，不能再编辑。请查看最新审批单；如内容有变化，请另建审批单。<button type="button" className={styles.secondary} onClick={closeEditor}>关闭旧草稿</button></p> : <ApprovalEditor key={`${editor.id}:${editingRecord?.version ?? 0}`} weekStart={data.tasks.find(task => task.id === initialTaskId)?.weekStart ?? weekStart} tasks={data.tasks} allApprovals={approvals} initialTask={data.tasks.find(task => task.id === initialTaskId)} original={editor.mode === "edit" ? editingRecord : undefined} revision={editor.mode === "revise" ? editor.record : undefined} onSaved={saved} onCancel={closeEditor} onRefresh={refresh} /> : null}
      <section className={styles.listPanel} aria-labelledby="approval-list-title">
        <div className={styles.sectionHeading}><h2 id="approval-list-title">审批记录</h2><span className={styles.count}>{shown.length} 单</span></div>
        <div className={review.filters}><UiSelect aria-label="审批状态筛选" value={scope} onChange={setScope} options={[{ value: "pending", label: "待审批（跨周）" }, { value: "all", label: "全部审批记录" }, ...["draft", "partially_reviewed", "approved", "changes_requested", "rejected", "withdrawn", "superseded"].map(value => ({ value, label: labels[value] }))]} /><UiSelect aria-label="审批站点筛选" value={site} onChange={setSite} options={[{ value: "all", label: "全部五站" }, ...WORKFLOW_SITES.map(value => ({ value, label: siteLabels[value] }))]} /><input aria-label="搜索审批单" value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索标题、URL、版本或提交人" /></div>
        {selectedId && !focused ? <p className={styles.warning}>未找到审批单 {selectedId}。请核对链接或刷新。</p> : null}
        {shown.length ? shown.map(approval => <ApprovalCard key={`${approval.id}:${focused?.id === approval.id ? "focused" : "list"}`} approval={approval} allApprovals={approvals} tasks={data.tasks} focused={focused?.id === approval.id} onSaved={saved} onRefresh={refresh} onEdit={() => setEditor({ id: approval.id, mode: "edit", record: approval })} onRevise={() => setEditor({ id: crypto.randomUUID(), mode: "revise", record: approval })} />) : <p className={styles.empty}>当前筛选没有匹配的审批单。</p>}
      </section>
    </>}
  </>;
}
