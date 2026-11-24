"use client";
import { GROWTH_COUNTRY_LABELS } from "@/lib/seo-growth-markets";

import { FeedbackButton } from "./FeedbackButton";
import { ReportLoading } from "./ReportLoading";
import { useActionFeedback } from "./useActionFeedback";
import { actionFailed, actionSucceeded } from "@/lib/interaction-feedback";
import { pendingTaskApproval } from "@/lib/seo-approval-display";

import { ReviewChangeSummary } from "./SeoPageApprovals";
import { SeoListDateControl, useSeoListDateRange } from "./SeoDateControl";
import { dateInListRange } from "@/lib/seo-date-range";
import Link from "./AppLink";
import { useLinkStatus } from "next/link";
import { useSearchParams } from "next/navigation";
import { useFeedbackRouter as useRouter } from "./useFeedbackRouter";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { CheckCircle2, ChevronRight, CircleAlert, Clock3, RefreshCw } from "lucide-react";
import { approvalReviewReadiness } from "@/lib/seo-workflow";
import type { WorkflowSnapshot, WorkflowTask, WorkflowTaskDetail, WorkflowOptimization, WorkflowIssue, WorkflowHistoricalImport, WorkflowApproval, WorkflowPublication } from "@/lib/seo-workflow";
import { PageDeliveryActions } from "./PageDeliveryActions";
import { WorkflowEvidence } from "./WorkflowEvidence";
import { PageHeader } from "./PageHeader";
import { SeoAutomationSchedule } from "./SeoAutomationSchedule";
import { workTaskHref } from "@/lib/seo-workspace-routes";
import { workTaskStatus, type WorkflowListTask, type WorkflowWorkList } from "@/lib/seo-workflow-list";
import { UiSelect } from "./UiSelect";
import { useSeoCountry } from "./useSeoCountry";
import { numberText, shanghaiStamp, useSeoRead } from "./useSeoAnalytics";
import workspace from "./SeoWorkspace.module.css";
import styles from "./SeoWorkWorkspace.module.css";
import { SeoAnchor } from "@/components/SeoAnchor";


const sites = [{ value: "flatkey.ai", label: "Flatkey" }, { value: "jev-llm.com", label: "JEV LLM" }, { value: "mochichatbot.com", label: "MochiChatbot" }, { value: "modelfit.cc", label: "ModelFit" }, { value: "rackrate.org", label: "RackRate" }];
const languages = [{ value: "en", label: "英语" }, { value: "ja", label: "日语" }, { value: "pt-BR", label: "巴西葡语" }, { value: "es-ES", label: "西班牙语" }];
const markets = GROWTH_COUNTRY_LABELS;
const statuses: Record<string, string> = { planned: "已排期", researching: "研究中", ready: "可制作", drafting: "制作中", review_pending: "待审批", missing_materials: "待补测试材料", approved: "已批准，待发布", published: "已发布待验收", verified: "已验收", observing: "观察中", blocked: "受阻", failed: "失败", unknown: "结果待核实", running: "执行中", completed: "已完成", partial: "部分完成", open: "待处理", investigating: "排查中", resolved: "已恢复", draft: "候选整理中", scheduled: "已自动排期", reviewed: "已排期", bootstrap: "本周补排", improved: "有改善", needs_investigation: "需排查", insufficient_data: "数据不足" };
const taskKinds: Record<string, string> = { blog: "博客", landing: "落地页", optimization: "旧页优化", cluster: "集群交付", technical: "技术修复", research: "关键词研究", promotion: "推广与内链", review: "复盘" };
const publicationKinds: Record<string, string> = { source_blog: "源文", translation: "翻译", backfill_translation: "历史补译", landing: "落地页", optimization: "旧页优化", cluster: "集群交付", prompt: "提示词" };
const stageNames: Record<string, string> = { SHEETS: "三表校验与同步", KEYWORD_RESEARCH: "关键词研究", TECHNICAL_QA: "三站公开官网技术巡检", BLOG: "博客发布与验收", OLD_PAGE: "旧页优化", LANDING: "落地页制作", CLUSTER: "集群交付", DELIVERY: "交付验收与续跑", WEEKLY_CANDIDATES: "下周候选证据", WEEKLY_PLAN: "下周计划定稿", REPORT_PREVIEW: "报告准备", REPORT_SEND: "群通知", MONTHLY_REVIEW: "月度投入复盘" };
const legacyMeasurementIssueId = "amplitude-organic-cohorts-pending";
const issueCategories: Record<WorkflowIssue["category"], string> = { technical: "技术", indexing: "索引", language: "语言", content: "内容", data: "数据", business: "业务", sync: "同步" };
const stateLabel = (value: string) => statuses[value] ?? value;
const taskStatusOptions = [
  { value: "active", label: "未验收" },
  { value: "all", label: "全部状态" },
  { value: "scheduled", label: "排期" },
  { value: "accepted", label: "进行中" },
  { value: "review", label: "待审核" },
  { value: "rejected", label: "已拒绝" },
  { value: "failed", label: "失败" },
  { value: "completed", label: "已验收" },
];
const taskStatusLabel = (value: string) => taskStatusOptions.find(option => option.value === value)?.label ?? "已完成";
const taskStatusAliases: Record<string, string> = {
  planned: "scheduled", ready: "scheduled", researching: "accepted", drafting: "accepted",
  missing_materials: "accepted", approved: "accepted", published: "accepted",
  review_pending: "review", blocked: "failed",
};
const taskFilterStatus = (value: string) => taskStatusOptions.some(option => option.value === value)
  ? value : taskStatusAliases[value] ?? "all";
const workTaskTypes = [
  { value: "all", label: "全部任务" },
  { value: "blog-create", label: "制作博客" },
  { value: "blog-update", label: "优化博客" },
  { value: "content-refresh", label: "旧文翻新" },
  { value: "internal-linking", label: "主题内链" },
  { value: "landing-create", label: "制作落地页" },
  { value: "landing-update", label: "优化页面" },
  { value: "research", label: "关键词研究" },
  { value: "technical", label: "技术修复" },
  { value: "cluster", label: "集群交付" },
  { value: "promotion", label: "推广与内链" },
  { value: "review", label: "复盘" },
];
function editorialTaskType(task: Pick<WorkflowTask, "kind" | "workClass" | "pageType" | "pageUrl">) {
  if (task.workClass === "content_refresh") return "content-refresh";
  if (task.workClass === "internal_linking") return "internal-linking";
  const blog = task.pageType === "blog" || /\/blog(?:\/|$)/.test(task.pageUrl ?? "");
  if (task.kind === "blog") return "blog-create";
  if (task.kind === "landing") return "landing-create";
  if (task.kind === "optimization") return blog ? "blog-update" : "landing-update";
  if (task.kind === "cluster" && task.pageUrl) return blog ? "blog-update" : "landing-update";
  return task.kind;
}
function EditorialTaskTag({ task }: { task: Pick<WorkflowTask, "kind" | "workClass" | "pageType" | "pageUrl"> }) {
  const type = editorialTaskType(task);
  const label = workTaskTypes.find(option => option.value === type)?.label;
  return label ? <span className={styles.taskTypeTag} data-task-type={type}>{label}</span> : null;
}
function TaskLinkIndicator() {
  const { pending } = useLinkStatus();
  return <span className={styles.taskOpen}>
    <span role="status">{pending ? "正在打开…" : "查看详情"}</span>
    <ChevronRight size={16} aria-hidden="true" />
  </span>;
}
const siteName = (domain: string) => sites.find(site => site.value === domain)?.label ?? domain;
const displayTime = (value: string | null | undefined) => value ? `${shanghaiStamp(value)} 北京时间` : "待记录";
const shiftDay = (day: string, offset: number) => new Date(Date.parse(day + "T00:00:00Z") + offset * 86_400_000).toISOString().slice(0, 10);
const currentMonday = () => { const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(new Date()); return shiftDay(today, -((new Date(today + "T00:00:00Z").getUTCDay() + 6) % 7)); };
const pageHref = (url: string, country: string | null) => "/pages?" + new URLSearchParams({ pageUrl: url, ...(country ? { country } : {}) });

