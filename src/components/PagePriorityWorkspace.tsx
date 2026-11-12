"use client";

import { useState } from "react";
import Link from "next/link";
import { CLUSTER_SITES } from "@/lib/seo-cluster-sites";
import { shiftDay } from "@/lib/seo-date-range";
import { gscPeriodEnd, formatCtr } from "@/lib/seo-page-effects";
import type { pageOptimizationPriorities } from "@/lib/seo-page-priority";
import { REGION_CODES, REGIONS, type SeoCountry } from "@/lib/seo";
import { analyticsUrl, numberText, useSeoRead } from "./useSeoAnalytics";
import { useSeoCountry } from "./useSeoCountry";
import { UiSelect } from "./UiSelect";
import styles from "./SeoWorkWorkspace.module.css";

const sites = ["flatkey.ai", ...CLUSTER_SITES.map(site => site.domain)];

export function PagePriorityWorkspace() {
  const [market, setMarket] = useSeoCountry();
  const country = market === "all" ? "US" : market;
  const [site, setSite] = useState("flatkey.ai");
  const [priority, setPriority] = useState("all");
  const [page, setPage] = useState(0);
  const end = gscPeriodEnd(new Date());
  const result = useSeoRead<ReturnType<typeof pageOptimizationPriorities>>(
    analyticsUrl({ start: shiftDay(end, -34), end }, [], country, site) + "&priority=1",
  );
  const rows = result.data?.rows.filter(row => priority === "all" || row.priority === priority) ?? [];
  const start = Math.min(page, Math.max(0, Math.ceil(rows.length / 20) - 1));
  const ctr = (period: typeof rows[number]["current"]) => period?.impressions ? period.clicks / period.impressions : null;
  return <section className={styles.listPanel} aria-label="页面优化优先级">
    <div className={styles.sectionHeading}><h1>页面优化优先级</h1><button type="button" className={styles.secondary} onClick={result.retry}>刷新</button></div>
    <div className={styles.toolbar}>
      <UiSelect aria-label="优化站点" value={site} onChange={value => { setSite(value); setPage(0); }} options={sites.map(value => ({ value, label: value }))} />
      <UiSelect aria-label="优化市场" value={country} onChange={value => { setMarket(value as SeoCountry); setPage(0); }} options={REGION_CODES.map(value => ({ value, label: REGIONS[value].label }))} />
      <UiSelect aria-label="优化优先级筛选" value={priority} onChange={value => { setPriority(value); setPage(0); }} options={["all", "高", "中", "低", "观察中", "待核实"].map(value => ({ value, label: value === "all" ? "全部优先级" : value }))} />
    </div>
    {result.error ? <p role="alert">{result.error}</p> : !result.data ? <p role="status">正在分析页面…</p> : <>
      <p className={styles.muted}>GSC 完整数据截至 {result.data.latestDay ?? "待数据"} · 近两周最多 {result.data.pairedDays} 对同星期数据日 · 全设备</p>
      {rows.length ? <div className={styles.scrollTable}><table aria-label="页面综合优先级结果">
        <thead><tr><th>页面</th><th>优先级</th><th>点击／曝光</th><th>CTR／平均排名</th><th>依据</th><th>任务</th></tr></thead>
        <tbody>{rows.slice(start * 20, (start + 1) * 20).map(row => <tr key={row.url}>
          <th scope="row"><Link href={"/pages?" + new URLSearchParams({ site, country, pageUrl: row.url })}>{new URL(row.url).pathname}</Link></th>
          <td><strong>{row.priority}</strong></td>
          <td>{numberText(row.previous?.clicks)} → {numberText(row.current?.clicks)}<br />{numberText(row.previous?.impressions)} → {numberText(row.current?.impressions)}</td>
          <td>{formatCtr(ctr(row.previous))} → {formatCtr(ctr(row.current))}<br />{row.previous?.position?.toFixed(1) ?? "—"} → {row.current?.position?.toFixed(1) ?? "—"}</td>
          <td>{row.reasons.join("、")} · {row.comparable} 对数据日</td>
          <td>{row.taskId ? <Link href={`/work?week=${row.taskWeek}#task-${row.taskId}`}>查看任务</Link> : <Link href={"/work?" + new URLSearchParams({ new: "1", kind: "optimization", site, country, targetUrl: row.url })}>填写任务</Link>}</td>
        </tr>)}</tbody>
      </table></div> : <p className={styles.empty}>当前筛选没有可分析的页面。</p>}
      {rows.length > 20 && <div className={styles.toolbar}><button type="button" disabled={start === 0} onClick={() => setPage(start - 1)}>上一页</button>
        <span>{start + 1} / {Math.ceil(rows.length / 20)}</span><button type="button" disabled={(start + 1) * 20 >= rows.length} onClick={() => setPage(start + 1)}>下一页</button></div>}
    </>}
  </section>;
}
