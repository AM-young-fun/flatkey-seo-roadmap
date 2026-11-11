"use client";

import { SeoDateControl, useSeoRange } from "./SeoDateControl";
import { SessionSeoReport } from "./SessionSeoReport";
import { SeoHistoryDisclosure } from "./SeoHistoryDisclosure";
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
        <p>历史手采汇总未核验正式域名，暂不参与效果判断。原始记录保留；当前效果以上方已核验的自然搜索会话为准。</p>
      </SeoHistoryDisclosure> : null}
    </SessionSeoReport>
  </section>;
}
