"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { CalendarDays, CheckCircle2, CircleAlert, Clock3, ExternalLink, RefreshCw } from "lucide-react";
import type { WorkflowSnapshot, WorkflowTask, WorkflowPlan, WorkflowOptimization, WorkflowIssue, WorkflowHistoricalImport, WorkflowApproval } from "@/lib/seo-workflow";
import { PageHeader } from "./PageHeader";
import { SeoAutomationSchedule } from "./SeoAutomationSchedule";
import { WorkTrafficEvidence } from "./WorkTrafficEvidence";
import { UiSelect } from "./UiSelect";
import { useSeoCountry } from "./useSeoCountry";
import { numberText, shanghaiStamp, useSeoRead } from "./useSeoAnalytics";
import workspace from "./SeoWorkspace.module.css";
import styles from "./SeoWorkWorkspace.module.css";

const sites = [{ value: "flatkey.ai", label: "Flatkey" }, { value: "jev-llm.com", label: "JEV LLM" }, { value: "mochichatbot.com", label: "MochiChatbot" }, { value: "modelfit.cc", label: "ModelFit" }, { value: "rackrate.org", label: "RackRate" }];
const languages = [{ value: "en", label: "英语" }, { value: "ja", label: "日语" }, { value: "pt-BR", label: "巴西葡语" }, { value: "es-ES", label: "西班牙语" }];
const marketLanguage = { US: "en", JP: "ja", BR: "pt-BR", ES: "es-ES" } as const;
const markets = { US: "美国", JP: "日本", BR: "巴西", ES: "西班牙" };
const statuses: Record<string, string> = { planned: "已排期", researching: "研究中", ready: "可制作", drafting: "制作中", review_pending: "待审核", approved: "已审核", published: "已发布待验收", verified: "已验收", observing: "观察中", blocked: "受阻", failed: "失败", unknown: "结果待核实", running: "执行中", completed: "已完成", partial: "部分完成", open: "待处理", investigating: "排查中", resolved: "已恢复", draft: "草案", reviewed: "已定稿", bootstrap: "本周补排", improved: "有改善", needs_investigation: "需排查", insufficient_data: "数据不足" };
const taskKinds: Record<string, string> = { blog: "博客", landing: "落地页", optimization: "旧页优化", cluster: "集群交付", technical: "技术修复", research: "关键词研究", promotion: "推广与内链", review: "复盘" };
const pageTypes: Record<string, string> = { blog: "博客", landing: "落地页", tool: "工具", comparison: "比较页", tutorial: "教程", pricing: "价格页", integration: "接入页", technical: "技术项", other: "其他" };
const publicationKinds: Record<string, string> = { source_blog: "源文", translation: "翻译", backfill_translation: "历史补译", landing: "落地页", optimization: "旧页优化", cluster: "集群交付" };
const stageNames: Record<string, string> = { SHEETS: "三表校验与同步", KEYWORD_RESEARCH: "关键词研究", TECHNICAL_QA: "五站技术巡检", BLOG: "博客发布与验收", OLD_PAGE: "旧页优化", LANDING: "落地页制作", CLUSTER: "集群交付", DELIVERY: "交付验收与续跑", WEEKLY_CANDIDATES: "下周候选证据", WEEKLY_PLAN: "下周计划定稿", REPORT_PREVIEW: "报告准备", REPORT_SEND: "群通知", MONTHLY_REVIEW: "月度投入复盘" };
const stateLabel = (value: string) => statuses[value] ?? value;
const siteName = (domain: string) => sites.find(site => site.value === domain)?.label ?? domain;
const displayTime = (value: string | null | undefined) => value ? shanghaiStamp(value) : "待记录";
const shiftDay = (day: string, offset: number) => new Date(Date.parse(day + "T00:00:00Z") + offset * 86_400_000).toISOString().slice(0, 10);
const currentMonday = () => { const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(new Date()); return shiftDay(today, -((new Date(today + "T00:00:00Z").getUTCDay() + 6) % 7)); };
const pageHref = (url: string, country: string | null) => "/pages?" + new URLSearchParams({ pageUrl: url, ...(country ? { country } : {}) });
const safeWebUrl = (url: string | null | undefined) => { try { const parsed = new URL(url ?? ""); return parsed.protocol === "https:" && !parsed.username && !parsed.password ? parsed.toString() : null; } catch { return null; } };

export function WorkflowStatus({ status }: { status: string }) {
  return <span className={styles.badge} data-state={status}>{stateLabel(status)}</span>;
}

