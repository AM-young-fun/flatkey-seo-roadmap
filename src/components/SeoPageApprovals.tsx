"use client";

import { SeoApprovalSkeleton } from "./SeoApprovalWorkspace";

import { approvalPreview, groupApprovalPages, visibleApprovalItemStatus, type ReviewItem } from "@/lib/seo-approval-display";
import { approvalReviewReadiness, approvalItemNeedsHuman, shiftWorkflowDay, workflowWeek } from "@/lib/seo-workflow";
import { useRouter, useSearchParams } from "next/navigation";
import { useRef, useState, type FormEvent } from "react";
import { ExternalLink, RefreshCw } from "lucide-react";
import { workflowApprovalEffectiveItemStatus, workflowApprovalStatus, WORKFLOW_SITES, type WorkflowApproval, type WorkflowSnapshot, type WorkflowTask } from "@/lib/seo-workflow";
import { UiSelect } from "./UiSelect";
import { numberText, shanghaiStamp, useSeoRead } from "./useSeoAnalytics";
import styles from "./SeoWorkWorkspace.module.css";
import review from "./SeoPageApprovals.module.css";

type ApprovalItem = WorkflowApproval["items"][number];
type ApprovalDecision = Omit<WorkflowApproval["decisions"][number], "recordedAt">;
type ApprovalInput = Omit<WorkflowApproval, "version" | "updatedAt" | "recordedAt" | "submittedRecordedAt" | "decisions"> & { decisions: ApprovalDecision[] };
const labels: Record<string, string> = { automatic_history: "免审历史", legacy_cluster: "旧流程记录", draft: "草稿", missing_materials: "待补测试材料", pending: "待审批", partially_reviewed: "逐项处理", approved: "已批准", rejected: "已拒绝", changes_requested: "要求修改", withdrawn: "已撤回", superseded: "已被新单替换" };
const siteLabels: Record<string, string> = { "flatkey.ai": "Flatkey", "jev-llm.com": "JEV LLM", "mochichatbot.com": "MochiChatbot", "modelfit.cc": "ModelFit", "rackrate.org": "RackRate" };
const stamp = (value: string | null) => value ? shanghaiStamp(value) : "尚未提交";
const href = (id: string) => `/approvals?approvalId=${encodeURIComponent(id)}`;
const recordInput = (approval: WorkflowApproval): ApprovalInput => {
  const { version: _version, updatedAt: _updatedAt, recordedAt: _recordedAt, submittedRecordedAt: _submittedRecordedAt, decisions, ...record } = approval;
  return { ...record, decisions: decisions.map(({ recordedAt: _recordedAt, ...decision }) => decision) };
};

function ApprovalBadge({ status }: { status: string }) {
  return <span className={review.badge} data-state={status}>{labels[status] ?? status}</span>;
}

export function ReviewChangeSummary({ item }: { item: ReviewItem }) {
  const { url } = approvalPreview(item);
  const label = item.afterSummary.match(/^新增文字“([^”]+)”/u)?.[1];
  const path = new URL(item.pageUrl).pathname;
  const pricingLink = label && /\/pricing\/?$/.test(path);
  const summary = pricingLink ? `在价格页简介下方添加「${label}」，链接到同语言的 LLM 费用计算器。` : item.changeSummary;
  const additional = !pricingLink && !item.afterSummary.startsWith(item.changeSummary) && item.afterSummary.length <= 300 ? item.afterSummary : null;
  return <div className={review.changeSummary}>
    <h4>变更摘要</h4>
    <p>{summary}</p>
    {additional ? <p>{additional}</p> : null}
    <div className={review.previewLink}>
      {item.postPublicationId ? <a href={item.pageUrl} target="_blank" rel="noreferrer">查看已上线页面 <ExternalLink size={13} aria-hidden="true" /></a> : url ? <a href={url} target="_blank" rel="noreferrer">打开同版本测试预览 <ExternalLink size={13} aria-hidden="true" /></a>
        : <span className={styles.muted}>待部署并核验测试版本</span>}
      {item.operation === "update" && !item.postPublicationId ? <a href={item.pageUrl} target="_blank" rel="noreferrer">查看正式页面 <ExternalLink size={13} aria-hidden="true" /></a> : null}
      {item.draftUrl && item.draftUrl !== url ? <a href={item.draftUrl} target="_blank" rel="noreferrer">查看稿件 <ExternalLink size={13} aria-hidden="true" /></a> : null}
    </div>
  </div>;
}

