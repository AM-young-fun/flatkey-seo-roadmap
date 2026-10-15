"use client";
import { useEffect, useRef, useState } from "react";
import * as echarts from "echarts";
import Link from "next/link";
import { DISPLAY_BUCKETS } from "@/lib/rank-display";
import { REGIONS, type SearchRegionCode } from "@/lib/seo";
import { recentTrendRange, type TrendResult } from "@/lib/ranking-trends";

export function RankingTrend({ region }: { region: SearchRegionCode }) {
  const [range, setRange] = useState(() => recentTrendRange());
  const key = `${region}:${range.start}:${range.end}`;
  const [result, setResult] = useState<(TrendResult & {key:string}) | null>(null);
  const [error, setError] = useState(false);
  const [version, retry] = useState(0);
  const element = useRef<HTMLDivElement>(null);
  const points = result?.key === key ? result.points : null;
  useEffect(() => {
    const controller = new AbortController();
    let busy = false;
    const read = async () => {
      if (busy || document.hidden) return;
      busy = true;
      setRange(previous => { const next = recentTrendRange(); return next.start === previous.start && next.end === previous.end ? previous : next; });
      try {
        const response = await fetch(`/api/seo/trends?region=${region}&start=${range.start}&end=${range.end}`, { signal: controller.signal, cache: "no-store" });
        if (response.status === 401) { window.location.assign("/login"); return; }
        if (!response.ok) throw new Error("加载失败");
        const data = await response.json() as TrendResult;
        if (!controller.signal.aborted) { setResult({...data,key}); setError(false); }
      } catch { if (!controller.signal.aborted) setError(true); }
      finally { busy = false; }
    };
    void read();
    const timer = setInterval(() => void read(), 60000);
    document.addEventListener("visibilitychange", read);
    window.addEventListener("focus", read);
    return () => { controller.abort(); clearInterval(timer); document.removeEventListener("visibilitychange", read); window.removeEventListener("focus", read); };
  }, [region, key, range.start, range.end, version]);
  useEffect(() => {
    if (!element.current || !points?.length) return;
    const chart = echarts.init(element.current);
    const byDate = new Map(points.map((point) => [point.date, point]));
    const dates: string[] = [];
    const end = new Date(range.end);
    for (const day = new Date(range.start); day <= end; day.setUTCDate(day.getUTCDate()+1)) dates.push(day.toISOString().slice(0,10));
    chart.setOption({ animation: false, color: ["#19283f", ...DISPLAY_BUCKETS.slice(0,4).map(bucket=>bucket.color)],
      tooltip: { trigger: "axis", renderMode:"richText", confine:true },
      legend: { top: 0, textStyle: {color:"#70819a",fontSize:11} },
      grid: { left: 45, right: 25, top: 45, bottom: 40 },
      xAxis: { type:"category", data:dates, boundaryGap:true, axisLabel:{formatter:(value:string)=>value.slice(5),color:"#8795a9"}, axisLine:{lineStyle:{color:"#e5eaf2"}} },
      yAxis: { type:"value", minInterval:1, axisLabel:{color:"#8795a9"},splitLine:{lineStyle:{color:"#eef2f7"}} },
      series: [{ name:"前 100 合计", type:"line", lineStyle:{width:3}, itemStyle:{color:"#19283f"}, symbolSize:6, connectNulls:false, data:dates.map(date=> { const point=byDate.get(date); return point ? point.counts.reduce((sum,count)=>sum+count,0) : null; }) }, ...DISPLAY_BUCKETS.slice(0,4).map((bucket,index)=>({ name:`${bucket.range} 名`, type:"line", itemStyle:{color:bucket.color}, lineStyle:{color:bucket.color}, smooth:false, showSymbol:true, symbolSize:points.length===1?10:5, connectNulls:false, data:dates.map(date=>byDate.get(date)?.counts[index] ?? null) }))],
    });
    const observer = new ResizeObserver(()=>chart.resize()); observer.observe(element.current);
    return () => { observer.disconnect(); chart.dispose(); };
  }, [points, range.start, range.end]);
  return <section className="dailyPanel trendPanel">
    <div className="dailyHeading"><div><h2>关键词排名趋势</h2><p className="chartNote">{REGIONS[region].label} · 最近 7 天 · 全词库前 100 排名数量</p></div><Link href="/traffic" className="textLink">查看周报 →</Link></div>
    {error ? <div className="loadError"><span>趋势暂时无法读取</span><button onClick={()=>retry(value=>value+1)}>重新加载</button></div> : null}
    {!points ? <p className="muted">{error ? "趋势读取失败，请重试" : "正在加载…"}</p> : !points.length ? <p className="muted">最近 7 天暂无完整词库快照，无法还原的历史日期留空。</p> : <><div ref={element} className="rankingTrend" role="img" aria-label={`${REGIONS[region].label}最近7天关键词排名数量趋势，${range.start}至${range.end}，${points.length}个有数据日期`} /><p className="chartNote">{range.start} 至 {range.end} · 按完整采集快照统计，包含截至该日每个词最近确认的排名；缺少快照的日期留空。</p><details className="movementDetails"><summary>数据说明</summary><p className="chartNote">前 100 合计为四个排名区间之和，同一网站同一关键词只计一次。每个快照包含此前已确认的排名；明确查到前 100 外才移出。GSC 单日曝光词报告不能代替完整词库快照，不用于补齐缺失的历史总数。GSC 排名保留其原统计区间。覆盖网站：{[...new Set(points.flatMap(point=>point.sites))].join("、")}。</p></details></>}
  </section>;
}
