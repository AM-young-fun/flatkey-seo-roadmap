"use client";

import { useState } from "react";
import type { GrowthCohortEvaluation } from "@/lib/growth-strategy";
import styles from "./GrowthProgressViews.module.css";

const views = { quarter: "冻结季度", weekly: "每周新增", platform: "全平台" } as const;
const number = (value: number) => value.toLocaleString("zh-CN");
const percent = (value: number | null) => value === null ? "暂无可计算排名" : `${(value * 100).toFixed(1)}%`;

function CohortProgress({ cohort }: { cohort: GrowthCohortEvaluation }) {
  const achieved = cohort.complete && cohort.targetCount > 0 && cohort.coverage !== null && cohort.coverage >= .6 && cohort.quality !== null && cohort.quality >= .8;
  return <article className={styles.card}>
    <header><div><h4>{cohort.label}</h4><span>独立截止日：{cohort.deadline}</span></div><span className={styles.status} data-achieved={achieved || undefined}>{achieved ? "已达标" : cohort.complete ? "待提升" : "证据未齐"}</span></header>
    <div className={styles.metrics}>
      <div><span>正式目标组合</span><strong>{number(cohort.targetCount)}</strong><small>已核验 {number(cohort.verifiedCount)} / {number(cohort.targetCount)}</small></div>
      <div><span>前100覆盖 · 目标60%</span><strong>{percent(cohort.coverage)}</strong><small>{number(cohort.rankedCount)} / {number(cohort.targetCount)} · 距目标差 {number(cohort.coverageGap)} 个</small><progress aria-label={`${cohort.label}前100覆盖，目标60%`} max={.6} value={Math.min(cohort.coverage ?? 0, .6)} /></div>
      <div><span>已有排名中前50 · 目标80%</span><strong>{percent(cohort.quality)}</strong><small>{number(cohort.top50Count)} / {number(cohort.rankedCount)}{cohort.qualityGap === null ? " · 待有效排名" : ` · 距目标差 ${number(cohort.qualityGap)} 个`}</small><progress aria-label={`${cohort.label}前50质量，目标80%`} max={.8} value={Math.min(cohort.quality ?? 0, .8)} /></div>
    </div>
    <p>{cohort.latestRankAt ? `最新有效采样：${cohort.latestRankAt}。` : "尚无当前有效实查。"}{cohort.complete ? "" : "未知、缺采目标保留在分母；当前为已确认部分，暂不判定达标。"}</p>
  </article>;
}

/** Each view consumes its own server-evaluated cohort; new batches never grow the frozen denominator. */
export function GrowthProgressViews({ cohorts, initialView = "quarter" }: { cohorts?: GrowthCohortEvaluation[]; initialView?: keyof typeof views }) {
  const [view, setView] = useState<keyof typeof views>(initialView);
  const selected = (cohorts || []).filter(cohort => cohort.kind === view);
  return <section className={styles.root} aria-label="季度、新增批次与全平台进度">
    <div className={styles.tabs} role="group" aria-label="关键词目标进度视图">{Object.entries(views).map(([kind, label]) => <button key={kind} type="button" aria-pressed={view === kind} onClick={() => setView(kind as keyof typeof views)}>{label}{kind === "weekly" && cohorts ? <span>{cohorts.filter(cohort => cohort.kind === "weekly").length}</span> : null}</button>)}</div>
    <p className={styles.note}>{view === "quarter" ? "本季原始正式目标清单冻结后单独验收；后续新增词不改变这一分母。" : view === "weekly" ? "每个接纳批次保留各自清单和期限，分别验收60%前100覆盖及80%前50质量。" : "按当前全部正式规划目标去重，包含规划中、进行中及已完成目标；与冻结季度、新增批次分别展示。"}</p>
    {selected.length ? selected.map(cohort => <CohortProgress key={cohort.id} cohort={cohort} />) : <p className={styles.empty}>{!cohorts ? "此历史快照尚未保存三组进度，保留原快照，不用当前数据覆盖。" : view === "quarter" ? "季度基线待核定，尚未形成冻结季度进度。" : view === "weekly" ? "尚无已接纳的新增批次；未接纳候选不计入新增目标。" : "尚无可核实的全平台正式目标进度。"}</p>}
  </section>;
}
