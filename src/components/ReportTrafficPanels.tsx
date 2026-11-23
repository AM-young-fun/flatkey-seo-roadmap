"use client";

import { DailySeoPageGroups } from "./DailySeoPageGroups";
import type { DailySeoPageGroupsHistory } from "@/lib/daily-seo-page-groups";
import { reportModuleShareRows, validReportTrafficRange, type ReportModuleShareComparison, type ReportTrafficRange } from "@/lib/report-module-shares";
import styles from "./SeoDigestReports.module.css";

export type { ReportModuleShareComparison } from "@/lib/report-module-shares";

const count = (value: number | null | undefined) => value == null ? "—" : value.toLocaleString("zh-CN");
const period = (range: ReportTrafficRange) => range.start === range.end ? range.start : `${range.start} — ${range.end}`;

export function ReportPageGroupTraffic({ range, snapshot }: { range: ReportTrafficRange; snapshot?: DailySeoPageGroupsHistory }) {
  return <section className={styles.section} aria-label="四个页面组流量">
    <h3>四个页面组流量</h3>
    <p className={styles.note}>{validReportTrafficRange(range) ? `${period(range)} · 洛杉矶时间` : "—"}</p>
    {validReportTrafficRange(range) && snapshot
      ? <DailySeoPageGroups start={range.start} end={range.end} category="all" snapshot={snapshot} />
      : <p className={styles.note}>此报告暂无页面组回执，数值为 —。</p>}
  </section>;
}

export function ReportModuleShares({ range, comparisonRange, values }: {
  range: ReportTrafficRange;
  comparisonRange: ReportTrafficRange;
  values?: ReportModuleShareComparison;
}) {
  const validRanges = validReportTrafficRange(range) && validReportTrafficRange(comparisonRange);
  const rows = reportModuleShareRows(validRanges ? values : undefined);
  const observedAt = values?.observedAt && Number.isFinite(Date.parse(values.observedAt))
    ? new Intl.DateTimeFormat("zh-CN", { timeZone: "America/Los_Angeles", dateStyle: "short", timeStyle: "short" }).format(new Date(values.observedAt)) : null;
  return <section className={styles.section} aria-label="模块流量">
    <h3>模块流量</h3>
    <p className={styles.note}>{validRanges ? `本期 ${period(range)} · 上期 ${period(comparisonRange)} · 洛杉矶时间` : "—"}</p>
    <div className={styles.tableScroll}>
      <table className={styles.comparison} aria-label="模型详情与提示词库整段去重访客变化">
        <thead><tr><th scope="col">页面类型</th><th scope="col">上期访客量</th><th scope="col">本期访客量</th><th scope="col">增减人数</th><th scope="col">环比</th></tr></thead>
        <tbody>
          {rows.map(row => <tr key={row.key}>
            <th scope="row">{row.label}</th>
            <td>{count(row.previous)}</td><td>{count(row.current)}</td>
            <td>{row.previous === null || row.current === null ? "—" : `${row.current > row.previous ? "+" : ""}${row.current - row.previous}`}</td>
            <td>{row.previous === null || row.current === null ? "—" : row.previous === 0 ? row.current > 0 ? "新增" : "0.0%" : `${row.current > row.previous ? "+" : ""}${((row.current - row.previous) / row.previous * 100).toFixed(1)}%`}</td>
          </tr>)}
        </tbody>
      </table>
    </div>
    <p className={styles.note}>访客按统计区间独立去重。</p>
    {observedAt ? <p className={styles.note}>取数于 {observedAt}（洛杉矶时间）</p> : null}
  </section>;
}
