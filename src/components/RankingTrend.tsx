"use client";
import { useEffect, useRef, useState } from "react";
import * as echarts from "echarts";
import Link from "next/link";
import { DISPLAY_BUCKETS } from "@/lib/rank-display";
import { REGIONS, type SearchRegionCode } from "@/lib/seo";
import { EARLIEST_TREND_DATE, trendRange, trendToday, type TrendPoint } from "@/lib/ranking-trends";

export function RankingTrend({ region }: { region: SearchRegionCode }) {
  const [range, setRange] = useState(() => ({ start: EARLIEST_TREND_DATE, end: trendToday() }));
  const key = `${region}:${range.start}:${range.end}`;
  const [result, setResult] = useState<{key:string;points:TrendPoint[];mode:"daily"|"capture"} | null>(null);
  const [error, setError] = useState(false);
  const [version, retry] = useState(0);
  const element = useRef<HTMLDivElement>(null);
  const points = result?.key === key ? result.points : null;
  function changeRange(part: "start" | "end", value: string) {
    setRange(previous => {
      if (previous[part] === value) return previous;
      try { return trendRange(part === "start" ? value : previous.start, part === "end" ? value : previous.end); }
      catch { return previous; }
    });
  }
  useEffect(() => {
    const controller = new AbortController();
    let busy = false;
    const read = async () => {
      if (busy || document.hidden) return;
      busy = true;
      try {
        const response = await fetch(`/api/seo/trends?region=${region}&start=${range.start}&end=${range.end}`, { signal: controller.signal, cache: "no-store" });
        if (!response.ok) throw new Error("加载失败");
        const data = await response.json() as { points: TrendPoint[]; mode: "daily" | "capture" };
        if (!controller.signal.aborted) { setResult({key,points:data.points,mode:data.mode}); setError(false); }
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
  }, [points, range.start, range.end]);
  return <section className="dailyPanel trendPanel">
    <div className="dailyHeading"><div><h2>关键词排名趋势</h2><p className="chartNote">{REGIONS[region].label} · 每天各排名区间的关键词数量{points && result?.mode === "daily" ? " · 历史单日排名" : ""}</p></div><div className="trendControls"><div className="trendDateRange" role="group" aria-label="趋势日期范围"><label>开始日期<input aria-label="趋势开始日期" type="date" min={EARLIEST_TREND_DATE} max={range.end} value={range.start} onInput={event=>changeRange("start",event.currentTarget.value)} onChange={event=>changeRange("start",event.currentTarget.value)} /></label><span>至</span><label>结束日期<input aria-label="趋势结束日期" type="date" min={range.start} max={trendToday()} value={range.end} onInput={event=>changeRange("end",event.currentTarget.value)} onChange={event=>changeRange("end",event.currentTarget.value)} /></label></div><Link href="/traffic" className="textLink">查看周报 →</Link></div></div>
    {error ? <div className="loadError"><span>趋势暂时无法读取</span><button onClick={()=>retry(value=>value+1)}>重新加载</button></div> : null}
    {!points ? <p className="muted">正在加载…</p> : !points.length ? <p className="muted">所选日期暂无排名记录，尚未公布或尚未采集的日期留空。</p> : <><div ref={element} className="rankingTrend" role="img" aria-label={`${REGIONS[region].label}关键词每日排名区间数量趋势，${range.start}至${range.end}，${points.length}个有数据日期`} /><p className="chartNote">{result?.mode === "daily" ? `已补录至 ${points.at(-1)!.date}，共 ${points.length} 天。GSC 按单日有曝光的查询及当日平均排名统计，与整月汇总数量不同。` : `当前为采集快照，${points.length} 个采集日期；历史单日数据补录后显示每日趋势。`} 无数据日期留空。</p><details className="movementDetails"><summary>数据说明</summary><p className="chartNote">最早可选 2026-10-08。历史数据使用来源报告日期，采集快照使用北京时间采集日期，两种口径不拼接。各排名区间互不重叠；GSC 查询报告不包含匿名查询，同一网站同一词按报告去重。覆盖网站：{[...new Set(points.flatMap(point=>point.sites))].join("、")}。网站缺少当天报告时留空，避免把缺失当成下降。</p></details></>}
  </section>;
}
