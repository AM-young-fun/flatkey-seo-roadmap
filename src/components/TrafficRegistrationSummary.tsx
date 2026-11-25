"use client";

import { useState } from "react";
import type { DateRange } from "@/lib/seo-date-range";
import { TRAFFIC_SUMMARY_MODULES, type TrafficSummaryTrend } from "@/lib/seo-traffic-summary";
import { LinePlot } from "./OverviewCharts";
import { SeoDateControl, type useSeoRange } from "./SeoDateControl";
import { UiSelect } from "./UiSelect";
import { useSeoRead } from "./useSeoAnalytics";
import styles from "./TrafficRegistrationSummary.module.css";

const scopes = [["all", "全站"], ...TRAFFIC_SUMMARY_MODULES] as const;
type Scope = typeof scopes[number][0];

export function useTrafficSummaryTrend(range: DateRange, ready: boolean) {
  return useSeoRead<TrafficSummaryTrend>(ready ? "/api/seo/traffic-summary?" + new URLSearchParams(range) : null,
    { showFeedback: false, keepPreviousData: true });
}

export function TrafficRegistrationSummary({ dates, read }: {
  dates: ReturnType<typeof useSeoRange>; read: ReturnType<typeof useTrafficSummaryTrend>;
}) {
  const [scope, setScope] = useState<Scope>("all");
  const data = read.data ?? read.previousData;
  const traffic = data?.daily.map(day => {
    const metric = scope === "all" ? day.site : day.modules[scope];
    return { label: day.date, value: metric.totalSessions, prior: metric.organicSessions };
  }) ?? [];
  const registrations = data?.daily.map(day => ({ label: day.date, value: day.site.totalRegistrations, prior: day.site.organicRegistrations })) ?? [];
  const period = data ? `${data.start}—${data.end}` : "";
  return <>
    <div className={styles.panels} aria-busy={read.pending || undefined}>
      <section className={styles.panel} aria-labelledby="flatkey-traffic-trend">
        <div className={styles.header}>
          <div><h2 id="flatkey-traffic-trend">Flatkey 流量趋势</h2><p>全部国家 · 洛杉矶日</p></div>
          <div className={styles.controls}>
            <UiSelect aria-label="流量板块" value={scope} options={scopes.map(([value, label]) => ({ value, label }))}
              onChange={value => setScope(scopes.find(([key]) => key === value)?.[0] ?? "all")} />
            <SeoDateControl value={dates} showComparison={false} pending={read.hasSettled && read.pending && !read.retrying} />
          </div>
        </div>
        {data ? <><LinePlot rows={traffic} unit="次会话" series={["总会话", "自然搜索会话"]} />
          <p className={styles.note}>本期 {period}。{scope === "all" ? "含正式官网和 Console。" : "按官网着陆页统计板块流量。"}</p></> : null}
      </section>
      <section className={styles.panel} aria-labelledby="flatkey-registration-trend">
        <div className={styles.header}>
          <div><h2 id="flatkey-registration-trend">Flatkey 注册趋势</h2><p>全站 · 洛杉矶日</p></div>
        </div>
        {data ? <><LinePlot rows={registrations} unit="人" series={["总注册", "自然搜索注册"]} />
          <p className={styles.note}>本期 {period}。注册按日去重，自然搜索注册按首次获客渠道归因。</p></> : null}
      </section>
    </div>
    {read.error ? <div className="loadError" role="alert"><span>{read.error}</span><button type="button" onClick={read.retry}>重新加载</button></div> : null}
  </>;
}
