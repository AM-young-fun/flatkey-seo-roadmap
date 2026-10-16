"use client";
import Link from "next/link";
import { Tooltip } from "antd";
import { Info } from "lucide-react";
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
    <div className="panelHeader"><div><h2>目标词排名汇总 <span className="fourMarketBadge">四国综合</span></h2><p className="serpScope">{data?.currentPeriod.label ?? "每月两期"} · 每月1日、16日更新</p></div><Link className="textLink" href="/manage#serp-monitor">更新设置 →</Link></div>
    {loading ? <p className="muted">正在读取四国排名汇总…</p> : error ? <div className="loadError" role="alert"><span>{error}</span><button onClick={refresh}>重新加载</button></div> : data ? <>
      <div className="overviewVisualGrid">
        <article className="overviewVisualCard">
          <h3>业务词库 <Tooltip title="四个国家、三个网站合并去重；同一个关键词只计一次。只有已有合适页面的正式词参与后续付费监控。"><Info size={13} aria-label="词库统计口径" /></Tooltip></h3>
          <SummaryRing value={data.monitoring.allTargetCount} label="目标关键词" segments={[{ count: data.monitoring.eligibleTargetCount, color: "#5988e8", label: "已有页面" }, { count: data.monitoring.heldTargetCount, color: "#dce4f1", label: "暂不监控" }]} />
          <div className="visualChartLegend"><div><i style={{ background: "#5988e8" }} /><span>已有页面</span><strong>{data.monitoring.eligibleTargetCount.toLocaleString()}</strong><small>{percentage(data.monitoring.allTargetCount ? data.monitoring.eligibleTargetCount / data.monitoring.allTargetCount * 100 : null)}</small></div><div><i style={{ background: "#dce4f1" }} /><span>暂不监控</span><strong>{data.monitoring.heldTargetCount.toLocaleString()}</strong><small>{percentage(data.monitoring.allTargetCount ? data.monitoring.heldTargetCount / data.monitoring.allTargetCount * 100 : null)}</small></div></div>
        </article>
        <article className="overviewVisualCard">
          <h3>排名分布 <Tooltip title="每个关键词取四国有效自然排名中的最佳名次，只进入一个区间。没有采集的词不算没有排名。"><Info size={13} aria-label="排名分布口径" /></Tooltip></h3>
          <SummaryRing value={data.summary.rankedInAnyRegion} label="词获得排名" segments={data.summary.buckets.map(bucket => ({ count: bucket.count, color: bucket.color, label: bucket.min === 1 ? "前10" : bucket.range }))} />
          <div className="visualRankLegend">{data.summary.buckets.map(bucket => <div key={bucket.key}><i style={{ background: bucket.color }} /><span>{bucket.min === 1 ? "前10" : bucket.range}</span><strong>{data.summary.captured ? bucket.count : "—"}</strong></div>)}</div>
          <div className="visualChartFootnote">占总词库 <strong>{percentage(data.summary.coveragePercent)}</strong><Tooltip title={`已有 ${data.summary.capturedInAnyRegion} 个词完成过实测。四国均确认前100外：${data.summary.outside} 词；其余未采集或未完整返回的词，不能算作没有排名。`}><Info size={12} aria-label="采集覆盖情况" /></Tooltip></div>
        </article>
        <article className="overviewVisualCard countryVisualCard">
          <h3>各国排名占比 <Tooltip title={`四国份额以 ${data.summary.rankedRecords} 条国家排名记录为分母；占总词库以 ${data.summary.total} 个去重关键词为分母。同词在多个国家有排名时分别计入各国。`}><Info size={13} aria-label="国家占比口径" /></Tooltip></h3>
          <div className="countryChartHead"><span>国家 / 排名词</span><span>四国排名份额</span><span>占总词库</span></div>
          <div className="countryBarChart">{data.regions.map(result => <div className="countryBarRow" key={result.region}>
            <div className="countryBarLabel"><span aria-hidden="true">{MARKET_FLAGS[result.region]}</span><div><strong>{REGIONS[result.region].label}</strong><small>{result.summary.captured ? `${result.rankedCount} 词` : "未采集"}</small></div></div>
            <div className="countryBarValue"><span className="countryBarTrack"><i style={{ width: `${result.rankingRecordSharePercent ?? 0}%`, background: MARKET_COLORS[result.region] }} /></span><strong>{result.summary.captured ? percentage(result.rankingRecordSharePercent) : "—"}</strong></div>
            <span className="countryTargetShare">{result.summary.captured ? percentage(result.targetSharePercent) : "—"}</span>
          </div>)}</div>
          <div className="visualChartFootnote">{data.summary.rankedRecords} 条国家排名记录 · {data.summary.rankedInAnyRegion} 个去重词</div>
        </article>
      </div>
      <details className="simpleExplanation overviewCountryDetails"><summary>查看各国明细</summary><div className="serpPeriodTable"><table><thead><tr><th>国家</th><th>前10</th><th>11–30</th><th>31–50</th><th>51–100</th><th>已采集</th><th>本次未命中</th><th>Google纠词</th></tr></thead><tbody>{data.regions.map(result => <tr key={result.region}>
        <td>{REGIONS[result.region].label}</td>{result.summary.buckets.map(bucket => <td key={bucket.key}>{result.summary.captured ? bucket.count : "—"}</td>)}<td>{result.summary.captured}</td><td>{result.summary.notFoundCaptured}</td><td>{result.summary.queryChanged}</td>
      </tr>)}</tbody></table></div></details>
      <div className="serpOverviewFooter"><Link href="/keywords" className="textLink">查看关键词 →</Link><span className="visualLastUpdated">{data.latestCompletedAt ? `最近采集 ${new Date(data.latestCompletedAt).toLocaleDateString("zh-CN", { timeZone: "Asia/Shanghai" })}` : "尚未采集"}</span></div>
    </> : null}
  </section>;
}
