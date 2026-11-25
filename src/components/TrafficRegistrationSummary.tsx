"use client";

import { Fragment } from "react";
import type { TrafficOverview } from "@/lib/seo-traffic-overview";
import { OVERVIEW_PAGE_MODULES } from "@/lib/seo-overview-scope";
import { BarPlot, chartNumber, LinePlot } from "./OverviewCharts";
import { SeoDateControl, type useSeoRange } from "./SeoDateControl";
import { useSeoRead } from "./useSeoAnalytics";
import styles from "./TrafficRegistrationSummary.module.css";

export function useTrafficSummaryTrend({ range, ready, isDefault }: ReturnType<typeof useSeoRange>) {
  const params = new URLSearchParams({ view: "traffic-overview", ...(isDefault ? {} : range) });
  return useSeoRead<TrafficOverview>(ready ? "/api/seo/analytics?" + params : null,
    { showFeedback: false, keepPreviousData: true });
}

function PeriodTotal({ label, unit, current, previous, range }: {
  label: string; unit: string; current?: number | null; previous?: number | null;
  range?: { start: string; end: string };
}) {
  const difference = current != null && previous != null ? current - previous : null;
  const rate = difference !== null && previous ? difference / previous : null;
  const direction = difference === null || difference === 0 ? undefined : difference > 0 ? "up" : "down";
  const rateLabel = rate === null ? null : rate.toLocaleString("zh-CN", {
    style: "percent", minimumFractionDigits: 1, maximumFractionDigits: 1, signDisplay: "exceptZero",
  });
  const differenceLabel = difference === null ? null : difference.toLocaleString("zh-CN", { signDisplay: "exceptZero" });
  return <div className={styles.periodTotal} aria-label={label}>
    <div className={styles.periodNumbers}>
      <span>{label} <strong>{chartNumber(current)}</strong> {unit}</span>
      <span className={styles.periodChange} data-direction={direction}>环比 {rateLabel ?? "—"}</span>
    </div>
    <p>{range ? `上期 ${range.start}—${range.end}` : "上期"} · {previous == null ? "待归档" : `${chartNumber(previous)} ${unit}`}
      {differenceLabel === null ? "" : ` · 较上期 ${differenceLabel} ${unit}`}</p>
  </div>;
}

export function TrafficRegistrationSummary({ dates, read }: {
  dates: ReturnType<typeof useSeoRange>; read: ReturnType<typeof useTrafficSummaryTrend>;
}) {
  const data = read.data ?? read.previousData;
  const period = data ? `${data.start}—${data.end}` : "";
  const modules = data?.modules;
  const comparison = data?.comparison;
  const moduleTotal = modules?.complete ? Object.values(modules.sessions).reduce((sum, value) => sum + value, 0) : 0;
  const dailyDetail = (days: { date: string; sessions: number | null }[]) => days.length <= 7 ? <dl>
    {days.map(day => <Fragment key={day.date}><dt>{day.date}</dt><dd>{chartNumber(day.sessions)} 次</dd></Fragment>)}
  </dl> : null;
  const shareRows = data && modules?.complete ? OVERVIEW_PAGE_MODULES.flatMap(([key, label]) => {
    if (key === "all") return [];
    const value = modules.sessions[key] ?? 0, share = moduleTotal ? `${(value / moduleTotal * 100).toFixed(1)}%` : undefined;
    return [{ label, value, suffix: share, tooltip: <>
      <b>{label} · {period}</b>
      <div>{chartNumber(value)} 次自然搜索入口会话{share ? `，占 ${share}` : ""}</div>
      <div>已归属入口会话共 {chartNumber(moduleTotal)} 次</div>
      {dailyDetail(data.moduleDays.map(day => ({ date: day.date, sessions: day.sessions[key] ?? 0 })))}
    </> }];
  }) : [];
  const traffic = data?.daily.map(day => ({ label: day.date, value: day.site.totalSessions, prior: day.site.organicSessions })) ?? [];
  const registrations = data?.daily.map(day => ({ label: day.date, value: day.site.totalRegistrations, prior: day.site.organicRegistrations })) ?? [];
  const displayDates = data ? { ...dates, range: { start: data.start, end: data.end }, isDefault: data.automatic } : dates;
  return <section className={styles.group} aria-labelledby="flatkey-traffic-registration" aria-busy={read.pending || undefined}>
    <header className={styles.groupHeader}>
      <div><h2 id="flatkey-traffic-registration">Flatkey 流量与注册</h2><p>按洛杉矶时间统计，默认使用各项数据均已归档的最近连续 7 天</p></div>
      <SeoDateControl value={displayDates} showComparison={false} completeWeek pending={read.hasSettled && read.pending || undefined} />
    </header>
    {data?.automatic && !data.completeWeekEnd ? <p className={styles.note} role="status">近期归档还没有连续 7 天完整数据。已知日期仍可查看。</p> : null}
    <div className={styles.panels}>
      <section className={styles.panel} aria-labelledby="flatkey-traffic-trend">
        <div className={styles.header}>
          <div><h3 id="flatkey-traffic-trend">Flatkey 流量趋势</h3><p>全部国家</p></div>
        </div>
        {data ? <><div className={styles.periodGrid}>
          <PeriodTotal label="本期总会话" unit="次" current={comparison?.totalSessions.current}
            previous={comparison?.totalSessions.previous} range={comparison?.previous} />
          <PeriodTotal label="自然搜索会话" unit="次" current={comparison?.organicSessions.current}
            previous={comparison?.organicSessions.previous} range={comparison?.previous} />
          </div><LinePlot rows={traffic} unit="次会话" detailUnit="次" series={["总会话", "自然搜索会话"]} />
          <p className={styles.note}>本期 {period}。GA4 会话含正式官网和 Console。</p></> : null}
      </section>
      <section className={styles.panel} aria-labelledby="flatkey-registration-trend">
        <div className={styles.header}>
          <div><h3 id="flatkey-registration-trend">Flatkey 注册趋势</h3><p>全站</p></div>
        </div>
        {data ? <><div className={styles.periodGrid}>
          <PeriodTotal label="本期总注册" unit="人" current={comparison?.totalRegistrations.current}
            previous={comparison?.totalRegistrations.previous} range={comparison?.previous} />
          <PeriodTotal label="自然搜索注册" unit="人" current={comparison?.organicRegistrations.current}
            previous={comparison?.organicRegistrations.previous} range={comparison?.previous} />
          </div><LinePlot rows={registrations} unit="人" series={["总注册", "自然搜索注册"]} />
          <p className={styles.note}>本期 {period}。总量按整段去重，折线按日去重。自然搜索注册按首次获客渠道归因。</p></> : null}
      </section>
    </div>
    <section className={styles.shares} aria-labelledby="flatkey-module-shares">
      <h3 id="flatkey-module-shares">页面模块入口会话占比</h3>
      {data ? <><BarPlot rows={shareRows} unit="次会话"
        denominator={modules?.complete ? `已归属入口会话 ${chartNumber(moduleTotal)}` : undefined}
        empty="所选日期的页面入口数据尚未归档齐全，暂不计算期间占比" />
        <p className={styles.note}>本期 {period}。按自然搜索会话的着陆页归属，每次会话只计一次。</p></>
        : null}
    </section>
    {read.error ? <div className="loadError" role="alert"><span>{read.error}</span><button type="button" onClick={read.retry}>重新加载</button></div> : null}
  </section>;
}
