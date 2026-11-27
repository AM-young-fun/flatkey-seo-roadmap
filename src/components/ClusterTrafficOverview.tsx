"use client";

import { useState } from "react";
import type { ClusterTraffic } from "@/lib/seo-cluster-traffic";
import type { DateRange } from "@/lib/seo-date-range";
import { ChartPanel, chartNumber, LinePlot } from "./OverviewCharts";
import { useOverviewRead } from "./useSeoAnalytics";
import styles from "./ClusterTrafficOverview.module.css";

const signed = { signDisplay: "exceptZero" } as const;

function sessionsChange(current: number | null, previous: number | null) {
  if (current === null || previous === null) return { text: "上期对比待归档" };
  const difference = current - previous;
  const delta = difference.toLocaleString("zh-CN", signed);
  const rate = previous > 0 ? (difference / previous).toLocaleString("zh-CN", {
    ...signed, style: "percent", minimumFractionDigits: 1, maximumFractionDigits: 1,
  }) : null;
  return {
    text: `较上期 ${delta} 次${rate === null ? "" : ` · ${rate}`}`,
    direction: difference > 0 ? "up" : difference < 0 ? "down" : undefined,
  };
}

export function ClusterTrafficOverview({ range }: { range: DateRange }) {
  const query = new URLSearchParams({ view: "cluster-traffic", start: range.start, end: range.end });
  const { data, error, pending, retry } = useOverviewRead<ClusterTraffic>("/api/seo/analytics?" + query);
  const [selection, setSelection] = useState<ClusterTraffic["sites"][number]["domain"]>();
  const selected = data?.sites.find(site => site.domain === selection)
    ?? data?.sites.find(site => site.current.recordedDays > 0) ?? data?.sites[0];
  return <ChartPanel title="集群站点流量趋势" note="GA4 自然搜索会话 · 全部国家">
    {error ? <div className="loadError" role="alert"><span>{error}</span><button type="button" onClick={retry} disabled={pending}>重新加载</button></div> : null}
    {!data && pending && !error ? <p className={styles.note} role="status">正在读取各站流量…</p> : null}
    {data && selected ? <div aria-busy={pending || undefined}>
      <p className={`${styles.note} ${styles.windows}`}>
        <span>所选日期 {data.start}—{data.end}</span>
        <span>上期 {data.previous.start}—{data.previous.end}</span>
      </p>
      <div className={styles.sites} role="group" aria-label="查看站点逐日趋势">
        {data.sites.map(site => {
          const change = sessionsChange(site.current.total, site.previous.total);
          return <button key={site.domain} type="button" className={styles.site} aria-pressed={site === selected}
            onClick={() => setSelection(site.domain)}>
            <span className={styles.name}>{site.name}</span>
            <span className={styles.domain}>{site.domain}</span>
            <span className={styles.total}><strong>{chartNumber(site.current.total)}</strong>{site.current.total === null ? "" : " 次"}</span>
            {site.current.total === null
              ? <span className={styles.change}>已归档 {site.current.recordedDays}/{site.daily.length} 天</span>
              : <span className={styles.change} data-direction={change.direction}>{change.text}</span>}
          </button>;
        })}
      </div>
      <section className={styles.trend} aria-labelledby="cluster-traffic-selected">
        <div className={styles.trendHeader}>
          <h3 id="cluster-traffic-selected">{selected.name} 逐日趋势</h3>
          <span className={styles.note}>{selected.timezone === "Asia/Shanghai" ? "北京时间" : "洛杉矶时间"}</span>
        </div>
        <LinePlot key={selected.domain + data.start + data.end} series={["自然搜索会话"]} unit="次会话" detailUnit="次"
          rows={selected.daily.map(day => ({ label: day.date, value: day.sessions }))} />
      </section>
    </div> : null}
  </ChartPanel>;
}
