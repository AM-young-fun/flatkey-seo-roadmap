"use client";
import Link from "next/link";
import { useCallback, useMemo, useState } from "react";
import { useSeoSelection } from "@/components/useSeoSelection";
import { RankingTrend } from "@/components/RankingTrend";
import { ArrowUpRight } from "lucide-react";
import { KeywordGraph } from "@/components/KeywordGraph";
import { PageHeader } from "@/components/PageHeader";
import { useDashboard } from "@/components/useDashboard";
import { DISPLAY_BUCKETS, rankingStats } from "@/lib/rank-display";
import { dailyOverviewKeywords } from "@/lib/daily-overview";
import { trendToday, type DailySnapshot } from "@/lib/ranking-trends";
import type { SearchRegionCode } from "@/lib/seo";

export function Dashboard() {
  const selection = useSeoSelection();
  const { region } = selection;
  const { data, loading, error, refresh } = useDashboard(selection.site, selection.source);
  const [daily, setDaily] = useState<{region:SearchRegionCode;snapshot:DailySnapshot|null} | null>(null);
  const onSnapshot = useCallback((snapshot:DailySnapshot|null, region:SearchRegionCode) => setDaily({region,snapshot}), []);
  const snapshot = daily?.region === region ? daily.snapshot : null;
  const ready = Boolean(data && snapshot);
  const keywords = useMemo(() => data && snapshot ? dailyOverviewKeywords(data.keywords, snapshot) : [], [data, snapshot]);
  const [graphSearch, setGraphSearch] = useState("");
  const graphKeywords = useMemo(() => {
    const query = graphSearch.trim().toLowerCase();
    return query ? keywords.filter((keyword) => `${keyword.text} ${keyword.topicText ?? ""} ${keyword.siteName ?? ""}`.toLowerCase().includes(query)) : keywords;
  }, [keywords, graphSearch]);
  const stats = rankingStats(keywords, region);
  const formatPercent = (count: number) =>
    ready ? `${stats.percent(count).toFixed(1)}%` : "—";
  const hasGsc = keywords.some(
    (keyword) => keyword.latestRanks[region]?.source === "gsc",
  );
  return (
    <main className="appShell">
      <PageHeader active="overview" selection={selection} />
      <RankingTrend region={region} onSnapshot={onSnapshot} />
      <div className="dailySnapshotHeading" aria-live="polite"><strong>{snapshot ? `${snapshot.date} 单日排名` : daily?.region === region ? "暂无单日排名记录" : "正在读取单日排名…"}</strong><span>{snapshot ? `覆盖网站：${snapshot.sites.join("、")}。${snapshot.date < trendToday() ? "这是最新可用日期，今天的数据尚未采集。" : ""}下方图表均使用这一天的数据。` : "有完整单日报告后展示，不沿用历史汇总排名。"}</span></div>
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
                {bucket.key === "NOT_FOUND" ? "当天未检出前 100" : bucket.range}
              </span>
            ))}
          </div>
          {loading || (data && daily?.region !== region) ? (
            <div className="loadingState">正在加载关键词…</div>
          ) : error && !data ? (
            <div className="loadingState">词库读取失败，请点击上方「重新加载」</div>
          ) : !snapshot ? (
            <div className="loadingState">暂无完整单日报告</div>
          ) : (
            <KeywordGraph keywords={graphKeywords} selectedRegion={region} />
          )}
        </article>
        <aside className="analyticsColumn">
          <article className="analyticsCard">
            <p className="eyebrow">RANKING COVERAGE</p>
            <h2>全词库排名覆盖率</h2>
            <div
              className="coverageDonut"
              role="img"
              aria-label={`已有排名 ${formatPercent(stats.ranked)}，未有排名 ${formatPercent(stats.unranked)}`}
              style={{
                background: stats.total
                  ? `conic-gradient(#10b981 0% ${stats.percent(stats.ranked)}%, #e8edf3 ${stats.percent(stats.ranked)}% 100%)`
                  : "#e8edf3",
              }}
            >
              <div>
                <strong>{formatPercent(stats.ranked)}</strong>
                <span>当天检出前 100</span>
              </div>
            </div>
            <div className="coverageRows">
              <p>
                <span>
                  <i style={{ background: "#10b981" }} />
                  当天前 100
                </span>
                <b>
                  {ready ? stats.ranked : "—"}
                  <small>{formatPercent(stats.ranked)}</small>
                </b>
              </p>
              <p>
                <span>
                  <i style={{ background: "#94a3b8" }} />
                  当天未检出前 100
                </span>
                <b>
                  {ready ? stats.unranked : "—"}
                  <small>{formatPercent(stats.unranked)}</small>
                </b>
              </p>
            </div>
            <p className="chartNote">
              灰色表示当天报告未检出前 100，包含未覆盖的网站与查询词，不表示已确认跌出排名。
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
                      {bucket.key === "NOT_FOUND" ? "当天未检出前 100" : bucket.range}
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
              各区间互不重叠，数量与上方对应日期的折线一致；占比以完整词库为分母。
            </p>
          </article>
        </aside>
      </section>
      <footer className="overviewFooter">
        <span>
          {hasGsc
            ? "GSC 单日有曝光查询的平均排名"
            : "排名以标明日期的单日报告为准"}
        </span>
        <span>每天 10:30 更新 · 北京时间</span>
      </footer>
    </main>
  );
}
