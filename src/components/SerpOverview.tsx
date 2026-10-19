"use client";
import { REGIONS } from "@/lib/seo";
import { useSerpOverviewResults } from "@/components/useSerpOverviewResults";

const percentage = (value: number | null) => value == null ? "—" : `${value.toFixed(1)}%`;

type RingSegment = { count: number; color: string; label: string };
function SummaryRing({ segments, value, label }: { segments: RingSegment[]; value: number; label: string }) {
  const total = segments.reduce((sum, segment) => sum + segment.count, 0), circumference = 2 * Math.PI * 40;
  let offset = 0;
  return <div className="summaryRing" role="img" aria-label={`${label} ${value}；${segments.map(segment => `${segment.label} ${segment.count}`).join("，")}`}>
    <svg viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="40" fill="none" stroke="#edf1f7" strokeWidth="10" />{segments.map(segment => {
      const length = total ? segment.count / total * circumference : 0, start = offset; offset += length;
      return length > 0 ? <circle key={segment.label} cx="50" cy="50" r="40" fill="none" stroke={segment.color} strokeWidth="10" strokeDasharray={`${length} ${circumference - length}`} strokeDashoffset={-start} transform="rotate(-90 50 50)" /> : null;
    })}</svg><div><strong>{value.toLocaleString()}</strong><span>{label}</span></div>
  </div>;
}
const MARKET_COLORS: Record<string, string> = { US: "#588bf5", JP: "#8b7bdd", ES: "#e6aa54", BR: "#47b49a" };
const MARKET_FLAGS: Record<string, string> = { US: "🇺🇸", JP: "🇯🇵", ES: "🇪🇸", BR: "🇧🇷" };

export function SerpOverview({ site }: { site: string }) {
  const { data, error, loading, refresh } = useSerpOverviewResults(site);
  return <section className="discoveryPanel serpOverview visualSerpOverview" aria-label="四国目标词排名汇总">
    <div className="panelHeader"><div><h2>目标词排名汇总 <span className="fourMarketBadge">四国综合</span></h2><p className="serpScope">{data?.currentPeriod.label ?? "每月两期"}{data ? ` · 已查 ${data.summary.capturedInAnyRegion} / ${data.summary.total.toLocaleString()} 词` : ""}</p></div></div>
    {loading ? <p className="muted">正在读取四国排名汇总…</p> : error ? <div className="loadError" role="alert"><span>{error}</span><button onClick={refresh}>重新加载</button></div> : data ? <>
      <div className="overviewVisualGrid">
        <article className="overviewVisualCard">
          <h3>业务词库</h3>
          <SummaryRing value={data.monitoring.allTargetCount} label="目标关键词" segments={[{ count: data.monitoring.eligibleTargetCount, color: "#5988e8", label: "已有页面" }, { count: data.monitoring.heldTargetCount, color: "#dce4f1", label: "暂不监控" }]} />
          <div className="visualChartLegend"><div><i style={{ background: "#5988e8" }} /><span>已有页面</span><strong>{data.monitoring.eligibleTargetCount.toLocaleString()}</strong><small>{percentage(data.monitoring.allTargetCount ? data.monitoring.eligibleTargetCount / data.monitoring.allTargetCount * 100 : null)}</small></div><div><i style={{ background: "#dce4f1" }} /><span>暂不监控</span><strong>{data.monitoring.heldTargetCount.toLocaleString()}</strong><small>{percentage(data.monitoring.allTargetCount ? data.monitoring.heldTargetCount / data.monitoring.allTargetCount * 100 : null)}</small></div></div>
        </article>
        <article className="overviewVisualCard">
          <h3>已实测排名</h3>
          <SummaryRing value={data.summary.rankedInAnyRegion} label="词已检出排名" segments={data.summary.buckets.map(bucket => ({ count: bucket.count, color: bucket.color, label: bucket.min === 1 ? "前10" : bucket.range }))} />
          <div className="visualRankLegend">{data.summary.buckets.map(bucket => <div key={bucket.key}><i style={{ background: bucket.color }} /><span>{bucket.min === 1 ? "前10" : bucket.range}</span><strong>{data.summary.captured ? bucket.count : "—"}</strong></div>)}</div>
          <div className="visualChartFootnote">已查 {data.summary.capturedInAnyRegion} 词 · 检出 {data.summary.rankedInAnyRegion} 词</div>
        </article>
        <article className="overviewVisualCard countryVisualCard">
          <h3>各国排名占比</h3>
          <div className="countryChartHead"><span>国家 / 排名词</span><span>四国排名份额</span><span>占总词库</span></div>
          <div className="countryBarChart">{data.regions.map(result => <div className="countryBarRow" key={result.region}>
            <div className="countryBarLabel"><span aria-hidden="true">{MARKET_FLAGS[result.region]}</span><div><strong>{REGIONS[result.region].label}</strong><small>{result.summary.captured ? `${result.rankedCount} 词` : "未采集"}</small></div></div>
            <div className="countryBarValue"><span className="countryBarTrack"><i style={{ width: `${result.rankingRecordSharePercent ?? 0}%`, background: MARKET_COLORS[result.region] }} /></span><strong>{result.summary.captured ? percentage(result.rankingRecordSharePercent) : "—"}</strong></div>
            <span className="countryTargetShare">{result.summary.captured ? percentage(result.targetSharePercent) : "—"}</span>
          </div>)}</div>
          <div className="visualChartFootnote">{data.summary.rankedRecords} 条国家排名记录 · {data.summary.rankedInAnyRegion} 个去重词</div>
        </article>
      </div>
      <div className="serpOverviewFooter"><span className="visualLastUpdated">{data.latestCompletedAt ? `最近采集 ${new Date(data.latestCompletedAt).toLocaleDateString("zh-CN", { timeZone: "Asia/Shanghai" })}` : "尚未采集"}</span></div>
    </> : null}
  </section>;
}
