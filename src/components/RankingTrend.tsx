"use client";
import { useEffect, useRef, useState } from "react";
import type * as echarts from "echarts";
import { REGION_CODES, REGIONS, type SearchRegionCode } from "@/lib/seo";
import { DISPLAY_BUCKETS } from "@/lib/rank-display";
import { EARLIEST_TREND_DATE, marketTrendCount, trendToday, type MultiRegionTrendResult, type TrendPoint } from "@/lib/ranking-trends";
import { dashboardSession } from "@/lib/dashboard-session";
import { dashboardStore } from "@/lib/dashboard-client";
import { clientReadCache, ClientReadError } from "@/lib/client-read-cache";

const trendResults = new Map<string, MultiRegionTrendResult>();
const COLORS = DISPLAY_BUCKETS.slice(0, 4).map(bucket => bucket.color);
const captured = (point?: TrendPoint) => point ? point.captured ?? point.checked ?? point.ranked + point.outside : 0;
const captureTime = (point?: TrendPoint) => {
  if (!point) return "本期未采集";
  const format = (value: string) => new Date(value).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" });
  return point.captureStartAt ? `${format(point.captureStartAt)}${point.captureEndAt && point.captureEndAt !== point.captureStartAt ? ` 至 ${format(point.captureEndAt)}` : ""}` : point.date;
};
function reportRange() {
  const end = trendToday();
  const start = new Date(Date.parse(`${end}T00:00:00Z`) - 89 * 86400000).toISOString().slice(0, 10);
  return { start: start < EARLIEST_TREND_DATE ? EARLIEST_TREND_DATE : start, end };
}
function isTrendResult(data: MultiRegionTrendResult) {
  return data.schemaVersion === 5 && data.mode === "serp-markets" && (data.points === null || Array.isArray(data.points)) && Array.isArray(data.markets) &&
    REGION_CODES.every(region => data.markets.some(market => market.region === region &&
      (market.status === "ERROR" && market.points === null || market.status === "READY" && Array.isArray(market.points))));
}