export function WorkflowStatus({ status }: { status: string }) {
  return <span className={styles.badge} data-state={status}>{stateLabel(status)}</span>;
}

function TaskStatus({ status }: { status: string }) {
  const tone = { scheduled: "planned", accepted: "running", review: "review_pending", rejected: "failed", failed: "failed", completed: "completed" }[status];
  return <span className={styles.badge} data-state={tone}>{taskStatusLabel(status)}</span>;
}


async function mutateWorkflow(body: object) {
  const response = await fetch("/api/seo/workflow", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.message ?? "保存失败，请保留当前内容后重试。");
  return result;
}

function TaskDetail({ task, tasks, approvals, publications, optimizations, onSaved }: { task: WorkflowTask; tasks: WorkflowTask[]; approvals: WorkflowApproval[]; publications: WorkflowPublication[]; optimizations: WorkflowOptimization[]; onSaved: () => void }) {
  const progress = task.progress?.at(-1);
  const pageDelivery = task.kind === "technical" ? task.channel !== "github" && task.channel !== "product"
    : ["landing", "optimization", "cluster"].includes(task.kind) && (task.changeScope === "search_intent" || task.pageType !== "blog" && !/\/blog(?:\/|$)/.test(task.pageUrl ?? ""));
  const relatedOptimizations = optimizations.filter(row => row.taskId === task.id);
  const evidence = [...(task.research?.evidence ?? []), ...relatedOptimizations.flatMap(row => [...row.baseline.evidence, ...row.evidence]), ...task.evidence, ...(progress?.evidence ?? [])]
    .filter((item, index, all) => all.findIndex(other => other.label === item.label && other.url === item.url && other.artifact === item.artifact) === index);
  const previewUrl = task.artifactUrl;
  const action = task.brief?.plan ?? task.nextAction.trim();
  return <div className={styles.detail}>
    <dl className={styles.metadata}>
      <div><dt>类型</dt><dd>{workTaskTypes.find(item => item.value === editorialTaskType(task))?.label ?? taskKinds[task.kind]}</dd></div>
      <div><dt>业务</dt><dd>{siteName(task.siteDomain)} · {task.business}{task.language ? ` · ${task.language}` : ""}</dd></div>
      <div><dt>时间</dt><dd>{displayTime(task.dueAt)}</dd></div>
      <div><dt>预览地址</dt><dd>{previewUrl ? <SeoAnchor href={previewUrl} target="_blank" rel="noreferrer">{previewUrl} ↗</SeoAnchor> : "暂未生成"}</dd></div>
    </dl>
    <section className={styles.taskContent} aria-label="任务内容">
      <h3>任务内容</h3>
      {task.pageUrl ? <p>目标页面：<SeoAnchor href={task.pageUrl} target="_blank" rel="noreferrer">{task.pageUrl} ↗</SeoAnchor></p> : null}
      <h4>为什么做</h4>
      <p className={styles.taskDescription}>{task.brief?.reason ?? "中文任务说明待补充：请结合证据说明具体问题、影响及处理理由；搜索量和 KD 仅用于判断需求，不能代替页面问题诊断。"}</p>
      {relatedOptimizations.map(({ id, baseline }) => <div key={id}>
        <p className={styles.muted}>{baseline.source} · {baseline.periodStart} — {baseline.periodEnd} · {markets[baseline.country]} · {baseline.device} · {baseline.timezone} · 来源截至 {baseline.sourceDate} · 数据{{ complete: "完整", partial: "部分覆盖", missing: "缺失", unverified: "未核实", not_connected: "未接入" }[baseline.dataStatus]}</p>
        <p>点击 {numberText(baseline.clicks)} · 曝光 {numberText(baseline.impressions)} · CTR {baseline.ctr == null ? "待补" : `${(baseline.ctr * 100).toFixed(2)}%`} · 平均排名 {baseline.averagePosition?.toFixed(1) ?? "待补"} · 自然访问 {numberText(baseline.organicVisits)}</p>
      </div>)}
      {task.kind === "optimization" && !relatedOptimizations.length ? <p className={styles.muted}>结构化优化基线尚未登记，需保留上述来源的具体查询、页面和日期口径，后续再按同口径复盘。</p> : null}
      <details><summary>数据与来源</summary>
        {task.keyword ? <p>目标查询：{task.keyword}</p> : null}
        {task.research ? <p>研究日期 {displayTime(task.research.observedAt)} · 月搜索量 {numberText(task.research.volume)} · KD {numberText(task.research.kd)} · 业务价值 {numberText(task.research.businessValue)} / 3</p> : null}
      <WorkflowEvidence evidence={evidence} />
      {evidence.filter(item => !item.url).map((item, index) => <p className={styles.muted} key={index}>{item.label} · {displayTime(item.observedAt)}</p>)}
      </details>
      <h4>怎么做</h4><p className={styles.taskDescription}>{task.brief?.plan ?? "中文处理方案待补充：请逐项说明针对上述问题要改哪里、如何修改以及如何验证。"}</p>
      {task.maintenance?.refresh ? <div><p><strong>旧文翻新：</strong>保留首发日 {displayTime(task.maintenance.refresh.originalPublishedAt)}，在原URL更新版本 {task.maintenance.refresh.baseContentVersion}。</p><ul>{task.maintenance.refresh.changes.map(change => <li key={change}>{change}</li>)}</ul><p className={styles.muted}>独立翻新额度，沿原任务进行7 / 14 / 28日效果复查。</p></div> : null}
      {task.maintenance?.links?.length ? <div><h4>模型与文章双向关联</h4><ul>{task.maintenance.links.map(link => <li key={`${link.modelUrl}:${link.articleUrl}`}><SeoAnchor href={link.modelUrl} target="_blank" rel="noreferrer">{link.entityId}</SeoAnchor> ↔ <SeoAnchor href={link.articleUrl} target="_blank" rel="noreferrer">{link.articleToModelAnchor}</SeoAnchor> · {link.language}<p>{link.relevance}</p></li>)}</ul></div> : null}
      {task.maintenance?.technical?.length ? <div><h4>技术检查与修复</h4><ul>{task.maintenance.technical.map((check, index) => <li key={`${check.area}:${index}`}><strong>{check.area} · {check.method}</strong><p>{check.before}</p><p>{check.change}</p><p>验证：{check.verify}</p></li>)}</ul></div> : null}
      {task.acceptanceCriteria.length ? <><p><strong>完成标准</strong></p><ul>{task.acceptanceCriteria.map((item, index) => <li key={index}>{item}</li>)}</ul></> : null}
      {progress ? <p className={styles.taskDescription}><strong>当前进展：</strong>{progress.summary}{progress.nextAction && progress.nextAction !== action ? `\n接下来：${progress.nextAction}` : ""}</p> : null}
      {task.failureReason ? <p className={styles.warning}><CircleAlert size={15} />{task.failureReason}</p> : null}
      {task.fallbackReason ? <p className={styles.muted}>{task.fallbackReason}</p> : null}
    </section>
    <details className={styles.taskSupporting}><summary>执行记录与交付</summary>
      <details><summary>原始执行指令</summary><p className={styles.taskDescription}>{task.nextAction}</p></details>
      <p className={styles.muted}>负责人 {task.owner} · 内容版本 {task.contentVersion ?? "尚未制作"} · 最近记录 {displayTime(task.updatedAt)}</p>
      {task.pageUrl ? <p><Link href={pageHref(task.pageUrl, task.country)}>查看已上线页面数据 →</Link></p> : null}
      {task.dependencies.length ? <><h4>前置任务</h4><ul>{task.dependencies.map(id => { const dependency = tasks.find(item => item.id === id); return <li key={id}>{dependency ? <Link href={workTaskHref(dependency)}>{dependency.title}</Link> : id} · {dependency ? stateLabel(dependency.status) : "待核实"}</li>; })}</ul></> : null}
      {task.approval ? <p className={styles.muted}>历史任务审核：{task.approval.approvedBy} · {displayTime(task.approval.approvedAt)} · 版本 {task.approval.contentVersion}。此记录不作为当前页面发布授权。</p> : null}
      {approvals.filter(approval => approval.items.some(item => item.taskId === task.id)).map(approval => <p key={approval.id}><Link href={`/approvals?approvalId=${encodeURIComponent(approval.id)}`}>{approval.title} →</Link></p>)}
      {pageDelivery ? <PageDeliveryActions key={`${task.id}:${task.version}`} task={task} approvals={approvals} publications={publications} mutate={mutateWorkflow} onSaved={onSaved} /> : null}
      {relatedOptimizations.map(row => <OptimizationHistory key={row.id} optimization={row} />)}
    </details>
  </div>;

}

