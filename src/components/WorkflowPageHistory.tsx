"use client";

import Link from "next/link";
import type { WorkflowSnapshot } from "@/lib/seo-workflow";
import { OptimizationHistory, WorkflowEvidence, WorkflowStatus } from "./SeoWorkWorkspace";
import { useSeoRead, shanghaiStamp } from "./useSeoAnalytics";
import styles from "./SeoWorkWorkspace.module.css";

export function WorkflowPageHistory({ pageUrl, country }: { pageUrl: string; country: string }) {
  const result = useSeoRead<WorkflowSnapshot>("/api/seo/workflow?" + new URLSearchParams({ pageUrl }));
  const data = result.data;
  const tasks = data?.tasks.filter(row => row.pageUrl === pageUrl && (country === "all" || row.country === country)) ?? [];
  const optimizations = data?.optimizations.filter(row => row.pageUrl === pageUrl && (country === "all" || row.country === country)) ?? [];
  const publications = data?.publications.filter(row => row.pageUrl === pageUrl && (country === "all" || row.country === country)) ?? [];
  const issues = data?.issues.filter(row => row.pageUrl === pageUrl) ?? [];
  return <section className={styles.detail} aria-label="页面修改与执行记录">
    <h3>修改、索引证据与下一步</h3>
    {result.error ? <p role="alert">{result.error} <button className={styles.secondary} onClick={result.retry}>重试</button></p> : !data ? <p className={styles.muted}>正在读取跨周历史…</p> : <>
      {tasks.length ? <ul>{tasks.map(task => <li key={task.id}><Link href={"/work?" + new URLSearchParams({ week: task.weekStart, ...(country === "all" ? {} : { country }) }) + "#task-" + task.id}>{task.title}</Link> · <WorkflowStatus status={task.status} /><p>{task.nextAction || "下一步待补充"}</p></li>)}</ul> : <p className={styles.muted}>该页面尚未关联工作任务。</p>}
      {publications.length ? <details><summary>发布与正式页面验收</summary>{publications.map(record => <div key={record.id}><p>{shanghaiStamp(record.publishedAt)} · 版本 {record.contentVersion} · <WorkflowStatus status={record.status} /></p><p>验收时间：{record.verifiedAt ? shanghaiStamp(record.verifiedAt) : "尚未验收"}</p><WorkflowEvidence evidence={record.evidence} /></div>)}</details> : null}
      {optimizations.map(record => <OptimizationHistory optimization={record} key={record.id} />)}
      {issues.length ? <details><summary>技术、语言和索引问题证据</summary>{issues.map(issue => <div key={issue.id}><p>{issue.title} · <WorkflowStatus status={issue.status} /></p><p>{issue.impact}</p><p>下一步：{issue.nextAction}</p><WorkflowEvidence evidence={issue.evidence} />{issue.resolvedAt ? <WorkflowEvidence evidence={issue.resolutionEvidence} /> : null}</div>)}</details> : <p className={styles.muted}>尚无该页面的索引检查证据。线上访问成功不能证明 Google 已收录当前版本。</p>}
      <p className={styles.muted}>API 激活指首次成功获得模型响应或生成结果；GPU 统计成功租赁。业务指标以已核实来源记录为准，未接入时保留空值。</p>
    </>}
  </section>;
}
