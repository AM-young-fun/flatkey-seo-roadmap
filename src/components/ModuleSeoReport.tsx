"use client";
import { useEffect, useRef, useState } from "react";
import type * as echarts from "echarts";
import { overviewMetricSummary, type ModuleAnalytics } from "@/lib/seo-overview-analytics";
import type { DateRange } from "@/lib/seo-date-range";
import { changeText } from "@/lib/seo-display-summary";
import type { OverviewPageModule } from "@/lib/seo-overview-scope";
import type { SeoCountry } from "@/lib/seo";
import { analyticsUrl, numberText, useSeoRead } from "./useSeoAnalytics";
import styles from "./SessionSeoReport.module.css";
import moduleStyles from "./ModuleSeoReport.module.css";

const metrics = [["sessions", "自然搜索入口会话"], ["clicks", "Google 点击"], ["impressions", "Google 曝光"]] as const;
type Metric = typeof metrics[number][0];
export function ModuleSeoReport({ range, comparison, module, country, showDetails = true }: { range: DateRange; comparison: DateRange | null; module: OverviewPageModule; country: SeoCountry; showDetails?: boolean }) {
  const current = useSeoRead<ModuleAnalytics>(`${analyticsUrl(range, [], country)}&module=${module}`);
  const prior = useSeoRead<ModuleAnalytics>(comparison ? `${analyticsUrl(comparison, [], country)}&module=${module}` : null);
  const data = current.data?.scope === "module-organic-search" && current.data.module === module ? current.data : null;
  const baseline = prior.data?.scope === "module-organic-search" && prior.data.module === module ? prior.data : null;
  const [metric, setMetric] = useState<Metric>("sessions");
  const target = useRef<HTMLDivElement>(null);
  const label = metrics.find(([key]) => key === metric)![1];
  const [chartError, setChartError] = useState(false);
  useEffect(() => {
    if (!target.current || !data) return;
    const node = target.current;
    let disposed = false, chart: echarts.ECharts | undefined, observer: ResizeObserver | undefined;
    void import("@/lib/charts").then(({ init }) => {
      if (disposed) return;
      chart = init(node); chart.setOption({ animation: false, color: ["#3473bd"],
        grid: { left: 44, right: 14, top: 18, bottom: 30 }, tooltip: { trigger: "axis", confine: true, renderMode: "richText" },
        xAxis: { type: "category", data: data.daily.map(day => day.date), axisLabel: { hideOverlap: true, formatter: (date: string) => date.slice(5) } },
        yAxis: { type: "value", min: 0, minInterval: 1 },
        series: [{ type: "line", name: label, data: data.daily.map(day => day[metric]), connectNulls: false, showSymbol: data.daily.length <= 14 }],
      }); setChartError(false);
      observer = new ResizeObserver(() => chart?.resize()); observer.observe(node);
    }).catch(() => { if (!disposed) setChartError(true); });
    return () => { disposed = true; observer?.disconnect(); chart?.dispose(); };
  }, [data, metric, label]);
  return <section className={`${styles.report} ${styles.compact} ${moduleStyles.report}`} aria-label="页面模块自然搜索统计">
    {current.error ? <div className={styles.error} role="alert">{current.error}<button type="button" onClick={current.retry}>重试</button></div> : null}
    <div className={`${styles.metrics} ${moduleStyles.metrics}`}>{metrics.map(([key, name]) => {
      const stat = overviewMetricSummary(data, key), previous = baseline ? overviewMetricSummary(baseline, key) : null;
      return <article key={key}><h3>{name}</h3><strong>{numberText(stat.total)}</strong>
        <p>{data ? changeText(stat, previous, comparison) : current.error ? "读取失败" : "正在读取…"}</p>
        {data && stat.measured < stat.days ? <small>完整记录 {stat.measured}/{stat.days} 天</small> : null}</article>;
    })}</div>
    <div className={styles.sourceSummary}><p>GA4 截至 {data?.ga4Through ?? "待采集"} · GSC 截至 {data?.gscThrough ?? "待采集"}</p></div>
    <section className={styles.trend}><div className={`${styles.heading} ${moduleStyles.heading}`}><h3>每日趋势</h3><div className={`${styles.switcher} ${moduleStyles.switcher}`}>{metrics.map(([key, name]) => <button key={key} type="button" aria-pressed={metric === key} onClick={() => setMetric(key)}>{name.replace("自然搜索", "")}</button>)}</div></div>
      <div ref={target} className={styles.plot} role="img" aria-label={`${label}每日趋势`} />
      {chartError ? <p>图表暂不可用，请刷新重试。</p> : null}
    </section>
    {comparison ? <p className={styles.comparison}>对比 {comparison.start} — {comparison.end}{prior.error ? " · 对比期读取失败" : ""}</p> : null}
    {showDetails ? <details className={styles.disclosure}><summary>数据口径与日期明细</summary><div className={styles.explanation}>
      <p>按实际着陆页所属模块统计自然搜索入口会话；同一会话只属于一个入口。未核实 hostname 的旧记录不分配，缺失保留「—」。模块注册人数尚无去重归因数据。</p>
      <p>点击、曝光为该模块已返回的 GSC 页面记录合计；同次搜索可能包含多个页面，因此曝光不等于站点去重曝光。锚点变体的原始记录各计一次，不复制对应 GA4 会话。暂定或缺日数据不计算环比。GA4 日期按属性时区 America/Los_Angeles，GSC 按太平洋时间。</p>
      <div className={styles.table}><table><thead><tr><th>日期</th>{metrics.map(([key, name]) => <th key={key}>{name}</th>)}</tr></thead><tbody>{[...(data?.daily ?? [])].reverse().map(day => <tr key={day.date}><th>{day.date}{!day.searchComplete ? " · GSC 待完整" : ""}</th>{metrics.map(([key]) => <td key={key}>{numberText(day[key])}</td>)}</tr>)}</tbody></table></div>
    </div></details> : null}
  </section>;
}
