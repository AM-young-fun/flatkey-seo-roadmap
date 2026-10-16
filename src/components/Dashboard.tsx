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
  const awaitingEvidence = stats.total > 0 && stats.pending === stats.total;
  const formatPercent = (count: number) =>
    ready ? `${stats.percent(count).toFixed(1)}%` : "—";
  return (
    <main className="appShell">
      <PageHeader active="overview" selection={selection} />
      {refreshing ? <p className="cacheNotice" role="status">已显示上次加载的词库结果，正在获取最新数据…</p> : null}
      <section className="overviewSummaryGrid">
        <RankingTrend region={region} reportEnd={data?.reportingPeriod?.end} hasSavedSnapshot={keywords.some(keyword => keyword.latestRanks[region]?.source === "dataforseo_labs")} />
        <aside className="analyticsColumn">
          <article className="analyticsCard">
            <p className="eyebrow">RANKING COVERAGE</p>
            <h2>DataForSEO 排名覆盖率</h2>
            <div
              className="coverageDonut"
              role="img"
              aria-label={`业务目标${stats.total}词，DataForSEO数据库前100记录${stats.ranked}词，来源明确前100外${stats.outside}词，未取得记录${stats.pending}词`}
              style={{
                background: stats.total
                  ? `conic-gradient(#10b981 0% ${stats.percent(stats.ranked)}%, #e8edf3 ${stats.percent(stats.ranked)}% 100%)`
                  : "#e8edf3",
              }}
            >
              <div>
                <strong>{awaitingEvidence ? "暂无记录" : formatPercent(stats.ranked)}</strong>
                <span>数据库前 100 记录</span>
              </div>
            </div>
            <div className="coverageRows">
              <p>
                <span>
                  <i style={{ background: "#10b981" }} />
                  数据库前 100 记录
                </span>
                <b>
                  {ready ? awaitingEvidence ? "暂无数据库记录" : stats.ranked : "—"}
                  <small>{awaitingEvidence ? "—" : formatPercent(stats.ranked)}</small>
                </b>
              </p>
              <p>
                <span>
                  <i style={{ background: "#94a3b8" }} />
                  无前 100 数据库记录
                </span>
                <b>
                  {ready ? stats.unranked : "—"}
                  <small>{formatPercent(stats.unranked)}</small>
                </b>
              </p>
            </div>
            <p className="chartNote">
              业务目标共 {ready ? stats.total : "—"} 词；来源明确前 100 外 {ready ? stats.outside : "—"} 词，未取得记录 {ready ? stats.pending : "—"} 词。未取得记录不能确认为前 100 外，也不代表网页未收录。
            </p>
          </article>
          <article className="analyticsCard">
            <p className="eyebrow">POSITION DISTRIBUTION</p>
            <h2>排名分布</h2>
            <div className="distributionRows">
              {stats.buckets.map((bucket) => (
                <div key={bucket.key}>
                  <div className="distributionLabel">
                    <span>
                      <i style={{ background: bucket.color }} />
                      {bucket.key === "NOT_FOUND" ? "无前 100 数据库记录" : bucket.range}
                    </span>
                    <b>
                      {ready ? bucket.count : "—"}
                      <small>{formatPercent(bucket.count)}</small>
                    </b>
                  </div>
                  <div className="distributionTrack">
                    <span
                      style={{
                        width: `${stats.percent(bucket.count)}%`,
                        background: bucket.color,
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
            <p className="chartNote">
              各区间互不重叠，按各关键词最新已存的 DataForSEO 数据库名次统计。真实来源日期详见明细，数据库名次不代表实时搜索结果。
            </p>
          </article>
        </aside>
      </section>
      <div className="dailySnapshotHeading"><strong>业务词库数据库排名</strong><span>核心排名使用最新已存的 DataForSEO 数据库记录，明细展示真实来源日期与实际排名页面；GSC、Ahrefs 仅保留为历史参考。</span></div>
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
                {bucket.key === "NOT_FOUND" ? "无前 100 数据库记录" : bucket.range}
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
