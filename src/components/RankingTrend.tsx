"use client";
import { useEffect, useRef, useState } from "react";
import type * as echarts from "echarts";
import Link from "next/link";
import { DISPLAY_BUCKETS } from "@/lib/rank-display";
import { REGIONS, type SearchRegionCode } from "@/lib/seo";
import { recentTrendRange, type TrendResult } from "@/lib/ranking-trends";
import { dashboardSession } from "@/lib/dashboard-session";

const trendResults = new Map<string, TrendResult>();

export function RankingTrend({ region }: { region: SearchRegionCode }) {
  const [range, setRange] = useState(() => recentTrendRange());
  const key = `${region}:${range.start}:${range.end}`;
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
        if (Array.isArray(data.points) && data.start === range.start && data.end === range.end)
          setResult(previous => previous?.key === key ? previous : { ...data, key });
      } catch { /* Ignore malformed cache data. */ }
    });
    const read = async () => {
      if (busy || document.hidden) return;
      busy = true;
      setRange(previous => { const next = recentTrendRange(); return next.start === previous.start && next.end === previous.end ? previous : next; });
      try {
        const response = await fetch(`/api/seo/trends?region=${region}&start=${range.start}&end=${range.end}`, { signal: controller.signal, cache: "no-store" });
        if (response.status === 401) { window.location.assign("/login"); return; }
        if (!response.ok) throw new Error("加载失败");
        const data = await response.json() as TrendResult;
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
    document.addEventListener("visibilitychange", read);
    window.addEventListener("focus", read);
    return () => { controller.abort(); clearInterval(timer); document.removeEventListener("visibilitychange", read); window.removeEventListener("focus", read); };
  }, [region, key, range.start, range.end, version]);
  useEffect(() => {
    if (!element.current || !points?.length) return;
    const target = element.current;
    let disposed = false;
    let chart: echarts.ECharts | undefined;
    let observer: ResizeObserver | undefined;
    const byDate = new Map(points.map((point) => [point.date, point]));
    const dates = points.map(point => point.date);
    const option: echarts.EChartsOption = { animation: false, color: ["#19283f", ...DISPLAY_BUCKETS.slice(0,4).map(bucket=>bucket.color)],
      tooltip: { trigger: "axis", renderMode:"richText", confine:true, formatter:(raw:unknown)=> {
        const values = raw as {axisValue:string;seriesName:string;value:number|null}[];
        const point = byDate.get(String(values[0]?.axisValue));
        if (!point) return "尚未建立词库基线";
        return [`截至 ${point.date} 已采集的报告记录`, ...values.filter(row=>row.value != null).map(row=>`${row.seriesName}：${Number(row.value).toLocaleString()} 个`), `排名记录更新于 ${point.asOf ?? point.date}`, point.asOf && point.asOf < point.date ? "沿用最近报告，未在当天重新检测" : "已纳入截至该日采集的来源报告"].join("\n");
      } },
      legend: { top: 0, textStyle: {color:"#70819a",fontSize:11} },
      grid: { left: 45, right: 25, top: 45, bottom: 40 },
      xAxis: { type:"category", data:dates, boundaryGap:true, axisLabel:{formatter:(value:string)=>value.slice(5),color:"#8795a9"}, axisLine:{lineStyle:{color:"#e5eaf2"}} },
      yAxis: { type:"value", minInterval:1, axisLabel:{color:"#8795a9"},splitLine:{lineStyle:{color:"#eef2f7"}} },
      series: [{ name:"前 100 合计", type:"line" as const, lineStyle:{width:3}, itemStyle:{color:"#19283f"}, symbolSize:6, connectNulls:false, data:dates.map(date=> { const point=byDate.get(date); return point ? point.counts.reduce((sum,count)=>sum+count,0) : null; }) }, ...DISPLAY_BUCKETS.slice(0,4).map((bucket,index)=>({ name:`${bucket.range} 名`, type:"line" as const, itemStyle:{color:bucket.color}, lineStyle:{color:bucket.color}, smooth:false, showSymbol:true, symbolSize:points.length===1?10:5, connectNulls:false, data:dates.map(date=>byDate.get(date)?.counts[index] ?? null) }))],
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
    <div className="dailyHeading"><div><h2>关键词排名趋势</h2><p className="chartNote">{REGIONS[region].label} · 最近 7 天 · 来源报告中的前 100 记录（非实时名次）</p></div><Link href="/traffic" className="textLink">查看周报 →</Link></div>
    {latest ? <p className="inventoryTrendTotal">截至 {latest.date}，报告前 100 记录 <strong>{latest.counts.reduce((sum,count)=>sum+count,0).toLocaleString()}</strong> 个{latest.asOf && latest.asOf < latest.date ? ` · 沿用 ${latest.asOf} 最近报告` : ""}</p> : null}
    {error ? <div className="loadError"><span>趋势暂时无法读取</span><button onClick={()=>retry(value=>value+1)}>重新加载</button></div> : null}
    {!points ? <p className="muted">{error ? "趋势读取失败，请重试" : "正在加载…"}</p> : !points.length ? <p className="muted">尚未建立词库排名基线，暂时无法展示总量趋势。</p> : <><div ref={element} className="rankingTrend" role="img" aria-label={`${REGIONS[region].label}最近7天关键词排名数量趋势，${displayStart}至${displayEnd}，${points.length}个有数据日期`} /><p className="chartNote">{displayStart} 至 {displayEnd} · 按当时已采集的来源报告统计；没有新报告的日期沿用上次结果，不代表当天搜索可复现。</p><details className="movementDetails"><summary>数据说明</summary><p className="chartNote">前 100 合计为四个排名区间之和，同一网站同一关键词只计一次。每个关键词按截至该日可用报告的实际数据日期选取；更新的无数据报告会替代旧排名，但无数据不代表确认前 100 外。未重新采集时沿用上次报告，悬停可查看采集更新日期。GSC 单日曝光词数量不作为词库总量，也不向首次有效采集之前反推历史排名。GSC 排名保留其原统计区间。覆盖网站：{[...new Set(points.flatMap(point=>point.sites))].join("、")}。</p></details></>}
  </section>;
}