function OptimizationComparison({ comparison }: { comparison: NonNullable<WorkflowOptimization["observations"][number]["comparison"]> }) {
  const labels = comparison.source === "GSC" ? { clicks: "点击", impressions: "曝光", ctr: "CTR", averagePosition: "页面平均排名", targetKeywordAveragePosition: "目标词平均排名" } : { organicVisits: "自然访问", registrations: "注册", activation: "首次成功激活", payment: "付费用户" };
  const format = (key: string, value: number | null) => value == null ? "未接入 / 缺失" : key === "ctr" ? `${(value * 100).toFixed(2)}%` : key.toLowerCase().includes("position") ? value.toFixed(1) : numberText(value);
  return <div className={styles.comparison}>
    <p><strong>{comparison.source}</strong> · {comparison.timezone} · {markets[comparison.country]} · {comparison.device} · {{ comparable: "可比", partial: "部分覆盖", not_comparable: "不可比" }[comparison.status]}</p>
    <p>目标词：{comparison.targetKeyword} · 修改版本 {comparison.changeId}</p>
    <div className={styles.tableScroll}><table><thead><tr><th>指标</th><th>优化前</th><th>优化后</th></tr></thead><tbody>
      <tr><th>窗口 / 实际覆盖</th><td>{comparison.before.periodStart} — {comparison.before.periodEnd}<br />{comparison.before.actualDays.length} 日 · 来源截至 {comparison.before.sourceDate}</td><td>{comparison.after.periodStart} — {comparison.after.periodEnd}<br />{comparison.after.actualDays.length} 日 · 来源截至 {comparison.after.sourceDate}</td></tr>
      {Object.entries(labels).map(([key, label]) => <tr key={key}><th>{label}</th><td>{format(key, comparison.before.metrics[key as keyof typeof comparison.before.metrics])}</td><td>{format(key, comparison.after.metrics[key as keyof typeof comparison.after.metrics])}</td></tr>)}
    </tbody></table></div>
    <details><summary>实际覆盖日期</summary><p>前：{comparison.before.actualDays.join("、") || "尚无已出数日期"}</p><p>后：{comparison.after.actualDays.join("、") || "尚无已出数日期"}</p></details>
    {comparison.reason ? <p className={styles.warning}>{comparison.reason}</p> : null}<WorkflowEvidence evidence={comparison.evidence} />
  </div>;
}

