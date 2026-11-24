"use client";

import type { ReactNode } from "react";
import styles from "./OverviewCharts.module.css";
import { SeoAnchor } from "@/components/SeoAnchor";


export const chartNumber = (value: number | null | undefined) => value == null ? "—" : value.toLocaleString("zh-CN", { maximumFractionDigits: 1 });
export function ChartPanel({ title, note, children, className = "" }: { title: string; note: string; children: ReactNode; className?: string }) {
  return <section className={`${styles.panel} ${className}`}><header><h2>{title}</h2><p>{note}</p></header>{children}</section>;
}
export function EmptyPlot({ reason }: { reason: string }) {
  return <div className={styles.empty} role="img" aria-label={`暂无可绘制数据：${reason}`}><svg viewBox="0 0 300 85" aria-hidden="true"><path d="M15 8V70H290 M15 28H290 M15 49H290" /></svg><span>{reason}</span></div>;
}
export function GoalPlot({ label, value, goal, unit, denominator, note }: { label: string; value: number | null; goal: number; unit: string; denominator: string; note: string }) {
  const maximum = Math.max(goal * 1.15, value ?? 0, unit === "%" ? 100 : 1);
  return <figure className={styles.goal}><figcaption><h3>{label}</h3><strong>{chartNumber(value)}<small>{unit}</small></strong></figcaption>
    <svg viewBox="0 0 360 62" role="img" aria-label={`${label}：${chartNumber(value)}${unit}，目标${goal}${unit}；${denominator}`}>
      <rect x="4" y="18" width="352" height="16" rx="5" fill="#edf1f6" />
      {value !== null ? <rect x="4" y="18" width={Math.max(0, value / maximum * 352)} height="16" rx="5" fill="#4285dc" /> : <text x="180" y="30" textAnchor="middle" fill="#718096" fontSize="10">暂缺有效数值</text>}
      <path d={`M${4 + goal / maximum * 352} 12v28`} stroke="#182b48" strokeWidth="2" />
      <text x="4" y="56" fill="#738197" fontSize="11">0 {unit}</text><text x="356" y="56" textAnchor="end" fill="#526680" fontSize="11">目标 {goal.toLocaleString()} {unit}</text>
    </svg><p>{denominator}</p><small>{note}</small></figure>;
}
export type BarDatum = { label: string; value: number | null; prior?: number | null; color?: string; href?: string; suffix?: string };
export function BarPlot({ rows, unit, denominator, empty = "暂无可核实数据", signed = false }: { rows: BarDatum[]; unit: string; denominator: string; empty?: string; signed?: boolean }) {
  const known = rows.filter(row => row.value !== null || typeof row.prior === "number");
  const maximum = unit === "%" ? 100 : Math.max(1, ...known.flatMap(row => [Math.abs(row.value ?? 0), Math.abs(row.prior ?? 0)]));
  return <figure className={styles.bars}><div className={styles.axis}>单位：{unit} · {known.length ? `刻度0—${chartNumber(maximum)}` : "暂无有效数值"} · {denominator}{rows.some(row => row.prior !== undefined) ? <span>浅色：上期 深色：本期</span> : null}</div>
    {!known.length ? <EmptyPlot reason={empty} /> : null}
    {rows.map((row, index) => <div className={styles.barRow} key={`${row.label}:${index}`}><span title={row.label}>{row.href ? <SeoAnchor href={row.href}>{row.label}</SeoAnchor> : row.label}</span><div className={styles.barTrack} data-signed={signed || undefined}>
      {signed ? <i className={styles.zero} /> : null}
      {row.prior != null ? <i className={styles.prior} style={{ width: `${Math.abs(row.prior) / maximum * 100}%` }} /> : null}
      {row.value !== null ? <i className={styles.bar} style={{ width: `${Math.abs(row.value) / maximum * (signed ? 50 : 100)}%`, ...(signed ? { left: row.value < 0 ? `${50 - Math.abs(row.value) / maximum * 50}%` : "50%" } : {}), background: row.color ?? (row.value < 0 ? "#d16e6b" : "#4b87d5") }} /> : null}
    </div><strong>{row.value === null ? "—" : `${signed && row.value > 0 ? "+" : ""}${chartNumber(row.value)}`}{row.suffix ? <small>{row.suffix}</small> : null}</strong></div>)}
  </figure>;
}
export type LineDatum = { label: string; value: number | null; prior?: number | null };
/** Gaps remain gaps. Previous observations align by ordinal day and retain their own dates in labels. */
export function LinePlot({ rows, unit, priorLabel }: { rows: LineDatum[]; unit: string; priorLabel?: string }) {
  const values = rows.flatMap(row => [row.value, row.prior]).filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (!values.length) return <EmptyPlot reason="所选周期暂无已归档的有效数据，缺口未记为0" />;
  const max = Math.max(1, ...values) * 1.12, x = (i: number) => 42 + i / Math.max(1, rows.length - 1) * 516, y = (v: number) => 182 - v / max * 150;
  const path = (key: "value" | "prior") => rows.map((row, i) => row[key] == null ? "" : `${i && rows[i - 1][key] != null ? "L" : "M"}${x(i)},${y(row[key]!)}`).join(" ");
  return <figure className={styles.line}><div className={styles.axis}>单位：{unit} · 深色：本期{priorLabel ? ` 浅色虚线：${priorLabel}` : ""}</div><svg viewBox="0 0 580 222" role="img" aria-label={`${unit}逐日趋势，缺失日期保留断点`}>
    {[0, .5, 1].map(ratio => <g key={ratio}><path d={`M42 ${y(max * ratio)}H558`} stroke="#e6ebf2" strokeDasharray="3 4" /><text x="35" y={y(max * ratio) + 4} textAnchor="end" fill="#718096" fontSize="11">{chartNumber(max * ratio)}</text></g>)}
    <path d={path("prior")} fill="none" stroke="#b7c8e0" strokeWidth="2" strokeDasharray="5 4" /><path d={path("value")} fill="none" stroke="#3478ca" strokeWidth="2.5" />
    {rows.map((row, i) => row.value == null ? null : <circle key={row.label} cx={x(i)} cy={y(row.value)} r="3" fill="#3478ca"><title>{`${row.label}：${chartNumber(row.value)} ${unit}${row.prior != null ? `；对比日 ${chartNumber(row.prior)} ${unit}` : ""}`}</title></circle>)}
    {rows.map((row, i) => i === 0 || i === rows.length - 1 || i === Math.floor(rows.length / 2) ? <text key={row.label} x={x(i)} y="210" textAnchor={i === 0 ? "start" : i === rows.length - 1 ? "end" : "middle"} fill="#718096" fontSize="11">{row.label}</text> : null)}
  </svg></figure>;
}
