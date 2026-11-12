"use client";

import { workTaskHref } from "@/lib/seo-workspace-routes";
import { approvalReviewReadiness, approvalItemNeedsHuman, reviewPreviewUrl } from "@/lib/seo-workflow";
import Link from "next/link";
import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import { useRef, useState, type FormEvent } from "react";
import { ExternalLink, ImageIcon, RefreshCw } from "lucide-react";
import { workflowApprovalEffectiveItemStatus, workflowApprovalStatus, WORKFLOW_SITES, type WorkflowApproval, type WorkflowSnapshot, type WorkflowTask } from "@/lib/seo-workflow";
import { UiSelect } from "./UiSelect";
import { WorkflowEvidence } from "./WorkflowEvidence";
import { numberText, shanghaiStamp, useSeoRead } from "./useSeoAnalytics";
import styles from "./SeoWorkWorkspace.module.css";
import review from "./SeoPageApprovals.module.css";
import workspace from "./SeoWorkspace.module.css";

type ApprovalItem = WorkflowApproval["items"][number];
type ApprovalDecision = Omit<WorkflowApproval["decisions"][number], "recordedAt">;
type ApprovalInput = Omit<WorkflowApproval, "version" | "updatedAt" | "recordedAt" | "submittedRecordedAt" | "decisions"> & { decisions: ApprovalDecision[] };
const labels: Record<string, string> = { automatic_history: "免审历史", draft: "草稿", pending: "待审批", partially_reviewed: "逐项处理", approved: "已批准", rejected: "已拒绝", changes_requested: "要求修改", withdrawn: "已撤回", superseded: "已被新单替换" };
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

function ReviewScreenshots({ item }: { item: ApprovalItem }) {
  const uploads = item.evidence.filter(row => row.url?.startsWith("https://flatkey-seo-roadmap.vercel.app/api/seo/review-assets/"));
  return uploads.length ? <div className={review.screenshotGrid}>{uploads.map(row =>
    <a href={row.url} key={row.url} target="_blank" rel="noreferrer"><Image src={row.url!} unoptimized width={240} height={160} alt={row.label} /><span>{row.label}</span></a>
  )}</div> : null;
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
    <h4>记录本次审核决定</h4><p className={styles.muted}>审核决定只适用于所选 URL、语言和版本。批准后交给发布队列。</p>
    <fieldset disabled={write.busy || write.conflict} className={review.fieldset}>
      <label className={review.selectLabel}>审批结果<UiSelect aria-label="审批结果" value={decision} onChange={value => { setDecision(value as typeof decision); setSelected([]); setConfirmed(false); }} options={[...(hasPending ? [{ value: "approved", label: "批准所选项" }, { value: "changes_requested", label: "要求修改" }, { value: "rejected", label: "拒绝所选项" }] : []), ...(hasApproved ? [{ value: "withdrawn", label: "撤回已批准项" }] : [])]} /></label>
      {!eligible.length ? <p className={styles.muted}>当前决定没有可选项。请选择“撤回已批准项”查看撤回范围。</p> : <>
        <div className={review.actions}><button type="button" className={styles.secondary} onClick={() => { setSelected(eligible.map(item => item.id)); setConfirmed(false); }}>{decision === "withdrawn" ? "选择全部已批准项" : "选择全部待审批项"}</button><button type="button" className={styles.secondary} onClick={() => { setSelected([]); setConfirmed(false); }}>取消选择</button><span className={styles.muted}>已选 {selectedItems.length} / {eligible.length} 项</span></div>
        <div className={review.selections}>{eligible.map(item => <label className={styles.checkbox} key={item.id}><input type="checkbox" checked={selected.includes(item.id)} onChange={event => { setSelected(current => event.target.checked ? [...current, item.id] : current.filter(id => id !== item.id)); setConfirmed(false); }} /><span><strong>{item.language} · {item.operation === "new" ? "新增" : "修改"}</strong><span>{item.pageUrl}</span><code>{item.contentVersion}</code></span></label>)}</div>
      </>}
      <div className={styles.formGrid}><label>审核人<input required maxLength={200} value={reviewer} onChange={event => setReviewer(event.target.value)} /></label><label className={styles.spanAll}>决定理由 / 需修改的具体内容<textarea required rows={3} maxLength={5000} value={note} onChange={event => setNote(event.target.value)} /></label></div>
      <label className={styles.checkbox}><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} />我已阅读所选 {selectedItems.length} 项的具体版本、前后改动和稿件，明确记录“{labels[decision]}”决定。</label>
      {decision === "approved" && selectedItems.some(item => !approvalReviewReadiness(item).ready) ? <p role="alert">所选版本缺少同版本测试链接或桌面/手机截图，请要求修改，由执行任务补齐材料后自动送审。</p> : null}
      <button type="submit" className={styles.primary} disabled={!confirmed || !selectedItems.length || !reviewer.trim() || !note.trim() || decision === "approved" && selectedItems.some(item => !approvalReviewReadiness(item).ready)}>{write.busy ? "记录中…" : `确认${labels[decision]} ${selectedItems.length} 项`}</button>
    </fieldset><WriteError error={write.error} conflict={write.conflict} onRefresh={onRefresh} />
  </form>;
}

