"use client";

import type { GrowthWorkspace } from "@/lib/growth-types";
import { useSeoRead } from "./useSeoAnalytics";
import styles from "./GrowthHistoricalReview.module.css";
import type { TrendPoint } from "@/lib/ranking-trends";
import { REGIONS } from "@/lib/seo";

/** Versioned language projection, never a replacement for the original period snapshots. */
export function GrowthHistoricalReview({ points }: { points?: TrendPoint[] } = {}) {
  return points ? <NativeHistory points={points} /> : <OriginalHistory />;
}
function NativeHistory({ points }: { points: TrendPoint[] }) {
  return <details className={styles.root}><summary>历史期次与原词语种去重核对</summary>
    <p>原始快照保留。只采用原词语言与实际采样国家相符的结果；同一关键词跨国家、跨站只计一次，保留有效最佳名次及其原国家。未知语种不算无排名，不把其他国家结果搬到目标国家。</p>
    {points.length ? <div className={styles.scroll}><table><thead><tr><th>原期次</th><th>原词去重数</th><th>非品牌词</th><th>已确认上榜</th><th>语种待核</th><th>国家归属</th></tr></thead><tbody>{points.map(point => <tr key={point.periodKey ?? point.date}>
      <th scope="row">{point.periodLabel ?? point.date}</th><td>{point.languageProjection?.rawTotal ?? "未核定"}</td><td>{point.total}</td><td>{point.ranked}</td><td>{point.languageProjection?.unknownLanguageWords ?? "未核定"}</td>
      <td>{point.languageProjection?.countryCounts.map(row => `${REGIONS[row.country].label} ${row.count}`).join(" · ")}<small>各期采样范围不同，不计算环比</small></td>
    </tr>)}</tbody></table></div> : <p>历史语种校正投影尚未读取，不用旧汇总代替。</p>}
  </details>;
}
function OriginalHistory() {
  const { data, error, retry } = useSeoRead<GrowthWorkspace>("/api/seo/growth");
  const review = data?.reconciliation.historicalLanguageReview;
  return <details className={styles.root}><summary>历史期次、采集范围与关键词语种复核</summary>
    {error ? <p role="alert">历史复核暂时无法读取。<button type="button" onClick={retry}>重新读取</button></p> : !review ? <p role="status">正在读取已存历史观察的语种复核…</p> : <>
      <p>{review.reason}。原值、原国家和实际采样时间保留；复核不会把中国结果转成新加坡，也不会把日本英语结果转成美国排名。</p>
      <p>历史观察行 {review.rows} · 语种匹配 {review.matched} · 不匹配 {review.mismatched} · 待核 {review.unknown}。这些行数与正式目标分母分别统计。</p>
      {review.periods?.length ? <div className={styles.scroll}><table><thead><tr><th>原期次 / 范围</th><th>原目标 / 原查询分母</th><th>完整实查查询</th><th>匹配语种且上榜目标</th><th>语种待核 / 不匹配</th><th>原集合标识</th></tr></thead><tbody>{review.periods.map(period => <tr key={period.id}>
        <th scope="row">{period.label}<small>{period.scope}</small><small>{period.id}</small></th>
        <td>{period.originalTargetCount ?? "未保存"} / {period.originalQueryCount ?? "未保存"}</td><td>{period.checkedQueries}</td><td>{period.matchedRankedTargets}</td><td>{period.unknownLanguageTargets} / {period.mismatchedLanguageTargets}</td><td><code>{period.cohortHash || "未保存"}</code><small>不可比；原快照保留</small></td>
      </tr>)}</tbody></table></div> : <p>本次来源未提供逐期复核，保留原图离散观察，暂不计算环比。</p>}
    </>}
  </details>;
}
