"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import type * as echarts from "echarts";
import { REGION_CODES, REGIONS, type SearchRegionCode } from "@/lib/seo";
import { marketTrendCount, serpTrendRange, type MultiRegionTrendResult, type TrendPoint } from "@/lib/ranking-trends";
import { DISPLAY_BUCKETS } from "@/lib/rank-display";
import { dashboardSession } from "@/lib/dashboard-session";
import { dashboardStore } from "@/lib/dashboard-client";
import { clientReadCache, ClientReadError } from "@/lib/client-read-cache";
import { OVERVIEW_PAGE_MODULES, type OverviewPageModule } from "@/lib/seo-overview-scope";

const trendResults = new Map<string, MultiRegionTrendResult>();
const SERIES = "进入前 100 的关键词";
const rankBuckets = DISPLAY_BUCKETS.slice(0, 4);
const captured = (point?: TrendPoint) => point ? point.captured ?? point.checked ?? point.ranked + point.outside : 0;
const captureTime = (point?: TrendPoint) => {
  if (!point) return "本期未采集";
  const format = (value: string) => new Date(value).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" });
  return point.captureStartAt ? `${format(point.captureStartAt)}${point.captureEndAt && point.captureEndAt !== point.captureStartAt ? ` 至 ${format(point.captureEndAt)}` : ""}` : point.date;
};
function isTrendResult(data: MultiRegionTrendResult) {
  return data.schemaVersion === 5 && data.mode === "serp-markets" && (data.points === null || Array.isArray(data.points)) && Array.isArray(data.markets) &&
    REGION_CODES.every(region => data.markets.some(market => market.region === region &&
      (market.status === "ERROR" && market.points === null || market.status === "READY" && Array.isArray(market.points))));
}

