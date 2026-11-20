"use client";

import { DailySeoPageGroups } from "./DailySeoPageGroups";
import { reportModuleShareRows, validReportTrafficRange, type ReportModuleShareComparison, type ReportTrafficRange } from "@/lib/report-module-shares";
import styles from "./SeoDigestReports.module.css";

export type { ReportModuleShareComparison } from "@/lib/report-module-shares";

const count = (value: number | null | undefined) => value == null ? "—" : value.toLocaleString("zh-CN");
const percent = (value: number | null) => value === null ? "—" : `${(value * 100).toFixed(1)}%`;
const period = (range: ReportTrafficRange) => range.start === range.end ? range.start : `${range.start} — ${range.end}`;

export function ReportPageGroupTraffic({ range }: { range: ReportTrafficRange }) {
  return <section className={styles.section} aria-label="四个页面组流量">
    <h3>四个页面组流量</h3>
    <p className={styles.note}>{validReportTrafficRange(range) ? `${period(range)} · 洛杉矶时间` : "—"}</p>
    {validReportTrafficRange(range) ? <DailySeoPageGroups start={range.start} end={range.end} category="all" /> : null}
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
  return <section className={styles.section} aria-label="模块流量占比">
    <h3>模块流量占比</h3>
    <p className={styles.note}>{validRanges ? `本期 ${period(range)} · 上期 ${period(comparisonRange)} · 洛杉矶时间` : "—"}</p>
    <div className={styles.tableScroll}>
      <table className={styles.comparison} aria-label="模型详情与提示词库整段去重访客占比">
        <thead><tr><th scope="col">页面组</th><th scope="col">上期访客</th><th scope="col">本期访客</th><th scope="col">上期占比</th><th scope="col">本期占比</th><th scope="col">占比变化</th></tr></thead>
        <tbody>
          <tr><th scope="row">全站自然搜索访客</th><td>{count(validRanges ? values?.previous.all : null)}</td><td>{count(validRanges ? values?.current.all : null)}</td><td>—</td><td>—</td><td>—</td></tr>
          {rows.map(row => <tr key={row.key}>
            <th scope="row">{row.label}</th><td>{count(row.previous)}</td><td>{count(row.current)}</td>
            <td>{percent(row.previousShare)}</td><td>{percent(row.currentShare)}</td>
            <td>{row.sharePoints === null ? "—" : `${row.sharePoints > 0 ? "+" : ""}${row.sharePoints.toFixed(1)} 个百分点`}</td>
          </tr>)}
        </tbody>
      </table>
    </div>
    <p className={styles.note}>占比 = 该组自然搜索去重访客 / 同期全站自然搜索去重访客；均按所选整段独立去重。两组可重叠，占比不相加为 100%。</p>
    {observedAt ? <p className={styles.note}>取数于 {observedAt}（洛杉矶时间）</p> : null}
  </section>;
}
