"use client";

import { useMemo, useState } from "react";
import type { pageQueryView } from "@/lib/seo-analytics";
import type { DateRange } from "@/lib/seo-date-range";
import type { SeoCountry } from "@/lib/seo";
import { analyticsUrl, numberText, useSeoRead } from "./useSeoAnalytics";
import styles from "./SeoPageCatalog.module.css";

const columns = { position: "GSC 平均排名", impressions: "曝光", clicks: "点击" };
type Sort = keyof typeof columns;
const pageSize = 25;

export function SeoPageQueries({ range, url, country }: { range: DateRange; url: string; country: SeoCountry }) {
  const { data, error, retry } = useSeoRead<ReturnType<typeof pageQueryView>>(
    analyticsUrl(range, [url], country) + "&pageQueries=1",
  );
  const [sort, setSort] = useState<Sort>("impressions");
  const [ascending, setAscending] = useState(false);
  const [page, setPage] = useState(1);
  const rows = useMemo(() => [...(data?.rows ?? [])].sort((left, right) => {
    const a = left[sort], b = right[sort];
    if (a == null || b == null) return Number(a == null) - Number(b == null);
    return (ascending ? a - b : b - a) || left.query.localeCompare(right.query);
  }), [data, sort, ascending]);
  const pageCount = Math.ceil(rows.length / pageSize);
  const current = Math.min(page, Math.max(1, pageCount));

  return <section className={styles.querySection} aria-label="该页面的 Google 搜索词">
    <h3>该页面的 Google 搜索词</h3>
    {error ? <p role="alert">{error} <button onClick={retry}>重试</button></p>
      : !data ? <p className={styles.note}>正在读取搜索词…</p>
      : rows.length === 0 ? <p className={styles.note}>所选周期暂无该页面的搜索词记录。</p>
      : <>
        {data.partial ? <p className={styles.note}>部分数据 · 仅显示已归档的搜索词</p> : null}
        <div className={styles.scroll}><table className={`${styles.daily} ${styles.queryTable}`}>
          <thead><tr><th scope="col">搜索词</th>
            {(Object.keys(columns) as Sort[]).map(key => <th scope="col" key={key} aria-sort={sort === key ? ascending ? "ascending" : "descending" : "none"}>
              <button onClick={() => { setAscending(sort === key ? !ascending : key === "position"); setSort(key); setPage(1); }}>
                {columns[key]}{sort === key ? ascending ? " ↑" : " ↓" : ""}
              </button>
            </th>)}<th scope="col">点击率</th>
          </tr></thead>
          <tbody>{rows.slice((current - 1) * pageSize, current * pageSize).map(row =>
            <tr key={row.query}>
              <th scope="row">{row.query}</th>
              <td>{row.position?.toFixed(1) ?? "—"}</td><td>{numberText(row.impressions)}</td><td>{numberText(row.clicks)}</td>
              <td>{row.impressions ? (100 * row.clicks / row.impressions).toFixed(1) + "%" : "—"}</td>
            </tr>,
          )}</tbody>
        </table></div>
        {pageCount > 1 ? <div className={styles.footer}><span>{numberText(rows.length)} 条</span><div>
          <button disabled={current <= 1} onClick={() => setPage(current - 1)}>上一页</button>
          <span>第 {current} / {pageCount} 页</span>
          <button disabled={current >= pageCount} onClick={() => setPage(current + 1)}>下一页</button>
        </div></div> : null}
      </>}
  </section>;
}
