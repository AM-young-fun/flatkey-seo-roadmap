"use client";

import { useState } from "react";
import { RefreshCw } from "lucide-react";
import type { AutomationSchedulePage, AutomationScheduleRow } from "@/lib/seo-automation-schedule";
import { useSeoRead } from "./useSeoAnalytics";
import { FeedbackButton } from "./FeedbackButton";
import { SeoTablePagination } from "./SeoTablePagination";
import styles from "./SeoAutomationSchedule.module.css";

const states = { enabled: "已启用", paused: "已暂停", unknown: "待核实" };
const groups = [
  { location: "computer", title: "Codex 定时任务" },
  { location: "server", title: "服务器定时任务" },
  { location: "unknown", title: "执行位置待核实" },
] as const;

/** Display the saved arrangement only; this view has no collection or payment actions. */
function SchedulePlans({ plans }: { plans: AutomationScheduleRow[] }) {
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
  const [page, setPage] = useState(1);
  const { data, error, retry, pending } = useSeoRead<AutomationSchedulePage>(`/api/operations?view=schedule&page=${page}`);
  return <section className={styles.root} aria-labelledby="automation-schedule-title">
    <div className={styles.heading}>
      <div><h2 id="automation-schedule-title">全部定时任务安排</h2><p>统一显示北京时间及配置启停状态。</p></div>
      <FeedbackButton onClick={retry} className={styles.refresh} pending={pending} pendingLabel="正在刷新安排…"><RefreshCw size={14} aria-hidden="true" />刷新安排</FeedbackButton>
    </div>
    {error ? <div className={styles.error} role="alert"><strong>任务安排暂时无法读取</strong><p>{error}</p>
        {page > 1 ? <FeedbackButton className={styles.refresh} onClick={() => setPage(1)}>回到第一页</FeedbackButton> : null}
      </div>
      : !data ? <p className={styles.note} role="status">正在读取任务安排…</p>
      : <>
        {groups.map(({ location, title }) => {
          const rows = data.rows.filter(row => row.executionLocation === location);
          if (!rows.length) return null;
          const id = `${location}-automation-title`;
          return <section key={location} className={styles.group} aria-labelledby={id}>
            <h3 id={id}>{title}</h3><SchedulePlans plans={rows} />
            {location === "server" && data.executionEvidence === "unavailable" ? <p className={styles.note}>服务器安排暂未核实，待恢复读取。</p> : null}
          </section>;
        })}
        <SeoTablePagination pagination={data} onPage={setPage} />
      </>}
  </section>;
}
