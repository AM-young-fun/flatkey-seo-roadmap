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
  const key = `weekly-v2:${region}:${range.start}:${range.end}`;
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
        if (data.schemaVersion === 2 && data.mode === "weekly-evidence" && Array.isArray(data.points) && data.start === range.start && data.end === range.end)
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
        if (data.schemaVersion !== 2 || data.mode !== "weekly-evidence") throw new Error("统计口径已更新，请重新加载");
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
        if (!point) return "暂无周排名证据";
        return [`统计期 ${point.periodStart} 至 ${point.periodEnd}`, `业务目标：${point.total.toLocaleString()} 词`, ...values.filter(row=>row.value != null).map(row=>`${row.seriesName}：${Number(row.value).toLocaleString()} 词`), `明确前 100 外：${point.outside} 词`, `待核验：${point.pending} 词`, "按当前已导入的真实报告回算，非当天搜索结果"].join("\n");
      } },
      legend: { top: 0, textStyle: {color:"#70819a",fontSize:11} },
      grid: { left: 45, right: 25, top: 45, bottom: 40 },
      xAxis: { type:"category", data:dates, boundaryGap:true, axisLabel:{formatter:(value:string)=>value.slice(5),color:"#8795a9"}, axisLine:{lineStyle:{color:"#e5eaf2"}} },
      yAxis: { type:"value", minInterval:1, axisLabel:{color:"#8795a9"},splitLine:{lineStyle:{color:"#eef2f7"}} },
      series: [{ name:"前 100 合计", type:"line" as const, lineStyle:{width:3}, itemStyle:{color:"#19283f"}, symbolSize:6, connectNulls:false, data:dates.map(date=> { const point=byDate.get(date); return point && point.pending < point.total ? point.ranked : null; }) }, ...DISPLAY_BUCKETS.slice(0,4).map((bucket,index)=>({ name:`${bucket.range} 名`, type:"line" as const, itemStyle:{color:bucket.color}, lineStyle:{color:bucket.color}, smooth:false, showSymbol:true, symbolSize:points.length===1?10:5, connectNulls:false, data:dates.map(date=>{ const point=byDate.get(date); return point && point.pending < point.total ? point.counts[index] : null; }) }))],
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
    <div className="dailyHeading"><div><h2>关键词排名趋势</h2><p className="chartNote">{REGIONS[region].label} · 业务词库的周排名证据 · 非实时名次</p></div><Link href="/traffic" className="textLink">查看周报 →</Link></div>
    {latest ? <><p className="inventoryTrendTotal">业务目标共 <strong>{latest.total.toLocaleString()}</strong> 词 · 本期前 100 记录 <strong>{latest.total > 0 && latest.pending === latest.total ? "暂无周证据" : `${latest.ranked.toLocaleString()} 词`}</strong></p><p className="chartNote">{latest.periodStart} 至 {latest.periodEnd} · 明确前 100 外 {latest.outside.toLocaleString()} 词 · 待核验 {latest.pending.toLocaleString()} 词</p>{latest.total > 0 && latest.pending === latest.total ? <p className="chartNote" role="status">本期暂无有效周排名证据，待核验词不能视为已确认未排名。</p> : null}</> : null}
    {error ? <div className="loadError"><span>趋势暂时无法读取</span><button onClick={()=>retry(value=>value+1)}>重新加载</button></div> : null}
    {!points ? <p className="muted">{error ? "趋势读取失败，请重试" : "正在加载…"}</p> : !points.length ? <p className="muted">当前没有可统计的业务目标词。</p> : <><div ref={element} className="rankingTrend" role="img" aria-label={`${REGIONS[region].label}业务词库周排名证据趋势，统计期末${displayStart}至${displayEnd}；缺少证据的日期留空`} /><p className="chartNote">每点为截至标注日期的连续 7 个完整自然日，按当前已导入报告回算。缺少有效周证据时留空，不沿用过期排名。</p><details className="movementDetails"><summary>数据说明</summary><p className="chartNote">业务目标总数与关键词明细使用相同词库：Flatkey 只计正式目标，其他网站保留有效业务词。同一网站同一关键词只计一次，前 100 是其中有有效排名证据的子集。GSC 只使用精确匹配该 7 天的查询平均排名；Ahrefs 要求来源更新日期在该统计期内。单日 GSC、28 天或 90 天均值不填充周排名。没有记录和来源明确报告前 100 外分别统计，页面均位不当作查询排名，当前 Google 搜索未核验。覆盖网站：{[...new Set(points.flatMap(point=>point.sites))].join("、")}。</p></details></>}
  </section>;
}
