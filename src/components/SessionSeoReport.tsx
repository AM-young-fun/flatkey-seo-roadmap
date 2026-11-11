"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import type * as echarts from "echarts";
import type { DateRange } from "@/lib/seo-date-range";
import { metricStats, changeText } from "@/lib/seo-display-summary";
import { SeoAnalyticsStatus } from "./SeoAnalyticsStatus";
import { analyticsUrl, numberText, useSeoRead, type SeoAnalytics, type SessionDay } from "./useSeoAnalytics";
import styles from "./SessionSeoReport.module.css";
import { useSeoCountry } from "./useSeoCountry";
import { REGIONS } from "@/lib/seo";

type Metric = "sessions" | "registrations";
function SessionDaysTable({ points }: { points: SessionDay[] }) {
  return <div className={styles.table}><table><thead><tr><th scope="col">日期</th><th scope="col">自然搜索访问次数</th><th scope="col">注册人数（当日去重）</th></tr></thead><tbody>{[...points].reverse().map(point => <tr key={point.date}><th scope="row">{point.date}</th><td>{numberText(point.sessions)}</td><td>{numberText(point.registrations)}</td></tr>)}</tbody></table></div>;
}
function SessionChart({ points, metric }: { points: SessionDay[]; metric: Metric }) {
  const element = useRef<HTMLDivElement>(null), [error, setError] = useState(false);
  const label = metric === "sessions" ? "自然搜索访问次数" : "注册人次";
  useEffect(() => {
    if (!element.current) return;
    const target = element.current;
    let disposed = false, chart: echarts.ECharts | undefined, observer: ResizeObserver | undefined;
    const option: echarts.EChartsOption = {
      animation: false, color: ["#3473bd"],
      grid: { left: 42, right: 14, top: 18, bottom: 30 },
      tooltip: { trigger: "axis", confine: true, renderMode: "richText" },
      xAxis: { type: "category", data: points.map(point => point.date), axisTick: {show:false}, axisLine:{lineStyle:{color:"#e2e7ee"}}, axisLabel: { color:"#778397", hideOverlap: true, formatter: (date: string) => date.slice(5).replace("-","/") } },
      yAxis: { type: "value", min: 0, minInterval: 1, axisLabel:{color:"#778397"}, splitLine:{lineStyle:{color:"#edf0f4",type:"dashed"}} },
      series: [{ type: "line", name: label, data: points.map(point => point[metric]), connectNulls: false, symbolSize: 6, showSymbol: points.length <= 14, lineStyle: {width:2.5} }],
    };
    void import("@/lib/charts").then(({ init }) => { if (disposed) return; chart = init(target); chart.setOption(option); setError(false); observer = new ResizeObserver(() => chart?.resize()); observer.observe(target); }).catch(() => { if (!disposed) setError(true); });
    return () => { disposed = true; observer?.disconnect(); chart?.dispose(); };
  }, [points,metric,label]);
  return <><div ref={element} className={styles.plot} role="img" aria-label={`${label}每日趋势`} />{error ? <p>趋势图暂时无法显示，可展开日期明细查看。</p> : null}</>;
}
export function SessionSeoReport({ range, comparison = null, expanded = false, summary = false, footer, children, detailsLabel = "统计说明", showDetails = true, showTrend = true, showSourceSummary = false, compact = false }: {
  range: DateRange; comparison?: DateRange | null; expanded?: boolean; summary?: boolean; footer?: ReactNode; children?: ReactNode; detailsLabel?: string; showDetails?: boolean; showTrend?: boolean; showSourceSummary?: boolean; compact?: boolean;
}) {
  const [country] = useSeoCountry();
  const current = useSeoRead<SeoAnalytics>(analyticsUrl(range, [], country));
  const previous = useSeoRead<SeoAnalytics>(comparison ? analyticsUrl(comparison, [], country) : null);
  const data = current.data?.scope === "session-organic-search" ? current.data : null, baseline = previous.data?.scope === "session-organic-search" ? previous.data : null;
  const [metric,setMetric] = useState<Metric>("sessions");
  const stats = { sessions:metricStats(data?.daily ?? [],"sessions"), registrations:metricStats(data?.daily ?? [],"registrations") };
  const changes = {sessions:changeText(stats.sessions,baseline ? metricStats(baseline.daily,"sessions") : null, comparison),registrations:changeText(stats.registrations,baseline ? metricStats(baseline.daily,"registrations") : null, comparison)};
  const error = current.error ?? (current.data && !data ? "返回的数据口径与当次自然搜索不一致" : null);
  const complete = data && data.daily.length > 0 && data.daily.every(day => day.sessions != null && day.registrations != null);
  const priorComplete = baseline && baseline.daily.length > 0 && baseline.daily.every(day => day.sessions != null && day.registrations != null);
  const missingCountry = country !== "all" && data?.ga4.status === "missing" ? `${REGIONS[country].label}在所选周期的自然搜索访问与注册待采集。` : null;
  const conclusion = missingCountry ?? (!data ? "正在汇总本期记录…" : !complete ? `本期数据尚未齐全，已记录访问 ${numberText(stats.sessions.total)} 次、注册 ${numberText(stats.registrations.total)} 人次。`
    : comparison && priorComplete ? `访问${changes.sessions}，注册${changes.registrations}。` : `本期自然搜索带来 ${numberText(stats.sessions.total)} 次访问、${numberText(stats.registrations.total)} 人次注册${comparison ? "，对比期数据待补齐" : ""}。`);
  const Heading = compact ? "h3" : "h2";
  const foldSourceReason = compact && showSourceSummary && showDetails;
  return <section className={compact ? `${styles.report} ${styles.compact}` : styles.report} aria-label="自然搜索统计">
    {summary || (missingCountry && !foldSourceReason) ? <p className={styles.conclusion}>{conclusion}</p> : null}
    {error ? <div className={styles.error} role="alert">{error}<button className="ui-button" type="button" onClick={current.retry}>重试</button></div> : null}
    <div className={styles.metrics}>{([["sessions", "自然搜索访问次数"], ["registrations", "注册人次（日去重）"]] as const).map(([key, label]) => {
      const { total, measured, days } = stats[key];
      return <article key={key}>
        <Heading>{label}</Heading>
        <strong>{numberText(total)}</strong>
        <p>{data ? changes[key] : error ? "读取失败" : "正在读取…"}</p>
        {data && measured < days ? <small>{measured ? "部分数据" : "待采集"} · {measured}/{days} 天有记录</small> : null}
      </article>;
    })}</div>
    {showSourceSummary ? <div className={styles.sourceSummary} aria-label="流量数据日期与覆盖">
      {data ? <SeoAnalyticsStatus name="GA4 自然搜索" source={foldSourceReason ? { ...data.ga4, reason: null } : data.ga4} /> : <p>{error ? "数据来源暂时无法读取，数值保持未知。" : "正在读取实际数据日期与采集状态…"}</p>}
    </div> : null}
    {showTrend ? <section className={styles.trend} aria-label="每日趋势"><div className={styles.heading}><Heading>每日趋势</Heading><div className={styles.switcher} aria-label="趋势指标"><button type="button" aria-pressed={metric === 'sessions'} onClick={() => setMetric('sessions')}>访问次数</button><button type="button" aria-pressed={metric === 'registrations'} onClick={() => setMetric('registrations')}>注册人次</button></div></div>
      {data && stats[metric].measured > 0 ? <SessionChart points={data.daily} metric={metric} /> : <div className={styles.empty}>{data ? "所选区间暂无记录，请选择其他日期。" : error ? "暂时无法显示趋势" : "正在读取每日趋势…"}</div>}
    </section> : null}
    {comparison ? <p className={styles.comparison}>对比 {comparison.start === comparison.end ? comparison.start : `${comparison.start} — ${comparison.end}`}{previous.error ? <> · 读取失败 <button type="button" onClick={previous.retry}>重试</button></> : null}</p> : null}
    {expanded && data ? <section className={styles.records}><h2>日期明细</h2><SessionDaysTable points={data.daily} /></section> : null}
    {footer || showDetails ? <div className={styles.footer}>{footer}{showDetails ? <details className={styles.disclosure}><summary>{detailsLabel}</summary><div className={styles.explanation}>
      <p>访问按当次自然搜索会话计次；注册统计这些会话中触发 sign_up_success 的用户，每日去重后累加为区间注册人次。</p><p>按 GA4 属性时区 America/Los_Angeles 划分日期。缺失数据以「—」显示，核实为零的记录显示 0。缺日时不显示涨跌百分比，等长周期比较合计，不等长周期比较日均。</p>
      {data && !showSourceSummary ? <SeoAnalyticsStatus name="GA4 自然搜索" source={data.ga4} /> : null}
      {foldSourceReason && (missingCountry || data?.ga4.reason) ? <p>{data?.ga4.reason ?? missingCountry}</p> : null}
      {comparison && baseline ? <SeoAnalyticsStatus name="GA4 对比期" source={baseline.ga4} /> : null}
      {!expanded && data ? <details><summary>查看日期明细</summary><SessionDaysTable points={data.daily} /></details> : null}
      {baseline ? <details><summary>对比期日期明细</summary><SessionDaysTable points={baseline.daily} /></details> : null}{children}
    </div></details> : null}</div> : null}
  </section>;
}