function ApprovalCard({ approval, allApprovals, tasks, focused, onSaved, onRefresh }: { approval: WorkflowApproval; allApprovals: WorkflowApproval[]; tasks: WorkflowTask[]; focused: boolean; onSaved: (approval: WorkflowApproval) => void; onRefresh: () => void }) {
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
      <div className={review.actions}>{canDecide ? <a href={`#${decisionFormId}`}>审核此单 ↓</a> : null}{!focused ? <Link href={href(approval.id)}>固定链接</Link> : null}<ScreenshotLinks items={approval.evidence} /></div>
      {approval.items.map((item, index) => {
        const task = tasks.find(task => task.id === item.taskId);
        const mismatch = Boolean(task?.pageUrl === item.pageUrl && task?.language === item.language && task?.contentVersion && task.contentVersion !== item.contentVersion);
        const preview = item.previewContentVersion === item.contentVersion ? reviewPreviewUrl(item.previewUrl, item.pageUrl) : null;
        const draft = safeUrl(item.draftUrl);
        return <section key={item.id} className={review.itemDetail} aria-label={`审批页面 ${index + 1}`}>
          <div className={styles.sectionHeading}><h3>{item.operation === "new" ? "新增页面" : "修改页面"} · {item.language}</h3><ApprovalBadge status={approvalItemNeedsHuman(item, tasks) ? itemStates[index] : "automatic_history"} /></div>
          <a className={review.targetUrl} href={item.pageUrl} target="_blank" rel="noreferrer">正式页 · {item.pageUrl} ↗</a>
          <div className={review.actions}>
            {preview ? <a href={preview} target="_blank" rel="noreferrer">打开测试预览 <ExternalLink size={13} aria-hidden="true" /></a> : <span className={styles.muted}>测试预览待补齐</span>}
            {draft ? <a href={draft} target="_blank" rel="noreferrer">打开稿件 <ExternalLink size={13} aria-hidden="true" /></a> : null}
            <ScreenshotLinks items={item.evidence} />
          </div>
          <ReviewScreenshots item={item} />
          <h4>变更摘要</h4><p className={review.preserveLines}>{item.changeSummary}</p>
          <dl className={styles.metadata}><div><dt>本次待审版本</dt><dd><code>{item.contentVersion}</code></dd></div>{item.baseContentVersion ? <div><dt>修改前版本</dt><dd><code>{item.baseContentVersion}</code></dd></div> : null}</dl>
          {mismatch ? <p className={styles.warning}>关联任务已有新版本，执行任务补齐新版本的测试材料后会重新送审。</p> : null}
          <details className={review.content}>
            <summary>前后改动与审稿内容</summary>
            <div className={review.beforeAfter}>{item.beforeSummary ? <div><h4>修改前</h4><p>{item.beforeSummary}</p></div> : <div><h4>修改前</h4><p className={styles.muted}>新增页面，尚无旧版。</p></div>}<div><h4>修改后 / 新增内容</h4><p>{item.afterSummary}</p></div></div>
            {item.beforeContent ? <details className={review.content}><summary>修改前完整内容 · {item.beforeContent.length.toLocaleString("zh-CN")} 字符</summary><pre>{item.beforeContent}</pre></details> : null}
            {item.reviewContent ? <><h4>{item.reviewFormat === "diff" ? "完整变更 Diff" : "完整审稿内容"} · {item.reviewContent.length.toLocaleString("zh-CN")} 字符</h4><pre>{item.reviewContent}</pre></> : <p className={styles.muted}>请在测试页面或稿件中核对版本。若无法访问，可要求修改。</p>}
          </details>
          <details className={review.content}><summary>关联任务、页面效果与证据</summary>
            <p>关联任务 {task ? <Link href={workTaskHref(task)}>{task.title}</Link> : item.taskId} · <Link href={"/pages?" + new URLSearchParams({ site: approval.siteDomain, pageUrl: item.pageUrl })}>页面效果</Link></p>
            <WorkflowEvidence evidence={item.evidence} />
          </details>
        </section>;
      })}
      <details className={review.content}><summary>审核历史 · {approval.decisions.length} 条</summary>{approval.decisions.length ? <ol className={review.decisions}>{approval.decisions.map(decision => <li key={decision.id}><div><ApprovalBadge status={decision.decision} /><strong>{decision.decidedBy}</strong><small>{stamp(decision.decidedAt)} · 入库 {stamp(decision.recordedAt)}</small></div><p>适用页面：{decision.itemIds.map(id => { const item = approval.items.find(item => item.id === id); return item ? `${item.language} ${item.pageUrl}` : id; }).join("；")}</p><p className={review.preserveLines}>{decision.note}</p><details><summary>审核证据</summary><WorkflowEvidence evidence={decision.evidence} /></details></li>)}</ol> : <p className={styles.muted}>尚无人工审批决定。</p>}</details>
      {automaticHistory ? <p className={styles.muted}>此页面按当前规则自动执行。本单仅保留历史，不计待审批；原审核决定未改写。</p> : approval.status === "draft" ? <p className={styles.muted}>等待执行任务补齐材料并送审。</p> : <DecisionForm id={decisionFormId} key={`${approval.id}:${approval.version}`} approval={approval} allApprovals={allApprovals} tasks={tasks} onSaved={onSaved} onRefresh={onRefresh} />}
      <details className={review.recordEvidence}><summary>审批单信息与来源证据</summary>
        <dl className={styles.metadata}><div><dt>单号 / 记录版本</dt><dd>{approval.id} / {approval.version}</dd></div><div><dt>归档工作周</dt><dd>{approval.weekStart}</dd></div><div><dt>提交入库</dt><dd>{stamp(approval.submittedRecordedAt)}</dd></div></dl>
        {approval.supersedesApprovalIds.length ? <p>替换原审批单 {approval.supersedesApprovalIds.map(id => <Link key={id} href={href(id)} className={review.inlineLink}>{id}</Link>)}</p> : null}
        <WorkflowEvidence evidence={approval.evidence} /></details>
    </div>
  </details>;
}