function ReviewPageGroup({ group, preferredTask, statusFor }: {
  group: ReturnType<typeof groupApprovalPages>[number];
  preferredTask: string | null;
  statusFor: (item: ApprovalItem) => string;
}) {
  const [selected, setSelected] = useState(() => (group.items.find(item => item.taskId === preferredTask)
    ?? group.items.find(item => item.language === "en") ?? group.items[0]).id);
  const item = group.items.find(item => item.id === selected) ?? group.items[0];
  return <section className={review.itemDetail} aria-label="审批页面">
    <div className={review.pageGroupHeading}>
      <div><h3>{item.operation === "new" ? "新增页面" : "修改页面"}</h3><span className={review.path}>{group.path}</span></div>
      <div className={review.pageGroupActions}>
        {group.items.length > 1 ? <UiSelect aria-label={`预览语言 ${group.path}`} value={item.id} onChange={setSelected}
          options={group.items.map(entry => ({ value: entry.id, label: entry.language }))} /> : <span className={styles.muted}>{item.language}</span>}
        <ApprovalBadge status={statusFor(item)} />
      </div>
    </div>
    <ReviewChangeSummary item={item} />
  </section>;
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

function DecisionForm({ approval, allApprovals, tasks, preferredTask, onSaved, onRefresh }: { preferredTask: string | null; approval: WorkflowApproval; allApprovals: WorkflowApproval[]; tasks: WorkflowTask[]; onSaved: (approval: WorkflowApproval) => void; onRefresh: () => void }) {
  const [decision, setDecision] = useState<ApprovalDecision["decision"]>(() => approval.items.some(item => visibleApprovalItemStatus(approval, item, allApprovals, tasks) === "pending") ? "approved" : "withdrawn"), [selected, setSelected] = useState<string[]>(() => approval.items.filter(item => item.taskId === preferredTask && workflowApprovalEffectiveItemStatus(approval, item.id, allApprovals) === "pending").map(item => item.id)), [reviewer, setReviewer] = useState(""), [note, setNote] = useState(""), [confirmed, setConfirmed] = useState(false);
  const postReview = approval.items.every(item => Boolean(item.postPublicationId));
  const write = useApprovalWrite();
  const eligible = approval.items.filter(item => {
    const state = visibleApprovalItemStatus(approval, item, allApprovals, tasks);
    return state === (decision === "withdrawn" ? "approved" : "pending");
  });
  const selectedItems = eligible.filter(item => selected.includes(item.id));
  const hasPending = approval.items.some(item => visibleApprovalItemStatus(approval, item, allApprovals, tasks) === "pending"), hasApproved = approval.items.some(item => approvalItemNeedsHuman(item, tasks) && workflowApprovalEffectiveItemStatus(approval, item.id, allApprovals) === "approved");
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
  return <form className={styles.reviewForm} onSubmit={event => void submit(event)}>
    <h4>记录本次审核决定</h4><p className={styles.muted}>审核决定只适用于所选 URL、语言和版本。{postReview ? "通过即结单；拒绝或要求修改会排入撤销队列。" : "批准后交给发布队列。"}</p>
    <fieldset disabled={write.busy || write.conflict} className={review.fieldset}>
      <label className={review.selectLabel}>审批结果<UiSelect aria-label="审批结果" value={decision} onChange={value => { setDecision(value as typeof decision); setSelected([]); setConfirmed(false); }} options={[...(hasPending ? [{ value: "approved", label: "批准所选项" }, { value: "changes_requested", label: "要求修改" }, { value: "rejected", label: "拒绝所选项" }] : []), ...(hasApproved && !postReview ? [{ value: "withdrawn", label: "撤回已批准项" }] : [])]} /></label>
      {!eligible.length ? <p className={styles.muted}>当前决定没有可选项。请选择“撤回已批准项”查看撤回范围。</p> : <>
        <div className={review.actions}><button type="button" className={styles.secondary} onClick={() => { setSelected(eligible.map(item => item.id)); setConfirmed(false); }}>{decision === "withdrawn" ? "选择全部已批准项" : "选择全部待审批项"}</button><button type="button" className={styles.secondary} onClick={() => { setSelected([]); setConfirmed(false); }}>取消选择</button><span className={styles.muted}>已选 {selectedItems.length} / {eligible.length} 项</span></div>
        <div className={review.selections}>{groupApprovalPages(eligible).map(group => <fieldset className={review.languageGroup} key={group.key}>
          <legend>{group.path}</legend>
          {group.items.map(item => <label key={item.id}><input type="checkbox" checked={selected.includes(item.id)}
            onChange={event => {
              const checked = event.target.checked;
              setSelected(current => checked ? [...current, item.id] : current.filter(id => id !== item.id));
              setConfirmed(false);
            }} />{item.language}</label>)}
        </fieldset>)}</div>
      </>}
      <div className={styles.formGrid}><label>审核人<input required maxLength={200} value={reviewer} onChange={event => setReviewer(event.target.value)} /></label><label className={styles.spanAll}>决定理由 / 需修改的具体内容<textarea required rows={3} maxLength={5000} value={note} onChange={event => setNote(event.target.value)} /></label></div>
      <label className={styles.checkbox}><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} />我已核对所选 {selectedItems.length} 项的变更摘要{decision === "approved" ? postReview ? "和正式页面" : "和测试预览" : ""}，同意记录“{labels[decision]}”决定。</label>
      {decision === "approved" && selectedItems.some(item => !approvalReviewReadiness(item).ready) ? <p role="alert">所选版本缺少同版本测试链接或桌面/手机截图，请要求修改，由执行任务补齐材料后自动送审。</p> : null}
      <button type="submit" className={styles.primary} disabled={!confirmed || !selectedItems.length || !reviewer.trim() || !note.trim() || decision === "approved" && selectedItems.some(item => !approvalReviewReadiness(item).ready)}>{write.busy ? "记录中…" : `确认${labels[decision]} ${selectedItems.length} 项`}</button>
    </fieldset><WriteError error={write.error} conflict={write.conflict} onRefresh={onRefresh} />
  </form>;
}