function HistoricalDeliveries({ archive, country, language, business }: { archive: WorkflowHistoricalImport; country: string; language: string; business: string }) {
  const pages = archive.publications.filter(page => (country === "all" || page.country === country) && (language === "all" || page.language === language) && (business === "all" || archive.sourceTasks.find(task => task.id === page.sourceTaskId)?.business === business));
  const live = pages.filter(page => page.verificationState === "live_verified").length;
  return <details className={styles.record}>
    <summary><span><strong>历史交付与证据 · {archive.sourceSnapshotAt.slice(0, 10)}</strong><small>{siteName(archive.siteDomain)} · {pages.filter(page => page.kind === "source_blog").length} 篇源文 / {pages.filter(page => page.kind === "translation").length} 篇翻译 · 只读归档</small></span><span className={styles.badge}>历史补录</span></summary>
    <div className={styles.detail}>
      <p>{archive.notes}</p><p>当前筛选：明确线上核验 {live} 页 · 归档证据核验 {pages.filter(page => page.verificationState === "artifact_verified").length} 页 · 仅有发布记录 {pages.filter(page => page.verificationState === "published_unverified").length} 页 · 未取得首次验收时间 {pages.filter(page => !page.firstVerifiedAt).length} 页。</p>
      <p className={styles.muted}>归档不生成新的执行或发布授权；未核实的国家和关键词保持为空，也不计入上方本周验收交付数。</p>
      <p>原运行 {archive.sourceRunId} · 原状态 {archive.sourceRunStatus} · 开始 {displayTime(archive.sourceStartedAt)} · 结束 {displayTime(archive.sourceCompletedAt)}</p>
      <details><summary>归档整体审查与待审核稿</summary><p>已尝试 {archive.auditBacklog.attempted} 页 · 已完成 {archive.auditBacklog.completed} 页 · 待补证据 {archive.auditBacklog.pending} 页。</p><WorkflowEvidence evidence={archive.auditBacklog.evidence} /><p>具体版本待审 {archive.pendingRevisions.count} 页 · CMS 改动 {archive.pendingRevisions.cmsModified} 页 · 原表行号 {archive.pendingRevisions.externalRows.join("、") || "无"}。</p><WorkflowEvidence evidence={archive.pendingRevisions.evidence} /></details>
      <div className={styles.tableScroll}><table><thead><tr><th>页面</th><th>语言 / 国家</th><th>证据状态</th><th>发布 / 验收时间</th></tr></thead><tbody>{pages.map(page => <tr key={page.id}>
        <td><SeoAnchor href={page.pageUrl} target="_blank" rel="noreferrer">{page.title} ↗</SeoAnchor><small>{page.kind === "source_blog" ? "源文" : "翻译"} · {page.keyword ?? "关键词待核实"}</small><details><summary>页面证据</summary><WorkflowEvidence evidence={page.evidence} /></details></td>
        <td>{page.language} / {page.country ? markets[page.country] : "未核实"}</td><td>{{ live_verified: "明确线上核验", artifact_verified: "归档证据核验", published_unverified: "发布待核验" }[page.verificationState]}</td>
        <td>发布 {displayTime(page.publishedAt)}<br />首次验收 {displayTime(page.firstVerifiedAt)}<br />最近核验 {displayTime(page.verifiedAt)}<br />证据入库 {displayTime(page.verificationRecordedAt)}</td>
      </tr>)}</tbody></table></div>{!pages.length ? <p className={styles.muted}>此筛选暂无已核实匹配页面；历史记录不会猜测国家或语言。</p> : null}
      <WorkflowEvidence evidence={archive.evidence} />
    </div>
  </details>;
}

function IssueTaskForm({ issue, weekStart, existingTask, onSaved }: { issue: WorkflowIssue; weekStart: string; existingTask?: WorkflowTask; onSaved: () => void }) {
  const dataIssue = ["data", "business", "sync"].includes(issue.category);
  const [owner, setOwner] = useState(issue.owner), [due, setDue] = useState(weekStart), [business, setBusiness] = useState(issue.siteDomain === "flatkey.ai" ? "API" : "CLUSTER");
  const [nextAction, setNextAction] = useState(issue.nextAction || `核查「${issue.title}」的来源证据，定位原因并提出可验收的修复。`);
  const [savedTask, setSavedTask] = useState<WorkflowTask | undefined>(existingTask), [message, setMessage] = useState("");
  const action = useActionFeedback("正在保存任务与问题关联…"), busy = action.pending;
  const attempt = useRef<{ requestId: string; action: string; expectedVersion: number; record: object } | null>(null);
  async function save(event: FormEvent) {
    event.preventDefault(); if (!action.start()) return; setMessage("");
    let task = savedTask;
    try {
      if (!task) {
        if (!attempt.current) {
          const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(issue.id)))).map(value => value.toString(16).padStart(2, "0")).join("").slice(0, 32);
          attempt.current = { requestId: crypto.randomUUID(), action: "save_task", expectedVersion: 0, record: {
            id: `issue-task-${hash}`, weekStart, title: `${dataIssue ? "数据核查" : "技术修复"} · ${issue.title}`.slice(0, 500), siteDomain: issue.siteDomain,
            kind: "technical", country: null, language: null, business, pageType: "technical", keyword: null, pageUrl: issue.pageUrl,
            owner: owner.trim(), dueAt: `${due}T16:00:00+08:00`, status: "planned", dependencies: [], contentVersion: null,
            evidence: [...issue.evidence.slice(0, 99), { label: "问题转任务", artifact: `issue:${issue.id}`, observedAt: new Date().toISOString() }],
            nextAction: nextAction.trim(), acceptanceCriteria: ["保留原问题、影响范围和复现 / 来源证据", "完成修复并保存恢复验证结果；验证通过后再关闭原问题"], source: "human",
          } };
        }
        const snapshotResponse = await fetch("/api/seo/workflow?allHistory=true", { cache: "no-store" });
        if (!snapshotResponse.ok) throw new Error("保存前无法核对是否已有问题任务，请重试。");
        const snapshot = await snapshotResponse.json() as WorkflowSnapshot;
        task = snapshot.tasks.find(row => row.id === (attempt.current!.record as { id: string }).id);
        if (task && (task.siteDomain !== issue.siteDomain || !task.evidence.some(item => item.artifact === `issue:${issue.id}`))) throw new Error("已有任务身份与原问题不一致，请保留记录后核查。");
        if (!task) {
          const result = await mutateWorkflow(attempt.current);
          task = result.record as WorkflowTask;
        }
        setSavedTask(task);
      }
      const { version, updatedAt: _updatedAt, recordedAt: _recordedAt, ...record } = issue;
      await mutateWorkflow({ requestId: crypto.randomUUID(), action: "save_issue", expectedVersion: version, record: { ...record, taskId: task.id } });
      setMessage("任务与原问题已关联。原问题状态、证据及历史均保留，尚未标记修复完成。"); actionSucceeded("任务与原问题已关联。"); onSaved();
    } catch (error) {
      const reason = error instanceof Error ? error.message : "暂时无法保存。";
      const message = task ? `任务 ${task.id} 已保存，问题关联待补：${reason} 请刷新核对原问题版本后重试，勿重复建任务。` : `${reason} 当前输入与请求已保留，可重试；若记录已存在，请刷新以恢复已保存任务。`;
      setMessage(message); actionFailed(message);
    } finally { action.finish(); }
  }
  return <form className={styles.reviewForm} onSubmit={event => void save(event)}>
    <h4>{savedTask ? "补齐问题关联" : `创建${dataIssue ? "数据核查" : "技术修复"}任务`}</h4>
    <p className={styles.muted}>保留原问题 {issue.id}（版本 {issue.version}）。此任务不强填国家、语言或关键词；创建后仍需实际执行与恢复验收。</p>
    {savedTask ? <p>已保存任务：<Link href={workTaskHref(savedTask)}>{savedTask.title}</Link></p> : <div className={styles.formGrid}>
      <label>负责人<input required value={owner} maxLength={200} disabled={busy || Boolean(attempt.current)} onChange={event => setOwner(event.target.value)} /></label>
      <label>计划交付日（北京时间 16:00）<input type="date" required min={weekStart} max={shiftDay(weekStart, 6)} value={due} disabled={busy || Boolean(attempt.current)} onChange={event => setDue(event.target.value)} /></label>
      <label>业务线<UiSelect aria-label="问题任务业务线" value={business} onChange={setBusiness} disabled={busy || Boolean(attempt.current)} options={["API", "GPU", "CLUSTER"].map(value => ({ value, label: value === "CLUSTER" ? "集群" : value }))} /></label>
      <label className={styles.spanAll}>执行步骤<textarea required maxLength={3000} rows={3} value={nextAction} disabled={busy || Boolean(attempt.current)} onChange={event => setNextAction(event.target.value)} /></label>
    </div>}
    <FeedbackButton type="submit" className={styles.primary} pending={busy} pendingLabel="正在保存…">{savedTask ? "重试关联原问题" : attempt.current ? "重试保存与关联" : "创建任务并关联"}</FeedbackButton>
    {message ? <p role="status">{message}</p> : null}
  </form>;
}

