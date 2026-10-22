"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { useDashboard } from "@/components/useDashboard";
import { keywordDemandRows } from "@/lib/keyword-demand";
import { REGIONS, REGION_CODES, type SearchRegionCode } from "@/lib/seo";
import { KEYWORD_BUSINESSES, type KeywordBusiness } from "@/lib/keyword-business";
import { displayBucket } from "@/lib/rank-display";
import { keywordRankingResultTag } from "@/lib/keyword-status-tags";
import styles from "./KeywordDemand.module.css";

const PAGE_SIZE = 20;
export function KeywordDemand({ initialRegion = "US" }: { initialRegion?: SearchRegionCode }) {
  const { data, loading, error, refresh } = useDashboard("all", "dataforseo_serp");
  const [region, setRegion] = useState<SearchRegionCode>(initialRegion);
  const [business, setBusiness] = useState<KeywordBusiness>("FLATKEY_API");
  const [search, setSearch] = useState("");
  const [crossLanguage, setCrossLanguage] = useState(false);
  const [page, setPage] = useState(1);
  const rows = useMemo(() => keywordDemandRows(data?.keywords ?? [], region, business, crossLanguage, search), [data?.keywords, region, business, crossLanguage, search]);
  const known = rows.filter(row => row.volume != null).length;
  const maximum = rows[0]?.volume ?? 0;
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE)), current = Math.min(page, pages);
  return <section className={styles.panel} aria-label="关键词声量与排名">
    <div className={styles.header}><div><h2>关键词声量与排名</h2><p>按所选国家月搜索量从高到低排列，查看高需求词的实际排名。</p></div><Link href="/keywords">查看关键词明细 ↗</Link></div>
    <div className={styles.filters}>
      <label>目标市场<select aria-label="声量图国家" value={region} onChange={event => { setRegion(event.target.value as SearchRegionCode); setPage(1); }}>{REGION_CODES.map(code => <option key={code} value={code}>{REGIONS[code].label}</option>)}</select></label>
      <label>业务<select aria-label="声量图业务" value={business} onChange={event => { setBusiness(event.target.value as KeywordBusiness); setPage(1); }}>{KEYWORD_BUSINESSES.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
      <input type="search" aria-label="搜索声量关键词" placeholder="搜索关键词或话题…" value={search} onChange={event => { setSearch(event.target.value); setPage(1); }} />
      <label><input type="checkbox" checked={crossLanguage} onChange={event => { setCrossLanguage(event.target.checked); setPage(1); }} />包含跨语种词</label>
    </div>
    {error ? <div className="loadError" role="alert"><span>{error}</span><button onClick={refresh}>重新加载</button></div> : null}
    {loading ? <div className={styles.empty}>正在读取关键词…</div> : <>
      <div className={styles.summary}><span><strong>{rows.length.toLocaleString()}</strong> 个关键词</span><span>已提供声量 <strong>{known.toLocaleString()}</strong></span><span>声量缺失 <strong>{(rows.length - known).toLocaleString()}</strong></span><span>{REGIONS[region].label}月搜索量 · 跨网站同词计一次</span></div>
      <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>关键词</th><th>{REGIONS[region].label}月搜索量</th><th>{REGIONS[region].label}实际排名</th></tr></thead><tbody>
        {rows.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE).map(row => {
          const tag = keywordRankingResultTag(row.rank);
          return <tr key={row.id}><td className={styles.keyword}><Link href={`/keywords?${new URLSearchParams({ country: region, keyword: row.text, business, crossLanguage: crossLanguage ? "1" : "0" })}`}>{row.text}</Link><small>{row.sites}</small></td>
            <td className={styles.demand}><div className={styles.demandValue}><span className={styles.track} aria-hidden="true"><i style={{ width: `${maximum && row.volume != null ? row.volume / maximum * 100 : 0}%` }} /></span><strong>{row.volume == null ? "未提供" : row.volume.toLocaleString()}</strong></div></td>
            <td><span className={styles.rank} title={tag.tooltip}><i style={{ background: displayBucket(row.position).color }} />{row.position != null ? `#${row.position}` : tag.label}</span></td></tr>;
        })}
      </tbody></table>{!rows.length ? <p className={styles.empty}>当前筛选下暂无关键词。</p> : null}</div>
      <div className={styles.footer}><p className={styles.note}>条长按真实搜索量比例显示；缺失值排在最后，0 表示来源明确记录为零。</p><div><button disabled={current <= 1} onClick={() => setPage(current - 1)}>上一页</button><span>{current} / {pages}</span><button disabled={current >= pages} onClick={() => setPage(current + 1)}>下一页</button></div></div>
      <p className={styles.note}>默认按来源语种匹配目标市场。跨语种词可单独开启；排名仅取所选国家的有效实测结果。</p>
    </>}
  </section>;
}
