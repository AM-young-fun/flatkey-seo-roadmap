"use client";

import { useEffect, useRef } from "react";
import { indexing404Trend, type Indexing404Response } from "@/lib/seo-indexing-404";
import { SeoAnchor } from "./SeoAnchor";
import { numberText, shanghaiStamp, useSeoRead } from "./useSeoAnalytics";
import styles from "./SeoIndexing404.module.css";

function IndexingTrend({ rows }: { rows: ReturnType<typeof indexing404Trend> }) {
  const first = rows.findIndex(row => row.value !== null);
  if (first < 0) return null;
  const last = rows.length - 1 - [...rows].reverse().findIndex(row => row.value !== null);
  const trend = rows.slice(first, last + 1);
  const counts = trend.flatMap(row => row.value === null ? [] : [row.value]);
  const min = Math.min(...counts), max = Math.max(...counts);
  const step = Math.max(1, 10 ** Math.floor(Math.log10(Math.max(1, (max - min) / 2))));
  const bottom = Math.max(0, Math.floor(min / step) * step - step);
  const top = Math.ceil(max / step) * step + step;
  const ticks = [top, Math.round((top + bottom) / 2), bottom];
  const x = (index: number) => trend.length === 1 ? 50 : 2 + index / (trend.length - 1) * 96;
  const y = (value: number) => (top - value) * 100 / (top - bottom);
  const path = trend.map((row, index) => row.value === null ? "" :
    `${index > 0 && trend[index - 1].value !== null ? "L" : "M"}${x(index)},${y(row.value)}`).join(" ");
  const labels = [...new Set([0, ...(trend.length > 4 ? [Math.floor((trend.length - 1) / 2)] : []), trend.length - 1])];
  return <figure className={styles.figure} aria-label={`404 数量趋势，共 ${counts.length} 天采集记录，最近一次 ${numberText(counts.at(-1))} 页`}>
    <div className={styles.axis} aria-hidden="true">{ticks.map(value => <span key={value} style={{ top: `${y(value)}%` }}>{numberText(value)}</span>)}</div>
    <div className={styles.chart}>
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        {ticks.map(value => <line key={value} x1="0" x2="100" y1={y(value)} y2={y(value)} vectorEffect="non-scaling-stroke" />)}
        <path d={path} fill="none" vectorEffect="non-scaling-stroke" />
      </svg>
      {trend.map((row, index) => row.value === null ? null : <span key={row.label} className={styles.point}
        data-latest={index === trend.length - 1} title={`${row.label} · ${numberText(row.value)} 页`}
        aria-hidden="true" style={{ left: `${x(index)}%`, top: `${y(row.value)}%` }} />)}
    </div>
    <div className={styles.dates} aria-hidden="true">{labels.map(index => <span key={trend[index].label}>{trend[index].label.slice(5).replace("-", "/")}</span>)}</div>
  </figure>;
}

export function SeoIndexing404({ throughDate }: { throughDate?: string } = {}) {
  const query = throughDate ? `?${new URLSearchParams({ through: throughDate })}` : "";
  const result = useSeoRead<Indexing404Response>(`/api/seo/indexing-404${query}`, { showFeedback: false });
  const history = result.data?.observations ?? [];
  const latest = history[0];
  const section = useRef<HTMLElement>(null);
  useEffect(() => {
    if (location.hash === "#seo-indexing-404") section.current?.scrollIntoView();
  }, []);
  return <section ref={section} id="seo-indexing-404" className={styles.panel} aria-labelledby="seo-indexing-404-title">
    <div className={styles.heading}>
      <h3 id="seo-indexing-404-title">Flatkey 网页索引 · 404</h3>
      <SeoAnchor href="https://search.google.com/search-console/index?resource_id=sc-domain%3Aflatkey.ai" target="_blank" rel="noopener noreferrer">打开 Search Console ↗</SeoAnchor>
    </div>
    {result.error ? <p role="alert">404 记录暂时无法读取。 <button type="button" onClick={result.retry}>重试</button></p> :
      result.loading ? <p role="status">正在读取 404 记录…</p> :
      !latest ? <p>尚无 404 采集记录。</p> : <>
        <div className={styles.overview}>
          <div><span>Google 报告的 404 数量</span><strong>{numberText(latest.total)}</strong></div>
          <div><span>较上次采集</span><strong>{latest.change === 0 ? "持平" : `${latest.change != null && latest.change > 0 ? "+" : ""}${numberText(latest.change)}`}</strong></div>
          <div><span>Google 报告日期</span><strong>{latest.reportDate ?? "待取得"}</strong></div>
          <div><span>Google 验证状态</span><strong>{latest.validation ?? "待取得"}</strong></div>
        </div>
        <p>GSC 最新采集于 <time dateTime={latest.observedAt}>{shanghaiStamp(latest.observedAt)}</time>（北京时间）。{latest.decision ?? "尚无本次处置记录。"}</p>
        <div className={styles.trend}>
          <h4>404 数量趋势</h4>
          <small>近 30 天 · {history.length} 天有记录 · 单位：页 · 北京时间采集日</small>
          <IndexingTrend rows={indexing404Trend(history, throughDate)} />
        </div>
        <details className={styles.history}>
          <summary>查看每日记录</summary>
          <div className={styles.scroll}><table>
            <thead><tr><th scope="col">采集日</th><th scope="col">Google 报告日</th><th scope="col">404 数量</th><th scope="col">较上次</th><th scope="col">验证</th></tr></thead>
            <tbody>{history.map(row => <tr key={row.collectedDate}><td>{row.collectedDate}</td><td>{row.reportDate ?? "待取得"}</td><td>{numberText(row.total)}</td><td>{row.change != null && row.change > 0 ? "+" : ""}{numberText(row.change)}</td><td>{row.validation ?? "待取得"}</td></tr>)}</tbody>
          </table></div>
        </details>
      </>}
    <p className={styles.note}>范围为 Flatkey 域名的所有已知网页。Google 报告有更新延迟，示例清单只覆盖部分 URL。</p>
  </section>;
}
