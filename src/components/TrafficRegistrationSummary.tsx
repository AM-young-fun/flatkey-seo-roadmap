"use client";

import { useState } from "react";
import type { FlatkeyBrandTraffic } from "@/lib/seo-brand-traffic";
import type { DateRange } from "@/lib/seo-date-range";
import type { OverviewTrafficAnalytics } from "@/lib/seo-overview-analytics";
import { OVERVIEW_PAGE_MODULES } from "@/lib/seo-overview-scope";
import { TRAFFIC_SUMMARY_MODULES, type TrafficSummaryTrend } from "@/lib/seo-traffic-summary";
import { BarPlot, chartNumber, LinePlot } from "./OverviewCharts";
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
  const range = dates.range;
  const shares = useSeoRead<Pick<OverviewTrafficAnalytics, "range" | "modules">>(
    dates.ready ? "/api/seo/analytics?" + new URLSearchParams({ view: "overview-traffic", ...range }) : null,
    { showFeedback: false, keepPreviousData: true, timeoutMs: 45_000 },
  );
  const brand = useSeoRead<FlatkeyBrandTraffic>(
    dates.ready ? "/api/seo/analytics?" + new URLSearchParams({ view: "brand-traffic", ...range }) : null,
    { showFeedback: false, keepPreviousData: true, timeoutMs: 45_000 },
  );
  const data = read.data ?? read.previousData;
  const displayedRange = data ?? range;
  const shareData = [shares.data, shares.previousData].find(item =>
    item && item.range.start === displayedRange.start && item.range.end === displayedRange.end);
  const brandData = [brand.data, brand.previousData].find(item =>
    item && item.start === displayedRange.start && item.end === displayedRange.end);
  const modules = shareData?.modules;
  const denominator = modules ? Object.values(modules.sessions).reduce((sum, value) => sum + value, 0) : 0;
  const shareRows = modules && (modules.complete || Object.keys(modules.sessions).length) ? OVERVIEW_PAGE_MODULES.flatMap(([key, label]) => {
    if (key === "all") return [];
    const value = modules.sessions[key] ?? (modules.complete ? 0 : null);
    return [{ label, value, suffix: modules.complete && value !== null && denominator > 0 ? `${(value / denominator * 100).toFixed(1)}%` : undefined }];
  }) : [];
  const traffic = data?.daily.map(day => {
    const metric = scope === "all" ? day.site : day.modules[scope];
    return { label: day.date, value: metric.totalSessions, prior: metric.organicSessions };
  }) ?? [];
  const registrations = data?.daily.map(day => ({ label: day.date, value: day.site.totalRegistrations, prior: day.site.organicRegistrations })) ?? [];
  const period = data ? `${data.start}—${data.end}` : "";
  return <section className={styles.group} aria-labelledby="flatkey-traffic-registration">
    <header className={styles.groupHeader}>
      <div><h2 id="flatkey-traffic-registration">Flatkey 流量与注册</h2><p>按洛杉矶时间统计</p></div>
      <SeoDateControl value={dates} showComparison={false} pending={read.hasSettled && (read.pending || shares.pending || brand.pending) || undefined} />
    </header>
    <div className={styles.panels} aria-busy={read.pending || undefined}>
      <section className={styles.panel} aria-labelledby="flatkey-traffic-trend">
        <div className={styles.header}>
          <div><h3 id="flatkey-traffic-trend">Flatkey 流量趋势</h3><p>全部国家</p></div>
          <div className={styles.controls}>
            <UiSelect aria-label="流量板块" value={scope} options={scopes.map(([value, label]) => ({ value, label }))}
              onChange={value => setScope(scopes.find(([key]) => key === value)?.[0] ?? "all")} />
          </div>
        </div>
        {data ? <><LinePlot rows={traffic} unit="次会话" series={["总会话", "自然搜索会话"]} />
          <p className={styles.note}>本期 {period}。{scope === "all" ? "含正式官网和 Console。" : "按官网着陆页统计板块流量。"}</p></> : null}
      </section>
      <section className={styles.panel} aria-labelledby="flatkey-registration-trend">
        <div className={styles.header}>
          <div><h3 id="flatkey-registration-trend">Flatkey 注册趋势</h3><p>全站</p></div>
        </div>
        {data ? <><LinePlot rows={registrations} unit="人" series={["总注册", "自然搜索注册"]} />
          <p className={styles.note}>本期 {period}。注册按日去重，自然搜索注册按首次获客渠道归因。</p></> : null}
      </section>
    </div>
    <section className={styles.shares} aria-labelledby="flatkey-brand-traffic" aria-busy={brand.pending || undefined}>
      <h3 id="flatkey-brand-traffic">品牌词与非品牌词搜索点击</h3>
      {brandData ? <LinePlot rows={brandData.daily.map(day => ({ label: day.date, value: day.branded, prior: day.nonBranded }))}
        unit="次点击" series={["品牌词", "非品牌词"]} /> : brand.error ? null : <p className={styles.note} role="status">正在读取搜索查询…</p>}
      <p className={styles.note}>统计 Search Console 中可见查询词带来的 Flatkey 官网 Google 自然搜索点击。匿名查询不计入；来源未完成的日期保留断点。</p>
      {brand.error ? <div className="loadError" role="alert"><span>{brand.error}</span><button type="button" onClick={brand.retry}>重新加载搜索点击</button></div> : null}
    </section>
    <section className={styles.shares} aria-labelledby="flatkey-module-shares" aria-busy={shares.pending || undefined}>
      <h3 id="flatkey-module-shares">页面模块入口会话占比</h3>
      {shareData ? <><BarPlot rows={shareRows} unit="次会话"
        denominator={modules?.complete ? `已归属入口会话 ${chartNumber(denominator)}` : undefined}
        empty="所选日期暂无完整的页面入口数据" />
        <p className={styles.note}>本期 {shareData.range.start}—{shareData.range.end}。按自然搜索会话的着陆页归属，每次会话只计一次。{modules?.complete ? "" : "所选日期有缺口，暂不计算占比。"}</p></>
        : shares.error ? null : <p className={styles.note} role="status">正在读取页面入口会话…</p>}
      {shares.error ? <div className="loadError" role="alert"><span>{shares.error}</span><button type="button" onClick={shares.retry}>重新加载占比</button></div> : null}
    </section>
    {read.error ? <div className="loadError" role="alert"><span>{read.error}</span><button type="button" onClick={read.retry}>重新加载</button></div> : null}
  </section>;
}
