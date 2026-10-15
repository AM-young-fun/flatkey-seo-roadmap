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
  const latest = points?.at(-1);
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
      tooltip: { trigger: "axis", renderMode:"richText", confine:true, formatter:(raw:unknown)=> {
        const values = raw as {axisValue:string;seriesName:string;value:number|null}[];
        const point = byDate.get(String(values[0]?.axisValue));
        if (!point) return "尚未建立词库基线";
        return [`截至 ${point.date} 的总量`, ...values.filter(row=>row.value != null).map(row=>`${row.seriesName}：${Number(row.value).toLocaleString()} 个`), `排名记录更新于 ${point.asOf ?? point.date}`, point.asOf && point.asOf < point.date ? "沿用最近确认结果，未当作当天重新检测" : "已纳入截至该日的确认结果"].join("\n");
      } },
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
    <div className="dailyHeading"><div><h2>关键词排名趋势</h2><p className="chartNote">{REGIONS[region].label} · 最近 7 天 · 截至每日的前 100 总量（含历史排名）</p></div><Link href="/traffic" className="textLink">查看周报 →</Link></div>
    {latest ? <p className="inventoryTrendTotal">截至 {latest.date}，前 100 总量 <strong>{latest.counts.reduce((sum,count)=>sum+count,0).toLocaleString()}</strong> 个{latest.asOf && latest.asOf < latest.date ? ` · 沿用 ${latest.asOf} 最近确认结果` : ""}</p> : null}
    {error ? <div className="loadError"><span>趋势暂时无法读取</span><button onClick={()=>retry(value=>value+1)}>重新加载</button></div> : null}
    {!points ? <p className="muted">{error ? "趋势读取失败，请重试" : "正在加载…"}</p> : !points.length ? <p className="muted">尚未建立词库排名基线，暂时无法展示总量趋势。</p> : <><div ref={element} className="rankingTrend" role="img" aria-label={`${REGIONS[region].label}最近7天关键词排名数量趋势，${range.start}至${range.end}，${points.length}个有数据日期`} /><p className="chartNote">{range.start} 至 {range.end} · 每日总量包含历史确认的排名；没有新确认结果时沿用上次总量，首次有效采集之前留空。</p><details className="movementDetails"><summary>数据说明</summary><p className="chartNote">前 100 合计为四个排名区间之和，同一网站同一关键词只计一次。总量按每个关键词截至该日最近确认的排名计算，已确认排名一直保留，明确查到前 100 外才移出。有新确认结果时更新所属区间，没有新确认结果时总量保持不变；悬停可查看结果的真实更新日期。GSC 单日曝光词数量不作为词库总量，也不向首次有效采集之前反推历史排名。GSC 排名保留其原统计区间。覆盖网站：{[...new Set(points.flatMap(point=>point.sites))].join("、")}。</p></details></>}
  </section>;
}
