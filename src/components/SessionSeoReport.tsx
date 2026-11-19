"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import type * as echarts from "echarts";
import type { DateRange } from "@/lib/seo-date-range";
import { metricStats, changeText } from "@/lib/seo-display-summary";
import { SeoAnalyticsStatus } from "./SeoAnalyticsStatus";
import { analyticsUrl, numberText, useSeoRead, type SeoAnalytics, type SessionDay } from "./useSeoAnalytics";
import { overviewRegistration, overviewRegistrationChange, type OrganicRegistrationArchive } from "@/lib/organic-overview-registration";
import styles from "./SessionSeoReport.module.css";
import { useSeoCountry } from "./useSeoCountry";
import { REGIONS } from "@/lib/seo";

type Metric = "sessions" | "registrations";
type RegistrationSeries = { daily: { date: string; users: number | null }[] };
const registrationMetricLabel = "自然搜索注册人数";

function withOrganicRegistrations(points: SessionDay[] | undefined, series: RegistrationSeries | null): SessionDay[] {
  const registrations = new Map(series?.daily.map(day => [day.date, day.users]));
  return points?.map(day => ({ ...day, registrations: registrations.get(day.date) ?? null }))
    ?? series?.daily.map(day => ({ date: day.date, sessions: null, registrations: day.users })) ?? [];
}
function SessionDaysTable({ points, registrationLabel }: { points: SessionDay[]; registrationLabel: string }) {
  return <div className={styles.table}><table><thead><tr><th scope="col">日期</th><th scope="col">自然搜索访问次数</th><th scope="col">{registrationLabel}</th></tr></thead><tbody>{[...points].reverse().map(point => <tr key={point.date}><th scope="row">{point.date}</th><td>{numberText(point.sessions)}</td><td>{numberText(point.registrations)}</td></tr>)}</tbody></table></div>;
}
function SessionChart({ points, metric, registrationLabel }: { points: SessionDay[]; metric: Metric; registrationLabel: string }) {
  const element = useRef<HTMLDivElement>(null), [error, setError] = useState(false);
  const label = metric === "sessions" ? "自然搜索访问次数" : registrationLabel;
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
export function SessionSeoReport({ range, comparison = null, expanded = false, summary = false, footer, children, detailsLabel = "统计说明", showDetails = true, showTrend = true, showComparisonDate = true, showSourceSummary = false, compact = false, organicRegistrations = false }: {
  range: DateRange; comparison?: DateRange | null; expanded?: boolean; summary?: boolean; footer?: ReactNode; children?: ReactNode; detailsLabel?: string; showDetails?: boolean; showTrend?: boolean; showComparisonDate?: boolean; showSourceSummary?: boolean; compact?: boolean; organicRegistrations?: boolean;
}) {
  const [country] = useSeoCountry();
  const current = useSeoRead<SeoAnalytics>(analyticsUrl(range, [], country));
  const previous = useSeoRead<SeoAnalytics>(comparison ? analyticsUrl(comparison, [], country) : null);
  const data = current.data?.scope === "session-organic-search" ? current.data : null, baseline = previous.data?.scope === "session-organic-search" ? previous.data : null;
  const registrationRange = { start: comparison && comparison.start < range.start ? comparison.start : range.start,
    end: comparison && comparison.end > range.end ? comparison.end : range.end };
  const periodRegistrations = useSeoRead<OrganicRegistrationArchive>(organicRegistrations && country === "all"
    ? "/api/traffic/registrations?" + new URLSearchParams(registrationRange) : null);
  const dailyRegistrations = useSeoRead<{points: {date: string; newRegistrations: number | null}[]}>(organicRegistrations && country === "all"
    ? "/api/traffic/daily?" + new URLSearchParams(registrationRange) : null);
  const registrationSeries = (period: DateRange): RegistrationSeries | null => dailyRegistrations.data ? {
    daily: dailyRegistrations.data.points.filter(point => point.date >= period.start && point.date <= period.end)
      .map(point => ({date: point.date, users: point.newRegistrations})) } : null;
  const registrations = { ...dailyRegistrations, data: registrationSeries(range) };
  const priorRegistrations = { ...dailyRegistrations, data: comparison ? registrationSeries(comparison) : null };
  const periodStats = overviewRegistration(range, periodRegistrations.data, country);
  const priorPeriodStats = comparison ? overviewRegistration(comparison, periodRegistrations.data, country) : null;
  const registrationLabel = organicRegistrations ? registrationMetricLabel : "可归属注册（日去重）";
  const daily = organicRegistrations ? withOrganicRegistrations(data?.daily, registrations.data) : data?.daily ?? [];
  const priorDaily = organicRegistrations ? withOrganicRegistrations(baseline?.daily, priorRegistrations.data) : baseline?.daily ?? [];
  const [metric,setMetric] = useState<Metric>("sessions");
  const stats = { sessions: metricStats(daily, "sessions"), registrations: organicRegistrations ? periodStats : metricStats(daily, "registrations") };
  const changes = {
    sessions: changeText(stats.sessions, baseline ? metricStats(priorDaily, "sessions") : null, comparison),
    registrations: organicRegistrations ? overviewRegistrationChange(periodStats, priorPeriodStats, !!comparison) : changeText(stats.registrations, priorDaily.length ? metricStats(priorDaily, "registrations") : null, comparison),
  };
  const error = current.error ?? (current.data && !data ? "返回的数据口径与当次自然搜索不一致" : null);
  const complete = data && data.daily.length > 0 && data.daily.every(day => day.sessions != null && day.registrations != null);
  const priorComplete = baseline && baseline.daily.length > 0 && baseline.daily.every(day => day.sessions != null && day.registrations != null);
  const missingCountry = country !== "all" && data?.ga4.status === "missing" ? `${REGIONS[country].label}在所选周期的自然搜索访问${organicRegistrations ? "" : "与注册"}待采集。` : null;
  const conclusion = missingCountry ?? (!data ? "正在汇总本期记录…" : !complete ? `本期数据尚未齐全，已记录访问 ${numberText(stats.sessions.total)} 次、可归属注册 ${numberText(stats.registrations.total)} 人次。`
    : comparison && priorComplete ? `访问${changes.sessions}，可归属注册${changes.registrations}。` : `本期自然搜索带来 ${numberText(stats.sessions.total)} 次访问、${numberText(stats.registrations.total)} 人次可归属注册${comparison ? "，对比期数据待补齐" : ""}。`);
  const Heading = compact ? "h3" : "h2";
  const foldSourceReason = compact && showSourceSummary && showDetails;
  const trendUsesRegistrations = organicRegistrations && metric === "registrations";
  const trendData = trendUsesRegistrations ? registrations.data : data;
  const trendError = trendUsesRegistrations ? registrations.error : error;
  const trendLoading = !trendData && !trendError && (!trendUsesRegistrations || country === "all");
  return <section className={compact ? `${styles.report} ${styles.compact}` : styles.report} aria-label="自然搜索统计">
    {summary || (missingCountry && !foldSourceReason) ? <p className={styles.conclusion}>{conclusion}</p> : null}
    {error ? <div className={styles.error} role="alert">{error}<button className="ui-button" type="button" onClick={current.retry}>重试</button></div> : null}
    <div className={styles.metrics}>{([["sessions", "自然搜索访问次数"], ["registrations", registrationLabel]] as const).map(([key, label]) => {
      const { total, measured, days } = stats[key];
      const isOrganic = organicRegistrations && key === "registrations";
      const ready = isOrganic ? periodRegistrations.data : data;
      const readError = isOrganic ? periodRegistrations.error : error;
      const loading = !ready && !readError && (!isOrganic || country === "all");
      return <article key={key} aria-busy={loading}>
        <Heading>{label}</Heading>
        {loading ? <span className={styles.valueSkeleton} aria-hidden="true" /> : <strong>{numberText(total)}</strong>}
        {isOrganic ? <><small>首次获客为自然搜索 · 所选区间去重 · 洛杉矶时间</small>{periodStats.record ? <small>{range.start} — {range.end} · 最新数据可能继续更新</small> : null}</> : null}
        {loading ? <span className={styles.captionSkeleton} aria-hidden="true" /> : <p>{ready ? changes[key] : readError ? "读取失败" : "待采集"}</p>}
        {isOrganic && !loading && !periodStats.record ? <small>{country !== "all" ? "该国家尚无同口径区间去重回执" : "所选区间去重数据待采集，未按每日人数相加"}</small> : null}
        {ready && measured < days && !isOrganic ? <small>{measured ? "部分数据" : "待采集"} · {measured}/{days} 天有记录</small> : null}
        {!organicRegistrations && ready && key === "registrations" && measured === 0 ? <small>未取得可归属注册记录，暂不计为 0。</small> : null}
        {isOrganic && readError ? <button className="ui-button" type="button" onClick={periodRegistrations.retry}>重试</button> : null}
      </article>;
    })}</div>
    {showSourceSummary ? <div className={styles.sourceSummary} aria-label="流量数据日期与覆盖">
      {data ? <SeoAnalyticsStatus name="GA4 自然搜索" source={foldSourceReason ? { ...data.ga4, reason: null } : data.ga4} /> : <p>{error ? "数据来源暂时无法读取，数值保持未知。" : "正在读取实际数据日期与采集状态…"}</p>}
    </div> : null}
    {showTrend ? <section className={styles.trend} aria-label="每日趋势"><div className={styles.heading}><Heading>每日趋势</Heading><div className={styles.switcher} aria-label="趋势指标"><button type="button" aria-pressed={metric === 'sessions'} onClick={() => setMetric('sessions')}>访问次数</button><button type="button" aria-pressed={metric === 'registrations'} onClick={() => setMetric('registrations')}>{organicRegistrations ? "注册人数" : "可归属注册"}</button></div></div>
      {trendLoading ? <div className={`${styles.plot} ${styles.plotSkeleton}`} role="status" aria-label="正在读取每日趋势">
        <span className={styles.plotGrid} aria-hidden="true" />
      </div> : (metric === "registrations" && organicRegistrations ? metricStats(daily, "registrations").measured : stats[metric].measured) > 0 ? <SessionChart points={daily} metric={metric} registrationLabel={organicRegistrations ? "自然搜索注册（日去重，不可相加替代区间人数）" : registrationLabel} />
        : <div className={styles.empty}>{trendError ? "暂时无法显示趋势" : "所选区间暂无记录，请选择其他日期。"}</div>}
    </section> : null}
    {showComparisonDate && comparison ? <p className={styles.comparison}>对比 {comparison.start === comparison.end ? comparison.start : `${comparison.start} — ${comparison.end}`}{previous.error ? <> · 读取失败 <button type="button" onClick={previous.retry}>重试</button></> : null}</p> : null}
    {expanded && data ? <section className={styles.records}><h2>日期明细</h2><SessionDaysTable points={daily} registrationLabel={registrationLabel} /></section> : null}
    {footer || showDetails ? <div className={styles.footer}>{footer}{showDetails ? <details className={styles.disclosure}><summary>{detailsLabel}</summary><div className={styles.explanation}>
      {organicRegistrations ? <p>注册与日报、周报统一：首次获客渠道为自然搜索，触发 sign_up_success 的用户在所选完整区间内去重。趋势按日去重，日人数不相加代替区间人数。最新有效数据可能继续更新。</p> : <p>访问按当次自然搜索会话计次；注册统计{data?.registrationMetric === "sign_up_or_legacy_distinct_users" ? "这些会话中触发规范 sign_up 或历史 sign_up_success 的用户并集，同一次查询去重，不把事件次数相加" : "这些会话中触发历史 sign_up_success 的用户（兼容新事件的归档待刷新）"}，每日去重后累加为区间注册人次。仅计正式域名可归属事件；旧事件缺少域名时未计入，0不代表业务实际无人注册。</p>}<p>按 GA4 属性时区 America/Los_Angeles 划分日期。缺失数据以「—」显示，核实为零的记录显示 0。缺日时不显示涨跌百分比。{organicRegistrations ? "区间去重注册仅比较等长且完整的区间。" : "等长周期比较合计，不等长周期比较日均。"}</p>
      {data && !showSourceSummary ? <SeoAnalyticsStatus name="GA4 自然搜索" source={data.ga4} /> : null}
      {foldSourceReason && (missingCountry || data?.ga4.reason) ? <p>{data?.ga4.reason ?? missingCountry}</p> : null}
      {comparison && baseline ? <SeoAnalyticsStatus name="GA4 对比期" source={baseline.ga4} /> : null}
      {!expanded && data ? <details><summary>查看日期明细</summary><SessionDaysTable points={daily} registrationLabel={registrationLabel} /></details> : null}
      {baseline ? <details><summary>对比期日期明细</summary><SessionDaysTable points={priorDaily} registrationLabel={registrationLabel} /></details> : null}{children}
    </div></details> : null}</div> : null}
  </section>;
}
