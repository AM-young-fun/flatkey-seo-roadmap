"use client";

import { useState } from "react";
import type { ApprovedCaptureRankedWord } from "@/lib/approved-weekly-keyword-capture";
import { seoTablePage } from "@/lib/seo-table-page";
import { SeoAnchor } from "./SeoAnchor";
import { SeoTablePagination } from "./SeoTablePagination";
import { UiSelect } from "./UiSelect";
import { useSeoRead } from "./useSeoAnalytics";
import styles from "./GrowthTopicWorkspace.module.css";

const countryNames = new Intl.DisplayNames("zh-CN", { type: "region" });
const languageNames = new Intl.DisplayNames("zh-CN", { type: "language" });
const shanghaiDate = new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", dateStyle: "medium" });

export function GrowthPublishedCapture() {
  const read = useSeoRead<{ periodLabel: string; words: ApprovedCaptureRankedWord[] }>("/api/seo/growth?view=published-ranking-capture", { showFeedback: false });
  const [country, setCountry] = useState("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const query = search.trim().normalize("NFKC").toLowerCase();
  const words = read.data?.words ?? [];
  const countries = [...new Set(words.map(word => word.country))].sort();
  const { rows, ...pagination } = seoTablePage(words.filter(word =>
    (country === "all" || word.country === country) && word.keyword.normalize("NFKC").toLowerCase().includes(query)), page);
  return <section className={styles.panel} aria-label="11 月第 2 期实测">
    <h2 className={styles.panelTitle}>11 月第 2 期实测</h2>
    {read.error ? <p role="alert">{read.error} <button type="button" onClick={read.retry}>重新加载</button></p>
      : !read.data ? <p role="status">正在读取已核实的排名和页面…</p> : <>
        <p className={styles.note}>Flatkey 固定词库有 <strong>{words.length.toLocaleString("zh-CN")} 个原词</strong>进入 Google 自然搜索前 100。</p>
        <div className={styles.filters}>
          <label>查询国家 / 地区<UiSelect aria-label="查询国家或地区" value={country} onChange={value => { setCountry(value); setPage(1); }}
            options={[{ value: "all", label: "全部国家 / 地区" }, ...countries.map(value => ({ value, label: countryNames.of(value) ?? value }))]} /></label>
          <label className={styles.search}>搜索本期上榜关键词<input value={search} onChange={event => { setSearch(event.target.value); setPage(1); }} /></label>
        </div>
        {rows.length ? <div className={styles.tableScroll}><table className={styles.table}>
          <thead><tr><th>原关键词</th><th>查询国家 / 语种</th><th>最佳排名</th><th>实际排名页面</th><th>采集日期（北京时间）</th></tr></thead>
          <tbody>{rows.map(word => <tr key={word.keywordId}>
            <th scope="row"><strong>{word.keyword}</strong></th>
            <td>{countryNames.of(word.country)}{word.language ? ` · ${languageNames.of(word.language)}` : null}</td>
            <td>第 {word.bestRank} 名</td>
            <td>{word.pages.map(({ url, title, rank }) => <div key={url} className={styles.capturePage}>
              <SeoAnchor href={url} target="_blank" rel="noreferrer">{title || new URL(url).pathname}</SeoAnchor><small>第 {rank} 名 · {new URL(url).pathname}</small>
            </div>)}</td>
            <td>{shanghaiDate.format(new Date(word.checkedAt))}{word.reused ? <small>复用已保存回执</small> : null}</td>
          </tr>)}</tbody>
        </table></div> : <p className={styles.empty}>没有符合条件的上榜关键词。</p>}
        <SeoTablePagination pagination={pagination} onPage={setPage} />
      </>}
  </section>;
}
