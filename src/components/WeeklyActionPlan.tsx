"use client";

import { workTaskHref } from "@/lib/seo-workspace-routes";
import Link from "next/link";
import { useState } from "react";
import type { WorkflowSnapshot } from "@/lib/seo-workflow";
import { useSeoCountry } from "./useSeoCountry";
import { useSeoRead, shanghaiStamp } from "./useSeoAnalytics";
import { WorkflowStatus } from "./SeoWorkWorkspace";
import styles from "./WeeklyActionPlan.module.css";

export function WeeklyActionPlan({ periodStart }: { periodStart?: string }) {
  const [country] = useSeoCountry();
  const [week, setWeek] = useState("current"), [expanded, setExpanded] = useState(false);
  const selectedWeek = periodStart ?? week;
  const result = useSeoRead<WorkflowSnapshot>(`/api/seo/workflow?week=${encodeURIComponent(selectedWeek)}`);
  const data = result.data;
  const tasks = data?.tasks.filter(task => country === "all" || task.country === country) ?? [];
  const link = "/work?" + new URLSearchParams({ week: selectedWeek, ...(country === "all" ? {} : { country }) });
  return <section className={styles.section} aria-labelledby="weekly-actions-heading">
    <div className={styles.heading}><h2 id="weekly-actions-heading">每周工作计划</h2><Link href={link}>查看任务与交付 →</Link></div>
    {!periodStart ? <p><button type="button" className={styles.textButton} aria-pressed={week === "current"} onClick={() => setWeek("current")}>本周</button> · <button type="button" className={styles.textButton} aria-pressed={week === "next"} onClick={() => setWeek("next")}>下周</button></p> : null}
    {data ? <>
      <p className={styles.workWeek}><strong>工作周 {data.weekStart} — {data.weekEnd}</strong>{data.plan ? <WorkflowStatus status={data.plan.status} /> : <span>等待定稿</span>}</p>
      <p className={styles.meta}>周一至周日 · 周五 16:30 定稿下周事项 · {tasks.length} 项已登记</p>
      {tasks.length ? <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th scope="col">关键词 / 任务</th><th scope="col">交付日 / 页面</th><th scope="col">状态与下一步</th></tr></thead><tbody>
        {tasks.slice(0, expanded ? tasks.length : 5).map(task => <tr key={task.id}><td data-label="关键词 / 任务"><Link href={workTaskHref(task, new URLSearchParams(country === "all" ? {} : { country }))}><strong>{task.keyword ?? task.title}</strong></Link><small>{task.country ?? "全站"} · {task.language ?? "不适用"} · {task.business}</small></td><td data-label="交付日 / 页面">{shanghaiStamp(task.dueAt)}{task.pageUrl ? <small><a href={task.pageUrl} target="_blank" rel="noreferrer">{task.pageUrl}</a></small> : <small>目标页待确定</small>}</td><td data-label="状态与下一步"><WorkflowStatus status={task.status} /><p>{task.nextAction || "待补充"}</p></td></tr>)}
      </tbody></table></div> : <p className={styles.empty}>尚无该范围的工作事项。周四准备候选证据，周五定稿关键词、页面和交付日。</p>}
      {tasks.length > 5 ? <button type="button" className={styles.textButton} onClick={() => setExpanded(value => !value)}>{expanded ? "收起" : `展开全部 ${tasks.length} 项`}</button> : null}
    </> : result.error ? <div className={styles.empty}><p role="alert">{result.error}</p><button type="button" className={styles.textButton} onClick={result.retry}>重新读取</button></div> : <p className={styles.empty}>正在读取工作计划…</p>}
  </section>;
}