export function WorkflowEvidence({ evidence }: { evidence: WorkflowTask["evidence"] }) {
  if (!evidence.length) return <p className={styles.muted}>尚未提交证据。</p>;
  return <ul className={styles.evidence}>{evidence.map((item, index) => <li key={index}>
    {safeWebUrl(item.url) ? <a href={item.url} target="_blank" rel="noreferrer">{item.label} <ExternalLink size={12} aria-hidden="true" /></a> : <span>{item.label}</span>}
    {item.artifact ? <code>{item.artifact}</code> : null}<small>{displayTime(item.observedAt)}</small>
  </li>)}</ul>;
}

async function mutateWorkflow(body: object) {
  const response = await fetch("/api/seo/workflow", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.message ?? "保存失败，请保留当前内容后重试。");
  return result;
}

function PlanApproval({ plan, onSaved }: { plan: WorkflowPlan; onSaved: () => void }) {
  const [reviewer, setReviewer] = useState(""), [checked, setChecked] = useState(false), [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!checked || !reviewer.trim()) return;
    setBusy(true); setMessage("");
    try {
      const now = new Date().toISOString();
      const { version, updatedAt: _updatedAt, recordedAt: _recordedAt, ...record } = plan;
      await mutateWorkflow({ requestId: crypto.randomUUID(), action: "save_plan", expectedVersion: version, record: { ...record, status: "reviewed", reviewedAt: now, reviewedBy: reviewer.trim(), evidence: [...record.evidence, { label: "工作台周计划核对", artifact: `plan:${plan.id}:record:${version}`, observedAt: now }] } });
      setMessage("周计划已定稿。每次页面新增或修改仍需单独的页面审批。"); setChecked(false); onSaved();
    } catch (error) { setMessage(error instanceof Error ? error.message : "审核记录未保存。"); }
    finally { setBusy(false); }
  }
  return <form className={styles.reviewForm} onSubmit={event => void submit(event)}>
    <p>定稿前请核对每项关键词、国家、交付日、证据及缺口理由。周计划定稿不代替页面审批。</p>
    <label>审核人<input required maxLength={200} value={reviewer} onChange={event => setReviewer(event.target.value)} disabled={busy} /></label>
    <label className={styles.checkbox}><input type="checkbox" checked={checked} onChange={event => setChecked(event.target.checked)} disabled={busy} />我已核对上述周计划全部事项，确认可以继续研究和制作。</label>
    <button type="submit" className={styles.primary} disabled={busy || !checked || !reviewer.trim()}>{busy ? "保存中…" : "确认周计划"}</button>
    {message ? <p role="status">{message}</p> : null}
  </form>;
}

