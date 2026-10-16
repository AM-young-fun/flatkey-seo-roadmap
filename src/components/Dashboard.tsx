"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { useSeoSelection } from "@/components/useSeoSelection";
import { RankingTrend } from "@/components/RankingTrend";
import { ArrowUpRight } from "lucide-react";
import { KeywordGraph } from "@/components/KeywordGraph";
import { PageHeader } from "@/components/PageHeader";
import { useDashboard } from "@/components/useDashboard";
import { DISPLAY_BUCKETS } from "@/lib/rank-display";
import { SerpOverview } from "@/components/SerpOverview";
import { RegionSelect } from "@/components/RegionSelect";

export function Dashboard() {
  const selection = useSeoSelection();
  const { region } = selection;
  const { data, loading, error, refreshing, refresh } = useDashboard(selection.site, selection.source);
  const ready = Boolean(data);
  const keywords = useMemo(() => data?.keywords ?? [], [data?.keywords]);
  const [graphSearch, setGraphSearch] = useState("");
  const [graphOpen, setGraphOpen] = useState(false);
  const graphKeywords = useMemo(() => {
    const query = graphSearch.trim().toLowerCase();
    return query ? keywords.filter((keyword) => `${keyword.text} ${keyword.topicText ?? ""} ${keyword.siteName ?? ""}`.toLowerCase().includes(query)) : keywords;
  }, [keywords, graphSearch]);
  return (
    <main className="appShell">
      <PageHeader active="overview" />
      <div className="rankingPageToolbar"><h1>排名概览</h1><div className="pageRegionFilter"><span>查看国家</span><RegionSelect value={region} onChange={selection.setRegion} /></div></div>
      {refreshing ? <p className="cacheNotice" role="status">已显示上次加载的词库结果，正在获取最新数据…</p> : null}
      <SerpOverview site={selection.site} region={region} />
      <RankingTrend region={region} />

      {error ? (
        <div className="loadError" role="alert">
          <span>{error}</span>
          <button type="button" onClick={() => void refresh()}>
            重新加载
          </button>
        </div>
      ) : null}
      <details className="simpleDisclosure keywordGraphDisclosure" onToggle={event => setGraphOpen(event.currentTarget.open)}><summary>业务词库关系图</summary>{graphOpen ? <section className="overviewGrid">
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
          <p className="chartNote">正式目标词库 · 图中显示 {ready ? graphKeywords.length : "—"} 条{graphSearch ? "匹配" : "关键词与网站"}记录。只展示当前正式监控目标，候选研究词在关键词明细中单独查看。</p>
          <div className="rankLegend">
            {DISPLAY_BUCKETS.map((bucket) => (
              <span key={bucket.key}>
                <i style={{ background: bucket.color }} />
                {bucket.key === "NOT_FOUND" ? "暂无前100实测 / 待采集" : bucket.range}
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
      </section> : null}</details>
      <footer className="overviewFooter">
        <span>排名来自DataForSEO SERP实测；Labs、GSC、Ahrefs历史记录不计入主排名。</span>
        <span>地区、采集时间及各排名页面详见关键词明细</span>
      </footer>
    </main>
  );
}
