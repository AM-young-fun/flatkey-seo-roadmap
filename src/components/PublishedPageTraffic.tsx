"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { CLUSTER_SITES } from "@/lib/seo-cluster-sites";
import { propertyToday, shiftDay } from "@/lib/seo-date-range";
import type { WorkflowPublication, WorkflowSnapshot } from "@/lib/seo-workflow";
import { PageChart } from "./SeoPageCatalog";
import { UiSelect } from "./UiSelect";
import { analyticsUrl, numberText, shanghaiStamp, useSeoRead, type SeoAnalytics } from "./useSeoAnalytics";
import styles from "./SeoWorkWorkspace.module.css";

type Day = { date: string; sessions: number | null; registrations: number | null; clicks: number | null };

function PublicationTrend({ record }: { record: WorkflowPublication }) {
  const timezone = CLUSTER_SITES.find(site => site.domain === record.siteDomain)?.ga4TimeZone ?? "America/Los_Angeles";
  const start = shiftDay(new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(new Date(record.publishedAt)), 1);
  const end = shiftDay(propertyToday(timezone), -1);
  const result = useSeoRead<SeoAnalytics & { pageDaily: Day[] }>(start <= end
    ? analyticsUrl({ start, end }, [record.pageUrl], record.country ?? "all", record.siteDomain) + "&pageDaily=1"
    : null);
  const points = result.data?.pageDaily;
  const measured = points?.filter(day => day.sessions !== null);
  const first = measured?.[0];
  const latest = measured?.at(-1);
  return <section className={styles.listPanel} aria-label="上线后自然搜索流量">
    <div className={styles.sectionHeading}><h2>{record.title}</h2><Link href={"/work?" + new URLSearchParams({ week: record.weekStart }) + "#task-" + record.taskId}>查看任务</Link></div>
    <p><a href={record.pageUrl} target="_blank" rel="noreferrer">{record.pageUrl} ↗</a></p>
    <p className={styles.muted}>上线于 {shanghaiStamp(record.publishedAt)}（北京时间） · {record.country ?? "全部国家"} · GA4 自然搜索访问</p>
    <dl className={styles.metadata}>
      <div><dt>首次有数据</dt><dd>{first ? numberText(first.sessions) + " 次 · " + first.date : "待采集"}</dd></div>
      <div><dt>最新有数据</dt><dd>{latest ? numberText(latest.sessions) + " 次 · " + latest.date : "待采集"}</dd></div>
    </dl>
    {result.error ? <p role="alert">{result.error} <button type="button" className={styles.secondary} onClick={result.retry}>重试</button></p> : first && points
      ? <PageChart points={points} metric="sessions" label="该版本上线后的每日自然搜索访问" />
      : <p role="status">{start > end ? "首个完整数据日尚未结束。" : points ? "上线后尚无可用的 GA4 页面访问数据。" : "正在读取每日数据…"}</p>}
    <small className={styles.muted}>图表从上线后的首个完整日开始，日期按 GA4 媒体资源时区 {timezone}。</small>
  </section>;
}

export function PublishedPageTraffic() {
  const result = useSeoRead<WorkflowSnapshot>("/api/seo/workflow?allHistory=true");
  const [selected, setSelected] = useState("");
  const cutoff = shiftDay(propertyToday(), -90);
  const records = useMemo(() => {
    const sorted = (result.data?.publications ?? []).filter(row => row.status === "verified" && row.publishedAt.slice(0, 10) >= cutoff)
      .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
    const seen = new Set<string>();
    return sorted.filter(row => {
      const key = row.pageUrl + "|" + (row.country ?? "all");
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [result.data, cutoff]);
  const active = records.find(row => row.id === selected) ?? records[0];
  return <>
    <div className={styles.sectionHeading}><h1>上线效果</h1><button type="button" className={styles.secondary} onClick={result.retry}>刷新页面列表</button></div>
    {result.error ? <p role="alert">{result.error}</p> : !result.data ? <p role="status">正在读取上线页面…</p> : active ? <>
      <label>已核验页面（最近 90 天）<UiSelect aria-label="选择已核验页面" value={active.id} onChange={setSelected} options={records.map(row => ({ value: row.id, label: row.title + " · " + (row.country ?? row.language) }))} /></label>
      <PublicationTrend key={active.id} record={active} />
    </> : <p className={styles.empty}>最近 90 天暂无已核验的上线页面。</p>}
  </>;
}
