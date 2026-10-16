"use client";
import { useEffect, useRef, useState } from "react";
import type * as echarts from "echarts";
import Link from "next/link";
import { DISPLAY_BUCKETS } from "@/lib/rank-display";
import { REGIONS, type SearchRegionCode } from "@/lib/seo";
import { EARLIEST_TREND_DATE, trendToday, type TrendResult } from "@/lib/ranking-trends";
import { dashboardSession } from "@/lib/dashboard-session";
import { dashboardStore } from "@/lib/dashboard-client";

const trendResults = new Map<string, TrendResult>();
function reportRange() {
  const end = trendToday();
  const start = new Date(Date.parse(`${end}T00:00:00Z`) - 89 * 86400000).toISOString().slice(0, 10);
  return { start: start < EARLIEST_TREND_DATE ? EARLIEST_TREND_DATE : start, end };
}

export function RankingTrend({ region }: { region: SearchRegionCode }) {
  const [range, setRange] = useState(() => reportRange());
  const key = `serp-checks-v4:${dashboardStore.revision()}:${region}:${range.start}:${range.end}`;
  const [result, setResult] = useState<(TrendResult & {key:string}) | null>(() => {
    const saved = trendResults.get(key);
    return saved ? { ...saved, key } : null;
  });
  const [error, setError] = useState(false);
  const [version, retry] = useState(0);
  const element = useRef<HTMLDivElement>(null);
  const points = result?.key === key ? result.points : null;
  const displayStart = points?.[0]?.date ?? range.start;
  const displayEnd = points?.at(-1)?.date ?? range.end;
  const latest = points?.at(-1);
  useEffect(() => {
    const controller = new AbortController();
    let busy = false;
    let completed = false;
    const remembered = trendResults.get(key);
    if (remembered) setResult(previous => previous?.key === key ? previous : { ...remembered, key });
    void dashboardSession.load(`trend:${key}`).then(saved => {
      if (!saved || completed || controller.signal.aborted) return;
      try {
        const data = JSON.parse(saved.body) as TrendResult;
        if (data.schemaVersion === 4 && data.mode === "serp-checks" && Array.isArray(data.points) && data.start === range.start && data.end === range.end)
          setResult(previous => previous?.key === key ? previous : { ...data, key });
      } catch { /* Ignore malformed cache data. */ }
    });
    const read = async () => {
      if (busy || document.hidden) return;
      busy = true;
      setRange(previous => { const next = reportRange(); return next.start === previous.start && next.end === previous.end ? previous : next; });
      try {
        const response = await fetch(`/api/seo/trends?region=${region}&start=${range.start}&end=${range.end}${version > 0 || dashboardStore.revision() > 0 ? "&refresh=1" : ""}`, { signal: controller.signal, cache: "no-store" });
        if (response.status === 401) { window.location.assign("/login"); return; }
        if (!response.ok) throw new Error("加载失败");
        const data = await response.json() as TrendResult;
        if (data.schemaVersion !== 4 || data.mode !== "serp-checks") throw new Error("统计口径已更新，请重新加载");
        if (!controller.signal.aborted) {
          trendResults.set(key, data);
          if (trendResults.size > 16) trendResults.delete(trendResults.keys().next().value!);
          setResult({...data,key}); setError(false);
          void dashboardSession.save(`trend:${key}`, JSON.stringify(data), Date.now());
        }
      } catch { if (!controller.signal.aborted) setError(true); }
      finally { busy = false; completed = true; }
    };
    void read();
    const timer = setInterval(() => void read(), 60000);
    const onUpdated = () => retry(value => value + 1);
    document.addEventListener("visibilitychange", read);
    window.addEventListener("focus", read);
    window.addEventListener("seo-rankings-updated", onUpdated);
    return () => { controller.abort(); clearInterval(timer); document.removeEventListener("visibilitychange", read); window.removeEventListener("focus", read); window.removeEventListener("seo-rankings-updated", onUpdated); };
  }, [region, key, range.start, range.end, version]);
  useEffect(() => {
    if (!element.current || !points?.length) return;
    const target = element.current;
    let disposed = false;
    let chart: echarts.ECharts | undefined;
    let observer: ResizeObserver | undefined;
    const byDate = new Map(points.map((point) => [point.periodKey ?? point.date, point]));
    const dates = points.map(point => point.periodKey ?? point.date);
    const option: echarts.EChartsOption = { animation: false, color: ["#19283f", ...DISPLAY_BUCKETS.slice(0,4).map(bucket=>bucket.color)],
      tooltip: { trigger: "axis", renderMode:"richText", confine:true, formatter:(raw:unknown)=> {
        const values = raw as {axisValue:string;seriesName:string;value:number|null}[];
        const point = byDate.get(String(values[0]?.axisValue));
        if (!point) return "暂无SERP实测记录";
        return [`期次 ${point.periodLabel ?? point.date}`, `当期冻结词库：${point.total.toLocaleString()} 词`, ...values.filter(row=>row.value != null).map(row=>`${row.seriesName}：${Number(row.value).toLocaleString()} 词`), `已完成采集：${point.captured ?? point.checked ?? point.ranked + point.outside} 词`, `本次未命中：${point.notFoundCaptured ?? 0} 词`, `实测时间：${point.dataDates?.length ? point.dataDates.join("、") : "来源日期未提供"}`, "DataForSEO SERP采集时的自然排名"].join("\n");
      } },
      legend: { top: 0, textStyle: {color:"#70819a",fontSize:11} },
      grid: { left: 45, right: 25, top: 45, bottom: 60 },
      xAxis: { type:"category", data:dates, boundaryGap:true, axisLabel:{formatter:(value:string)=>(byDate.get(value)?.periodLabel ?? value).replace("年", "年\n"),color:"#8795a9"}, axisLine:{lineStyle:{color:"#e5eaf2"}} },
      yAxis: { type:"value", minInterval:1, axisLabel:{color:"#8795a9"},splitLine:{lineStyle:{color:"#eef2f7"}} },
      series: [{ name:"前 100 合计", type:"line" as const, lineStyle:{width:3}, itemStyle:{color:"#19283f"}, symbolSize:6, connectNulls:false, data:dates.map(date=> { const point=byDate.get(date); return point && (point.captured ?? point.checked ?? point.ranked + point.outside) > 0 ? point.ranked : null; }) }, ...DISPLAY_BUCKETS.slice(0,4).map((bucket,index)=>({ name:`${bucket.range} 名`, type:"line" as const, itemStyle:{color:bucket.color}, lineStyle:{color:bucket.color}, smooth:false, showSymbol:true, symbolSize:points.length===1?10:5, connectNulls:false, data:dates.map(date=>{ const point=byDate.get(date); return point && (point.captured ?? point.checked ?? point.ranked + point.outside) > 0 ? point.counts[index] : null; }) }))],
    };
    void import("@/lib/charts").then(({ init }) => {
      if (disposed) return;
      chart = init(target);
      chart.setOption(option);
      observer = new ResizeObserver(() => chart?.resize());
      observer.observe(target);
    });
    return () => { disposed = true; observer?.disconnect(); chart?.dispose(); };
  }, [points, range.start, range.end]);
  return <section className="dailyPanel trendPanel">
    <div className="dailyHeading"><div><h2>每期排名趋势</h2><p className="chartNote">{REGIONS[region].label} · 最近90天真实期次快照 · 每月1日、16日 · 全量定时未开启</p></div><Link href="/manage" className="textLink">管理采集计划 →</Link></div>
    {latest ? <><p className="inventoryTrendTotal">当期冻结词库 <strong>{latest.total.toLocaleString()}</strong> 词 · 其中取得前 100 记录 <strong>{(latest.captured ?? latest.checked ?? latest.ranked + latest.outside) === 0 ? "暂无记录" : `${latest.ranked.toLocaleString()} 词`}</strong></p><p className="chartNote">{latest.periodLabel ?? latest.date} · 最近实测日 {latest.date} · 已采集 {latest.captured ?? latest.checked ?? latest.ranked + latest.outside} 词 · 本次未命中 {latest.notFoundCaptured ?? 0} 词</p>{(latest.captured ?? latest.checked ?? latest.ranked + latest.outside) === 0 ? <p className="chartNote" role="status">尚无已完成的采集结果。</p> : null}</> : null}
    {error ? <div className="loadError"><span>趋势暂时无法读取</span><button onClick={()=>retry(value=>value+1)}>重新加载</button></div> : null}
    {!points ? <p className="muted">{error ? "趋势读取失败，请重试" : "正在加载…"}</p> : !points.length ? <p className="muted">尚无该国排名快照，采集完成后会显示实际期次与趋势。</p> : <><div ref={element} className="rankingTrend" role="img" aria-label={`${REGIONS[region].label} DataForSEO SERP实测，${displayStart} 至 ${displayEnd}；仅显示真实采集日`} /><p className="chartNote">每个真实采集期次仅绘一个点，标注当期实际采集时间；未采集的期次不补零。</p><details className="simpleExplanation"><summary>查看各期数据与变化</summary><div className="serpPeriodTable"><table><thead><tr><th>期次 / 实测时间</th><th>当期词库 / 已采集</th><th>前10</th><th>11–30</th><th>31–50</th><th>51–100</th><th>暂无前100</th><th>较上次有效实测</th></tr></thead><tbody>{points.map(point => <tr key={point.periodKey ?? point.date}><td><strong>{point.periodLabel ?? point.date}</strong><small>{point.captureStartAt ? new Date(point.captureStartAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" }) : point.date}{point.captureEndAt && point.captureEndAt !== point.captureStartAt ? ` 至 ${new Date(point.captureEndAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}` : ""}</small></td><td>{point.total} / {point.captured ?? point.checked ?? point.ranked + point.outside}<small>本次未命中 {point.notFoundCaptured ?? 0} · 纠词 {point.queryChanged ?? 0}</small></td>{point.counts.map((count, index) => <td key={index}>{(point.captured ?? point.checked ?? point.ranked + point.outside) > 0 ? count : "—"}</td>)}<td>{(point.captured ?? point.checked ?? point.ranked + point.outside) > 0 ? point.outside : "—"}</td><td>{point.movementSummary ? <>↑ {point.movementSummary.up} · ↓ {point.movementSummary.down}<small>新进 {point.movementSummary.newInTop100} · 跌出 {point.movementSummary.droppedOut} · 首次 {point.movementSummary.firstCheck}</small></> : "暂无可比基线"}</td></tr>)}</tbody></table></div></details><details className="movementDetails"><summary>数据说明</summary><p className="chartNote">后续采集仅纳入页面就绪的正式词，研究候选不自动进入付费范围。历史期次按采集时冻结的词库范围保留，不因当前页面状态改变而重算。只统计DataForSEO SERP的自然结果，每个关键词只计一次，保留同轮各排名页面。“本次未命中”是已完成采集的结论，保留实际检查范围，不自动视为跌出前100。未查询、失败与数据异常不算作无排名；Labs、GSC、Ahrefs不参与本图。</p></details></>}
  </section>;
}