function ApprovalCard({ approval, allApprovals, tasks, focused, startReview, preferredTask, onSaved, onRefresh }: {
  approval: WorkflowApproval; allApprovals: WorkflowApproval[]; tasks: WorkflowTask[];
  focused: boolean; startReview: boolean; preferredTask: string | null;
  onSaved: (approval: WorkflowApproval) => void; onRefresh: () => void;
}) {
  const [open, setOpen] = useState(focused);
  const [showDecision, setShowDecision] = useState(startReview);
  const effectiveItemStatus = (item: ApprovalItem) => visibleApprovalItemStatus(approval, item, allApprovals, tasks);
  const pending = approval.items.filter(item => effectiveItemStatus(item) === "pending" && approvalItemNeedsHuman(item, tasks)).length;
  const automaticHistory = approval.items.every(item => !approvalItemNeedsHuman(item, tasks));
  const effectiveStatus = approval.items.every(item => effectiveItemStatus(item) === "superseded") ? "superseded" : approval.items.every(item => effectiveItemStatus(item) === "legacy_cluster") ? "legacy_cluster" : approval.status;
  const missing = approval.items.filter(item => effectiveItemStatus(item) === "missing_materials").length;
  const canDecide = !automaticHistory && (pending > 0 || approval.items.some(item => !item.postPublicationId && effectiveItemStatus(item) === "approved"));
  const groups = groupApprovalPages(approval.items);
  return <details className={`${styles.record} ${focused ? review.focused : ""}`} id={`approval-${approval.id}`} open={open} onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>
      <span><strong>{approval.title}</strong><small>{siteLabels[approval.siteDomain]} · {stamp(approval.submittedAt)}{approval.items.every(item => item.postPublicationId) ? " · 上线后审核" : ""}</small></span>
      <span className={styles.taskMeta}><ApprovalBadge status={automaticHistory ? "automatic_history" : !pending && missing ? "missing_materials" : effectiveStatus} />
        <small>{[pending ? `待审 ${pending} 项` : "", missing ? `待补 ${missing} 项` : ""].filter(Boolean).join(" · ") || `${groups.length} 个页面`}</small></span>
    </summary>
    <div className={styles.detail}>
      {canDecide ? <div className={review.actions}><button type="button" className={styles.primary} aria-expanded={showDecision}
        onClick={() => setShowDecision(current => !current)}>{showDecision ? "收起审核" : pending ? "审核此单" : "管理审核"}</button></div> : null}
      {canDecide && showDecision ? <DecisionForm key={`${approval.id}:${approval.version}`} approval={approval}
        allApprovals={allApprovals} tasks={tasks} preferredTask={preferredTask} onSaved={onSaved} onRefresh={onRefresh} /> : null}
      {groups.map(group => <ReviewPageGroup key={group.key} group={group} preferredTask={preferredTask}
        statusFor={effectiveItemStatus} />)}
    </div>
  </details>;
}