export function SeoPageApprovals({ weekStart }: { weekStart: string }) {
  const params = useSearchParams(), router = useRouter();
  const selectedId = params.get("approvalId"), taskFilter = params.get("taskId");
  const result = useSeoRead<WorkflowSnapshot>(`/api/seo/workflow?week=${weekStart}&allHistory=true`);
  const [scope, setScope] = useState("pending"), [site, setSite] = useState("all"), [query, setQuery] = useState("");
  const [notice, setNotice] = useState("");
  const data = result.data, approvals = data?.approvals ?? [], allApprovals = approvals;
  const pending = approvals.filter(approval => approval.items.some(item => approvalItemNeedsHuman(item, data?.tasks ?? []) && workflowApprovalEffectiveItemStatus(approval, item.id, allApprovals) === "pending"));
  function refresh() { result.retry(); }
  function saved(record: WorkflowApproval) { setNotice("审批结果已保存。"); refresh(); router.push(href(record.id), { scroll: false }); }
  const focused = approvals.find(approval => approval.id === selectedId);
  const filtered = approvals.filter(approval => {
    const effectiveSuperseded = approval.items.every(item => workflowApprovalEffectiveItemStatus(approval, item.id, approvals) === "superseded");
    const matchesState = scope === "all" || (scope === "pending" ? pending.includes(approval) : (effectiveSuperseded ? "superseded" : approval.status) === scope);
    return (!taskFilter || approval.items.some(item => item.taskId === taskFilter)) && (site === "all" || approval.siteDomain === site) && matchesState && [approval.title, approval.id, approval.requestedBy, ...approval.items.flatMap(item => [item.pageUrl, item.language, item.contentVersion])].some(value => value.toLowerCase().includes(query.trim().toLowerCase()));
  });
  const shown = focused ? [focused, ...filtered.filter(approval => approval.id !== focused.id)] : filtered;
  return <>
    <div className={workspace.titleRow}>
      <h1 className={workspace.title}>页面审批</h1>
      <div className={styles.toolbarActions}>
        <button type="button" className={styles.secondary} onClick={refresh}><RefreshCw size={14} aria-hidden="true" />刷新</button>
      </div>
    </div>
    {notice ? <p role="status" className={review.notice}>{notice}</p> : null}
    {result.error ? <div className={styles.empty} role="alert"><p>{result.error}</p><button type="button" className={styles.secondary} onClick={refresh}>重试读取审批单</button></div> : !data ? <p className={styles.empty} role="status">正在读取跨周审批记录…</p> : <>
      {data.storage === "local_preview" ? <p className={styles.warning}>本地预览 · 操作仅保存到本地。</p> : null}
      <section className={`${styles.summary} ${styles.summaryPair}`} aria-label="跨周待审批摘要">
        <div><span>待审批单</span><strong>{numberText(data.summary.pendingApprovals)}</strong></div>
        <div><span>待审页面版本</span><strong>{numberText(data.summary.pendingApprovalItems)}</strong></div>
      </section>
      <section className={styles.listPanel} aria-labelledby="approval-list-title">
        <div className={styles.sectionHeading}><h2 id="approval-list-title">审批队列</h2><span className={styles.count}>{shown.length} 单</span></div>
        <div className={review.filters}><UiSelect aria-label="审批状态筛选" value={scope} onChange={setScope} options={[{ value: "pending", label: "待审批（跨周）" }, { value: "all", label: "全部审批记录" }, ...["draft", "partially_reviewed", "approved", "changes_requested", "rejected", "withdrawn", "superseded"].map(value => ({ value, label: labels[value] }))]} /><UiSelect aria-label="审批站点筛选" value={site} onChange={setSite} options={[{ value: "all", label: "全部五站" }, ...WORKFLOW_SITES.map(value => ({ value, label: siteLabels[value] }))]} /><input aria-label="搜索审批单" value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索标题、URL、版本或提交人" /></div>
        {selectedId && !focused ? <p className={styles.warning}>未找到审批单 {selectedId}。请核对链接或刷新。</p> : null}
        {shown.length ? shown.map(approval => <ApprovalCard key={`${approval.id}:${focused?.id === approval.id ? "focused" : "list"}`} approval={approval} allApprovals={approvals} tasks={data.tasks} focused={focused?.id === approval.id} onSaved={saved} onRefresh={refresh} />) : <p className={styles.empty}>当前没有匹配的送审记录。测试材料齐备后，执行任务会自动送审。</p>}
      </section>
    </>}
  </>;
}
