"use client";

import { useState } from "react";
import type { GrowthKeywordCatalogPage } from "@/lib/growth-keyword-catalog";
import { KeywordCategories, KeywordPages, KeywordTopics } from "./KeywordTableCells";
import { SeoTablePagination } from "./SeoTablePagination";
import { useSeoRead } from "./useSeoAnalytics";
import styles from "./GrowthTopicWorkspace.module.css";

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
      <label className={styles.search}>搜索网址、路由、关键词或话题<input maxLength={2000} placeholder="例如 /blog/gpu、GPU rental" value={search} onChange={event => { setSearch(event.target.value); setPage(1); }} /></label>
    </div>
    {read.error ? <p role="alert">{read.error} <button type="button" onClick={read.retry}>重新加载</button></p>
      : !data ? <p role="status">正在汇总关键词…</p> : <>
        <p className={styles.note}>{data.pagination.total.toLocaleString("zh-CN")} 个原词</p>
        {data.rows.length ? <div className={styles.tableScroll} aria-busy={read.pending}><table className={styles.table}>
          <thead><tr><th>关键词</th><th>话题</th><th>分类</th><th>市场</th><th>关联页面</th></tr></thead>
          <tbody>{data.rows.map(row => <tr key={row.keyword}>
            <th scope="row"><strong>{row.keyword}</strong></th>
            <td><KeywordTopics topics={row.topics} /></td>
            <td><KeywordCategories categories={row.categories} /></td>
            <td>{row.countries.map(code => countries.of(code)).join("、") || "—"}</td>
            <td><KeywordPages urls={row.urls} /></td>
          </tr>)}</tbody>
        </table></div> : <p className={styles.empty}>没有符合条件的关键词。</p>}
        <SeoTablePagination pagination={data.pagination} onPage={setPage} />
      </>}
  </section>;
}
