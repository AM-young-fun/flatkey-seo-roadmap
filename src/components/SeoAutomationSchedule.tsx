"use client";

import { RefreshCw } from "lucide-react";
import type { OperationsStatus } from "@/lib/operations";
import { readonlyAutomationPlans, type ReadonlyAutomationPlan } from "@/lib/seo-automation-schedule";
import { useSeoRead } from "./useSeoAnalytics";
import { FeedbackButton } from "./FeedbackButton";
import styles from "./SeoAutomationSchedule.module.css";

const states = { enabled: "已启用", paused: "已暂停", unknown: "待核实" };

/** Display the saved arrangement only; this view has no collection or payment actions. */
function SchedulePlans({ plans }: { plans: ReadonlyAutomationPlan[] }) {
  if (!plans.length) return <p className={styles.note}>此来源暂未返回安排。</p>;
  return <div className={styles.tableScroll}><table className={styles.table}>
    <thead><tr><th>任务名称</th><th>频率</th><th>北京时间</th><th>启停</th></tr></thead>
    <tbody>{plans.map(plan => {
      const cadence = plan.cadence.replace(/^候选唤醒：/, "");
      const timeIndex = cadence.search(/\d{1,2}:\d{2}/);
      const frequency = timeIndex < 0 ? cadence : cadence.slice(0, timeIndex).trim();
      const time = timeIndex < 0 ? "待核实" : cadence.slice(timeIndex).trim();
      return <tr key={plan.id}><th scope="row">{plan.name}</th><td>{frequency || "按配置"}</td><td>{time}</td>
        <td><span className={styles.state} data-state={plan.configurationState}>{states[plan.configurationState]}</span></td></tr>;
    })}</tbody>
  </table></div>;
}

export function SeoAutomationSchedule() {
  const { data, error, retry, pending } = useSeoRead<OperationsStatus>("/api/operations");
  // The retired Friday sender remains in history, rather than the current arrangements.
  const plans = data ? readonlyAutomationPlans(data).filter(plan => plan.id !== "seo-10-00-2") : [];
  const computerPlans = plans.filter(plan => plan.executionLocation === "computer");
  const serverPlans = plans.filter(plan => plan.executionLocation === "server");
  const unknownPlans = plans.filter(plan => plan.executionLocation === "unknown");
  const coordinator: ReadonlyAutomationPlan[] = data ? [{
    id: "server-schedule-coordinator", name: "服务器调度检查与续跑", location: "服务器", cadence: data.scheduler.cadence,
    state: "", nextAt: null, note: "", executionLocation: "server", nextConfiguredAt: null,
    configurationState: data.executionEvidence === "unavailable" ? "unknown" : data.scheduler.configured ? "enabled" : "paused",
  }] : [];
  return <section className={styles.root} aria-labelledby="automation-schedule-title">
    <div className={styles.heading}>
      <div><h2 id="automation-schedule-title">全部定时任务安排</h2><p>统一显示北京时间及配置启停状态。</p></div>
      <FeedbackButton onClick={retry} className={styles.refresh} pending={pending} pendingLabel="正在刷新安排…"><RefreshCw size={14} aria-hidden="true" />刷新安排</FeedbackButton>
    </div>
    {error ? <div className={styles.error} role="alert"><strong>任务安排暂时无法读取</strong><p>{error}</p></div>
      : !data ? <p className={styles.note} role="status">正在读取任务安排…</p>
      : <>
        <section className={styles.group} aria-labelledby="computer-automation-title"><h3 id="computer-automation-title">Codex 定时任务</h3><SchedulePlans plans={computerPlans} /></section>
        <section className={styles.group} aria-labelledby="server-automation-title"><h3 id="server-automation-title">服务器定时任务</h3>
          <SchedulePlans plans={[...serverPlans, ...coordinator]} />
          {data.executionEvidence === "unavailable" ? <p className={styles.note}>服务器安排暂未核实，待恢复读取。</p> : null}
        </section>
        {unknownPlans.length ? <section className={styles.group}><h3>执行位置待核实</h3><SchedulePlans plans={unknownPlans} /></section> : null}
      </>}
  </section>;
}
