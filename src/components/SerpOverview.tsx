"use client";
import Link from "next/link";
import { REGIONS } from "@/lib/seo";
import { useSerpOverviewResults } from "@/components/useSerpOverviewResults";

const percentage = (value: number | null) => value == null ? "—" : `${value.toFixed(1)}%`;

export function SerpOverview({ site }: { site: string }) {
  const { data, error, loading, refresh } = useSerpOverviewResults(site);
  return <section className="discoveryPanel serpOverview" aria-label="四国目标词排名汇总">
    <div className="panelHeader"><div><h2>目标词排名汇总</h2><p className="serpScope">美国、日本、西班牙、巴西 · {data?.currentPeriod.label ?? "每月两期"} · 每月1日、16日 · 定时付费未开启</p></div><Link className="textLink" href="/manage#serp-monitor">更新设置 →</Link></div>
    {loading ? <p className="muted">正在读取四国排名汇总…</p> : error ? <div className="loadError" role="alert"><span>{error}</span><button onClick={refresh}>重新加载</button></div> : data ? <>
      <div className="serpProgressMetrics simpleMetrics">
        <div><span>全部业务目标</span><strong>{data.monitoring.allTargetCount.toLocaleString()}<small>词</small></strong></div>
        <div><span>已有合适页面 · 可监控</span><strong>{data.monitoring.eligibleTargetCount.toLocaleString()}<small>词</small></strong></div>
        <div><span>页面未就绪 · 暂不监控</span><strong>{data.monitoring.heldTargetCount.toLocaleString()}<small>词</small></strong><small>包括待建设、待核实的页面</small></div>
      </div>
      <p className="inventoryTrendTotal">至少一个国家有排名：<strong>{data.summary.rankedInAnyRegion.toLocaleString()}</strong> 词<small> · 占全部关键词 {percentage(data.summary.coveragePercent)}</small></p>
      <div className="serpRankMetrics">{data.summary.buckets.map(bucket => <div key={bucket.key}><span><i style={{ background: bucket.color }} />{bucket.min === 1 ? "前10名" : `${bucket.range}名`}</span><strong>{data.summary.captured ? bucket.count : "—"}</strong></div>)}<div><span>四国均暂无前100排名</span><strong>{data.summary.captured ? data.summary.outside : "—"}</strong></div></div>
      <p className="chartNote">总分布每个词取四国已存有效名次中的最好排名，只计一次。同词多个网站合并。</p>
      <p className="chartNote">占总关键词：除以 {data.summary.total.toLocaleString()} 词；占四国排名记录：除以 {data.summary.rankedRecords.toLocaleString()} 条（同词跨国分别计一条）。</p>
      <div className="serpPeriodTable"><table><thead><tr><th>国家</th><th>有排名词数</th><th>占总关键词</th><th>占四国排名记录</th><th>已采集 / 总词数</th></tr></thead><tbody>{data.regions.map(result => <tr key={result.region}>
        <td><strong>{REGIONS[result.region].label}</strong></td>
        <td>{result.summary.captured ? result.rankedCount : "—"}</td>
        <td>{result.summary.captured ? percentage(result.targetSharePercent) : "—"}</td>
        <td>{result.summary.captured ? percentage(result.rankingRecordSharePercent) : "—"}</td>
        <td>{result.summary.captured.toLocaleString()} / {data.summary.total.toLocaleString()}</td>
      </tr>)}</tbody></table></div>
      <details className="simpleExplanation"><summary>各国排名分布与采集状态</summary><div className="serpPeriodTable"><table><thead><tr><th>国家</th><th>前10</th><th>11–30</th><th>31–50</th><th>51–100</th><th>其他结果</th></tr></thead><tbody>{data.regions.map(result => <tr key={result.region}>
        <td>{REGIONS[result.region].label}</td>{result.summary.buckets.map(bucket => <td key={bucket.key}>{result.summary.captured ? bucket.count : "—"}</td>)}
        <td>{result.summary.captured ? <>本次未命中 {result.summary.notFoundCaptured} · 纠词 {result.summary.queryChanged}{result.summary.outside ? <> · 完整前100未命中 {result.summary.outside}</> : null}</> : "尚无实测"}{result.summary.queued || result.summary.failed || result.summary.incomplete ? <> · 采集中 {result.summary.queued} · 失败 {result.summary.failed} · 异常 {result.summary.incomplete}</> : null}</td>
      </tr>)}</tbody></table></div></details>
      <div className="serpOverviewFooter"><Link href="/keywords" className="textLink">查看关键词与页面 →</Link><details className="simpleExplanation"><summary>数据说明</summary><p>后续仅监控已有合适页面的正式词，已有页面待优化的词继续监控，页面上线并核实后自动加入。研究候选不自动付费。各国排名区间互不重叠，同词多页面取最佳自然名次，不计算四国平均排名。“本次未命中”保留实际检查范围，不能直接算作前100外；Google纠词单独记录。暂不监控的词及已有排名保留，历史期次不因当前页面状态改变而重算。Labs、GSC、Ahrefs只作历史参考。{data.latestCompletedAt ? `最近采集：${new Date(data.latestCompletedAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}。` : "尚无实测时间。"}</p></details></div>
    </> : null}
  </section>;
}
