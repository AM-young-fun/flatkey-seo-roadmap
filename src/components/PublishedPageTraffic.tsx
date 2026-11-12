"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { effectStatusLabel, formatCtr, formatDelta, gscPeriodEnd, optimizationRange, verifiedPagePublications, type OptimizationEffect } from "@/lib/seo-page-effects";
import { CLUSTER_SITES } from "@/lib/seo-cluster-sites";
import { propertyToday, shiftDay } from "@/lib/seo-date-range";
import type { WorkflowPublication, WorkflowSnapshot } from "@/lib/seo-workflow";
import { PageChart } from "./SeoPageCatalog";
import { UiSelect } from "./UiSelect";
import { analyticsUrl, numberText, shanghaiStamp, useSeoRead, type SeoAnalytics } from "./useSeoAnalytics";
import styles from "./SeoWorkWorkspace.module.css";

type Day = { date: string; sessions: number | null; registrations: number | null; clicks: number | null };

const searchMetrics = ["clicks", "impressions", "ctr"] as const;
const labels = { clicks: "点击", impressions: "曝光", ctr: "点击率", sessions: "GA4 自然访问" } as const;

function PublicationTrend({ record }: { record: WorkflowPublication }) {
  const [metric, setMetric] = useState<typeof searchMetrics[number] | "sessions">("clicks");
  const end = gscPeriodEnd(new Date());
  const range = optimizationRange(record.publishedAt, end);
  const result = useSeoRead<SeoAnalytics & { optimizationEffect: OptimizationEffect }>(
    analyticsUrl(range, [record.pageUrl], record.country ?? "all", record.siteDomain) + "&pageDaily=1&effectAt=" + encodeURIComponent(record.publishedAt),
  );
  const timezone = CLUSTER_SITES.find(site => site.domain === record.siteDomain)?.ga4TimeZone ?? "America/Los_Angeles";
  const gaStart = shiftDay(new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(new Date(record.publishedAt)), 1);
  const gaEnd = shiftDay(propertyToday(timezone), -1);
  const ga = useSeoRead<SeoAnalytics & { pageDaily: Day[] }>(metric === "sessions" && gaStart <= gaEnd
    ? analyticsUrl({ start: gaStart, end: gaEnd }, [record.pageUrl], record.country ?? "all", record.siteDomain) + "&pageDaily=1"
    : null);
  const effect = result.data?.optimizationEffect;
  const isOptimization = record.kind === "optimization";
  const baseline = isOptimization ? effect?.before : effect?.first;
  const status = isOptimization ? effect?.status : !effect?.first ? "waiting" : effect.first.date === effect.latest?.date ? "observing" : "updated";
  const reason = isOptimization ? effect?.reason : !effect?.first ? "尚无上线后的完整页面数据"
    : effect.first.date === effect.latest?.date ? "已取得上线后第一日数据" : "对比上线后首次与最新完整数据";
  const value = (key: typeof searchMetrics[number], datum: number | null | undefined) => key === "ctr" ? formatCtr(datum) : numberText(datum);
  return <section className={styles.listPanel} aria-label="上线效果与自然搜索流量">
    <div className={styles.sectionHeading}><h2>{record.title}</h2><Link href={"/work?" + new URLSearchParams({ week: record.weekStart }) + "#task-" + record.taskId}>查看任务</Link></div>
    <p><a href={record.pageUrl} target="_blank" rel="noreferrer">{record.pageUrl} ↗</a></p>
    <p className={styles.muted}>上线于 {shanghaiStamp(record.publishedAt)}（北京时间） · {record.country ?? "全部国家"} · GSC 网页搜索 · 全设备</p>
    {result.error ? <p role="alert">{result.error} <button type="button" className={styles.secondary} onClick={result.retry}>重试</button></p> : !effect ? <p role="status">正在读取 GSC 数据…</p> : <>
      <p><strong>{effectStatusLabel[status ?? "waiting"]}</strong> · {reason}</p>
      <div className={styles.scrollTable}><table aria-label={isOptimization ? "优化前最后一日与最新一日对比" : "上线后第一日与最新一日对比"}>
        <thead><tr><th>指标</th><th>{isOptimization ? "优化前" : "首次数据"} {baseline?.date ?? "待数据"}</th><th>最新 {effect.latest?.date ?? "待数据"}</th><th>变化</th></tr></thead>
        <tbody>{searchMetrics.map(key => {
          const before = baseline?.[key], latest = effect.latest?.[key];
          return <tr key={key}><th scope="row">{labels[key]}</th><td>{value(key, before)}</td><td>{value(key, latest)}</td>
            <td>{before == null || latest == null ? "—" : formatDelta((latest - before) * (key === "ctr" ? 100 : 1)) + (key === "ctr" ? " 个百分点" : "")}</td></tr>;
        })}</tbody>
      </table></div>
    </>}
    <div className={styles.toolbar} aria-label="趋势指标">{([...searchMetrics, "sessions"] as const).map(key =>
      <button className={styles.secondary} type="button" key={key} aria-pressed={metric === key} onClick={() => setMetric(key)}>{labels[key]}</button>)}</div>
    {metric === "sessions" ? ga.error ? <p role="alert">{ga.error} <button type="button" onClick={ga.retry}>重试</button></p>
      : ga.data?.pageDaily.some(row => row.sessions != null) ? <PageChart points={ga.data.pageDaily} metric="sessions" />
      : <p role="status">{gaStart > gaEnd || ga.data ? "尚无上线后的 GA4 入口会话数据。" : "正在读取 GA4…"} </p>
      : effect && <PageChart points={effect.series} metric={metric} launchDay={effect.launchDay} />}
    <small className={styles.muted}>GSC 日期按太平洋时间。图中标记上线日，{isOptimization ? "对比使用上线日前后完整日期" : "首次与最新数据均取上线后的完整日期"}。缺数留空。</small>
  </section>;
}

export function PublishedPageTraffic() {
  const result = useSeoRead<WorkflowSnapshot>("/api/seo/workflow?allHistory=true");
  const search = useSearchParams();
  const [selected, setSelected] = useState(search.get("publication") ?? "");
  const cutoff = shiftDay(propertyToday(), -90);
  const records = useMemo(() => verifiedPagePublications(result.data?.publications ?? [], new Date())
    .filter(row => row.publishedAt.slice(0, 10) >= cutoff), [result.data, cutoff]);
  const active = records.find(row => row.id === selected) ?? records[0];
  return <>
    <div className={styles.sectionHeading}><h1>上线效果</h1><button type="button" className={styles.secondary} onClick={result.retry}>刷新页面列表</button></div>
    {result.error ? <p role="alert">{result.error}</p> : !result.data ? <p role="status">正在读取上线页面…</p> : active ? <>
      <label>已核验页面（最近 90 天）<UiSelect aria-label="选择已核验页面" value={active.id} onChange={setSelected} options={records.map(row => ({ value: row.id, label: row.title + " · " + (row.country ?? row.language) }))} /></label>
      <PublicationTrend key={active.id} record={active} />
    </> : <p className={styles.empty}>最近 90 天暂无已核验的上线页面。</p>}
  </>;
}
