"use client";

import { useEffect, useRef } from "react";
import { indexing404Trend, type Indexing404Response } from "@/lib/seo-indexing-404";
import { LinePlot } from "./OverviewCharts";
import { SeoAnchor } from "./SeoAnchor";
import { numberText, shanghaiStamp, useSeoRead } from "./useSeoAnalytics";
import styles from "./SeoIndexing404.module.css";

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
          <div><span>较上次采集</span><strong>{latest.change != null && latest.change > 0 ? "+" : ""}{numberText(latest.change)}</strong></div>
          <div><span>Google 报告日期</span><strong>{latest.reportDate ?? "待取得"}</strong></div>
          <div><span>Google 验证状态</span><strong>{latest.validation ?? "待取得"}</strong></div>
        </div>
        <p>GSC 最新采集于 <time dateTime={latest.observedAt}>{shanghaiStamp(latest.observedAt)}</time>（北京时间）。{latest.decision ?? "尚无本次处置记录。"}</p>
        <div className={styles.trend}>
          <h4>404 数量趋势</h4>
          <small>按北京时间采集日绘制近 30 天的 Google 报告总数。</small>
          <LinePlot rows={indexing404Trend(history, throughDate)} unit="页" />
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
