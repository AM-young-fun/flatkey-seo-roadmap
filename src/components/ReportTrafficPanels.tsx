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

export function ReportModuleShares({ range, comparisonRange, values, showShares = false }: {
  range: ReportTrafficRange;
  comparisonRange: ReportTrafficRange;
  values?: ReportModuleShareComparison;
  showShares?: boolean;
}) {
  const validRanges = validReportTrafficRange(range) && validReportTrafficRange(comparisonRange);
  const rows = reportModuleShareRows(validRanges ? values : undefined);
  const observedAt = values?.observedAt && Number.isFinite(Date.parse(values.observedAt))
    ? new Intl.DateTimeFormat("zh-CN", { timeZone: showShares ? "Asia/Shanghai" : "America/Los_Angeles", dateStyle: "short", timeStyle: "short" }).format(new Date(values.observedAt)) : null;
  const share = (value: number | null) => value === null ? "—" : `${(value * 100).toFixed(1)}%`;
  return <section className={styles.section} aria-label="模块流量">
    <h3>{showShares ? "模块流量占比" : "模块流量"}</h3>
    <p className={styles.note}>{validRanges ? `本期 ${period(range)} · 上期 ${period(comparisonRange)} · 洛杉矶时间` : "—"}</p>
    <div className={styles.tableScroll}>
      <table className={styles.comparison} aria-label="模型详情与提示词库整段去重访客变化">
        <thead><tr><th scope="col">页面类型</th><th scope="col">上期访客量</th><th scope="col">本期访客量</th><th scope="col">增减人数</th><th scope="col">环比</th></tr></thead>
        <tbody>
          {rows.map(row => <tr key={row.key}>
            <th scope="row">{row.label}</th>
            <td>{count(row.previous)}{showShares ? <small>占比 {share(row.previousShare)}</small> : null}</td><td>{count(row.current)}{showShares ? <small>占比 {share(row.currentShare)}</small> : null}</td>
            <td>{row.previous === null || row.current === null ? "—" : `${row.current > row.previous ? "+" : ""}${row.current - row.previous}`}</td>
            <td>{row.previous === null || row.current === null ? "—" : row.previous === 0 ? row.current > 0 ? "新增" : "0.0%" : `${row.current > row.previous ? "+" : ""}${((row.current - row.previous) / row.previous * 100).toFixed(1)}%`}</td>
          </tr>)}
        </tbody>
      </table>
    </div>
    <p className={styles.note}>访客按统计区间独立去重。</p>
    {showShares ? <p className={styles.note}>占比分母为同区间全站去重访客，模块可重叠，不相加；缺可靠来源时保留空值。</p> : null}
    {observedAt ? <p className={styles.note}>取数于 {observedAt}（{showShares ? "北京时间" : "洛杉矶时间"}）</p> : null}
  </section>;
}
