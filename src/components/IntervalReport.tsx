"use client";

import { ReportVersions } from "./ReportVersions";
import { SeoDateControl, useSeoRange } from "./SeoDateControl";
import { SeoHistoryDisclosure } from "./SeoHistoryDisclosure";
import { SessionSeoReport } from "./SessionSeoReport";
import styles from "./WeeklyReport.module.css";

export function IntervalReport() {
  const context = useSeoRange();
  const { range, comparison } = context;
  return <>
    <div className={styles.intervalDate}><SeoDateControl value={context} /></div>
    <SessionSeoReport range={range} comparison={comparison} summary detailsLabel="报告证据与日期明细">
      <SeoHistoryDisclosure><ReportVersions range={range} comparison={comparison} /></SeoHistoryDisclosure>
    </SessionSeoReport>
  </>;
}