function TaskDetail({ task, tasks, approvals }: { task: WorkflowTask; tasks: WorkflowTask[]; approvals: WorkflowApproval[] }) {
  return <div className={styles.detail}>
    <dl className={styles.metadata}>
      <div><dt>任务类型 / 页面类型</dt><dd>{taskKinds[task.kind]} / {pageTypes[task.pageType]}</dd></div>
      <div><dt>业务 / 语言</dt><dd>{task.business} / {task.language ?? "不适用"}</dd></div>
      <div><dt>负责人 / 交付日</dt><dd>{task.owner} / {displayTime(task.dueAt)}</dd></div>
      <div><dt>内容版本</dt><dd>{task.contentVersion ?? "尚未制作"}</dd></div>
    </dl>
    {task.pageUrl ? <p><a href={task.pageUrl} target="_blank" rel="noreferrer">{task.pageUrl} ↗</a> · <Link href={pageHref(task.pageUrl, task.country)}>页面效果</Link></p> : <p className={styles.muted}>目标页面尚未确定。</p>}
    <h4>下一步</h4><p>{task.nextAction || "待执行人补充"}</p>
    {task.failureReason ? <p className={styles.warning}><CircleAlert size={15} />{task.failureReason}</p> : null}
    {task.fallbackReason ? <p className={styles.warning}>本次例外：{task.fallbackReason}</p> : null}
    <h4>验收要求</h4><ul>{task.acceptanceCriteria.map((item, index) => <li key={index}>{item}</li>)}</ul>
    <h4>前置任务</h4>{task.dependencies.length ? <ul>{task.dependencies.map(id => { const dependency = tasks.find(item => item.id === id); return <li key={id}><a href={`#task-${id}`}>{dependency?.title ?? id}</a> · {dependency ? stateLabel(dependency.status) : "本周范围外，需读取前置回执"}</li>; })}</ul> : <p className={styles.muted}>未登记任务依赖。</p>}
    <h4>关键词研究</h4>{task.research ? <><p>月搜索量 {numberText(task.research.volume)} · KD {numberText(task.research.kd)} · 业务价值 {numberText(task.research.businessValue)} / 3</p><p>{task.research.intent}</p>{task.research.exceptionReason ? <p>例外理由：{task.research.exceptionReason}</p> : null}<WorkflowEvidence evidence={task.research.evidence} /></> : <p className={styles.muted}>{task.kind === "technical" ? "技术与数据任务不要求主关键词；按验收要求执行。" : "研究证据待补，不能视为合格制作输入。"}</p>}
    <h4>交付证据</h4><WorkflowEvidence evidence={task.evidence} />
    {task.approval ? <p className={styles.muted}>历史任务审核：{task.approval.approvedBy} · {displayTime(task.approval.approvedAt)} · 版本 {task.approval.contentVersion}。此记录不作为当前页面发布授权。</p> : null}
    <h4>页面审批</h4><p className={styles.muted}>每个新增或修改页面、每种语言都需具体版本审批；包括新博客和译文。内容变化后须重新提交。</p>
    {approvals.filter(approval => approval.items.some(item => item.taskId === task.id)).map(approval => <p key={approval.id}><Link href={`/approvals?approvalId=${encodeURIComponent(approval.id)}`}>{approval.title} →</Link></p>)}
    <Link href={`/approvals?newApproval=1&taskId=${encodeURIComponent(task.id)}`} className={styles.secondary}>准备页面审批单</Link>
    <p className={styles.muted}>最近记录 {displayTime(task.updatedAt)} · 任务 {task.id}</p>
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
        <td><a href={page.pageUrl} target="_blank" rel="noreferrer">{page.title} ↗</a><small>{page.kind === "source_blog" ? "源文" : "翻译"} · {page.keyword ?? "关键词待核实"}</small><details><summary>页面证据</summary><WorkflowEvidence evidence={page.evidence} /></details></td>
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
  const [savedTask, setSavedTask] = useState<WorkflowTask | undefined>(existingTask), [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const attempt = useRef<{ requestId: string; action: string; expectedVersion: number; record: object } | null>(null);
  async function save(event: FormEvent) {
    event.preventDefault(); setBusy(true); setMessage("");
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
      setMessage("任务与原问题已关联。原问题状态、证据及历史均保留，尚未标记修复完成。"); onSaved();
    } catch (error) {
      const reason = error instanceof Error ? error.message : "暂时无法保存。";
      setMessage(task ? `任务 ${task.id} 已保存，问题关联待补：${reason} 请刷新核对原问题版本后重试，勿重复建任务。` : `${reason} 当前输入与请求已保留，可重试；若记录已存在，请刷新以恢复已保存任务。`);
    } finally { setBusy(false); }
  }
  return <form className={styles.reviewForm} onSubmit={event => void save(event)}>
    <h4>{savedTask ? "补齐问题关联" : `创建${dataIssue ? "数据核查" : "技术修复"}任务`}</h4>
    <p className={styles.muted}>保留原问题 {issue.id}（版本 {issue.version}）。此任务不强填国家、语言或关键词；创建后仍需实际执行与恢复验收。</p>
    {savedTask ? <p>已保存任务：<Link href={`/work?week=${savedTask.weekStart}#task-${savedTask.id}`}>{savedTask.title}</Link></p> : <div className={styles.formGrid}>
      <label>负责人<input required value={owner} maxLength={200} disabled={busy || Boolean(attempt.current)} onChange={event => setOwner(event.target.value)} /></label>
      <label>计划交付日<input type="date" required min={weekStart} max={shiftDay(weekStart, 6)} value={due} disabled={busy || Boolean(attempt.current)} onChange={event => setDue(event.target.value)} /></label>
      <label>业务线<UiSelect aria-label="问题任务业务线" value={business} onChange={setBusiness} disabled={busy || Boolean(attempt.current)} options={["API", "GPU", "CLUSTER"].map(value => ({ value, label: value === "CLUSTER" ? "集群" : value }))} /></label>
      <label className={styles.spanAll}>执行步骤<textarea required maxLength={3000} rows={3} value={nextAction} disabled={busy || Boolean(attempt.current)} onChange={event => setNextAction(event.target.value)} /></label>
    </div>}
    <button type="submit" className={styles.primary} disabled={busy}>{busy ? "保存中…" : savedTask ? "重试关联原问题" : attempt.current ? "重试保存与关联" : "创建任务并关联"}</button>
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
      <h4>7 / 28 / 56 日复盘</h4>{(["7", "28", "56"] as const).map(days => { const observation = optimization.observations.filter(row => row.windowDays === days).sort((a, b) => b.checkedAt.localeCompare(a.checkedAt))[0]; return <div key={days} className={styles.observation}><strong>{days} 日</strong>{observation ? <><WorkflowStatus status={observation.status} /><p>{observation.note}</p><p className={styles.muted}>可比 {observation.comparableDays} 天 · 检查于 {displayTime(observation.checkedAt)}</p>{observation.comparison ? <OptimizationComparison comparison={observation.comparison} /> : <p className={styles.muted}>此历史记录仅有复盘说明，未保存数值对比窗口。</p>}<WorkflowEvidence evidence={observation.evidence} /></> : <p className={styles.muted}>尚无该窗口复盘证据。数据齐全后再判断效果。</p>}</div>; })}
    </div>
  </details>;
}

