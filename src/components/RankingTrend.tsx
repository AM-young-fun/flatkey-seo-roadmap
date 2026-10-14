"use client";
import { useEffect, useRef, useState } from "react";
import * as echarts from "echarts";
import Link from "next/link";
import { DISPLAY_BUCKETS } from "@/lib/rank-display";
import { REGIONS, type SearchRegionCode } from "@/lib/seo";

type Point = { date: string; counts: number[]; sites: string[]; sources: string[] };
export function RankingTrend({ region }: { region: SearchRegionCode }) {
  const [result, setResult] = useState<{region:string;points:Point[]} | null>(null);
  const [error, setError] = useState(false);
  const [version, retry] = useState(0);
  const element = useRef<HTMLDivElement>(null);
  const points = result?.region === region ? result.points : null;
  useEffect(() => {
    const controller = new AbortController();
    let busy = false;
    const read = async () => {
      if (busy || document.hidden) return;
      busy = true;
      try {
        const response = await fetch(`/api/seo/trends?region=${region}`, { signal: controller.signal, cache: "no-store" });
        if (!response.ok) throw new Error("加载失败");
        const data = await response.json() as { points: Point[] };
        if (!controller.signal.aborted) { setResult({region,points:data.points}); setError(false); }
      } catch { if (!controller.signal.aborted) setError(true); }
      finally { busy = false; }
    };
    void read();
    const timer = setInterval(() => void read(), 60000);
    return () => { controller.abort(); clearInterval(timer); };
  }, [region, version]);
  useEffect(() => {
    if (!element.current || !points?.length) return;
    const chart = echarts.init(element.current);
    const byDate = new Map(points.map((point) => [point.date, point]));
    const dates: string[] = [];
    const end = new Date(points.at(-1)!.date);
    for (const day = new Date(points[0].date); day <= end; day.setUTCDate(day.getUTCDate()+1)) dates.push(day.toISOString().slice(0,10));
    chart.setOption({ animation: false, color: DISPLAY_BUCKETS.slice(0,4).map(bucket=>bucket.color),
      tooltip: { trigger: "axis", renderMode:"richText", confine:true },
      legend: { top: 0, textStyle: {color:"#70819a",fontSize:11} },
      grid: { left: 45, right: 25, top: 45, bottom: 40 },
      xAxis: { type:"category", data:dates, boundaryGap:true, axisLabel:{formatter:(value:string)=>value.slice(5),color:"#8795a9"}, axisLine:{lineStyle:{color:"#e5eaf2"}} },
      yAxis: { type:"value", minInterval:1, axisLabel:{color:"#8795a9"},splitLine:{lineStyle:{color:"#eef2f7"}} },
      series: DISPLAY_BUCKETS.slice(0,4).map((bucket,index)=>({ name:`${bucket.range} 名`, type:"line", smooth:false, showSymbol:true, symbolSize:points.length===1?10:5, connectNulls:false, data:dates.map(date=>byDate.get(date)?.counts[index] ?? null) })),
    });
    const observer = new ResizeObserver(()=>chart.resize()); observer.observe(element.current);
    return () => { observer.disconnect(); chart.dispose(); };
  }, [points]);
  return <section className="dailyPanel trendPanel">
    <div className="dailyHeading"><div><h2>关键词排名趋势</h2><p className="chartNote">{REGIONS[region].label} · 每天各排名区间的关键词数量</p></div><Link href="/traffic" className="textLink">查看周报 →</Link></div>
    {error ? <div className="loadError"><span>趋势暂时无法读取</span><button onClick={()=>retry(value=>value+1)}>重新加载</button></div> : null}
    {!points ? <p className="muted">正在加载…</p> : !points.length ? <p className="muted">尚未采集排名，首次采集后开始记录每日变化。</p> : <><div ref={element} className="rankingTrend" role="img" aria-label={`${REGIONS[region].label}关键词每日排名区间数量趋势，${points.length}个采集日期`} />{points.length === 1 ? <p className="chartNote">目前只有 {points[0].date} 的采集记录，后续每天更新后形成曲线。</p> : null}<details className="movementDetails"><summary>数据说明</summary><p className="chartNote">按北京时间的实际采集日期统计，同一网站同一词只计一次。未采集的日期留空。包含 GSC 区间平均排名；采集范围不同会影响数量，目前有数据的网站：{[...new Set(points.flatMap(point=>point.sites))].join("、")}。</p></details></>}
  </section>;
}
