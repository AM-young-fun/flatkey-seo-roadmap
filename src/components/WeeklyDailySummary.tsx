"use client";

import { closedPreset, shiftDay } from "@/lib/seo-date-range";
import { WeeklyActionPlan } from "./WeeklyActionPlan";
import { SessionSeoReport } from "./SessionSeoReport";
import { ClusterSiteTable } from "./SeoClusterReport";
import { siteReportToday, type ClusterDomain } from "@/lib/seo-cluster-sites";
import styles from "./WeeklyReport.module.css";

export function WeeklyDailySummary({ previous = false, site }: { previous?: boolean; site?: ClusterDomain }) {
  const range = closedPreset(previous ? "lastWeek" : "week", siteReportToday(site));
  if (!range) return <p className={styles.empty}>本周尚无已结束日，可在右上查看上周或历史周报。</p>;
  const comparison = { start: shiftDay(range.start, -7), end: shiftDay(range.end, -7) };
  if (site) return <>
    <p className={styles.period}>{range.start} — {range.end}</p>
    <ClusterSiteTable range={range} domain={site} label={previous ? "上周站点总结" : "本周站点总结"} />
    <details className={styles.evidence}>
      <summary>查看上周同期 {comparison.start} — {comparison.end}</summary>
      <ClusterSiteTable range={comparison} domain={site} label="上周同期站点总结" />
    </details>
  </>;
  return <>
    <p className={styles.period}>{range.start} — {range.end} · 对比上周同期 {comparison.start} — {comparison.end}</p>
    <SessionSeoReport range={range} comparison={comparison} summary detailsLabel="报告证据与日期明细">
      <p>业务周为周五至周四，按 GA4 属性时区 America/Los_Angeles 选取已结束日期。周中对比上周相同星期；缺日时保留缺口提示。</p>
    </SessionSeoReport>
    {!previous ? <WeeklyActionPlan /> : null}
  </>;
}
