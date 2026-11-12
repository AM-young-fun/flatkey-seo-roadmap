"use client";

import { useState } from "react";
import type { CollectionControlMutation, CollectionSchedulePreview } from "@/lib/collection-control";
import { RefreshCw } from "lucide-react";
import type { OperationsStatus } from "@/lib/operations";
import { automationDate, automationSchedulerLabels, readonlyAutomationPlans, type ReadonlyAutomationPlan } from "@/lib/seo-automation-schedule";
import { useSeoRead } from "./useSeoAnalytics";
import styles from "./SeoAutomationSchedule.module.css";

const dollars = (micros: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 6 }).format(micros / 1e6);

function PaidSchedule({ onEnabled }: { onEnabled: () => void }) {
  const [quote, setQuote] = useState<CollectionSchedulePreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function submit(action: CollectionControlMutation) {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/operations", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(action),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || "暂时无法读取付费计划");
      if (action.action === "previewSchedule") {
        if (result.action !== "previewSchedule" || !result.previewToken) throw new Error("费用预览不完整");
        setQuote(result);
      } else {
        setQuote(null);
        setMessage(result.message);
        onEnabled();
      }
    } catch (error) { setMessage(error instanceof Error ? error.message : "付费计划暂不可用"); }
    finally { setBusy(false); }
  }
  return <div className={styles.paidControl}>
    {quote ? <>
      <p>本轮上限 <strong>{dollars(quote.totalMaxCostMicros)}</strong> · {quote.keywordCount} 个关键词 · {quote.queryCount} 次排名查询 · {quote.discoveryJobs} 项新词发现</p>
      <p className={styles.note}>计划时间 {automationDate(quote.dueAt)} · 排名月度上限 {dollars(quote.maxMonthSerpCostMicros)} · 新词每轮上限 {dollars(quote.discoveryMaxCostMicros)}</p>
      <div className={styles.paidActions}><button type="button" className={styles.refresh} disabled={busy} onClick={() => void submit({ action: "enableSchedule", previewToken: quote.previewToken })}>仅开启自动付费</button><button type="button" className={styles.refresh} disabled={busy} onClick={() => setQuote(null)}>取消</button></div>
    </> : <button type="button" className={styles.refresh} disabled={busy} onClick={() => void submit({ action: "previewSchedule", futureOnly: true })}>查看费用与开启</button>}
    {message ? <p role="status">{message}</p> : null}
  </div>;
}

function SchedulePlans({ plans, enableRankings }: { plans: ReadonlyAutomationPlan[]; enableRankings?: () => void }) {
  if (!plans.length) return <p className={styles.note}>此来源暂未提供计划，不能判断为已停用或任务数为零。</p>;
  return <div className={styles.plans}>{plans.map(plan => <details key={plan.id} className={styles.plan}>
    <summary>
      <span className={styles.planTitle}><strong>{plan.name}</strong><small>{plan.cadence} · {plan.location}</small></span>
      <span className={styles.state} data-state={plan.configurationState}>{plan.state}</span>
    </summary>
    <div className={styles.detail}>
      <p>{plan.note}</p>
      {plan.dependencies?.length ? <p>前置条件：{plan.dependencies.join(" → ")}</p> : null}
      {plan.executionLocation === "computer" ? <p className={styles.note}>在 Codex 自动化中按任务名称管理启停。任务 ID：<code>{plan.id}</code></p> : null}
      {plan.configurationState === "paused"
        ? <p className={styles.note}>当前配置暂停，不安排下一次自动执行；上方时间仅表示原定周期。</p>
        : <p>按配置推算的下个时段：<strong>{automationDate(plan.nextConfiguredAt)}</strong>。实际是否开始，以执行回执为准。</p>}
      {plan.currentExecution ? <p>已落库的本期进度：{plan.currentExecution}</p> : null}
      {plan.id === "rankings" && enableRankings ? <PaidSchedule onEnabled={enableRankings} /> : null}
    </div>
  </details>)}</div>;
}