export function OptimizationHistory({ optimization }: { optimization: WorkflowOptimization }) {
  const baseline = optimization.baseline;
  return <details className={styles.record}>
    <summary><span><strong>{optimization.keyword}</strong><small>{siteName(optimization.siteDomain)} · {markets[optimization.country]} · {optimization.pageUrl}</small></span><WorkflowStatus status={optimization.status} /></summary>
    <div className={styles.detail}><p>{optimization.objective}</p><Link href={pageHref(optimization.pageUrl, optimization.country)}>查看页面实际效果 →</Link>
      <h4>优化前基线</h4><p>{baseline.periodStart} — {baseline.periodEnd} · {baseline.source} · 来源截至 {baseline.sourceDate} · {baseline.timezone} · {baseline.device}</p>
      <p className={styles.muted}>数据状态：{{ complete: "完整", partial: "部分", missing: "缺失", unverified: "未核实", not_connected: "未接入" }[baseline.dataStatus]}。首次基线保留，后续修改追加版本。</p>
      <dl className={styles.metadata}><div><dt>点击 / 曝光</dt><dd>{numberText(baseline.clicks)} / {numberText(baseline.impressions)}</dd></div><div><dt>CTR / 平均排名</dt><dd>{baseline.ctr == null ? "—" : (baseline.ctr * 100).toFixed(2) + "%"} / {baseline.averagePosition?.toFixed(1) ?? "—"}</dd></div><div><dt>自然访问 / 注册</dt><dd>{numberText(baseline.organicVisits)} / {numberText(baseline.registrations)}</dd></div><div><dt>激活 / 付费</dt><dd>{numberText(baseline.activation)} / {numberText(baseline.payment)}</dd></div></dl><WorkflowEvidence evidence={baseline.evidence} />
      <h4>修改时间线</h4>{optimization.changes.length ? <ol className={styles.timeline}>{optimization.changes.map(change => <li key={change.id}><strong>{displayTime(change.changedAt)} · {change.contentVersion}</strong><p>{change.description}</p><p className={styles.muted}>{change.publicationId ? `关联发布回执：${change.publicationId}` : "尚未关联发布回执，不能计为上线优化"}</p><WorkflowEvidence evidence={change.evidence} /></li>)}</ol> : <p className={styles.muted}>尚无已登记的修改版本。</p>}
      <h4>7 / 14 / 28 日复盘（保留历史56日）</h4>{(["7", "14", "28", "56"] as const).map(days => { const observation = optimization.observations.filter(row => row.windowDays === days).sort((a, b) => b.checkedAt.localeCompare(a.checkedAt))[0]; return <div key={days} className={styles.observation}><strong>{days} 日</strong>{observation ? <><WorkflowStatus status={observation.status} /><p>{observation.note}</p><p className={styles.muted}>可比 {observation.comparableDays} 天 · 检查于 {displayTime(observation.checkedAt)}</p>{observation.comparison ? <OptimizationComparison comparison={observation.comparison} /> : <p className={styles.muted}>此历史记录仅有复盘说明，未保存数值对比窗口。</p>}<WorkflowEvidence evidence={observation.evidence} /></> : <p className={styles.muted}>尚无该窗口复盘证据。数据齐全后再判断效果。</p>}</div>; })}
    </div>
  </details>;
}


const workViews = {
  tasks: "工作任务",
  deliveries: "发布记录",
  optimizations: "页面优化",
  issues: "问题处理",
  runs: "运行日志",
} as const;

