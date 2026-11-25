"use client";
import { useState } from "react";
import type { DateRange } from "@/lib/seo-date-range";
import type { SeoCountry } from "@/lib/seo";
import type { OverviewTrafficAnalytics } from "@/lib/seo-overview-analytics";
import { OVERVIEW_PAGE_MODULES, type OverviewPageModule } from "@/lib/seo-overview-scope";
import { useSeoRead } from "./useSeoAnalytics";
import { FeedbackButton } from "./FeedbackButton";
import { BarPlot, LinePlot, chartNumber } from "./OverviewCharts";
import styles from "./OverviewCharts.module.css";

export function useOverviewTrafficRead(range: DateRange, comparison: DateRange | null, module: OverviewPageModule, country: SeoCountry, ready: boolean) {
  const params = new URLSearchParams({ view: "overview-traffic", ...range });
  if (country !== "all") params.set("country", country);
  if (module !== "all") params.set("module", module);
  if (comparison) { params.set("compareStart", comparison.start); params.set("compareEnd", comparison.end); }
  return useSeoRead<OverviewTrafficAnalytics>(ready ? `/api/seo/analytics?${params}` : null,
    { showFeedback: false, keepPreviousData: true, timeoutMs: 45_000 });
}

export function OverviewTrafficCharts({ read }: { read: ReturnType<typeof useOverviewTrafficRead> }) {
  const [metric, setMetric] = useState<"sessions" | "clicks" | "impressions">("sessions");
  const data = read.data ?? read.previousData;
  const selectedMetric = !data || data.module === "all" ? "sessions" : metric;
  const labels = { sessions: "自然搜索会话", clicks: "Google点击", impressions: "Google曝光" };
  if (read.error) return <div className="loadError" role="alert"><span>自然搜索流量：{read.error}</span><FeedbackButton onClick={read.retry} pending={read.retrying} pendingLabel="正在读取…">重新加载</FeedbackButton></div>;
  if (!data) return null;
  const { range, comparison, module, current, previous, modules } = data;
  const dailyValue = (day: OverviewTrafficAnalytics["current"][number] | undefined) => {
    if (selectedMetric === "sessions") return day?.sessions ?? null;
    return day && selectedMetric in day ? (day as { clicks: number | null; impressions: number | null })[selectedMetric] : null;
  };
  const rows = current.map((day, index) => ({ label: day.date, value: dailyValue(day), prior: comparison ? dailyValue(previous?.[index]) : undefined }));
  const hasModules = Object.keys(modules.sessions).length > 0;
  const denominator = Object.values(modules.sessions).reduce((sum, value) => sum + value, 0);
  return <>
    {module !== "all" ? <div className={styles.switcher} aria-label="总览流量趋势指标">{Object.entries(labels).map(([key, label]) => <button key={key} type="button" aria-pressed={metric === key} onClick={() => setMetric(key as typeof metric)}>{label}</button>)}</div> : null}
    <LinePlot rows={rows} unit={selectedMetric === "sessions" ? "次会话" : selectedMetric === "clicks" ? "次点击" : "次曝光"} priorLabel={comparison ? `${comparison.start}—${comparison.end}` : undefined} />
    <p className={styles.note}>本期 {range.start}—{range.end}；GA4属性日界为洛杉矶，GSC按其来源日界。缺日保持断点，不计算假环比。</p>
    <h3 className={`${styles.subheading} ${styles.sectionSpace}`}>页面模块入口会话占比</h3>
    <BarPlot rows={hasModules ? OVERVIEW_PAGE_MODULES.flatMap(([key, label]) => {
      if (key === "all") return [];
      const count = modules.sessions[key];
      return [{ label, value: count ?? (modules.complete ? 0 : null), suffix: modules.complete && denominator > 0 && count !== undefined ? `${(count / denominator * 100).toFixed(1)}%` : "占比待完整" }];
    }) : []} unit="次会话" denominator={`${modules.complete ? "完整" : "已核实部分"}入口会话 ${hasModules ? chartNumber(denominator) : "—"}；同会话只按着陆页归属一次`} empty="模块着陆页来源未齐，未把缺行记为0" />
    <p className={styles.note}>模块占比以同周期完整已归属着陆页会话为分母，非GSC曝光；缺日不输出占比。控制台等入口仅按实际已授权生产域名归属。</p>
  </>;
}
