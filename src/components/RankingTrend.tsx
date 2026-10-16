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
function reportRange(reportEnd?: string) {
  const end = reportEnd ?? trendToday();
  const start = new Date(Date.parse(`${end}T00:00:00Z`) - 6 * 86400000).toISOString().slice(0, 10);
  return { start: start < EARLIEST_TREND_DATE ? EARLIEST_TREND_DATE : start, end };
}

export function RankingTrend({ region, reportEnd, hasSavedSnapshot = false }: { region: SearchRegionCode; reportEnd?: string; hasSavedSnapshot?: boolean }) {
  const [range, setRange] = useState(() => reportRange(reportEnd));
  const key = `labs-snapshots-v3:${dashboardStore.revision()}:${region}:${range.start}:${range.end}`;
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
        if (data.schemaVersion === 3 && data.mode === "labs-snapshots" && Array.isArray(data.points) && data.start === range.start && data.end === range.end)
          setResult(previous => previous?.key === key ? previous : { ...data, key });
      } catch { /* Ignore malformed cache data. */ }
    });
    const read = async () => {
      if (busy || document.hidden) return;
      busy = true;
      setRange(previous => { const next = reportRange(reportEnd); return next.start === previous.start && next.end === previous.end ? previous : next; });
      try {
        const response = await fetch(`/api/seo/trends?region=${region}&start=${range.start}&end=${range.end}${version > 0 || dashboardStore.revision() > 0 ? "&refresh=1" : ""}`, { signal: controller.signal, cache: "no-store" });
        if (response.status === 401) { window.location.assign("/login"); return; }
        if (!response.ok) throw new Error("加载失败");
        const data = await response.json() as TrendResult;
        if (data.schemaVersion !== 3 || data.mode !== "labs-snapshots") throw new Error("统计口径已更新，请重新加载");
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
  }, [region, key, range.start, range.end, reportEnd, version]);
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
        if (!point) return "暂无 DataForSEO 采集快照";
        return [`采集日 ${point.date}`, `业务目标：${point.total.toLocaleString()} 词`, ...values.filter(row=>row.value != null).map(row=>`${row.seriesName}：${Number(row.value).toLocaleString()} 词`), `待核验：${point.pending} 词`, `来源 SERP 日期：${point.dataDates?.length ? point.dataDates.join("、") : "来源日期未提供"}`, "DataForSEO 数据库快照；不代表实时搜索结果"].join("\n");
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
    <div className="dailyHeading"><div><h2>关键词排名趋势</h2><p className="chartNote">{REGIONS[region].label} · DataForSEO 已存采集快照</p></div><Link href="/manage" className="textLink">手动更新 →</Link></div>
    {latest ? <><p className="inventoryTrendTotal">业务目标共 <strong>{latest.total.toLocaleString()}</strong> 词 · 最近快照前 100 记录 <strong>{latest.total > 0 && latest.pending === latest.total ? "暂无记录" : `${latest.ranked.toLocaleString()} 词`}</strong></p><p className="chartNote">最近采集日 {latest.date} · 待核验 {latest.pending.toLocaleString()} 词</p>{latest.total > 0 && latest.pending === latest.total ? <p className="chartNote" role="status">暂无有效数据库名次，待核验词不能视为已确认未排名。</p> : null}</> : null}
    {error ? <div className="loadError"><span>趋势暂时无法读取</span><button onClick={()=>retry(value=>value+1)}>重新加载</button></div> : null}
    {!points ? <p className="muted">{error ? "趋势读取失败，请重试" : "正在加载…"}</p> : !points.length ? <p className="muted">{hasSavedSnapshot ? <>最近 7 天暂无更新；<Link href="/keywords" className="textLink">上次已存快照见关键词明细</Link>。</> : "尚未更新 DataForSEO。完成手动更新后显示真实采集点。"}</p> : <><div ref={element} className="rankingTrend" role="img" aria-label={`${REGIONS[region].label} DataForSEO 数据库采集快照，${displayStart} 至 ${displayEnd}；仅显示真实采集日`} /><p className="chartNote">仅在真实采集日绘点；首次采集前不补零，没有采集的日期不延用旧值。采集日与供应商 SERP 更新日期分别记录。</p><details className="movementDetails"><summary>数据说明</summary><p className="chartNote">业务目标总数与关键词明细使用相同词库：Flatkey 只计正式目标，其他网站保留有效业务词。同一网站同一关键词只计一次，前 100 是其中取得 DataForSEO 自然结果名次的子集。GSC、Ahrefs 只作历史原始证据，不参与本图。未返回的词保留为待核验，不视为确认前 100 外；数据库名次不代表此刻实时搜索结果。覆盖网站：{[...new Set(points.flatMap(point=>point.sites))].join("、")}。</p></details></>}
  </section>;
}