export function SeoWorkWorkspace({ view = "tasks", embedded = false }: { view?: keyof typeof workViews; embedded?: boolean }) {
  const [country] = useSeoCountry();
  const params = useSearchParams();
  const router = useRouter();
  const isTaskList = view === "tasks";
  const week = (isTaskList ? null : params.get("week")) ?? "current";
  const site = (isTaskList ? null : params.get("site")) ?? "all";
  const business = (isTaskList ? null : params.get("business")) ?? "all";
  const language = (isTaskList ? null : params.get("language")) ?? "all";
  const requestedStatus = params.get("status") ?? (isTaskList ? "active" : "all"), tab = view;
  const status = isTaskList ? taskFilterStatus(requestedStatus) : requestedStatus;
  const Container = embedded ? "section" : "main";
  const requestedTaskType = params.get("taskType");
  const taskType = workTaskTypes.find(option => option.value === requestedTaskType)?.value ?? "all";
  const title = workViews[view], detailedFilters = !["issues", "runs"].includes(view);
  const [query, setQuery] = useState(params.get("q") ?? ""), [monday] = useState(currentMonday);
  const filter = (key: string, value: string) => { const params = new URLSearchParams(location.search); const defaultValue = isTaskList && key === "status" ? "active" : "all"; if (value === defaultValue) params.delete(key); else params.set(key, value); history.pushState(null, "", location.pathname + (params.size ? "?" + params : "") + location.hash); dispatchEvent(new PopStateEvent("popstate")); };
  const time = useSeoListDateRange(isTaskList ? "work" : "calendar");
  const snapshotResult = useSeoRead<WorkflowSnapshot>(isTaskList ? null : `/api/seo/workflow?week=${encodeURIComponent(week)}`);
  const listResult = useSeoRead<WorkflowWorkList>(isTaskList ? "/api/seo/workflow?operational=1&workList=1&format=list" : null);
  const result = isTaskList ? listResult : snapshotResult;
  const relatedTaskHistory = useSeoRead<WorkflowSnapshot>(view === "issues" ? "/api/seo/workflow?allHistory=true" : null);
  const data = snapshotResult.data;
  const current = isTaskList ? listResult.data : data;
  const relatedTasks = [...(data?.tasks ?? []), ...(relatedTaskHistory.data?.tasks ?? [])];
  const matchesScope = (record: { siteDomain: string; country?: string | null; language?: string | null }) => (site === "all" || record.siteDomain === site) && (country === "all" || record.country === country) && (language === "all" || record.language === language);
  const taskScope = current?.tasks.filter(task => matchesScope(task) && (business === "all" || task.business === business)) ?? [];

  const taskFilters = new URLSearchParams(params.toString());
  if (query) taskFilters.set("q", query); else taskFilters.delete("q");
  const reviews = new Map(listResult.data?.tasks.flatMap(task => task.review ? [[task.id, task.review] as const] : []) ?? []);
  const overdue = new Set(current?.workWeek?.overdueTaskIds);
  const displayStatus = (task: WorkflowTask | WorkflowListTask) => "displayStatus" in task ? task.displayStatus : workTaskStatus(task, data);
  const tasks = taskScope.filter(task => {
    const state = displayStatus(task);
    const type = editorialTaskType(task);
    return (taskType === "all" || type === taskType)
      && (time.preset === "week" && overdue.has(task.id) || dateInListRange(task.dueAt, time.range))
      && (status === "all" || (status === "active" ? state !== "completed" : state === status))
      && [task.title, task.keyword, task.pageUrl, task.owner, reviews.get(task.id)?.title].some(value => value?.toLowerCase().includes(query.toLowerCase()));
  });
  const listedReviews = new Set<string>();
  const taskRows = tasks.filter(task => {
    const review = reviews.get(task.id);
    if (!review) return true;
    if (listedReviews.has(review.key)) return false;
    listedReviews.add(review.key);
    return true;
  });
  const scopedIds = new Set(taskScope.map(task => task.id));
  const publications = data?.publications.filter(record => matchesScope(record) && (business === "all" || scopedIds.has(record.taskId))) ?? [];
  const optimizations = data?.optimizations.filter(record => matchesScope(record) && (business === "all" || scopedIds.has(record.taskId))) ?? [];
  const issueScope = data?.issues.filter(record => site === "all" || record.siteDomain === site) ?? [];
  const issues = issueScope.filter(issue => (status === "all" || issue.status === status) &&
    [issue.title, issue.owner, issue.pageUrl].some(value => value?.toLowerCase().includes(query.trim().toLowerCase())));
  useEffect(() => {
    if (embedded || !current) return;
    function revealRecord() {
      const id = location.hash.slice(1);
      if (view === "tasks" && id.startsWith("task-")) {
        const legacyTask = current?.tasks.find(task => "task-" + task.id === id || "task-" + encodeURIComponent(task.id) === id);
        if (legacyTask) router.replace(workTaskHref(legacyTask, new URLSearchParams(location.search)));
        return;
      }
      if (!id.startsWith("issue-")) return;
      const record = document.getElementById(id);
      if (record instanceof HTMLDetailsElement) {
        record.open = true;
        record.scrollIntoView({ block: "start" });
      }
    }
    revealRecord();
    window.addEventListener("hashchange", revealRecord);
    return () => window.removeEventListener("hashchange", revealRecord);
  }, [current, embedded, router, view]);
  const siteTaskIds = new Set(data?.tasks.filter(task => site === "all" || task.siteDomain === site).map(task => task.id));
  const runs = data?.runs.filter(record => site === "all" || record.taskIds.some(id => siteTaskIds.has(id))) ?? [];
  const verified = publications.filter(record => record.status === "verified");
  const chosenWeek = current?.weekStart ?? (week === "next" ? shiftDay(monday, 7) : /^\d{4}-\d{2}-\d{2}$/.test(week) ? week : monday);
  return <Container className={embedded ? styles.embedded : workspace.shell}>
    {!embedded ? <PageHeader active={view === "tasks" ? "work" : view} /> : null}
    {!embedded ? <div className={workspace.titleRow}>
      <h1 className={workspace.title}>{title}</h1>
      <div className={styles.toolbarActions}>
        {isTaskList ? <Link className={styles.secondary} href={country === "all" ? "/deliveries" : `/deliveries?country=${country}`}>发布记录</Link> : null}
        {view === "deliveries" ? <Link className={styles.secondary} href={country === "all" ? "/work" : `/work?country=${country}`}>返回工作任务</Link> : null}
        <FeedbackButton type="button" className={styles.secondary} onClick={result.retry} pending={result.pending} pendingLabel="正在刷新…"><RefreshCw size={14} aria-hidden="true" />刷新</FeedbackButton>
      </div>
    </div> : null}
    {!embedded && !isTaskList ? <div className={styles.filters}>
      <UiSelect aria-label="工作周" value={week} onChange={value => filter("week", value)} options={[{ value: "current", label: "本周" }, { value: "next", label: "下周" }, { value: shiftDay(monday, -7), label: "上周" }, ...(!["current", "next", shiftDay(monday, -7)].includes(week) ? [{ value: week, label: week }] : [])]} />
      <UiSelect aria-label="工作站点" value={site} onChange={value => filter("site", value)} options={[{ value: "all", label: "全部五站" }, ...sites]} />
      {detailedFilters ? <><UiSelect aria-label="业务线筛选" value={business} onChange={value => filter("business", value)} options={[{ value: "all", label: "全部业务" }, { value: "API", label: "API" }, { value: "GPU", label: "GPU" }, { value: "CLUSTER", label: "集群" }]} />
      <UiSelect aria-label="页面语言筛选" value={language} onChange={value => filter("language", value)} options={[{ value: "all", label: "全部语言" }, ...languages]} /></> : null}
    </div> : null}
    {view === "runs" ? <SeoAutomationSchedule /> : null}
    {result.error ? <div className={styles.empty} role="alert"><h2>{title}暂时无法读取</h2><p>{result.error}</p><FeedbackButton className={styles.secondary} onClick={result.retry} pending={result.pending} pendingLabel="正在读取…">重新读取</FeedbackButton></div> : !current ? <ReportLoading label={`正在读取${title}`} /> : <>
      {current.storage === "local_preview" ? <p className={styles.warning}>本地预览 · 操作仅保存到本地。</p> : null}
      {view === "issues" ? <section className={styles.summary} aria-label="问题摘要">
        {["open", "investigating", "blocked", "resolved"].map(status => <div key={status}><span>{stateLabel(status)}</span><strong>{issueScope.filter(issue => issue.status === status).length}</strong></div>)}
      </section> : view === "deliveries" ? <section className={`${styles.summary} ${styles.summaryPair}`} aria-label="发布验收摘要">
        <div><span>已验收源文 / 翻译</span><strong>{verified.filter(row => row.kind === "source_blog").length}<em> / {verified.filter(row => ["translation", "backfill_translation"].includes(row.kind)).length}</em></strong><small>只统计正式链接验收成功</small></div>
        <div><span>已验收落地页 / 优化页</span><strong>{new Set(verified.filter(row => row.kind === "landing").map(row => row.pageUrl)).size}<em> / {new Set(verified.filter(row => row.kind === "optimization").map(row => row.pageUrl)).size}</em></strong><small>同一页面去重，修改版本保留</small></div>
      </section> : null}
      {tab === "tasks" ? <section className={styles.listPanel} aria-labelledby="work-list-title">
        <div className={styles.sectionHeading}><h2 id="work-list-title">任务列表</h2><span className={styles.count}>{taskRows.length} 项</span></div>
        <p className={styles.muted}>任务排期、日期筛选与执行时间均按北京时间（UTC+8），工作周为周五至周四。{time.preset === "week" && time.range ? `本周 ${time.range.start} — ${time.range.end}，另含此前未完成的延期任务。` : ""}</p>
        <div className={styles.taskFilters}><UiSelect aria-label="任务类型筛选" value={taskType} onChange={value => filter("taskType", value)} options={workTaskTypes} /><input aria-label="搜索工作任务" value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索关键词、页面、任务或负责人" /><SeoListDateControl value={time} /><UiSelect aria-label="任务状态筛选" value={status} onChange={value => filter("status", value)} options={taskStatusOptions} /></div>
        {taskRows.length ? <div className={styles.records}>{taskRows.map(task => {
          const review = reviews.get(task.id);
          const delayed = overdue.has(task.id) || Boolean(review && taskScope.some(other => reviews.get(other.id)?.key === review.key && overdue.has(other.id)));
          const delayBadge = delayed ? <span className={styles.badge} data-state="review_pending">延期</span> : null;
          const rowStatus = displayStatus(task);
          const rollbackPending = current.workWeek?.pendingRollbackTaskIds.includes(task.id);
          if (review) return <Link className={styles.taskLink} href={`/approvals?approvalId=${encodeURIComponent(review.id)}`} key={review.key} prefetch={false}>
            <span><strong>{review.title}</strong><small className={styles.taskContext}><span className={styles.siteTag} title={task.siteDomain}>{siteName(task.siteDomain)}</span><EditorialTaskTag task={task} /><span>{review.languages.length} 个语言 · {review.languages.join("、")}</span></small></span>
            <span className={styles.taskMeta}>{delayBadge}<TaskStatus status="review" /></span>
            <TaskLinkIndicator />
          </Link>;
          return <Link
          className={styles.taskLink} href={workTaskHref(task, taskFilters)} id={`task-${task.id}`} key={task.id} prefetch={false}>
          <span><strong>{task.title}</strong><small className={styles.taskContext}><span className={styles.siteTag} title={task.siteDomain}>{siteName(task.siteDomain)}</span><EditorialTaskTag task={task} /><span>{task.keyword ?? "不适用关键词"} · {task.country ? markets[task.country] : "全站"} · {task.language ?? "不限语言"}</span></small>{rollbackPending ? <small>下一步：撤销未通过审核的发布</small> : rowStatus === "failed" || delayed && task.nextAction ? <small className={styles.taskDiagnostic}>{task.failureReason} {task.nextAction ? `下一步：${task.nextAction}` : ""}</small> : null}</span>
          <span className={styles.taskMeta}>{delayBadge}<TaskStatus status={rowStatus} /><small>{delayed ? "原计划 " : ""}{displayTime(task.dueAt)} · {task.owner}</small>{delayed && current.workWeek?.catchUpDate ? <small>补齐跟进 {current.workWeek.catchUpDate} 北京时间</small> : null}</span>
          <TaskLinkIndicator />
          </Link>;
        })}</div> : <p className={styles.empty}>当前筛选范围没有已登记任务。</p>}
      </section> : null}
      {tab === "deliveries" ? <section aria-label="正式页面发布验收"><p className={styles.muted}>发布成功和验收成功分别保留。翻译、历史补译和源文单独统计；Sitemap 首次发现不计为发布。</p>{publications.length ? publications.map(record => <details key={record.id} className={styles.record}><summary><span><strong>{record.title}</strong><small>{publicationKinds[record.kind]} · {siteName(record.siteDomain)} · {record.language}</small></span><WorkflowStatus status={record.status} /></summary><div className={styles.detail}><SeoAnchor href={record.pageUrl} target="_blank" rel="noreferrer">{record.pageUrl} ↗</SeoAnchor><p>发布 {displayTime(record.publishedAt)} · 验收 {displayTime(record.verifiedAt)} · 版本 {record.contentVersion}</p><p>目标词：{record.keyword ?? "未核实"} · {record.country ? markets[record.country] : "未指定目标市场"}</p>{record.failureReason ? <p className={styles.warning}>{record.failureReason}</p> : null}{record.liveCheck ? <p><CheckCircle2 size={14} /> 正式内容、canonical、语言与链接已核对。此检查不等于 Google 已收录。</p> : <p className={styles.muted}>尚无正式页验收记录。</p>}<WorkflowEvidence evidence={record.evidence} />{record.approvalId ? <p><Link href={`/approvals?approvalId=${encodeURIComponent(record.approvalId)}`}>查看此次发布审批 →</Link></p> : <p className={styles.muted}>历史发布尚无本次规则的审批关联，不作为新发布授权。</p>}<Link href={pageHref(record.pageUrl, record.country)}>进入页面效果 →</Link></div></details>) : <p className={styles.empty}>尚无此范围的发布回执。</p>}{(data?.historicalImports ?? []).filter(archive => site === "all" || archive.siteDomain === site).map(archive => <HistoricalDeliveries key={archive.id} archive={archive} country={country} language={language} business={business} />)}</section> : null}
      {tab === "optimizations" ? <section aria-label="优化版本与观察窗口">{optimizations.length ? optimizations.map(row => <OptimizationHistory key={row.id} optimization={row} />) : <p className={styles.empty}>尚无此范围的优化记录。先保存优化前基线，审核稿、上线回执和后续观察会关联到同一页面。</p>}</section> : null}
      {tab === "issues" ? <section className={styles.listPanel} aria-labelledby="issue-list-title">
        <div className={styles.sectionHeading}><h2 id="issue-list-title">问题台账</h2><span className={styles.count}>{issues.length} 项</span></div>
        <div className={styles.taskFilters}>
          <input aria-label="搜索问题" value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索问题、页面或负责人" />
          <UiSelect aria-label="问题状态筛选" value={status} onChange={value => filter("status", value)} options={[{ value: "all", label: "全部状态" }, ...["open", "investigating", "blocked", "resolved"].map(value => ({ value, label: stateLabel(value) }))]} />
        </div>
        {issues.length ? issues.map(issue => <details id={`issue-${issue.id}`} key={issue.id} className={styles.record}><summary><span><strong><span className={styles.priority} data-priority={issue.priority}>{issue.priority}</span>{issue.title}</strong><small>{siteName(issue.siteDomain)} · {issueCategories[issue.category]} · {issue.owner}{issue.id === legacyMeasurementIssueId ? " · 历史待同步" : ""}</small></span><WorkflowStatus status={issue.status} /></summary><div className={styles.detail}><p className={styles.muted}>首次发现 {displayTime(issue.firstSeenAt)}</p>{issue.id === legacyMeasurementIssueId ? <p className={styles.muted}>此为历史接入记录。后续行为与转化分析统一使用 GA4，归因与观察窗口待核验。</p> : null}<h4>影响范围</h4><p>{issue.impact}</p><h4>下一步</h4><p>{issue.nextAction || "待补充"}</p>{issue.pageUrl ? <SeoAnchor href={issue.pageUrl} target="_blank" rel="noreferrer">{issue.pageUrl} ↗</SeoAnchor> : null}<WorkflowEvidence evidence={issue.evidence} />{issue.taskId ? (() => { const linkedTask = relatedTasks.find(task => task.id === issue.taskId); return linkedTask ? <Link href={workTaskHref(linkedTask)}>查看关联任务 →</Link> : <p className={styles.muted}>关联任务 {issue.taskId} {relatedTaskHistory.error ? "暂时无法读取" : relatedTaskHistory.data ? "未找到，需核查关联记录" : "正在跨周核对"}。<FeedbackButton type="button" className={styles.secondary} onClick={relatedTaskHistory.retry} pending={relatedTaskHistory.pending} pendingLabel="正在读取…">重新核对任务</FeedbackButton></p>; })() : issue.status !== "resolved" ? <IssueTaskForm key={`${issue.id}:${issue.version}`} issue={issue} weekStart={chosenWeek} existingTask={relatedTasks.find(task => task.evidence.some(item => item.artifact === `issue:${issue.id}`))} onSaved={() => { result.retry(); relatedTaskHistory.retry(); }} /> : null}{issue.resolvedAt ? <><p>恢复于 {displayTime(issue.resolvedAt)}</p><WorkflowEvidence evidence={issue.resolutionEvidence} /></> : null}</div></details>) : <p className={styles.empty}>{issueScope.length ? "当前筛选没有匹配的问题。" : "所选范围暂无问题记录，巡检进度见运行回执。"}</p>}
        <details className={styles.listNote}><summary>问题状态与证据</summary><p>线上状态与 Google 索引版本分别留存证据。创建任务后，仍需完成修复和恢复验收。</p></details>
      </section> : null}
      {tab === "runs" ? <section aria-label="运行回执"><div className={styles.sectionHeading}><h2>阶段运行与来源日期</h2></div><p className={styles.muted}>以下为实际执行回执。任务排期、开始运行和成功完成是不同状态；未关联具体站点任务的全局回执在“全部五站”中查看。</p>{runs.length ? runs.map(run => <details key={run.id} className={styles.record}><summary><span><strong>{stageNames[run.stage] ?? run.stage}</strong><small>{displayTime(run.scheduledFor)} · {run.owner}</small></span><WorkflowStatus status={run.status} /></summary><div className={styles.detail}><p><Clock3 size={14} />开始 {displayTime(run.startedAt)} · 完成 {displayTime(run.completedAt)}</p><p>完成 {run.completedItems} / 核查 {run.checkedItems} 项 · 覆盖 {({ full: "完整", partial: "部分", unknown: "未核实" }[run.coverage])} · 费用 {run.costMicros == null ? "未提供" : `$${(run.costMicros / 1e6).toFixed(4)}`}</p>{run.failureReason ? <p className={styles.warning}>{run.failureReason}</p> : null}<p>下一步：{run.nextAction || "无待办记录"}</p><h4>来源截至日期</h4>{Object.keys(run.sourceDates).length ? <dl className={styles.metadata}>{Object.entries(run.sourceDates).map(([source, date]) => <div key={source}><dt>{source}</dt><dd>{date ?? "待更新"}</dd></div>)}</dl> : <p className={styles.muted}>该回执尚未提供来源日期。</p>}<WorkflowEvidence evidence={run.evidence} /><p className={styles.muted}>输入版本 {run.inputVersion} · 回执 {run.id}</p></div></details>) : <p className={styles.empty}>此范围尚无阶段执行回执，不能据定时配置判断已完成。</p>}</section> : null}
    </>}
    {!embedded && !isTaskList && data ? <p className={styles.footer}>读取于 {displayTime(data.generatedAt)} · <SeoAnchor href="https://alidocs.dingtalk.com/i/nodes/jb9Y4gmKWrQa6B4mHrdNPxke8GXn6lpz" target="_blank" rel="noreferrer">数据基础 ↗</SeoAnchor></p> : null}
  </Container>;
}

