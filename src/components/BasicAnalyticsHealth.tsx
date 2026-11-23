"use client";
import { FeedbackButton } from "./FeedbackButton";
import styles from "./SeoPageCatalog.module.css";
import type { DateRange } from "@/lib/seo-date-range";
import type { SeoCountry } from "@/lib/seo";
import type { BasicAnalyticsHealth as Health } from "@/lib/analytics-health";
import { useSeoRead, shanghaiStamp } from "./useSeoAnalytics";
export function BasicAnalyticsHealth({ range, country }: { range: DateRange; country: SeoCountry }) {
  const read = useSeoRead<Health>("/api/seo/analytics/health?" + new URLSearchParams({ ...range, country }));
  const text = (metric: Health["sites"][number]["sessions"]) => `${metric.measuredDays}/${metric.expectedDays} 日`;
  return <section className="dailyPanel" aria-label="基础数据完整性">
    <h2>基础数据完整性</h2>
    <p>{range.start} — {range.end} · {country === "all" ? "全部国家" : country}。自然会话与搜索点击曝光独立验收；注册未知不影响会话判断。</p>
    {read.error ? <p role="alert">读取失败，不能判定为正常。<FeedbackButton onClick={read.retry} pending={read.pending} pendingLabel="正在读取…">重试</FeedbackButton></p> : !read.data ? <p role="status">正在检查逐日归档…</p> : <>
      <div className={styles.scroll}><table className={styles.table}><thead><tr><th>站点</th><th>自然会话</th><th>搜索点击/曝光</th><th>基础归档</th><th>页面覆盖（完整日）</th><th>注册</th></tr></thead>
        <tbody>{read.data.sites.map(site => <tr key={site.site}><th scope="row">{site.name}</th><td>{text(site.sessions)}</td><td>{text(site.search)}</td><td>{site.basicReady ? "区间完整" : "存在缺日或未知"}</td><td>{site.pages ? `会话 ${text(site.pages.sessions)}；搜索 ${text(site.pages.search)}` : "本项仅核对站点流量"}</td><td>{site.registrations.status === "ready" ? text(site.registrations) : `待核实 · ${text(site.registrations)}`}</td></tr>)}</tbody></table></div>
      <details><summary>查看缺日与来源时间</summary>{read.data.sites.map(site => <div key={site.site}><h3>{site.name}</h3>{([['sessions','自然会话'],['search','搜索点击/曝光'],['registrations','注册']] as const).map(([key,label]) => <p key={key}>{label}：未归档 {site[key].missingDates.join('、') || '无'}；已有归档但指标未知 {site[key].unknownDates.join('、') || '无'}；最近观测 {site[key].observedAt ? shanghaiStamp(site[key].observedAt!) : '未知'}</p>)}</div>)}</details>
      <p>按各属性已结束日期检查。GSC 未归档可能包含发布延迟，不能直接认定漏采；页面覆盖列仅统计可确认完整的天数，覆盖不足不影响独立站点总量。0 为已核实数值，缺日与未知不会补成0。</p>
    </>}
  </section>;
}
