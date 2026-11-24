"use client";
import { useState } from "react";
import type { DateRange } from "@/lib/seo-date-range";
import type { SeoCountry } from "@/lib/seo";
import type { ModuleAnalytics } from "@/lib/seo-overview-analytics";
import { OVERVIEW_PAGE_MODULES, overviewPageModule, type OverviewPageModule } from "@/lib/seo-overview-scope";
import { analyticsUrl, useSeoRead, type SeoAnalytics } from "./useSeoAnalytics";
import { BarPlot, LinePlot, chartNumber } from "./OverviewCharts";
import styles from "./OverviewCharts.module.css";

type LandingAnalytics = SeoAnalytics & { landingDaily?: { date: string; paths: [string, number | null][] | null }[] };
export function OverviewTrafficCharts({ range, comparison, module, country }: { range: DateRange; comparison: DateRange | null; module: OverviewPageModule; country: SeoCountry }) {
  const [metric, setMetric] = useState<"sessions" | "clicks" | "impressions">("sessions");
  const current = useSeoRead<ModuleAnalytics | SeoAnalytics>(analyticsUrl(range, [], country) + (module === "all" ? "" : `&module=${module}`));
  const previous = useSeoRead<ModuleAnalytics | SeoAnalytics>(comparison ? analyticsUrl(comparison, [], country) + (module === "all" ? "" : `&module=${module}`) : null);
  const landing = useSeoRead<LandingAnalytics>(analyticsUrl(range, [], country) + "&pages=all&landingDaily=1");
  const selectedMetric = module === "all" ? "sessions" : metric;
  const labels = { sessions: "自然搜索会话", clicks: "Google点击", impressions: "Google曝光" };
  const dailyValue = (day: SeoAnalytics["daily"][number] | ModuleAnalytics["daily"][number], key: typeof selectedMetric): number | null => key in day ? (day as unknown as Record<string, number | null>)[key] : null;
  const rows = current.data?.daily.map((day, index) => ({ label: day.date, value: dailyValue(day, selectedMetric), prior: comparison ? previous.data?.daily[index] ? dailyValue(previous.data.daily[index], selectedMetric) : null : undefined })) ?? [];
  const landingDays = landing.data?.landingDaily;
  const complete = Boolean(landingDays?.length && landingDays.every(day => day.paths && day.paths.every(([, count]) => count !== null)));
  const moduleCounts = new Map<string, number>();
  for (const day of landingDays ?? []) for (const [url, count] of day.paths ?? []) {
    const key = overviewPageModule(url); if (key && count !== null) moduleCounts.set(key, (moduleCounts.get(key) ?? 0) + count);
  }
  const denominator = [...moduleCounts.values()].reduce((sum, value) => sum + value, 0);
  return <>
    {module !== "all" ? <div className={styles.switcher} aria-label="总览流量趋势指标">{Object.entries(labels).map(([key, label]) => <button key={key} type="button" aria-pressed={metric === key} onClick={() => setMetric(key as typeof metric)}>{label}</button>)}</div> : null}
    <LinePlot rows={rows} unit={selectedMetric === "sessions" ? "次会话" : selectedMetric === "clicks" ? "次点击" : "次曝光"} priorLabel={comparison ? `${comparison.start}—${comparison.end}` : undefined} />
    <p className={styles.note}>本期 {range.start}—{range.end}；GA4属性日界为洛杉矶，GSC按其来源日界。{current.error ? `读取失败：${current.error}` : "缺日保持断点，不计算假环比。"} </p>
    <h3 className={`${styles.subheading} ${styles.sectionSpace}`}>页面模块入口会话占比</h3>
    <BarPlot rows={moduleCounts.size ? OVERVIEW_PAGE_MODULES.filter(([key]) => key !== "all").map(([key, label]) => ({ label, value: moduleCounts.has(key) ? moduleCounts.get(key)! : complete ? 0 : null, suffix: complete && denominator > 0 && moduleCounts.has(key) ? `${(moduleCounts.get(key)! / denominator * 100).toFixed(1)}%` : "占比待完整" })) : []} unit="次会话" denominator={`${complete ? "完整" : "已核实部分"}入口会话 ${moduleCounts.size ? chartNumber(denominator) : "—"}；同会话只按着陆页归属一次`} empty="模块着陆页来源未齐，未把缺行记为0" />
    <p className={styles.note}>模块占比以同周期完整已归属着陆页会话为分母，非GSC曝光；缺日不输出占比。控制台等入口仅按实际已授权生产域名归属。</p>
  </>;
}