export function WorkTaskPage({ taskId, listHref }: { taskId: string; listHref: string }) {
  const router = useRouter();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const deletion = useActionFeedback("正在删除任务…"), deleting = deletion.pending;
  const [deleteError, setDeleteError] = useState("");
  async function deleteTask(task: WorkflowTask) {
    if (!deletion.start()) return;
    setDeleteError("");
    const { version, recordedAt: _recordedAt, updatedAt: _updatedAt, ...record } = task;
    try {
      const receipt = await mutateWorkflow({ requestId: crypto.randomUUID(), action: "save_task",
        expectedVersion: version, record: { ...record, deletedAt: new Date().toISOString() } });
      if (receipt.stored !== true) throw new Error("未确认删除，请刷新后重试。");
      actionSucceeded("任务已删除。");
      router.replace(listHref);
      router.refresh();
    } catch (error) {
      const message = error instanceof Error ? error.message : "删除失败，请重试。";
      setDeleteError(message); actionFailed(message); deletion.finish();
    }
  }

  const result = useSeoRead<WorkflowTaskDetail>(`/api/seo/workflow?taskId=${encodeURIComponent(taskId)}`);
  const task = result.data?.task;
  const pending = task ? pendingTaskApproval(task, result.data?.approvals ?? []) : null;
  const pendingReview = pending && approvalReviewReadiness(pending.item).ready ? pending : null;
  return <main className={workspace.shell}>
    <PageHeader active="work" />
    <div className={workspace.titleRow}>
      <Link className={styles.secondary} href={listHref}>← 返回任务列表</Link>
    </div>
    {result.error ? <div className={styles.empty} role="alert"><p>{result.error}</p><FeedbackButton className={styles.secondary} onClick={result.retry} pending={result.pending} pendingLabel="正在读取…">重新读取</FeedbackButton></div>
      : !result.data ? <ReportLoading label="正在读取任务" />
      : !task ? <p className={styles.empty}>找不到这条任务。</p>
      : <article className={styles.listPanel}>
        <div className={styles.sectionHeading}>
          <h1 className={workspace.title}>{task.title}</h1>
          <div className={styles.toolbarActions}>
            <EditorialTaskTag task={task} />
            <TaskStatus status={workTaskStatus(task, result.data)} />
            {confirmDelete ? <>
              <button className={styles.secondary} disabled={deleting} onClick={() => setConfirmDelete(false)} type="button">取消</button>
              <button className={styles.secondary} disabled={deleting} onClick={() => void deleteTask(task)} type="button">
                {deleting ? "正在删除…" : "确认删除任务"}
              </button>
            </> : <button className={styles.secondary} onClick={() => setConfirmDelete(true)} type="button">删除任务</button>}
            {pendingReview ? <Link className={styles.primary} href={"/approvals?" + new URLSearchParams({ approvalId: pendingReview.approval.id, taskId: task.id, review: "1" })}>审核任务</Link> : null}
          </div>
        </div>
        {deleteError ? <p className={styles.warning} role="alert">{deleteError}</p> : null}
        {pendingReview ? <div className={styles.detail}><ReviewChangeSummary item={pendingReview.item} /></div>
          : <TaskDetail task={task} tasks={result.data.dependencies} approvals={result.data.approvals}
              publications={result.data.publications} optimizations={result.data.optimizations} onSaved={result.retry} />}
      </article>}
  </main>;
}
