import Link from "next/link";
import styles from "./BusinessMeasurementStatus.module.css";

export function BusinessMeasurementStatus({ compact = false }: { compact?: boolean }) {
  return <aside className={`${styles.panel}${compact ? ` ${styles.compact}` : ""}`} aria-label="业务数据接入状态">
    {compact ? <>
      <div><strong>用户行为与转化</strong><Link href="/issues#issue-ga4-business-journey-pending">查看接入待办 →</Link></div>
      <p>GA4 行为链路待完善 · GPU 租赁、API 使用与付费、用户路径待核验。</p>
    </> : <>
    <div><strong>用户行为与转化</strong><Link href="/issues#issue-ga4-business-journey-pending">查看接入待办 →</Link></div>
    <dl><div><dt>GPU 成功租赁</dt><dd>待接入</dd></div><div><dt>API 首次成功使用 / 付费</dt><dd>待接入</dd></div><div><dt>用户路径 / 停留 / 流失</dt><dd>待接入</dd></div></dl>
    <details><summary>数据口径</summary><p>GA4 已有访问采集；业务事件、用户路径与来源关联尚待验收。GPU 以成功租赁衡量转化；API 首次成功响应与付费分别统计。转化率需核实观察窗口，缺失数据不补 0。</p></details>
    </>}
  </aside>;
}