/** Server and desktop schedules with a separate, previewed DataForSEO opt-in. */
export function SeoAutomationSchedule() {
  const { data, error, retry } = useSeoRead<OperationsStatus>("/api/operations");
  const plans = data ? readonlyAutomationPlans(data) : [];
  const computerPlans = plans.filter(plan => plan.executionLocation === "computer");
  const serverPlans = plans.filter(plan => plan.executionLocation === "server");
  const unknownPlans = plans.filter(plan => plan.executionLocation === "unknown");
  return <section className={styles.root} aria-labelledby="automation-schedule-title">
    <div className={styles.heading}>
      <div><h2 id="automation-schedule-title">定时任务安排</h2><p>北京时间 · 计划配置与实际执行分开记录。</p></div>
      <button type="button" onClick={retry} className={styles.refresh}><RefreshCw size={14} aria-hidden="true" />刷新安排</button>
    </div>
    {error ? <div className={styles.error} role="alert"><strong>任务安排暂时无法读取</strong><p>{error}</p><p>启停状态和运行结果暂未知，不代表任务已停止或执行次数为零。</p></div>
      : !data ? <p className={styles.note} role="status">正在读取已保存的配置和执行回执…</p>
      : <>
        {data.executionEvidence === "unavailable" ? <p className={styles.warning} role="status">{data.evidenceNote}</p> : null}
        <div className={styles.counts}><span>配置已启用 <strong>{computerPlans.filter(plan => plan.configurationState === "enabled").length}</strong></span><span>配置已暂停 <strong>{computerPlans.filter(plan => plan.configurationState === "paused").length}</strong></span><span>最近执行 <strong>{data.executionEvidence === "unavailable" ? "待核实" : "见回执"}</strong></span></div>
        <section className={styles.group} aria-labelledby="computer-automation-title">
          <div className={styles.groupHeading}><h3 id="computer-automation-title">电脑上的 Codex 任务</h3><span>配置核对于 {automationDate(data.automationConfigurationVerifiedAt)}</span></div>
          <p className={styles.note}>来源：Codex 自动化配置回读。任务依赖这台电脑上的 Codex 可运行；这里保留的是核对时的启停状态，实时变化以 Codex 为准。启用不等于已经执行成功。</p>
          <SchedulePlans plans={computerPlans} />
        </section>
        {data.executionEvidence !== "unavailable" ? <section className={styles.group} aria-labelledby="server-automation-title">
          <div className={styles.groupHeading}><h3 id="server-automation-title">服务器采集任务</h3><span>状态读取于 {automationDate(data.checkedAt)}</span></div>
          <p className={styles.note}>GA4 / GSC 由 GitHub Actions 采集；DataForSEO 由项目服务器检查及续跑。它们独立于电脑上的 Codex。读取时间不是配置修改时间，也不是最近采集完成时间。</p>
          {data.controls.emergencyStopped ? <p className={styles.warning}>外部付费采集处于紧急停止状态；本页不会恢复或提交查询。</p> : null}
          <SchedulePlans plans={serverPlans} enableRankings={!data.controls.enabled && !data.controls.emergencyStopped ? retry : undefined} />
          <div className={styles.heartbeat}>
            <h4>DataForSEO 服务器调度检查</h4>
            <p>{data.scheduler.configured ? data.scheduler.cadence : "调度认证尚未配置"} · {automationSchedulerLabels[data.scheduler.state] ?? "检查状态未核实"}</p>
            <dl><div><dt>最近开始</dt><dd>{automationDate(data.scheduler.lastStartedAt)}</dd></div><div><dt>最近完成</dt><dd>{automationDate(data.scheduler.lastCompletedAt)}</dd></div></dl>
            <p className={styles.note}>检查成功仅说明调度检查完成；不代表付费已开启、全部关键词已采集，也不代表其他任务成功。</p>
          </div>
        </section> : null}
        {unknownPlans.length ? <section className={styles.group}><h3>执行位置待核实</h3><SchedulePlans plans={unknownPlans} /></section> : null}
        <details className={styles.receipts}>
          <summary>最近采集与调度回执</summary>
          {data.executionEvidence === "unavailable" ? <p className={styles.warning}>执行记录未读取，不能把配置启用当成运行成功。</p> : null}
          <p className={styles.note}>只列接口已保存的最近记录，不作为全部历史或某项计划的完整成功率。工作任务的阶段交付回执另行展示。</p>
          {data.records.length ? <ol>{data.records.map(record => <li key={record.id}>
            <div className={styles.recordHeading}><strong>{record.name}</strong><span>{record.state}</span></div>
            <p>开始 {automationDate(record.startedAt)} · 完成 {automationDate(record.completedAt)}</p><p>{record.detail}</p>
          </li>)}</ol> : <p className={styles.note}>尚无已保存的采集或调度回执，不能据此判断任务已运行或未运行。</p>}
        </details>
      </>}
  </section>;
}