export function RankingTrend({region = "all"}:{region?:"all" | SearchRegionCode}) {
  const [range, setRange] = useState(() => reportRange());
  const key = `serp-markets-v5:${dashboardStore.revision()}:${range.start}:${range.end}`;
  const [result, setResult] = useState<(MultiRegionTrendResult & { key: string }) | null>(() => {
    const saved = trendResults.get(key);
    return saved ? { ...saved, key } : null;
  });
  const [error, setError] = useState(false);
  const [version, retry] = useState(0);
  const element = useRef<HTMLDivElement>(null);
  const selectedLines = useRef<Record<string, boolean>>({});
  const markets = result?.key === key ? result.markets : null;
  const points = result?.key === key ? region === "all" ? result.points : result.markets.find(value=>value.region === region)?.points ?? null : null;
  const latest = points?.at(-1);
  const failed = markets?.filter(market => market.status === "ERROR" && (region === "all" || market.region === region)) ?? [];
  const hasPoints = points?.some(point => marketTrendCount(point) !== null) ?? false;
  useEffect(() => {
    const controller = new AbortController();
    let pendingTimer: ReturnType<typeof setTimeout>;
    let busy = false, completed = false, forceNext = version > 0 || dashboardStore.revision() > 0;
    const remembered = trendResults.get(key);
    if (remembered) setResult(previous => previous?.key === key ? previous : { ...remembered, key });
    void dashboardSession.load(`trend:${key}`).then(saved => {
      if (!saved || completed || controller.signal.aborted) return;
      try {
        const data = JSON.parse(saved.body) as MultiRegionTrendResult;
        if (isTrendResult(data) && data.start === range.start && data.end === range.end)
          setResult(previous => previous?.key === key ? previous : { ...data, key });
      } catch { /* Ignore malformed cache data. */ }
    });
    const read = async () => {
      if (busy || document.hidden) return;
      busy = true;
      setRange(previous => { const next = reportRange(); return next.start === previous.start && next.end === previous.end ? previous : next; });
      try {
        const url = `/api/views?view=trends&start=${range.start}&end=${range.end}${forceNext ? "&refresh=1" : ""}`;
        const data = await clientReadCache.read<MultiRegionTrendResult>(url, forceNext);
        forceNext = false;
        if ((data as MultiRegionTrendResult & {displaySnapshot?:{pending?:boolean}}).displaySnapshot?.pending) pendingTimer=setTimeout(()=>{forceNext=true;void read();},5000);
        if (!isTrendResult(data)) throw new Error("统计口径已更新，请重新加载");
        if (!controller.signal.aborted) {
          trendResults.set(key, data);
          if (trendResults.size > 16) trendResults.delete(trendResults.keys().next().value!);
          setResult({ ...data, key }); setError(false);
          void dashboardSession.save(`trend:${key}`, JSON.stringify(data), Date.now());
        }
      } catch (error) {
        if (error instanceof ClientReadError && error.status === 401) { clientReadCache.clear(); window.location.assign("/login"); return; }
        if (!controller.signal.aborted) setError(true);
      }
      finally { busy = false; completed = true; }
    };
    void read();
    const timer = setInterval(() => void read(), 5 * 60000);
    const onUpdated = () => retry(value => value + 1);
    document.addEventListener("visibilitychange", read);
    window.addEventListener("focus", read);
    window.addEventListener("seo-rankings-updated", onUpdated);
    return () => { controller.abort(); clearTimeout(pendingTimer); clearInterval(timer); document.removeEventListener("visibilitychange", read); window.removeEventListener("focus", read); window.removeEventListener("seo-rankings-updated", onUpdated); };
  }, [key, range.start, range.end, version]);
  useEffect(() => {
    if (!element.current || !hasPoints) return;
    const target = element.current;
    let disposed = false;
    let chart: echarts.ECharts | undefined;
    let observer: ResizeObserver | undefined;
    const byPeriod = new Map((points ?? []).map(point => [point.periodKey ?? point.date, point]));
    const dates = [...byPeriod.keys()];
    const option: echarts.EChartsOption = { animation: false, color: COLORS,
      tooltip: { trigger: "axis", renderMode: "richText", confine: true, formatter: (raw: unknown) => {
        const values = raw as { axisValue: string; seriesName: string; value: number | null }[];
        const point = byPeriod.get(String(values[0]?.axisValue));
        if (!point) return "暂无SERP实测记录";
        return [point.periodLabel ?? point.date, `当期关键词：${point.total} 词；已查 ${captured(point)} 词`,
          ...values.filter(value => value.value !== null).map(value => `${value.seriesName}：${value.value} 词`),
          `实际采集：${captureTime(point)}`].join("\n");
      } },
      legend: { top: 0, selectedMode: true, selected: { ...selectedLines.current }, inactiveColor: "#cbd5e1", textStyle: { color: "#70819a", fontSize: 11 } },
      grid: { left: 45, right: 25, top: 45, bottom: 60 },
      xAxis: { type: "category", data: dates, boundaryGap: true, axisLabel: { formatter: (value: string) => (byPeriod.get(value)?.periodLabel ?? value).replace("年", "年\n"), color: "#8795a9" }, axisLine: { lineStyle: { color: "#e5eaf2" } } },
      yAxis: { type: "value", minInterval: 1, name: "关键词数", axisLabel: { color: "#8795a9" }, splitLine: { lineStyle: { color: "#eef2f7" } } },
      series: DISPLAY_BUCKETS.slice(0, 4).map((bucket, index) => ({ name: `${bucket.range} 名`, type: "line" as const,
          lineStyle: { width: 2, color: bucket.color }, itemStyle: { color: bucket.color }, symbolSize: dates.length === 1 ? 9 : 5,
          connectNulls: false, data: dates.map(date => { const point = byPeriod.get(date); return marketTrendCount(point) === null ? null : point!.counts[index]; }) })),
    };
    void import("@/lib/charts").then(({ init }) => {
      if (disposed) return;
      chart = init(target); chart.setOption(option);
      chart.on("legendselectchanged", (event: unknown) => {
        selectedLines.current = { ...(event as { selected: Record<string, boolean> }).selected };
      });
      observer = new ResizeObserver(() => chart?.resize()); observer.observe(target);
    });
    return () => { disposed = true; observer?.disconnect(); chart?.dispose(); };
  }, [points, hasPoints]);
  return <section className="dailyPanel trendPanel">
    <div className="dailyHeading"><div><h2>每期排名趋势</h2><p className="chartNote">{region === "all" ? "四国汇总" : REGIONS[region].label} · 同一关键词只计一次 · 隔周周二10:30</p></div></div>
    {latest ? <p className="inventoryTrendTotal">{latest.periodLabel ?? latest.date} · 已查 <strong>{captured(latest).toLocaleString()}</strong> 词 · 检出前100排名 <strong>{latest.ranked.toLocaleString()}</strong> 词</p> : null}
    {error || failed.length ? <div className="loadError"><span>{error ? "趋势暂时无法读取" : `${failed.map(market => REGIONS[market.region].label).join("、")}趋势暂时无法读取`}</span><button onClick={() => retry(value => value + 1)}>重新加载</button></div> : null}
    {!markets ? <p className="muted">{error ? "趋势读取失败，请重试" : "正在加载…"}</p> : !hasPoints ? <p className="muted">{failed.length ? "部分国家数据暂时无法读取，请重试。" : "尚无有效排名快照，采集完成后显示总趋势。"}</p> : <><div ref={element} className="rankingTrend" role="img" aria-label={`${region === "all" ? "四国汇总" : REGIONS[region].label}关键词排名区间趋势，点击图例隐藏或显示对应曲线`} /></>}

  </section>;
}