function NewTask({ weekStart, onSaved }: { weekStart: string; onSaved: () => void }) {
  const query = useSearchParams();
  const prefill = JSON.stringify(["new", "keyword", "targetUrl", "country", "site", "kind"].map(key => [key, query.get(key)]));
  const [open, setOpen] = useState(false), [keyword, setKeyword] = useState(""), [pageUrl, setPageUrl] = useState("");
  const [site, setSite] = useState("flatkey.ai"), [country, setCountry] = useState<keyof typeof markets>("US"), [kind, setKind] = useState("landing"), [business, setBusiness] = useState("API");
  const [owner, setOwner] = useState(""), [due, setDue] = useState(weekStart), [evidenceUrl, setEvidenceUrl] = useState(""), [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  useEffect(() => {
    const params = new Map<string, string | null>(JSON.parse(prefill));
    if (params.get("new") !== "1") return;
    setOpen(true); setKeyword(params.get("keyword") ?? ""); setPageUrl(params.get("targetUrl") ?? "");
    const market = params.get("country"), domain = params.get("site"), requestedKind = params.get("kind");
    if (market && market in markets) setCountry(market as keyof typeof markets);
    if (domain && sites.some(site => site.value === domain)) { setSite(domain); setBusiness(domain === "flatkey.ai" ? "API" : "CLUSTER"); }
    if (requestedKind && ["landing", "blog", "optimization", "cluster"].includes(requestedKind)) setKind(requestedKind);
    else if (params.get("targetUrl")) setKind("optimization");
  }, [prefill]);
  useEffect(() => { setDue(weekStart); }, [weekStart]);
  async function save(event: FormEvent) {
    event.preventDefault(); setBusy(true); setMessage("");
    try {
      await mutateWorkflow({ requestId: crypto.randomUUID(), action: "save_task", expectedVersion: 0, record: {
        id: `task-${crypto.randomUUID()}`, weekStart, title: `${taskKinds[kind]} · ${keyword}`, siteDomain: site, kind, country, language: marketLanguage[country], business,
        pageType: kind === "blog" ? "blog" : kind === "landing" ? "landing" : "other", keyword, pageUrl: pageUrl.trim() || null, owner: owner.trim(), dueAt: `${due}T16:00:00+08:00`,
        status: "planned", dependencies: [], evidence: evidenceUrl.trim() ? [{ label: "机会来源", url: evidenceUrl.trim(), observedAt: new Date().toISOString() }] : [],
        nextAction: notes.trim(), contentVersion: null, acceptanceCriteria: ["补齐目标国家搜索意图、搜索量、KD 和页面冲突证据", "事实、语言、功能与正式页面验收通过"], source: "human",
      } });
      setMessage("任务已保存为待研究，尚未计入已定稿计划。周计划定稿时会核对并纳入。"); onSaved();
    } catch (error) { setMessage(error instanceof Error ? error.message : "任务未保存。"); }
    finally { setBusy(false); }
  }
  return <details open={open} onToggle={event => setOpen(event.currentTarget.open)} className={styles.newTask}><summary>新增工作任务</summary><form onSubmit={event => void save(event)}>
    <div className={styles.formGrid}>
      <label>站点<UiSelect aria-label="任务站点" value={site} onChange={setSite} options={sites} /></label>
      <label>任务类型<UiSelect aria-label="任务类型" value={kind} onChange={setKind} options={["landing", "blog", "optimization", "cluster"].map(value => ({ value, label: taskKinds[value] }))} /></label>
      <label>目标国家<UiSelect aria-label="任务目标国家" value={country} onChange={value => setCountry(value as keyof typeof markets)} options={Object.entries(markets).map(([value, label]) => ({ value, label }))} /></label>
      <label>业务线<UiSelect aria-label="任务业务线" value={business} onChange={setBusiness} options={["API", "GPU", "CLUSTER"].map(value => ({ value, label: value === "CLUSTER" ? "集群" : value }))} /></label>
      <label>主关键词（{languages.find(item => item.value === marketLanguage[country])?.label}）<input required value={keyword} maxLength={300} onChange={event => setKeyword(event.target.value)} /></label>
      <label>目标页面（可留空）<input type="url" value={pageUrl} onChange={event => setPageUrl(event.target.value)} placeholder="https://…" /></label>
      <label>负责人<input required value={owner} maxLength={200} onChange={event => setOwner(event.target.value)} /></label>
      <label>计划交付日<input type="date" required min={weekStart} max={shiftDay(weekStart, 6)} value={due} onChange={event => setDue(event.target.value)} /></label>
      <label className={styles.spanAll}>机会证据链接（可留空）<input type="url" value={evidenceUrl} onChange={event => setEvidenceUrl(event.target.value)} placeholder="https://…" /></label>
      <label className={styles.spanAll}>下一步与判断依据<textarea required rows={3} maxLength={3000} value={notes} onChange={event => setNotes(event.target.value)} /></label>
    </div><p className={styles.muted}>先保存为待研究任务；证据不足不会自动进入制作或发布。</p><button type="submit" className={styles.primary} disabled={busy}>{busy ? "保存中…" : "保存任务"}</button>{message ? <p role="status">{message}</p> : null}
  </form></details>;
}

const workViews = {
  tasks: { title: "工作任务", description: "确定本周计划、关键词和交付日，跟进任务依赖与实际进度。" },
  deliveries: { title: "发布验收", description: "核对正式页面、内容版本与验收证据，分别查看本期交付和历史归档。" },
  optimizations: { title: "页面优化", description: "保留优化前基线、每次修改和后续可比数据，判断页面优化效果。" },
  issues: { title: "问题处理", description: "跟进技术、索引、语言和数据问题，创建任务并保留恢复证据。" },
  runs: { title: "运行日志", description: "查看实际执行回执、数据截至日期、缺口和运行异常。" },
} as const;

export function SeoWorkWorkspace({ view = "tasks", embedded = false }: { view?: keyof typeof workViews; embedded?: boolean }) {
  const [country] = useSeoCountry();
  const params = useSearchParams();
  const week = params.get("week") ?? "current", site = params.get("site") ?? "all", business = params.get("business") ?? "all", language = params.get("language") ?? "all", status = params.get("status") ?? "all", tab = view;
  const Container = embedded ? "section" : "main";
  const panel = params.get("panel");
  const presentation = workViews[view], detailedFilters = !["issues", "runs"].includes(view);
  const [query, setQuery] = useState(""), [monday] = useState(currentMonday);
  const filter = (key: string, value: string) => { const params = new URLSearchParams(location.search); if (value === "all") params.delete(key); else params.set(key, value); history.pushState(null, "", location.pathname + "?" + params); dispatchEvent(new PopStateEvent("popstate")); };
  const result = useSeoRead<WorkflowSnapshot>(`/api/seo/workflow?week=${encodeURIComponent(week)}`);
  const relatedTaskHistory = useSeoRead<WorkflowSnapshot>(view === "issues" ? "/api/seo/workflow?allHistory=true" : null);
  const data = result.data;
  const relatedTasks = [...(data?.tasks ?? []), ...(relatedTaskHistory.data?.tasks ?? [])];
  const matchesScope = (record: { siteDomain: string; country?: string | null; language?: string | null }) => (site === "all" || record.siteDomain === site) && (country === "all" || record.country === country) && (language === "all" || record.language === language);
  const taskScope = data?.tasks.filter(task => matchesScope(task) && (business === "all" || task.business === business)) ?? [];
  const tasks = taskScope.filter(task => (status === "all" || task.status === status) && [task.title, task.keyword, task.pageUrl, task.owner].some(value => value?.toLowerCase().includes(query.toLowerCase())));
  const scopedIds = new Set(taskScope.map(task => task.id));
  const publications = data?.publications.filter(record => matchesScope(record) && (business === "all" || scopedIds.has(record.taskId))) ?? [];
  const optimizations = data?.optimizations.filter(record => matchesScope(record) && (business === "all" || scopedIds.has(record.taskId))) ?? [];
  const issues = data?.issues.filter(record => site === "all" || record.siteDomain === site) ?? [];
  const siteTaskIds = new Set(data?.tasks.filter(task => site === "all" || task.siteDomain === site).map(task => task.id));
  const runs = data?.runs.filter(record => site === "all" || record.taskIds.some(id => siteTaskIds.has(id))) ?? [];
  const verified = publications.filter(record => record.status === "verified");
  const plan = data?.plan;
  const chosenWeek = data?.weekStart ?? (week === "next" ? shiftDay(monday, 7) : /^\d{4}-\d{2}-\d{2}$/.test(week) ? week : monday);
  return <Container className={embedded ? styles.embedded : workspace.shell}>
    {!embedded ? <PageHeader active={view === "tasks" ? "work" : view} /> : null}
    {!embedded ? <div className={workspace.titleRow}><div><h1 className={workspace.title}>{presentation.title}</h1><p className={styles.subtitle}>{presentation.description}</p></div><button type="button" className={styles.secondary} onClick={result.retry}><RefreshCw size={14} />刷新</button></div> : null}
    {!embedded ? <><div className={styles.filters}>
      <UiSelect aria-label="工作周" value={week} onChange={value => filter("week", value)} options={[{ value: "current", label: "本周" }, { value: "next", label: "下周" }, { value: shiftDay(monday, -7), label: "上周" }, ...(!["current", "next", shiftDay(monday, -7)].includes(week) ? [{ value: week, label: week }] : [])]} />
      <UiSelect aria-label="工作站点" value={site} onChange={value => filter("site", value)} options={[{ value: "all", label: "全部五站" }, ...sites]} />
      {detailedFilters ? <><UiSelect aria-label="业务线筛选" value={business} onChange={value => filter("business", value)} options={[{ value: "all", label: "全部业务" }, { value: "API", label: "API" }, { value: "GPU", label: "GPU" }, { value: "CLUSTER", label: "集群" }]} />
      <UiSelect aria-label="页面语言筛选" value={language} onChange={value => filter("language", value)} options={[{ value: "all", label: "全部语言" }, ...languages]} /></> : null}
    </div>
    <p className={styles.period}><CalendarDays size={16} />工作周 {chosenWeek} — {shiftDay(chosenWeek, 6)} <span>北京时间 · 周一至周日</span></p></> : null}
    {view === "tasks" && !embedded ? <section className={styles.support} aria-label="工作参考数据">
      <div className={styles.supportActions}><span>按需查看</span>{[["traffic", "流量效果"], ["deliveries", "发布记录"], ["runs", "定时任务与执行记录"]].map(([value, label]) => <button key={value} type="button" className={styles.secondary} aria-expanded={panel === value} aria-controls="work-support-content" onClick={() => filter("panel", panel === value ? "all" : value)}>{label}</button>)}</div>
      {["traffic", "deliveries", "runs"].includes(panel ?? "") ? <div id="work-support-content" className={styles.supportContent}>{panel === "traffic" ? <WorkTrafficEvidence /> : <SeoWorkWorkspace view={panel as "deliveries" | "runs"} embedded />}</div> : null}
    </section> : null}
    {view === "runs" ? <SeoAutomationSchedule /> : null}
    {result.error ? <div className={styles.empty} role="alert"><h2>{presentation.title}暂时无法读取</h2><p>{result.error}</p><button className={styles.secondary} onClick={result.retry}>重新读取</button></div> : !data ? <p className={styles.empty} role="status">正在读取{presentation.title}…</p> : <>
      {data.storage === "local_preview" ? <p className={styles.warning}>本地预览存储，当前记录尚不代表线上平台已保存。</p> : null}
      {view === "tasks" ? <>
        <section className={`${styles.summary} ${styles.summaryPair}`} aria-label="任务进度摘要">
          <div><span>已登记任务</span><strong>{taskScope.length}</strong><small>按站点、国家、业务与语言筛选</small></div>
          <div><span>任务待审 / 受阻</span><strong>{taskScope.filter(row => row.status === "review_pending").length}<em> / {taskScope.filter(row => ["blocked", "failed"].includes(row.status)).length}</em></strong><small>具体页面发布许可在独立审批单核对</small></div>
        </section>
        <p className={styles.approvalNotice}><span>跨周待审批 <strong>{data.summary.pendingApprovals ?? 0}</strong> 单 / <strong>{data.summary.pendingApprovalItems ?? 0}</strong> 个页面版本。</span><Link href="/approvals">进入页面审批 →</Link></p>
      </> : view === "deliveries" ? <section className={`${styles.summary} ${styles.summaryPair}`} aria-label="发布验收摘要">
        <div><span>已验收源文 / 翻译</span><strong>{verified.filter(row => row.kind === "source_blog").length}<em> / {verified.filter(row => ["translation", "backfill_translation"].includes(row.kind)).length}</em></strong><small>只统计正式链接验收成功</small></div>
        <div><span>已验收落地页 / 优化页</span><strong>{new Set(verified.filter(row => row.kind === "landing").map(row => row.pageUrl)).size}<em> / {new Set(verified.filter(row => row.kind === "optimization").map(row => row.pageUrl)).size}</em></strong><small>同一页面去重，修改版本保留</small></div>
      </section> : null}
      {tab === "tasks" ? <>
        <NewTask weekStart={chosenWeek} onSaved={result.retry} />
        <section className={styles.plan} aria-labelledby="work-plan-title"><div className={styles.sectionHeading}><h2 id="work-plan-title">{plan?.title ?? "本周计划尚未落库"}</h2>{plan ? <WorkflowStatus status={plan.status} /> : <span className={styles.muted}>等待定稿</span>}</div>
          <p>每周目标：落地页 5 页 · API 源文 21 篇 · GPU 源文 14 篇 · 上线优化至少 5 页。</p>
          <p className={styles.muted}>周四 14:00 准备候选证据，周五 16:30 定稿下周。周末继续当前周计划。</p>
          {plan ? <><p>{plan.notes}</p>{plan.gaps.length ? <ul className={styles.gaps}>{plan.gaps.map((gap, index) => <li key={index}>{({ landing: "落地页", apiBlogs: "API 源文", gpuBlogs: "GPU 源文", optimizedPages: "优化页", evidence: "证据", other: "其他" }[gap.category])}缺口 {gap.count}：{gap.reason}</li>)}</ul> : null}<details><summary>计划依据与审核</summary><WorkflowEvidence evidence={plan.evidence} /><p>负责人 {plan.owner} · 整理于 {displayTime(plan.preparedAt)}{plan.reviewedAt ? ` · ${plan.reviewedBy} 定稿于 ${displayTime(plan.reviewedAt)}` : ""}</p>{plan.status === "draft" ? <PlanApproval key={`${plan.id}:${plan.version}`} plan={plan} onSaved={result.retry} /> : null}</details></> : <p className={styles.muted}>先补齐候选和输入证据，再确定具体关键词、页面和交付日。没有记录时不会生成示例完成数据。</p>}
        </section>
        <div className={styles.taskFilters}><input aria-label="搜索工作任务" value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索关键词、页面、任务或负责人" /><UiSelect aria-label="任务状态筛选" value={status} onChange={value => filter("status", value)} options={[{ value: "all", label: "全部状态" }, ...["planned", "researching", "ready", "drafting", "review_pending", "approved", "published", "verified", "observing", "blocked", "failed"].map(value => ({ value, label: stateLabel(value) }))]} /></div>
        {tasks.length ? <div className={styles.records}>{tasks.map(task => <details className={styles.record} id={`task-${task.id}`} key={task.id}><summary><span><strong>{task.title}</strong><small>{task.keyword ?? "不适用关键词"} · {siteName(task.siteDomain)} · {task.country ? markets[task.country] : "全站"} · {task.language ?? "不限语言"}</small></span><span className={styles.taskMeta}><WorkflowStatus status={task.status} /><small>{task.dueAt.slice(0, 10)} · {task.owner}</small></span></summary><TaskDetail task={task} tasks={data.tasks} approvals={data.approvals ?? []} /></details>)}</div> : <p className={styles.empty}>当前筛选范围没有已登记任务。</p>}
      </> : null}
      {tab === "deliveries" ? <section aria-label="正式页面发布验收"><p className={styles.muted}>发布成功和验收成功分别保留。翻译、历史补译和源文单独统计；Sitemap 首次发现不计为发布。</p>{publications.length ? publications.map(record => <details key={record.id} className={styles.record}><summary><span><strong>{record.title}</strong><small>{publicationKinds[record.kind]} · {siteName(record.siteDomain)} · {record.language}</small></span><WorkflowStatus status={record.status} /></summary><div className={styles.detail}><a href={record.pageUrl} target="_blank" rel="noreferrer">{record.pageUrl} ↗</a><p>发布 {displayTime(record.publishedAt)} · 验收 {displayTime(record.verifiedAt)} · 版本 {record.contentVersion}</p><p>目标词：{record.keyword ?? "未核实"} · {record.country ? markets[record.country] : "未指定目标市场"}</p>{record.failureReason ? <p className={styles.warning}>{record.failureReason}</p> : null}{record.liveCheck ? <p><CheckCircle2 size={14} /> 正式内容、canonical、语言与链接已核对。此检查不等于 Google 已收录。</p> : <p className={styles.muted}>尚无正式页验收记录。</p>}<WorkflowEvidence evidence={record.evidence} />{record.approvalId ? <p><Link href={`/approvals?approvalId=${encodeURIComponent(record.approvalId)}`}>查看此次发布审批 →</Link></p> : <p className={styles.muted}>历史发布尚无本次规则的审批关联，不作为新发布授权。</p>}<Link href={pageHref(record.pageUrl, record.country)}>进入页面效果 →</Link></div></details>) : <p className={styles.empty}>尚无此范围的发布回执。</p>}{(data.historicalImports ?? []).filter(archive => site === "all" || archive.siteDomain === site).map(archive => <HistoricalDeliveries key={archive.id} archive={archive} country={country} language={language} business={business} />)}</section> : null}
      {tab === "optimizations" ? <section aria-label="优化版本与观察窗口">{optimizations.length ? optimizations.map(row => <OptimizationHistory key={row.id} optimization={row} />) : <p className={styles.empty}>尚无此范围的优化记录。先保存优化前基线，审核稿、上线回执和后续观察会关联到同一页面。</p>}</section> : null}
      {tab === "issues" ? <section aria-label="技术与语言问题"><p className={styles.muted}>按站点与工作周显示问题。线上状态与 Google 已索引版本分别保存证据；创建任务不会把问题自动标成已修复。</p>{issues.length ? issues.map(issue => <details id={`issue-${issue.id}`} key={issue.id} className={styles.record}><summary><span><strong>{issue.priority} · {issue.title}</strong><small>{siteName(issue.siteDomain)} · {issue.category} · {issue.owner}</small></span><WorkflowStatus status={issue.status} /></summary><div className={styles.detail}><p>{issue.impact}</p><p>下一步：{issue.nextAction || "待补充"}</p>{issue.pageUrl ? <a href={issue.pageUrl} target="_blank" rel="noreferrer">{issue.pageUrl} ↗</a> : null}<WorkflowEvidence evidence={issue.evidence} />{issue.taskId ? (() => { const linkedTask = relatedTasks.find(task => task.id === issue.taskId); return linkedTask ? <Link href={`/work?week=${linkedTask.weekStart}#task-${linkedTask.id}`}>查看关联任务 →</Link> : <p className={styles.muted}>关联任务 {issue.taskId} {relatedTaskHistory.error ? "暂时无法读取" : relatedTaskHistory.data ? "未找到，需核查关联记录" : "正在跨周核对"}。<button type="button" className={styles.secondary} onClick={relatedTaskHistory.retry}>重新核对任务</button></p>; })() : issue.status !== "resolved" ? <IssueTaskForm key={`${issue.id}:${issue.version}`} issue={issue} weekStart={chosenWeek} existingTask={relatedTasks.find(task => task.evidence.some(item => item.artifact === `issue:${issue.id}`))} onSaved={() => { result.retry(); relatedTaskHistory.retry(); }} /> : null}{issue.resolvedAt ? <><p>恢复于 {displayTime(issue.resolvedAt)}</p><WorkflowEvidence evidence={issue.resolutionEvidence} /></> : null}</div></details>) : <p className={styles.empty}>此范围尚无已登记的问题；这不代表巡检已经完成。</p>}</section> : null}
      {tab === "runs" ? <section aria-label="运行回执"><div className={styles.sectionHeading}><h2>阶段运行与来源日期</h2></div><p className={styles.muted}>以下为实际执行回执。任务排期、开始运行和成功完成是不同状态；未关联具体站点任务的全局回执在“全部五站”中查看。</p>{runs.length ? runs.map(run => <details key={run.id} className={styles.record}><summary><span><strong>{stageNames[run.stage] ?? run.stage}</strong><small>{displayTime(run.scheduledFor)} · {run.owner}</small></span><WorkflowStatus status={run.status} /></summary><div className={styles.detail}><p><Clock3 size={14} />开始 {displayTime(run.startedAt)} · 完成 {displayTime(run.completedAt)}</p><p>完成 {run.completedItems} / 核查 {run.checkedItems} 项 · 覆盖 {({ full: "完整", partial: "部分", unknown: "未核实" }[run.coverage])} · 费用 {run.costMicros == null ? "未提供" : `$${(run.costMicros / 1e6).toFixed(4)}`}</p>{run.failureReason ? <p className={styles.warning}>{run.failureReason}</p> : null}<p>下一步：{run.nextAction || "无待办记录"}</p><h4>来源截至日期</h4>{Object.keys(run.sourceDates).length ? <dl className={styles.metadata}>{Object.entries(run.sourceDates).map(([source, date]) => <div key={source}><dt>{source}</dt><dd>{date ?? "待更新"}</dd></div>)}</dl> : <p className={styles.muted}>该回执尚未提供来源日期。</p>}<WorkflowEvidence evidence={run.evidence} /><p className={styles.muted}>输入版本 {run.inputVersion} · 回执 {run.id}</p></div></details>) : <p className={styles.empty}>此范围尚无阶段执行回执，不能据定时配置判断已完成。</p>}</section> : null}
      {!embedded ? <p className={styles.footer}>读取于 {displayTime(data.generatedAt)} · <a href="https://alidocs.dingtalk.com/i/nodes/jb9Y4gmKWrQa6B4mHrdNPxke8GXn6lpz" target="_blank" rel="noreferrer">数据基础 ↗</a></p> : null}
    </>}
  </Container>;
}
