import Link from "next/link";
import styles from "./BusinessMeasurementStatus.module.css";

export function BusinessMeasurementStatus({ compact = false }: { compact?: boolean }) {
  return <aside className={`${styles.panel}${compact ? ` ${styles.compact}` : ""}`} aria-label="业务数据接入状态">
    {compact ? <>
      <div><strong>业务测量待办</strong><Link href="/issues#issue-amplitude-organic-cohorts-pending">查看待办 →</Link></div>
      <p>自然来源 7 日激活率、30 日付费率待接入 Amplitude；尚未核验来源与观察窗口，当前不补 0。</p>
    </> : <>
    <div><strong>Amplitude 自然来源成熟队列待接入</strong><Link href="/issues#issue-amplitude-organic-cohorts-pending">查看接入待办 →</Link></div>
    <dl><div><dt>自然来源 7 日激活率</dt><dd>待接入</dd></div><div><dt>自然来源 30 日付费率</dt><dd>待接入</dd></div></dl>
    <p>服务端首次成功 / 付款事实和 SDK 事件不等于已完成归因报表。待后续授权后台读取，再核验自然来源、注册队列、观察窗口及覆盖后计算；当前不补 0。</p>
    </>}
  </aside>;
}
