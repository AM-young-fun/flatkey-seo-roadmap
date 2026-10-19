"use client";
import { Tooltip } from "antd";
import { REGIONS } from "@/lib/seo";
import { useSerpOverviewResults } from "@/components/useSerpOverviewResults";

const percentage = (value: number | null) => value == null ? "—" : `${value.toFixed(1)}%`;

type RingSegment = { count: number; color: string; label: string; description?: string };
function SummaryRing({ segments, value, label, basis }: { segments: RingSegment[]; value: number; label: string; basis: string }) {
  const total = segments.reduce((sum, segment) => sum + segment.count, 0), circumference = 2 * Math.PI * 40;
  let offset = 0;
  return <div className="summaryRing" role="group" aria-label={`${label} ${value}；${segments.map(segment => `${segment.label} ${segment.count}`).join("，")}`}>
    <svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="40" fill="none" stroke="#edf1f7" strokeWidth="10" />{segments.map(segment => {
      const length = total ? segment.count / total * circumference : 0, start = offset; offset += length;
      const point = (distance: number) => { const angle = distance / circumference * Math.PI * 2 - Math.PI / 2; return `${50 + 40 * Math.cos(angle)} ${50 + 40 * Math.sin(angle)}`; };
      const arc = length >= circumference - .001 ? "M 50 10 A 40 40 0 1 1 50 90 A 40 40 0 1 1 50 10"
        : `M ${point(start)} A 40 40 0 ${length > circumference/2 ? 1 : 0} 1 ${point(start+length)}`;
      const tip = `${segment.label}：${segment.count.toLocaleString()} 词 · 占${basis} ${total ? (segment.count/total*100).toFixed(1) : "0.0"}%${segment.description ? `；${segment.description}` : ""}`;
      return length > 0 ? <Tooltip key={segment.label} title={tip}><path tabIndex={0} aria-label={tip} className="summaryRingSegment" d={arc} fill="none" stroke={segment.color} strokeWidth="10" /></Tooltip> : null;
    })}</svg><div className="summaryRingCenter"><Tooltip title={`${label}：${value.toLocaleString()} 词；同一关键词跨网站、国家去重。`}><strong tabIndex={0}>{value.toLocaleString()}</strong></Tooltip><span>{label}</span></div>
  </div>;
}
const MARKET_COLORS: Record<string, string> = { US: "#588bf5", JP: "#8b7bdd", ES: "#e6aa54", BR: "#47b49a" };
const MARKET_FLAGS: Record<string, string> = { US: "🇺🇸", JP: "🇯🇵", ES: "🇪🇸", BR: "🇧🇷" };

export function SerpOverview({ site }: { site: string }) {
  const { data, error, loading, refresh } = useSerpOverviewResults(site);
  const totalKeywords = data?.monitoring.allTargetCount ?? 0;
  const rankingCoverage: RingSegment[] = [
    { count: data?.summary.rankedInAnyRegion ?? 0, color: "#5988e8", label: "有排名", description: "本期至少一个国家检出前100自然排名；同一关键词跨国家、网站只计一次。" },
    { count: Math.max(0, totalKeywords - (data?.summary.rankedInAnyRegion ?? 0)), color: "#dce4f1", label: "没有排名", description: "本期尚未检出前100排名，包含尚未完成采集的关键词；不等同于已确认在前100之外。" },
  ];
  return <section className="discoveryPanel serpOverview visualSerpOverview" aria-label="四国目标词排名汇总">
    <div className="panelHeader"><div><h2>目标词排名汇总 <span className="fourMarketBadge">四国综合</span></h2><p className="serpScope">四国汇总 · 隔周周二10:30 · 图表展示已返回的有效排名结果</p></div></div>
    {loading ? <p className="muted">正在读取四国排名汇总…</p> : error ? <div className="loadError" role="alert"><span>{error}</span><button onClick={refresh}>重新加载</button></div> : data ? <>
      <div className="overviewVisualGrid">
        <article className="overviewVisualCard">
          <h3>业务词库</h3>
          <SummaryRing value={totalKeywords} label="目标关键词" basis="总词库" segments={rankingCoverage} />
          <div className="visualChartLegend">{rankingCoverage.map(segment => <Tooltip key={segment.label} title={`${segment.label}：${segment.count.toLocaleString()} 词；占总词库 ${percentage(totalKeywords ? segment.count/totalKeywords*100 : 0)}。${segment.description}`}><div tabIndex={0}><i style={{ background: segment.color }} /><span>{segment.label}</span><strong>{segment.count.toLocaleString()}</strong><small>{percentage(totalKeywords ? segment.count/totalKeywords*100 : 0)}</small></div></Tooltip>)}</div>
        </article>
        <article className="overviewVisualCard">
          <h3>已实测排名</h3>
          <SummaryRing value={data.summary.rankedInAnyRegion} label="词已检出排名" basis="有排名词" segments={data.summary.buckets.map(bucket => ({ count: bucket.count, color: bucket.color, label: bucket.min === 1 ? "前10名" : `${bucket.range}名` }))} />
          <div className="visualRankLegend">{data.summary.buckets.map(bucket => <Tooltip key={bucket.key} title={`${bucket.range} 名：${bucket.count} 词，占有排名词 ${percentage(data.summary.rankedInAnyRegion ? bucket.count/data.summary.rankedInAnyRegion*100 : null)}；同词取四国最佳有效排名，只计一次。`}><div tabIndex={0}><i style={{ background: bucket.color }} /><span>{bucket.min === 1 ? "前10" : bucket.range}</span><strong>{data.summary.captured ? bucket.count : "—"}</strong></div></Tooltip>)}</div>
          <div className="visualChartFootnote">可用结果 {data.summary.capturedInAnyRegion} 词 · 检出排名 {data.summary.rankedInAnyRegion} 词</div>
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