export function RankingTrend({region = "all", module = "all"}:{region?:"all" | SearchRegionCode; module?: OverviewPageModule}) {
  const [range, setRange] = useState(() => serpTrendRange());
  const key = `serp-markets-v5:current-target-modules-v1:${module}:${dashboardStore.revision()}:${range.start}:${range.end}`;
  const moduleLabel = OVERVIEW_PAGE_MODULES.find(([value]) => value === module)?.[1];
  const [result, setResult] = useState<(MultiRegionTrendResult & { key: string }) | null>(() => {
    const saved = trendResults.get(key);
    return saved ? { ...saved, key } : null;
  });
  const [error, setError] = useState(false);
  const [version, retry] = useState(0);
  const element = useRef<HTMLDivElement>(null);
  const markets = result?.key === key ? result.markets : null;
  const points = result?.key === key ? region === "all" ? result.points : result.markets.find(value=>value.region === region)?.points ?? null : null;
  const validPoints = useMemo(() => (points ?? []).filter(point => marketTrendCount(point) !== null), [points]);
  const latest = validPoints.at(-1);
  const failed = markets?.filter(market => market.status === "ERROR" && (region === "all" || market.region === region)) ?? [];
  const hasPoints = validPoints.length > 0;
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
        if (isTrendResult(data) && data.start === range.start && data.end === range.end && data.moduleScope?.module === module)
          setResult(previous => previous?.key === key ? previous : { ...data, key });
      } catch { /* Ignore malformed cache data. */ }
    });
    const read = async () => {
      if (busy || document.hidden) return;
      busy = true;
      setRange(previous => { const next = serpTrendRange(); return next.start === previous.start && next.end === previous.end ? previous : next; });
      try {
        const url = `/api/views?view=trends&start=${range.start}&end=${range.end}&module=${module}${forceNext ? "&refresh=1" : ""}`;
        const data = await clientReadCache.read<MultiRegionTrendResult>(url, forceNext);
        forceNext = false;
        if ((data as MultiRegionTrendResult & {displaySnapshot?:{pending?:boolean}}).displaySnapshot?.pending) pendingTimer=setTimeout(()=>{forceNext=true;void read();},5000);
        if (!isTrendResult(data) || data.moduleScope?.module !== module) throw new Error("统计口径已更新，请重新加载");
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
  }, [key, range.start, range.end, version, module]);
  useEffect(() => {
    if (!element.current || !hasPoints) return;
    const target = element.current;
    let disposed = false;
    let chart: echarts.ECharts | undefined;
    let observer: ResizeObserver | undefined;
    const byPeriod = new Map(validPoints.map(point => [point.periodKey ?? point.date, point]));
    const dates = [...byPeriod.keys()];
    const option: echarts.EChartsOption = { animation: false, color: ["#3473bd"],
      tooltip: { trigger: "axis", renderMode: "richText", confine: true, formatter: (raw: unknown) => {
        const values = raw as { axisValue: string }[];
        const point = byPeriod.get(String(values[0]?.axisValue));
        if (!point) return "暂无SERP实测记录";
        return [point.periodLabel ?? point.date, `当期关键词：${point.total} 词；已查 ${captured(point)} 词`,
          `${SERIES}：${point.ranked} 词`,
          ...rankBuckets.map((bucket, index) => `第 ${bucket.range} 名：${point.counts[index] ?? "—"} 词`),
          `实际采集：${captureTime(point)}`].join("\n");
      } },
      grid: { left: 48, right: 25, top: 34, bottom: 42 },
      xAxis: { type: "category", data: dates, boundaryGap: true, axisLabel: { formatter: (value: string) => (byPeriod.get(value)?.periodLabel ?? value).replace("年", "年\n"), color: "#8795a9" }, axisLine: { lineStyle: { color: "#e5eaf2" } } },
      yAxis: { type: "value", minInterval: 1, name: "关键词数", axisLabel: { color: "#8795a9" }, splitLine: { lineStyle: { color: "#eef2f7" } } },
      series: [{ name: SERIES, type: "line", lineStyle: { width: 2 }, symbol: "circle", showSymbol: true,
        symbolSize: dates.length === 1 ? 9 : 6, label: { show: dates.length === 1, position: "top" },
        data: [...byPeriod.values()].map(point => point.ranked) }],
    };
    void import("@/lib/charts").then(({ init }) => {
      if (disposed) return;
      chart = init(target); chart.setOption(option);
      observer = new ResizeObserver(() => chart?.resize()); observer.observe(target);
    });
    return () => { disposed = true; observer?.disconnect(); chart?.dispose(); };
  }, [validPoints, hasPoints]);
  return <section className="dailyPanel trendPanel">
    <div className="dailyHeading"><div><h2>上榜关键词数趋势</h2><p className="chartNote">{region === "all" ? "四国去重" : REGIONS[region].label} · {moduleLabel} · 按排名采集期统计进入前 100 的词</p></div></div>
    {module !== "all" ? <p className="chartNote">按当前登记目标页筛选历史实测；不代表当时的模块归属。</p> : null}
    {latest ? <>
      <p className="inventoryTrendTotal">{latest.periodLabel ?? latest.date} · 进入前 100 <strong>{latest.ranked.toLocaleString()}</strong> 词</p>
      <p className="chartNote">实际采集：{captureTime(latest)} · 本期已查 {captured(latest).toLocaleString()} / {latest.total.toLocaleString()} 词</p>
      <dl className="trendRankCounts" aria-label="最新一期各排名区间词数">
        {rankBuckets.map((bucket, index) => <div key={bucket.key}>
          <dt>第 {bucket.range} 名</dt><dd>{latest.counts[index]?.toLocaleString() ?? "—"}</dd>
        </div>)}
      </dl>
    </> : null}
    {error || failed.length ? <div className="loadError"><span>{error ? "趋势暂时无法读取" : `${failed.map(market => REGIONS[market.region].label).join("、")}趋势暂时无法读取`}</span><button onClick={() => retry(value => value + 1)}>重新加载</button></div> : null}
    {!markets ? <p className="muted">{error ? "趋势读取失败，请重试" : "正在加载…"}</p> : !hasPoints ? <p className="muted">{failed.length ? "部分国家数据暂时无法读取，请重试。" : "暂无有效排名采集记录。"}</p> : <div ref={element} className="rankingTrend" role="img" aria-label={`${region === "all" ? "四国去重" : REGIONS[region].label}上榜关键词数折线图`} />}

  </section>;
}
