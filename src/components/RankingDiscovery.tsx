"use client";
import Link from "next/link";
import { useState } from "react";
import { Select, Table, Tag } from "antd";
import type { ColumnsType } from "antd/es/table";
import type { SearchRegionCode } from "@/lib/seo";
import type { RankingDiscoveryResponse, RankingDiscoveryRow } from "@/lib/ranking-discovery-types";
import { useRankingDiscovery } from "@/components/useRankingDiscovery";

const POOLS = { FORMAL: "正式目标", RESEARCH: "候选研究", NEW_CANDIDATE: "新发现候选", AMBIGUOUS: "业务意图待复核" };
const COLORS = ["#10b981", "#3b82f6", "#f59e0b", "#f97316"];
const BUCKETS = ["前10", "11–30", "31–50", "51–100"];
const date = (value: string | null | undefined) => value?.slice(0, 10) ?? "来源未提供";
const preferredBrands = (words: string[]) => [...words].sort((a, b) => { const priority = ["flatkey", "flatkey ai", "flat key"]; const ai = priority.indexOf(a), bi = priority.indexOf(b); return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi) || a.localeCompare(b); });
const rankTag = (rank: number) => rank <= 10 ? "前10" : rank <= 30 ? "前30" : rank <= 50 ? "前50" : "前100";

function SnapshotNote({ data }: { data: RankingDiscoveryResponse }) {
  const snapshot = data.snapshot;
  return <p className="chartNote">本批仅 Flatkey · 美国 / 英文；采集于 {date(snapshot?.collectedAt)}，来源 SERP 更新于 {date(snapshot?.sourceSerpDateMin)} 至 {date(snapshot?.sourceSerpDateMax)}。这是历史数据库发现结果，未逐词实时搜索，未返回的词不能判定为无排名。{data.requested.site === "all" ? " RackRate、ModelFit 尚未采集。" : ""}</p>;
}

export function DiscoverySummary({ site, region }: { site: string; region: SearchRegionCode }) {
  const { data, loading, error, refresh } = useRankingDiscovery(site, region);
  return <section className="discoveryPanel">
    <div className="panelHeader"><div><p className="eyebrow">DISCOVERED DATABASE RANKINGS</p><h2>已发现的关键词排名</h2></div><Link className="textLink" href="/keywords?view=discovery">查看关键词和页面 →</Link></div>
    {loading ? <p className="muted">正在读取已保存的排名记录…</p> : error ? <div className="loadError"><span>{error}</span><button onClick={refresh}>重新加载</button></div> : !data?.available ? <p className="cacheNotice">当前网站 / 地区尚无可用的数据库发现快照，不能据此判断关键词没有排名。</p> : <>
      <div className="discoveryMetrics"><div><span>相关词前100记录</span><strong>{data.stats.uniqueBusinessKeywords}<small>词</small></strong></div>{data.stats.buckets.map((count, index) => <div key={BUCKETS[index]}><span><i style={{ background: COLORS[index] }} />{BUCKETS[index]}</span><strong>{count}<small>词</small></strong></div>)}</div>
      <SnapshotNote data={data} />
      <p className="chartNote">共保留 {data.stats.uniqueDiscoveredKeywords} 个发现词；正式目标 {data.stats.formal} 词 · 候选研究 {data.stats.research} 词 · 新发现候选 {data.stats.newCandidates} 词{data.stats.ambiguous ? ` · 意图待复核 ${data.stats.ambiguous} 词` : ""}。候选排名也会显示，加入正式目标仍需核对业务意图与页面。排名分布不计意图待复核词。</p>
      {data.brandCoverage.unobservedTerms.length ? <div className="discoveryMissing"><strong>品牌词记录不完整</strong><p>{preferredBrands(data.brandCoverage.unobservedTerms).slice(0, 3).join("、")} 等 {data.brandCoverage.unobservedTerms.length} 个正式品牌词未被本次数据库返回；它们保留为待核验，不计作没有排名。</p></div> : null}
    </>}
  </section>;
}

