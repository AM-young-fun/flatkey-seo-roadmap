"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { useSeoSelection } from "@/components/useSeoSelection";
import { RankingTrend } from "@/components/RankingTrend";
import { ArrowUpRight } from "lucide-react";
import { KeywordGraph } from "@/components/KeywordGraph";
import { PageHeader } from "@/components/PageHeader";
import { useDashboard } from "@/components/useDashboard";
import { DISPLAY_BUCKETS, rankingStats } from "@/lib/rank-display";
import { DiscoverySummary } from "@/components/RankingDiscovery";

export function Dashboard() {
  const selection = useSeoSelection();
  const { region } = selection;
  const { data, loading, error, refreshing, refresh } = useDashboard(selection.site, selection.source);
  const ready = Boolean(data);
  const keywords = useMemo(() => data?.keywords ?? [], [data?.keywords]);
  const [graphSearch, setGraphSearch] = useState("");
  const graphKeywords = useMemo(() => {
    const query = graphSearch.trim().toLowerCase();
    return query ? keywords.filter((keyword) => `${keyword.text} ${keyword.topicText ?? ""} ${keyword.siteName ?? ""}`.toLowerCase().includes(query)) : keywords;
  }, [keywords, graphSearch]);
  const stats = useMemo(() => rankingStats(keywords, region), [keywords, region]);
  return (
    <main className="appShell">
      <PageHeader active="overview" selection={selection} />
      {refreshing ? <p className="cacheNotice" role="status">已显示上次加载的词库结果，正在获取最新数据…</p> : null}
      <DiscoverySummary site={selection.site} region={region} />
      <section className="targetMonitoringStrip" aria-label="正式目标的数据库监测情况">
        <div><span>当前正式目标库</span><strong>{ready ? stats.total.toLocaleString() : "—"}<small>词</small></strong></div>
        <div><span>取得数据库前100记录</span><strong>{ready ? stats.ranked : "—"}<small>词</small></strong></div>
        <div><span>未取得记录 · 待核验</span><strong>{ready ? stats.pending.toLocaleString() : "—"}<small>词</small></strong></div>
        <p>这里仅计算正式目标与已存记录的交集。发现词数量和目标词数量口径不同，均不能当作全站实际排名覆盖率。{stats.outside ? `来源确认前100外 ${stats.outside} 词。` : ""}</p>
      </section>
      <details className="formalTrendDetails"><summary>查看全部网站正式目标的最近一周数据库记录趋势</summary><RankingTrend region={region} reportEnd={data?.reportingPeriod?.end} hasSavedSnapshot={keywords.some(keyword => keyword.latestRanks[region]?.source === "dataforseo_labs")} /></details>
      <div className="dailySnapshotHeading"><strong>业务目标词库</strong><span>目标库用于跟进页面建设与优化。数据库未返回某词时保留为待核验，实际发现的排名词与页面见上方。</span></div>
      {error ? (
        <div className="loadError" role="alert">
          <span>{error}</span>
          <button type="button" onClick={() => void refresh()}>
            重新加载
          </button>
        </div>
      ) : null}
      <section className="overviewGrid">
        <article className="graphPanel">
          <div className="panelHeader">
            <div>
              <p className="eyebrow">KEYWORD NETWORK</p>
              <h2>关键词关系图</h2>
              <p>缩放、拖动或悬停查看关键词；连线表示同话题或父子关联</p>
            </div>
            <div className="graphTools"><label className="searchField graphSearch"><input aria-label="搜索图中关键词" placeholder="搜索图中关键词…" value={graphSearch} onChange={(event) => setGraphSearch(event.target.value)} /></label><Link href="/keywords" className="textLink">
              查看明细
              <ArrowUpRight size={15} />
            </Link></div>
          </div>
          <p className="chartNote">完整圆形词库 · 图中显示 {ready ? graphKeywords.length : "—"} 条{graphSearch ? "匹配" : "关键词与网站"}记录。包含页面目标词、集群页面词、实际搜索词和待评估词。</p>
          <div className="rankLegend">
            {DISPLAY_BUCKETS.map((bucket) => (
              <span key={bucket.key}>
                <i style={{ background: bucket.color }} />
                {bucket.key === "NOT_FOUND" ? "暂无数据库记录 · 待核验" : bucket.range}
              </span>
            ))}
          </div>
          {loading ? (
            <div className="loadingState">正在加载关键词…</div>
          ) : error && !data ? (
            <div className="loadingState">词库读取失败，请点击上方「重新加载」</div>
          ) : (
            <KeywordGraph keywords={graphKeywords} selectedRegion={region} />
          )}
        </article>
      </section>
      <footer className="overviewFooter">
        <span>排名来自已存 DataForSEO 数据库记录；GSC、Ahrefs 仅供历史参考，当前 Google 搜索未核验。</span>
        <span>真实来源日期与实际排名页面详见明细</span>
      </footer>
    </main>
  );
}
