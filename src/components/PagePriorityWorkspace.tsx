"use client";

import { FeedbackButton } from "./FeedbackButton";
import { workTaskHref } from "@/lib/seo-workspace-routes";
import { useState } from "react";
import Link from "@/components/AppLink";
import { publishedKeywordRankLabels, type PublishedKeywordRank } from "@/lib/published-keyword-rank";
import { GROWTH_EXECUTION_SITES } from "@/lib/seo-growth-markets";
import { shiftDay } from "@/lib/seo-date-range";
import { gscPeriodEnd, formatCtr } from "@/lib/seo-page-effects";
import type { PagePriorityFilters, pageOptimizationPriorities } from "@/lib/seo-page-priority";
import { REGION_CODES, REGIONS, type SeoCountry } from "@/lib/seo";
import { analyticsUrl, numberText, useSeoRead } from "./useSeoAnalytics";
import { useSeoCountry } from "./useSeoCountry";
import { UiSelect } from "./UiSelect";
import styles from "./SeoWorkWorkspace.module.css";

export function PagePriorityWorkspace() {
  const [market, setMarket] = useSeoCountry();
  const country = market === "all" ? "US" : market;
  const [site, setSite] = useState<string>("flatkey.ai");
  const [signal, setSignal] = useState<PagePriorityFilters["signal"]>("all");
  const [rank, setRank] = useState<PagePriorityFilters["rank"]>("all");
  const [page, setPage] = useState(1);
  const end = gscPeriodEnd(new Date());
  const filters = new URLSearchParams({ priority: "1", rank, signal, page: String(page) });
  const result = useSeoRead<ReturnType<typeof pageOptimizationPriorities>>(
    analyticsUrl({ start: shiftDay(end, -34), end }, [], country, site) + "&" + filters,
  );
  const rows = result.data?.rows ?? [];
  const pagination = result.data?.pagination;
  const rankCounts = result.data?.counts;
  const rankOptions = [{ value: "all", label: "全部排名状态" }, ...Object.entries(publishedKeywordRankLabels).map(([value, label]) => ({
    value, label: rankCounts ? `${label}（${numberText(rankCounts[value as PublishedKeywordRank])}）` : label,
  }))];
  const ctr = (period: typeof rows[number]["current"]) => period?.impressions ? period.clicks / period.impressions : null;
  return <section className={styles.listPanel} aria-label="页面优化优先级">
    <div className={styles.sectionHeading}><h1>页面优化优先级</h1><div className={styles.toolbarActions}><Link className={styles.secondary} href="/opportunities?tab=published">已有内容与排名</Link><FeedbackButton type="button" className={styles.secondary} onClick={result.retry} pending={result.pending} pendingLabel="正在刷新…">刷新</FeedbackButton></div></div>
    <div className={styles.toolbar}>
      <UiSelect aria-label="优化站点" value={site} onChange={value => { setSite(value); setPage(1); }} options={GROWTH_EXECUTION_SITES.map(value => ({ value, label: value }))} />
      <UiSelect aria-label="优化市场" value={country} onChange={value => { setMarket(value as SeoCountry); setPage(1); }} options={REGION_CODES.map(value => ({ value, label: REGIONS[value].label }))} />
      <UiSelect aria-label="关键词排名状态" value={rank} onChange={value => { setRank(value as PagePriorityFilters["rank"]); setPage(1); }} options={rankOptions} />
      <UiSelect aria-label="页面信号优先级" value={signal} onChange={value => { setSignal(value as PagePriorityFilters["signal"]); setPage(1); }} options={["all", "高", "中", "低", "观察中", "待核实"].map(value => ({ value, label: value === "all" ? "全部信号优先级" : value }))} />
    </div>
    {result.error ? <p role="alert">{result.error}</p> : !result.data ? <p role="status">正在分析页面…</p> : <>
      <p className={styles.muted}>GSC 完整数据截至 {result.data.latestDay ?? "待数据"} · 近两周最多 {result.data.pairedDays} 对同星期数据日 · 全设备</p>
      {rows.length ? <div className={styles.scrollTable}><table aria-label="页面综合优先级结果">
        <thead><tr><th>原关键词与上线页</th><th>关键词排名</th><th>页面信号优先级</th><th>点击／曝光</th><th>CTR／GSC 平均排名</th><th>依据</th><th>任务</th></tr></thead>
        <tbody>{rows.map(row => <tr key={`${row.targetId}:${row.url}`}>
          <th scope="row"><strong>{row.keyword}</strong><br /><Link href={"/pages?" + new URLSearchParams({ site, country, pageUrl: row.url })}>{new URL(row.url).pathname}</Link></th>
          <td>{row.rank === null ? publishedKeywordRankLabels[row.rankStatus] : `第 ${row.rank} 名`}{row.checkedAt ? <><br /><time dateTime={row.checkedAt}>{new Date(row.checkedAt).toLocaleDateString("zh-CN", { timeZone: "Asia/Shanghai" })}</time></> : null}</td>
          <td><strong>{row.priority}</strong></td>
          <td>{numberText(row.previous?.clicks)} → {numberText(row.current?.clicks)}<br />{numberText(row.previous?.impressions)} → {numberText(row.current?.impressions)}</td>
          <td>{formatCtr(ctr(row.previous))} → {formatCtr(ctr(row.current))}<br />{row.previous?.position?.toFixed(1) ?? "—"} → {row.current?.position?.toFixed(1) ?? "—"}</td>
          <td>{row.reasons.join("、")} · {row.comparable} 对数据日</td>
          <td>{row.taskId && row.taskWeek ? <Link href={workTaskHref({ id: row.taskId, weekStart: row.taskWeek })}>查看原任务</Link> : "—"}</td>
        </tr>)}</tbody>
      </table></div> : <p className={styles.empty}>当前筛选没有匹配的已上线关键词页面。</p>}
      {pagination && pagination.pageCount > 1 ? <nav aria-label="页面优化优先级分页" className={styles.toolbar}><button type="button" disabled={pagination.page === 1} onClick={() => setPage(pagination.page - 1)}>上一页</button>
        <span>{pagination.page} / {pagination.pageCount} · 共 {pagination.total} 项</span><button type="button" disabled={pagination.page === pagination.pageCount} onClick={() => setPage(pagination.page + 1)}>下一页</button></nav> : null}
    </>}
  </section>;
}