export function RankingDiscoveryTable({ site, region }: { site: string; region: SearchRegionCode }) {
  const { data, loading, error, refresh } = useRankingDiscovery(site, region);
  const [search, setSearch] = useState("");
  const [bucket, setBucket] = useState("ALL");
  const [pool, setPool] = useState("ALL");
  const rows = (data?.rows ?? []).filter(row => `${row.keyword} ${row.pages.map(page => page.url).join(" ")}`.toLowerCase().includes(search.trim().toLowerCase()))
    .filter(row => bucket === "ALL" || rankTag(row.rank) === bucket).filter(row => pool === "ALL" || row.pool === pool);
  const columns: ColumnsType<RankingDiscoveryRow> = [
    { title: "关键词 / 状态", key: "keyword", width: 270, render: (_, row) => <div className="evidenceSummary"><strong>{row.keyword}</strong><div><Tag color={row.rank <= 10 ? "green" : "blue"}>{rankTag(row.rank)}</Tag><Tag color={row.pool === "FORMAL" ? "blue" : "gold"}>{POOLS[row.pool]}</Tag></div>{row.pool !== "FORMAL" ? <small>{row.reviewReason ?? "实际排名页面不等于已通过目标页面审计"}</small> : null}</div> },
    { title: "数据库名次", key: "rank", width: 140, defaultSortOrder: "ascend", sorter: (a, b) => a.rank - b.rank, render: (_, row) => <strong>#{row.rank}</strong> },
    { title: "实际排名页面 / 各页名次", key: "pages", width: 520, render: (_, row) => <div className="rankingPageList">{row.pages.map(page => <div className="rankingPageRecord" key={`${page.url}:${page.sourceSerpUpdatedAt}`}><a className="observedUrl" href={page.url} target="_blank" rel="noreferrer">{page.url}</a><strong>页面名次 #{page.rank}</strong><small>SERP 更新：{date(page.sourceSerpUpdatedAt)} · 采集：{date(page.collectedAt)}</small></div>)}</div> },
    { title: "月搜索量 · 美国", key: "volume", width: 140, render: (_, row) => row.volume?.toLocaleString() ?? "未提供" },
    { title: "人工核对", key: "check", width: 130, render: (_, row) => <a href={`https://www.google.com/search?${new URLSearchParams({ q: row.keyword, gl: "us", hl: "en", pws: "0" })}`} target="_blank" rel="noreferrer">Google 搜索 ↗</a> },
  ];
  return <div className="discoveryWorkspace">
    <div className="contentPlanIntro"><div><h2>数据库发现的排名词与页面</h2><p>逐词列出正式目标、候选池和新发现词；相同页面上不同关键词保留各自名次，不共用排名。</p></div><button className="okrRefresh" onClick={refresh}>重新读取已存记录</button></div>
    {error ? <p className="loadError" role="alert">{error}</p> : null}
    {data?.available ? <><SnapshotNote data={data} /><div className="detailToolbar"><div className="detailFilters"><Select aria-label="发现词排名区间" value={bucket} onChange={setBucket} options={[{ value: "ALL", label: "全部排名" }, ...["前10", "前30", "前50", "前100"].map(value => ({ value, label: value }))]} /><Select aria-label="发现词词池" value={pool} onChange={setPool} options={[{ value: "ALL", label: "全部词池" }, ...Object.entries(POOLS).map(([value, label]) => ({ value, label }))]} /></div><label className="searchField"><input aria-label="搜索发现词或页面" placeholder="搜索发现词或页面…" value={search} onChange={event => setSearch(event.target.value)} /></label></div><p className="chartNote">当前 {rows.length} 词；原始返回 {data.stats.returnedItems} 条，已过滤 {data.stats.filteredUnrelated} 条明确无关记录，另有 {data.stats.policyExcluded} 条已归档或人工移除记录不重新纳入。新发现候选尚未自动加入正式目标。</p></> : !loading && !error ? <p className="cacheNotice">当前网站 / 地区尚未采集，不能据此判断没有排名。</p> : null}
    <section className="tablePanel"><Table columns={columns} dataSource={rows} rowKey="keyword" loading={loading} pagination={{ defaultPageSize: 20, showSizeChanger: true, showTotal: total => `共 ${total} 个关键词` }} scroll={{ x: 1200 }} /></section>
  </div>;
}