export function SeoPageApprovals() {
  const params = useSearchParams(), router = useRouter();
  const [monday] = useState(() => workflowWeek());
  const requestedWeek = params.get("week");
  const weekStart = requestedWeek === "next" ? shiftWorkflowDay(monday, 7) : requestedWeek && /^\d{4}-\d{2}-\d{2}$/.test(requestedWeek) && new Date(requestedWeek + "T00:00:00Z").getUTCDay() === 1 ? requestedWeek : monday;
  const selectedId = params.get("approvalId"), taskFilter = params.get("taskId");
  const result = useSeoRead<WorkflowSnapshot>(`/api/seo/workflow?week=${weekStart}&allHistory=true`);
  const [scope, setScope] = useState("pending"), [site, setSite] = useState("all"), [query, setQuery] = useState("");
  const [notice, setNotice] = useState("");
  const data = result.data, approvals = data?.approvals ?? [], allApprovals = approvals;
  const pending = approvals.filter(approval => approval.items.some(item => visibleApprovalItemStatus(approval, item, allApprovals, data?.tasks ?? []) === "pending"));
  const missing = approvals.filter(approval => approval.items.some(item => visibleApprovalItemStatus(approval, item, allApprovals, data?.tasks ?? []) === "missing_materials"));
  function refresh() { result.retry(); }
  function saved(record: WorkflowApproval) { setNotice("审批结果已保存。"); refresh(); router.push(href(record.id), { scroll: false }); }
  const focused = approvals.find(approval => approval.id === selectedId);
  const filtered = approvals.filter(approval => {
    const effectiveSuperseded = approval.items.every(item => workflowApprovalEffectiveItemStatus(approval, item.id, approvals) === "superseded");
    const matchesState = scope === "all" || (scope === "pending" ? pending.includes(approval) : scope === "missing_materials" ? missing.includes(approval) : (effectiveSuperseded ? "superseded" : approval.status) === scope);
    return (!taskFilter || approval.items.some(item => item.taskId === taskFilter)) && (site === "all" || approval.siteDomain === site) && matchesState && [approval.title, approval.id, approval.requestedBy, ...approval.items.flatMap(item => [item.pageUrl, item.language, item.contentVersion])].some(value => value.toLowerCase().includes(query.trim().toLowerCase()));
  });
  const shown = focused ? [focused, ...filtered.filter(approval => approval.id !== focused.id)] : filtered;
  return <>
    {data || result.error ? <div className={review.approvalRefresh}>
      <button type="button" className={styles.secondary} onClick={refresh}><RefreshCw size={14} aria-hidden="true" />刷新</button>
    </div> : null}
    {notice ? <p role="status" className={review.notice}>{notice}</p> : null}
    {result.error ? <div className={styles.empty} role="alert"><p>{result.error}</p><button type="button" className={styles.secondary} onClick={refresh}>重试读取审批单</button></div> : !data ? <SeoApprovalSkeleton /> : <>
      {data.storage === "local_preview" ? <p className={styles.warning}>本地预览 · 操作仅保存到本地。</p> : null}
      <section className={`${styles.summary}`} aria-label="跨周审批摘要">
        <div><span>待审批单</span><strong>{numberText(data.summary.pendingApprovals)}</strong></div>
        <div><span>待审页面版本</span><strong>{numberText(data.summary.pendingApprovalItems)}</strong></div>
        <div><span>待补测试材料</span><button type="button" className={styles.secondary} onClick={() => setScope("missing_materials")}>{missing.length} 单</button></div>
      </section>
      <section className={styles.listPanel} aria-labelledby="approval-list-title">
        <div className={styles.sectionHeading}><h2 id="approval-list-title">审批队列</h2><span className={styles.count}>{shown.length} 单</span></div>
        <div className={review.filters}><UiSelect aria-label="审批状态筛选" value={scope} onChange={setScope} options={[{ value: "pending", label: "待审批（跨周）" }, { value: "missing_materials", label: "待补测试材料" }, { value: "all", label: "全部审批记录" }, ...["draft", "partially_reviewed", "approved", "changes_requested", "rejected", "withdrawn", "superseded"].map(value => ({ value, label: labels[value] }))]} /><UiSelect aria-label="审批站点筛选" value={site} onChange={setSite} options={[{ value: "all", label: "全部五站" }, ...WORKFLOW_SITES.map(value => ({ value, label: siteLabels[value] }))]} /><input aria-label="搜索审批单" value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索标题、URL、版本或提交人" /></div>
        {selectedId && !focused ? <p className={styles.warning}>未找到审批单 {selectedId}。请核对链接或刷新。</p> : null}
        {shown.length ? shown.map(approval => <ApprovalCard key={`${approval.id}:${focused?.id === approval.id ? "focused" : "list"}`} approval={approval} allApprovals={approvals} tasks={data.tasks} focused={focused?.id === approval.id} startReview={focused?.id === approval.id && params.get("review") === "1"} preferredTask={taskFilter} onSaved={saved} onRefresh={refresh} />) : <p className={styles.empty}>当前没有匹配的送审记录。测试材料齐备后，执行任务会自动送审。</p>}
      </section>
    </>}
  </>;
}
