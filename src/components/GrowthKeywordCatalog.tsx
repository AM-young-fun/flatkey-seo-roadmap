"use client";

import { useState } from "react";
import type { GrowthKeywordCatalogPage } from "@/lib/growth-keyword-catalog";
import { SeoAnchor } from "./SeoAnchor";
import { SeoTablePagination } from "./SeoTablePagination";
import { useSeoRead } from "./useSeoAnalytics";
import styles from "./GrowthTopicWorkspace.module.css";

const categoryLabels = { quarter: "季度关键词", hotspot: "近期热点词", published: "已有内容与排名" } as const;
const countries = new Intl.DisplayNames("zh-CN", { type: "region" });

export function GrowthKeywordCatalog() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const params = new URLSearchParams({ view: "keywords", page: String(page), q: search.trim() });
  const read = useSeoRead<GrowthKeywordCatalogPage>("/api/seo/growth?" + params, { showFeedback: false, keepPreviousData: true });
  const data = read.data ?? read.previousData;
  return <section className={styles.panel} aria-label="全部关键词">
    <h2 className={styles.panelTitle}>全部关键词</h2>
    <div className={`${styles.filters} ${styles.inventoryFilters}`}>
      <label className={styles.search}>搜索关键词<input maxLength={240} value={search} onChange={event => { setSearch(event.target.value); setPage(1); }} /></label>
    </div>
    {read.error ? <p role="alert">{read.error} <button type="button" onClick={read.retry}>重新加载</button></p>
      : !data ? <p role="status">正在汇总关键词…</p> : <>
        <p className={styles.note}>{data.pagination.total.toLocaleString("zh-CN")} 个原词</p>
        {data.rows.length ? <div className={styles.tableScroll} aria-busy={read.pending}><table className={styles.table}>
          <thead><tr><th>原关键词</th><th>所属分类</th><th>市场</th><th>关联页面</th></tr></thead>
          <tbody>{data.rows.map(row => <tr key={row.keyword}>
            <th scope="row"><strong>{row.keyword}</strong></th>
            <td>{row.categories.map(key => categoryLabels[key]).join("、")}</td>
            <td>{row.countries.map(code => countries.of(code)).join("、") || "—"}</td>
            <td>{row.urls.length ? row.urls.map(url => <div key={url} className={styles.capturePage}><SeoAnchor href={url} target="_blank" rel="noreferrer">{url}</SeoAnchor></div>) : "—"}</td>
          </tr>)}</tbody>
        </table></div> : <p className={styles.empty}>没有符合条件的关键词。</p>}
        <SeoTablePagination pagination={data.pagination} onPage={setPage} />
      </>}
  </section>;
}
