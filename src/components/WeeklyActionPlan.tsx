"use client";

import Link from "next/link";
import { useState } from "react";
import type { WeeklyActionPlan as Plan } from "@/lib/seo-weekly-actions";
import { REGIONS } from "@/lib/seo";
import { useSeoCountry } from "./useSeoCountry";
import { shiftDay } from "@/lib/seo-date-range";
import { numberText, shanghaiStamp, useSeoRead } from "./useSeoAnalytics";
import styles from "./WeeklyActionPlan.module.css";

const pageLabel = (url: string) => { const value = new URL(url); return value.pathname + value.search || "/"; };

export function WeeklyActionPlan({ periodStart }: { periodStart?: string }) {
  const [country] = useSeoCountry();
  const result = useSeoRead<{ periodStart: string | null; plan: Plan | null }>(`/api/seo/weekly-actions?week=${encodeURIComponent(periodStart ?? "latest")}`);
  const [all, setAll] = useState(false);
  const [beijingWeek] = useState(() => {
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(new Date());
    return shiftDay(today, -((new Date(today + "T00:00:00Z").getUTCDay() + 2) % 7));
  });
  const plan = result.data?.plan;
  const matching = plan?.actions.filter(item => country === "all" || item.country === country) ?? [];
  const actions = matching.slice(0, all ? 10 : 5);
  return <section className={styles.section} aria-labelledby="weekly-actions-heading">
    <div className={styles.heading}><h2 id="weekly-actions-heading">每周优化清单</h2><Link href={country === "all" ? "/opportunities" : "/opportunities?country=" + country}>查看关键词机会 →</Link></div>
    {plan ? <>
      <p className={styles.workWeek}><strong>工作周 {plan.periodStart} — {shiftDay(plan.periodStart, 6)}</strong><span>{plan.periodStart < beijingWeek ? "历史工作周 · " : plan.periodStart > beijingWeek ? "未来工作周 · " : ""}{plan.status === "reviewed" ? "已核对" : "待核对草案"}</span></p>
      <p className={styles.meta}>{matching.length} 个关键词 · {shanghaiStamp(plan.preparedAt)} 整理（北京时间）</p>
      <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th scope="col">关键词</th><th scope="col">页面</th><th scope="col">下一步动作</th></tr></thead><tbody>
        {actions.map(item => <tr key={item.pageUrl + item.country + item.keyword}>
          <td data-label="关键词"><strong>{item.keyword}</strong><small>{REGIONS[item.country].label} · {item.role === "primary" ? "主词" : "辅助词"}</small></td>
          <td data-label="页面"><a href={item.pageUrl} target="_blank" rel="noreferrer">{pageLabel(item.pageUrl)}</a></td>
          <td data-label="下一步动作">{item.action}</td>
        </tr>)}
      </tbody></table></div>
      {matching.length > 5 ? <button type="button" className={styles.textButton} onClick={() => setAll(value => !value)}>{all ? "收起" : `展开全部 ${matching.length} 个关键词`}</button> : null}
      <details className={styles.evidence}><summary>查看排名、预估和判断依据</summary>
        {matching.map(item => <article key={item.pageUrl + item.country + item.keyword}>
          <h3>{item.keyword} · {REGIONS[item.country].label}</h3>
          <p>当前排名 {numberText(item.currentRank)} · 目标排名 {numberText(item.targetRank)} · 月搜索量 {numberText(item.monthlySearchVolume)}</p>
          <p>{item.reason}</p>
          <p>{item.estimatedClicks === null ? "预估月点击：待核对目标排名与 CTR 假设后填写。" : `预估月点击 ${numberText(item.estimatedClicks)}，假设目标排名 ${item.targetRank} 的 CTR 为 ${((item.ctrAssumption ?? 0) * 100).toFixed(1)}%。这是情景估算。`}</p>
        </article>)}
        <div className={styles.sources}><h3>数据来源</h3>{plan.sources.map((source, index) => <p key={index}>{source.date} · {source.url ? <a href={source.url} target="_blank" rel="noreferrer">{source.name} ↗</a> : source.name}</p>)}</div>
      </details>
    </> : result.error ? <div className={styles.empty}><p role="alert">{result.error}</p><button type="button" className={styles.textButton} onClick={result.retry}>重新读取</button></div>
      : result.data ? <p className={styles.empty}>尚未生成优化清单。每周五北京时间 10:10 核对关键词与页面，整理新工作周的动作。</p>
      : <p className={styles.empty}>正在读取优化清单…</p>}
  </section>;
}
