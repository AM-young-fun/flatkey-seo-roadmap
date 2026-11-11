"use client";

import { useState } from "react";
import Link from "next/link";
import type { BusinessAnalytics } from "@/lib/seo-business-analytics";
import { businessEventLabels } from "@/lib/seo-business-events";
import type { DateRange } from "@/lib/seo-date-range";
import { useSeoCountry } from "./useSeoCountry";
import { useSeoRead, numberText, shanghaiStamp } from "./useSeoAnalytics";
import { UiSelect } from "./UiSelect";
import { SeoApiCohorts, type CohortPeriodLink } from "./SeoApiCohorts";
import styles from "./SeoBusinessAnalytics.module.css";

export function SeoBusinessAnalytics({ range, onCohortRangeSelect }: { range: DateRange; onCohortRangeSelect: (range: DateRange) => void }) {
  const [country] = useSeoCountry(), [scope, setScope] = useState<BusinessAnalytics["scope"]>("session-organic-search");
  const { data, error, retry } = useSeoRead<{ record: BusinessAnalytics | null; cohortPeriods?: CohortPeriodLink[]; status: string; message?: string }>("/api/seo/business?" + new URLSearchParams({ ...range, country, scope }));
  const record = data?.record;
  return <section className={styles.panel} aria-labelledby="business-analytics-title">
    <div className={styles.header}><h2 id="business-analytics-title">用户行为与转化</h2><div>
      <UiSelect aria-label="业务归因范围" value={scope} onChange={value => setScope(value as BusinessAnalytics["scope"])} options={[{ value: "session-organic-search", label: "自然搜索归因" }, { value: "all-channels", label: "全渠道业务" }]} />
      <button type="button" onClick={retry}>刷新</button></div></div>
    <p className={styles.note}>Flatkey · GA4 · {range.start}—{range.end} · {country === "all" ? "全部国家" : country}</p>
    {error ? <p role="alert">{error}</p> : !data ? <p role="status">正在读取业务回执…</p> : !record ? <p className={styles.note}>{data.message ?? "暂无同区间业务数据。事件代码、生产收数与归因需逐项验收；缺失不补0。"}</p> : <p className={styles.note}>{record.complete ? "查询完整" : "部分数据"} · 数据时区 {record.timezone} · 采集 {shanghaiStamp(record.observedAt)}{record.reasons.length ? " · " + record.reasons.join("、") : ""}</p>}
    <div className={styles.table}><table><thead><tr><th>事件</th><th>次数</th><th>区间去重人数</th></tr></thead><tbody>
      {Object.entries(businessEventLabels).map(([event, label]) => { const row = record?.rows.find(value => value.event === event); return <tr key={event}><td>{label}</td><td>{numberText(row?.events)}</td><td>{numberText(row?.users)}</td></tr>; })}
    </tbody></table></div>
    <h3>同用户顺序漏斗</h3>
    {scope !== "all-channels" ? <p className={styles.note}>切换“全渠道业务”查看 GPU 与 API 顺序漏斗；自然搜索事件归因另列。</p> : !record?.journeys ? <p className={styles.note}>尚无漏斗回执。不会用不同事件总人数推算转化率。</p> : record.journeys.map(journey => <div key={journey.business}>
      <strong>{journey.business === "gpu" ? "GPU 租赁" : "API 使用与付款"}</strong>
      {journey.status === "unavailable" ? <p className={styles.note}>查询待核验 · {journey.reason}</p> : <><p className={styles.note}>{journey.status === "partial" ? "部分数据 · " : ""}{journey.steps.map(step => `${step.name} ${numberText(step.users)} 人`).join(" → ")}</p>
      <p className={styles.note}>{journey.steps.slice(0, -1).map(step => `${step.name}后流失 ${numberText(step.abandonments)} 人`).join(" · ")}</p></>}
    </div>)}
    <p className={styles.note}>封闭漏斗按 GA4 报告身份识别同一用户，允许中间有其他事件。GPU 每步最长24小时；API 注册到首次使用最长7天、首次使用到首次付款最长30天。所有步骤必须落在当前所选日期内，不是成熟注册 cohort 转化率。</p>
    <SeoApiCohorts cohorts={record?.apiCohorts} range={range} periods={data?.cohortPeriods} onRangeSelect={onCohortRangeSelect} collectionPresent={Boolean(record)} />
    <h3>参与与停留</h3><p className={styles.note}>GA4 有效参与时长：{record?.engagement?.engagementSeconds === null || record?.engagement?.engagementSeconds === undefined ? "待更新" : `${numberText(record.engagement.engagementSeconds)} 秒`} · 活跃人数：{numberText(record?.engagement?.activeUsers)}{record?.engagement?.status === "partial" ? " · 部分数据" : ""}</p>
    <p className={styles.note}>自定义 active_time_msec：{record?.engagement?.activeTimeCustomMetric === "registered" ? "已注册；页面明细需另查" : "指标定义待核验"}。有效参与时长来自 GA4 标准指标，不等同单页总打开时间。</p>
    <details><summary>指标口径与路径分析</summary><p className={styles.note}>人数按整个所选区间查询，不累加每日人数；不同事件用户不能相加或直接计算漏斗率。首次付款与全部付款事件不相加。重试可能重复上报，事件次数不等于唯一订单数；订单及金额需与业务账本核对。此表不能还原用户路径。路径、停留及步骤流失在 GA4 探索中按已验收事件分析。</p>
      <a href="https://analytics.google.com/analytics/web/#/a248149353p541304395/analysis" target="_blank" rel="noreferrer">打开 GA4 探索 ↗</a><Link href="/issues#issue-ga4-business-journey-pending">查看埋点验收待办 →</Link>
    </details>
  </section>;
}
