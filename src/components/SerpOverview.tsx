"use client";
import Link from "next/link";
import { REGIONS, type SearchRegionCode } from "@/lib/seo";
import { useSerpResults } from "@/components/useSerpResults";

export function SerpOverview({ site, region }: { site: string; region: SearchRegionCode }) {
  const { data, error, loading, refresh } = useSerpResults(site, region);
  const summary = data?.summary;
  const checked = summary?.checked ?? 0;
  const captured = summary?.captured ?? checked;
  return <section className="discoveryPanel serpOverview" aria-label="目标词实际排名监控">
    <div className="panelHeader"><div><h2>目标词排名</h2><p className="serpScope">{REGIONS[region].label} · {data?.currentPeriod.label ?? "每月两期"} · 每月1日、16日 · 全量定时未开启</p></div><Link className="textLink" href="/manage#serp-monitor">更新设置 →</Link></div>
    {loading ? <p className="muted">正在读取排名…</p> : error ? <div className="loadError" role="alert"><span>{error}</span><button onClick={refresh}>重新加载</button></div> : summary ? <>
      <div className="serpProgressMetrics simpleMetrics"><div><span>目标关键词</span><strong>{summary.total.toLocaleString()}<small>词</small></strong></div><div><span>已完成采集</span><strong>{captured.toLocaleString()}<small>词</small></strong></div><div><span>尚未完成采集</span><strong>{(summary.total - captured).toLocaleString()}<small>词</small></strong>{summary.queued || summary.failed || summary.incomplete ? <small>采集中 {summary.queued} · 失败 {summary.failed} · 数据异常 {summary.incomplete}</small> : null}</div></div>
      {!captured ? <p className="serpSimpleNotice">尚无该国实测。待采集的词保留，不算“没有排名”。</p> : null}
      <div className="serpRankMetrics">{summary.buckets.map(bucket => <div key={bucket.key}><span><i style={{ background: bucket.color }} />{bucket.min === 1 ? "前10名" : `${bucket.range}名`}</span><strong>{checked ? bucket.count : "—"}</strong></div>)}<div><span>暂无前100排名</span><strong>{checked ? summary.outside : "—"}</strong></div></div>
      {captured ? <p className="chartNote">已检出排名 {summary.ranked} 词 · 本次未命中 {summary.notFoundCaptured ?? 0} 词 · Google已纠词 {summary.queryChanged ?? 0} 词。未命中的实际检查范围见关键词明细。</p> : null}
      {checked && data?.movementSummary ? <div className="serpMovementSummary"><span>较上次有效实测：</span><span>↑ 上升 {data.movementSummary.up}</span><span>↓ 下降 {data.movementSummary.down}</span><span>新进 {data.movementSummary.newInTop100}</span><span>跌出 {data.movementSummary.droppedOut}</span></div> : null}
      <div className="serpOverviewFooter"><Link href="/keywords" className="textLink">查看关键词与页面 →</Link><details className="simpleExplanation"><summary>数据说明</summary><p>同词多个页面取最佳自然名次，逐页证据在明细保留。已完成采集包括有排名、本次未命中及Google纠词；“本次未命中”会标出实际检查范围，不能直接算作前100外。待采集、采集失败及数据异常分别保留。各词以实际采集期次与时间为准，未执行不会生成快照。Labs、GSC、Ahrefs只作历史参考。{data?.latestCompletedAt ? `最近采集：${new Date(data.latestCompletedAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}。` : "尚无实测时间。"}</p></details></div>
    </> : null}
  </section>;
}
