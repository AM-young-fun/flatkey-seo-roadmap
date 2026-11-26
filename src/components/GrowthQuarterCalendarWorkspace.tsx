"use client";

import { useState } from "react";
import type { QuarterCalendarDisplay } from "@/lib/growth-quarter-display";
import { GROWTH_COUNTRY_LABELS } from "@/lib/seo-growth-markets";
import { seoTablePage } from "@/lib/seo-table-page";
import { keywordTextMatches, numericKeywordOrder, type NumericSort } from "@/lib/growth-keyword-lookup";
import { KeywordNumericHeader } from "./KeywordTableCells";
import { SeoTablePagination } from "./SeoTablePagination";
import { UiSelect } from "./UiSelect";
import styles from "./GrowthTopicWorkspace.module.css";

const count = (value: number) => value.toLocaleString("zh-CN");

export function GrowthQuarterCalendarWorkspace({ plan }: { plan: QuarterCalendarDisplay }) {
  const [page, setPage] = useState(1);
  const [cohort, setCohort] = useState("flatkey");
  const [day, setDay] = useState("all");
  const [country, setCountry] = useState("all");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<NumericSort | null>(null);
  const showSatellite = cohort === "satellite" && plan.satellite;
  const source = showSatellite ? showSatellite.rows : plan.rows;
  const dates = showSatellite ? [...new Set(source.map(row => row.researchDate))].sort() : plan.days;
  const waiting = showSatellite ? source.filter(row => !row.deliveryDate).length : plan.deliveryPending;
  const countries = [...new Set(source.map(row => row.country))].sort();
  const { rows, ...pagination } = seoTablePage(source.filter(row => (day === "all" || row.researchDate === day)
    && (country === "all" || row.country === country)
    && keywordTextMatches(search, row.keyword, row.topicName ?? "")).sort((a, b) => numericKeywordOrder(a.volume, b.volume, sort)), page);
  return <section className={styles.panel} aria-label="季度新词排期">
    <div className={styles.sectionHeading}><div>
      <h2>{showSatellite ? "ModelFit／RackRate 季度词" : "季度关键词"} · {count(showSatellite ? source.length : plan.total)} 词</h2>
      <p>北京时间 {dates[0] ?? plan.start} 至 {dates.at(-1) ?? plan.end} · {count(dates.length)} 个研究日</p>
    </div></div>
    <p className={styles.note}>{showSatellite ? `ModelFit ${count(showSatellite.siteCounts["modelfit.cc"] ?? 0)} 词，RackRate ${count(showSatellite.siteCounts["rackrate.org"] ?? 0)} 词。`
      : plan.frozen ? "季度方案已冻结。" : "研究排期已保存，方案待正式启用。"}{waiting ? ` ${count(waiting)} 词的页面交付日期待核验。` : null}</p>
    <div className={styles.filters}>
      {plan.satellite ? <label>站点词库<UiSelect aria-label="站点词库" value={cohort} onChange={value => {
        setCohort(value); setDay("all"); setCountry("all"); setPage(1);
      }} options={[{ value: "flatkey", label: "Flatkey" }, { value: "satellite", label: "ModelFit／RackRate" }]} /></label> : null}
      <label>研究日期<UiSelect aria-label="研究日期" value={day} onChange={value => { setDay(value); setPage(1); }}
        options={[{ value: "all", label: "全部研究日期" }, ...dates.map(value => ({ value, label: value }))]} /></label>
      <label>目标市场<UiSelect aria-label="目标市场" value={country} onChange={value => { setCountry(value); setPage(1); }}
        options={[{ value: "all", label: "全部市场" }, ...countries.map(value => ({ value, label: GROWTH_COUNTRY_LABELS[value] }))]} /></label>
      <label className={styles.search}>搜索话题或关键词<input value={search} onChange={event => { setSearch(event.target.value); setPage(1); }} /></label>
    </div>
    {rows.length ? <div className={styles.tableScroll}><table className={styles.table}>
      <thead><tr><th>原关键词</th><th>话题 / 站点</th><th>目标市场</th><KeywordNumericHeader label="Ahrefs 月搜索量" order={sort} onChange={order => { setSort(order); setPage(1); }} /><th>研究日期</th><th>页面交付</th></tr></thead>
      <tbody>{rows.map(row => <tr key={row.id}>
        <th scope="row"><strong>{row.keyword}</strong></th><td>{row.topicName ?? "待核"}{row.site ? <small>{row.site}</small> : null}</td>
        <td>{GROWTH_COUNTRY_LABELS[row.country]}</td><td>{count(row.volume)}</td><td>{row.researchDate}</td><td>{row.deliveryDate ?? "待核验"}</td>
      </tr>)}</tbody>
    </table></div> : <p className={styles.empty}>没有符合条件的关键词。</p>}
    <SeoTablePagination pagination={pagination} onPage={setPage} />
  </section>;
}
