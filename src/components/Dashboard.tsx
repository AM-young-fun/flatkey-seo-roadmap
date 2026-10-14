"use client";
import Link from "next/link";
import { useSeoSelection } from "@/components/useSeoSelection";
import { DailyChanges } from "@/components/Insights";
import { ArrowUpRight } from "lucide-react";
import { KeywordGraph } from "@/components/KeywordGraph";
import { PageHeader } from "@/components/PageHeader";
import { useDashboard } from "@/components/useDashboard";
import { DISPLAY_BUCKETS, rankingStats } from "@/lib/rank-display";

export function Dashboard() {
  const selection = useSeoSelection();
  const { region } = selection;
  const { data, loading, error, refresh } = useDashboard(selection.site, selection.source, region);
  const keywords = data?.keywords ?? [];
  const stats = rankingStats(keywords, region);
  const formatPercent = (count: number) =>
    `${stats.percent(count).toFixed(1)}%`;
  const hasGsc = keywords.some(
    (keyword) => keyword.latestRanks[region]?.source === "gsc",
  );
  return (
    <main className="appShell">
      <PageHeader active="overview" selection={selection} />
      <DailyChanges selection={selection} />
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
              <p>当前地区声量最高的 500 条记录；关系图、覆盖率和排名分布采用相同范围</p>
            </div>
            <Link href="/keywords" className="textLink">
              查看明细
              <ArrowUpRight size={15} />
            </Link>
          </div>
          <div className="rankLegend">
            {DISPLAY_BUCKETS.map((bucket) => (
              <span key={bucket.key}>
                <i style={{ background: bucket.color }} />
                {bucket.range}
              </span>
            ))}
          </div>
          {loading ? (
            <div className="loadingState">正在加载关键词…</div>
          ) : (
            <KeywordGraph keywords={keywords} selectedRegion={region} />
          )}
        </article>
        <aside className="analyticsColumn">
          <article className="analyticsCard">
            <p className="eyebrow">RANKING COVERAGE</p>
            <h2>排名覆盖率</h2>
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
                <span>已有前 100 排名</span>
              </div>
            </div>
            <div className="coverageRows">
              <p>
                <span>
                  <i style={{ background: "#10b981" }} />
                  已有排名
                </span>
                <b>
                  {stats.ranked}
                  <small>{formatPercent(stats.ranked)}</small>
                </b>
              </p>
              <p>
                <span>
                  <i style={{ background: "#94a3b8" }} />
                  未有排名
                </span>
                <b>
                  {stats.unranked}
                  <small>{formatPercent(stats.unranked)}</small>
                </b>
              </p>
            </div>
            <p className="chartNote">
              未有排名包含未采集、暂无数据及前 100 外的关键词。当前未采集{" "}
              {stats.pending} 个。
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
                      {bucket.range}
                    </span>
                    <b>
                      {bucket.count}
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
              各排名区间互不重叠，占比以当前关键词总数为分母。
            </p>
          </article>
        </aside>
      </section>
      <footer className="overviewFooter">
        <span>
          {hasGsc
            ? "包含 GSC 平均排名，统计区间可在明细中查看"
            : "排名以最近一次采集结果为准"}
        </span>
        <span>每天 10:30 更新 · 北京时间</span>
      </footer>
    </main>
  );
}
