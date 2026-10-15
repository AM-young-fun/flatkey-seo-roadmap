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
  const formatPercent = (count: number) =>
    ready ? `${stats.percent(count).toFixed(1)}%` : "—";
  const hasGsc = keywords.some(
    (keyword) => keyword.latestRanks[region]?.source === "gsc",
  );
  return (
    <main className="appShell">
      <PageHeader active="overview" selection={selection} />
      {refreshing ? <p className="cacheNotice" role="status">已显示上次加载的词库结果，正在获取最新数据…</p> : null}
      <section className="overviewSummaryGrid">
        <RankingTrend region={region} />
        <aside className="analyticsColumn">
          <article className="analyticsCard">
            <p className="eyebrow">RANKING COVERAGE</p>
            <h2>全词库排名覆盖率</h2>
            <div
              className="coverageDonut"
              role="img"
              aria-label={`已有前100排名 ${formatPercent(stats.ranked)}，暂无前100排名 ${formatPercent(stats.unranked)}`}
              style={{
                background: stats.total
                  ? `conic-gradient(#10b981 0% ${stats.percent(stats.ranked)}%, #e8edf3 ${stats.percent(stats.ranked)}% 100%)`
                  : "#e8edf3",
              }}
            >
              <div>
                <strong>{formatPercent(stats.ranked)}</strong>
                <span>已有前 100 排名</span>
              </div>
            </div>
            <div className="coverageRows">
              <p>
                <span>
                  <i style={{ background: "#10b981" }} />
                  已有前 100 排名
                </span>
                <b>
                  {ready ? stats.ranked : "—"}
                  <small>{formatPercent(stats.ranked)}</small>
                </b>
              </p>
              <p>
                <span>
                  <i style={{ background: "#94a3b8" }} />
                  暂无前 100 排名
                </span>
                <b>
                  {ready ? stats.unranked : "—"}
                  <small>{formatPercent(stats.unranked)}</small>
                </b>
              </p>
            </div>
            <p className="chartNote">
              灰色包括已确认 100 名以外和暂无排名数据的词；不代表网页未被收录。当前待采集 {ready ? stats.pending : "—"} 个。
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
                      {bucket.key === "NOT_FOUND" ? "暂无前 100 排名" : bucket.range}
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
              各区间互不重叠，按每个词最近一次确认的排名统计；占比以完整词库为分母。
            </p>
          </article>
        </aside>
      </section>
      <div className="dailySnapshotHeading"><strong>全词库排名总览</strong><span>每个词使用最近一次确认的排名，包含历史采集结果；当天没有曝光不清空旧排名，明确查到前 100 外时才更新。</span></div>
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
                {bucket.key === "NOT_FOUND" ? "暂无前 100 排名" : bucket.range}
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
        <span>
          {hasGsc
            ? "包含 GSC 区间平均排名，悬停可查看来源、统计区间和采集日期"
            : "每个关键词以最近一次确认的排名为准"}
        </span>
        <span>每天 10:30 更新 · 北京时间</span>
      </footer>
    </main>
  );
}
