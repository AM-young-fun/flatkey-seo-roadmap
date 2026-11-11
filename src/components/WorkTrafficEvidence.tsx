"use client";

import { SeoDateControl, useSeoRange } from "./SeoDateControl";
import { SessionSeoReport } from "./SessionSeoReport";
import { SeoHistoryDisclosure } from "./SeoHistoryDisclosure";
import { SeoPeriodSummary } from "./SeoPeriodSummary";
import { DailySeoTrafficTrend } from "./DailySeoTrafficTrend";
import { DailySeoPageGroups } from "./DailySeoPageGroups";
import { useSeoCountry } from "./useSeoCountry";
import styles from "./SeoWorkWorkspace.module.css";

/** Mounted only while the operator asks to see supporting traffic evidence. */
export function WorkTrafficEvidence() {
  const context = useSeoRange();
  const { range, comparison } = context;
  const [country] = useSeoCountry();
  return <section aria-label="工作任务流量依据">
    <div className={styles.sectionHeading}><h2>Flatkey 自然搜索效果</h2><SeoDateControl value={context} /></div>
    <p className={styles.muted}>用于判断任务优先级；日期按数据来源统计，独立于工作周。其他站点的逐页数据在页面优化中查看。</p>
    <SessionSeoReport range={range} comparison={comparison} showSourceSummary>
      {country === "all" ? <SeoHistoryDisclosure>
        <SeoPeriodSummary range={range} comparison={comparison} />
        <DailySeoTrafficTrend {...range} expanded />
        <DailySeoPageGroups {...range} category="all" />
      </SeoHistoryDisclosure> : null}
    </SessionSeoReport>
  </section>;
}
