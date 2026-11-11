"use client";

import Link from "next/link";
import { useState } from "react";
import { REGIONS, REGION_CODES, type SeoCountry } from "@/lib/seo";
import type { WorkflowSnapshot } from "@/lib/seo-workflow";
import { useSeoRead } from "./useSeoAnalytics";
import { UiSelect } from "./UiSelect";
import styles from "./SeoPageCatalog.module.css";

export function PageOptimizationActions({ pageUrl, site, country }: { pageUrl: string; site: string; country: SeoCountry }) {
  const [market, setMarket] = useState(country === "all" ? "" : country);
  const [keyword, setKeyword] = useState("");
  const [taskId, setTaskId] = useState("");
  const result = useSeoRead<WorkflowSnapshot>("/api/seo/workflow?" + new URLSearchParams({ pageUrl }));
  const tasks = result.data?.tasks.filter(task => task.pageUrl === pageUrl && task.siteDomain === site && task.kind === "optimization" && (!market || task.country === market)) ?? [];
  const task = tasks.find(row => row.id === taskId);
  return <section className={styles.actionPanel} aria-label="当前页面优化操作">
    <h3>优化这个页面</h3>
    <form action="/work" method="get" className={styles.actionForm}>
      <input type="hidden" name="new" value="1" /><input type="hidden" name="kind" value="optimization" />
      <input type="hidden" name="site" value={site} /><input type="hidden" name="targetUrl" value={pageUrl} />
      <input type="hidden" name="country" value={market} />
      <label>目标国家<UiSelect aria-label="优化目标国家" value={market} onChange={value => { setMarket(value); setKeyword(""); setTaskId(""); }} options={[{ value: "", label: "请选择国家" }, ...REGION_CODES.map(value => ({ value, label: REGIONS[value].label }))]} /></label>
      <label className={styles.keywordField}>本语言主关键词<input name="keyword" required maxLength={300} value={keyword} onChange={event => setKeyword(event.target.value)} placeholder={market === "JP" ? "输入日语关键词" : market === "BR" ? "输入巴西葡语关键词" : market === "ES" ? "输入西班牙语关键词" : market === "US" ? "输入英语关键词" : "先选择目标国家"} /></label>
      <button className={styles.actionPrimary} type="submit" disabled={!market || !keyword.trim()}>填写优化任务</button>
    </form>
    {result.error ? <p role="alert">已有任务读取失败：{result.error} <button type="button" onClick={result.retry}>重试</button></p> : !result.data ? <p className={styles.note}>正在核对已有优化任务…</p> : tasks.length ? <details className={styles.approvalActions}><summary>已有优化任务 · {tasks.length} 项</summary><div className={styles.approvalAction}>
      <label>已有优化任务<UiSelect aria-label="选择待提审的优化任务" value={task?.id ?? ""} onChange={setTaskId} options={[{ value: "", label: "选择已登记的优化任务" }, ...tasks.map(row => ({ value: row.id, label: `${row.keyword ?? row.title} · ${row.country ? REGIONS[row.country].label : "未指定国家"} · ${row.weekStart}` }))]} /></label>
      {task ? <><Link className={styles.actionSecondary} href={`/approvals?newApproval=1&taskId=${encodeURIComponent(task.id)}`}>准备审批</Link><Link href={`/work?week=${task.weekStart}#task-${task.id}`}>查看任务</Link></> : null}
    </div></details> : null}
  </section>;
}
