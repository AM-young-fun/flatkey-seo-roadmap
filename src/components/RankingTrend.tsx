"use client";

import { ReportLoading } from "./ReportLoading";
import { useEffect, useMemo, useRef, useState } from "react";
import type * as echarts from "echarts";
import { REGION_CODES, REGIONS, type SearchRegionCode } from "@/lib/seo";
import { marketTrendComparabilityNote, SERP_TRENDS_DISPLAY_VERSION, serpTrendRange, type MultiRegionTrendResult, type TrendPoint } from "@/lib/ranking-trends";
import { DISPLAY_BUCKETS } from "@/lib/rank-display";
import { dashboardSession } from "@/lib/dashboard-session";
import { dashboardStore } from "@/lib/dashboard-client";
import { clientReadCache, ClientReadError } from "@/lib/client-read-cache";
import { createPendingDisplayPoll } from "@/lib/pending-display-poll";
import { OVERVIEW_PAGE_MODULES, type OverviewPageModule } from "@/lib/seo-overview-scope";
import { GrowthHistoricalReview } from "./GrowthHistoricalReview";
import { rankingTrendDisplayPeriods, rankingTrendDisplaySegments } from "./ranking-trend-display";
import styles from "./RankingTrend.module.css";

const trendResults = new Map<string, MultiRegionTrendResult>();
const SERIES = "进入前 100 的关键词";
const rankBuckets = DISPLAY_BUCKETS.slice(0, 4);
const periodLabel = (point: TrendPoint) => point.periodLabel ?? point.date;
const CAPTURE_STATUS = "采集状态";
const FIXED_CAPTURE_SERIES = "Flatkey 固定词库实测";
const captureTime = (point?: TrendPoint) => {
  if (!point) return "本期未采集";
  const format = (value: string) => new Date(value).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" });
  return point.captureStartAt ? `${format(point.captureStartAt)}${point.captureEndAt && point.captureEndAt !== point.captureStartAt ? ` 至 ${format(point.captureEndAt)}` : ""}` : point.date;
};
function isTrendResult(data: MultiRegionTrendResult) {
  return data.schemaVersion === 5 && data.mode === "serp-markets" && (data.points === null || Array.isArray(data.points)) && Array.isArray(data.markets) &&
    (data.points ?? []).every(point => point.languageProjection?.version === "native-word-single-country-v1") &&
    REGION_CODES.every(region => data.markets.some(market => market.region === region &&
      (market.status === "ERROR" && market.points === null || market.status === "READY" && Array.isArray(market.points) && market.points.every(point => point.languageProjection?.version === "native-word-single-country-v1"))));
}

export function RankingTrend({region = "all", module = "all", historicalScope = false, chartsOnly = false}:{region?:"all" | SearchRegionCode; module?: OverviewPageModule; historicalScope?: boolean; chartsOnly?: boolean}) {
  const [range, setRange] = useState(() => serpTrendRange());
  const key = `serp-markets-v5:${SERP_TRENDS_DISPLAY_VERSION}:${module}:${dashboardStore.revision()}:${range.start}:${range.end}`;
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
  const periods = useMemo(() => rankingTrendDisplayPeriods(points ?? []), [points]);
  const latest = periods.at(-1);
  const failed = markets?.filter(market => market.status === "ERROR" && (region === "all" || market.region === region)) ?? [];
  const fixedCapture = historicalScope && result?.key === key ? result.fixedCapture : undefined;
  const fixedCounts = region === "all" ? fixedCapture : fixedCapture?.countries.find(row => row.country === region);
  const fixedPeriod = fixedCounts ? fixedCapture : undefined;
  const hasCaptureStatus = historicalScope && periods.some(period => period.status !== null && period.key !== fixedPeriod?.periodKey);
  const hasPoints = Boolean(fixedPeriod) || hasCaptureStatus || periods.some(period => period.chartValue !== null);
  const segments = useMemo(() => rankingTrendDisplaySegments(periods, historicalScope), [periods, historicalScope]);
  useEffect(() => {
    const controller = new AbortController();
    const pendingPoll = createPendingDisplayPoll(() => { forceNext = true; void read(); });
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
      if (busy || !pendingPoll.canRead()) return;
      pendingPoll.cancel();
      busy = true;
      setRange(previous => { const next = serpTrendRange(); return next.start === previous.start && next.end === previous.end ? previous : next; });
      try {
        const url = `/api/views?view=trends&start=${range.start}&end=${range.end}&module=${module}${forceNext ? "&refresh=1" : ""}`;
        const data = await clientReadCache.read<MultiRegionTrendResult>(url, forceNext);
        forceNext = false;
        if (!pendingPoll.isActive()) return;
        if (!isTrendResult(data) || data.moduleScope?.module !== module) throw new Error("统计口径已更新，请重新加载");
        pendingPoll.update(Boolean((data as MultiRegionTrendResult & {displaySnapshot?:{pending?:boolean}}).displaySnapshot?.pending));
        if (!controller.signal.aborted) {
          trendResults.set(key, data);
          if (trendResults.size > 16) trendResults.delete(trendResults.keys().next().value!);
          setResult({ ...data, key }); setError(false);
          void dashboardSession.save(`trend:${key}`, JSON.stringify(data), Date.now());
        }
      } catch (error) {
        pendingPoll.cancel();
        if (!pendingPoll.isActive()) return;
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
    return () => { controller.abort(); pendingPoll.dispose(); clearInterval(timer); document.removeEventListener("visibilitychange", read); window.removeEventListener("focus", read); window.removeEventListener("seo-rankings-updated", onUpdated); };
  }, [key, range.start, range.end, version, module]);
  useEffect(() => {
    if (!element.current || !hasPoints) return;
    const target = element.current;
    let disposed = false;
    let chart: echarts.ECharts | undefined;
    let observer: ResizeObserver | undefined;
    const byPeriod = new Map(periods.map(period => [period.key, period]));
    const dates = [...new Set([...byPeriod.keys(), ...(fixedPeriod ? [fixedPeriod.periodKey] : [])])].sort();
    const periodIndexes = new Map(periods.map((period, index) => [period.key, index]));
    const xAxis: echarts.XAXisComponentOption = { type: "category", data: dates, boundaryGap: true, axisTick: { show: false },
      axisLabel: { hideOverlap: true, formatter: (value: string) => {
        const period = byPeriod.get(value);
        const label = period ? periodLabel(period.point) : fixedPeriod?.periodKey === value ? fixedPeriod.periodLabel : value;
        return dates.every(key => key.slice(0, 4) === dates[0].slice(0, 4)) ? label.replace(/^\d{4}年/, "") : label;
      }, color: "#64748b" }, axisLine: { lineStyle: { color: "#e2e8f0" } } };
    const yAxis: echarts.YAXisComponentOption = { type: "value", name: "词", min: 0, minInterval: 1, splitNumber: 4, axisLabel: { color: "#64748b" },
      splitLine: { lineStyle: { color: "#e9eef5", type: "dashed" } } };
    const series: echarts.SeriesOption[] = [
      { name: SERIES, type: "scatter", symbol: "emptyCircle", symbolSize: 8, itemStyle: { color: "#3473bd" },
        label: { show: dates.length <= 4, position: "top", color: "#334155", fontWeight: 600 }, labelLayout: { hideOverlap: true },
        data: dates.map(key => byPeriod.get(key)?.chartValue ?? null), z: 3 },
      ...segments.map<echarts.SeriesOption>(({ comparable, data }) => ({ name: comparable ? "可比区间" : "口径不同的观察值", type: "line",
        lineStyle: { width: 2.5, color: comparable ? "#3473bd" : "#647fa5", type: comparable ? "solid" : "dashed" },
        connectNulls: false, showSymbol: false, data: dates.map(key => data[periodIndexes.get(key) ?? -1] ?? null), z: 2 })),
    ];
    if (fixedPeriod && fixedCounts) series.push({ name: FIXED_CAPTURE_SERIES, type: "scatter", symbol: "rect", symbolSize: 9,
      itemStyle: { color: "#087e76" }, label: { show: true, position: "top", color: "#087e76", fontWeight: 600 },
      data: dates.map(key => key === fixedPeriod.periodKey ? fixedCounts.rankedKeywords : null), z: 4 });
    if (hasCaptureStatus) series.push({ name: CAPTURE_STATUS, type: "scatter", xAxisIndex: 1, yAxisIndex: 1, symbol: "diamond", symbolSize: 11,
      itemStyle: { color: "#a96514" },
      label: { show: true, position: "bottom", color: "#88510e", fontSize: 11, lineHeight: 14,
        formatter: params => `已开始采集\n${byPeriod.get(String((params.value as string[])[0]))?.status?.label ?? "上榜证据待齐"}` },
      tooltip: { trigger: "item", formatter: raw => {
        const { value } = raw as { value: string[] };
        const period = byPeriod.get(value[0]);
        if (!period?.status) return CAPTURE_STATUS;
        const unknown = period.point.languageProjection?.unknownLanguageWords;
        return [periodLabel(period.point), `已开始采集 / ${period.status.label}`, `原始有效采集 ${period.status.rawCaptured} 词 · 语种核验匹配 ${period.captured} 词`,
          ...(unknown === undefined ? [] : [`当期清单语种待核 ${unknown} 词`]), `实际采集：${captureTime(period.point)}`].join("\n");
      } },
      data: periods.flatMap(period => period.status && period.key !== fixedPeriod?.periodKey ? [[period.key, CAPTURE_STATUS]] : []),
    });
    const option: echarts.EChartsOption = { animation: false, color: ["#3473bd"],
      tooltip: { trigger: "axis", renderMode: "richText", confine: true, formatter: (raw: unknown) => {
        const values = raw as { axisValue: string }[];
        const key = String(values[0]?.axisValue);
        if (fixedPeriod && fixedCounts && key === fixedPeriod.periodKey) return [
          fixedPeriod.periodLabel, FIXED_CAPTURE_SERIES,
          `已采集 ${fixedCounts.capturedKeywords.toLocaleString()} 词 · 已确认前100 ${fixedCounts.rankedKeywords.toLocaleString()} 词`,
          `已核实前100外 ${fixedCounts.verifiedOutsideTop100.toLocaleString()} 词 · 排名未确认 ${fixedCounts.unresolvedKeywords.toLocaleString()} 词`,
          `采集截至 ${new Date(fixedPeriod.latestCheckedAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}`,
        ].join("\n");
        const period = byPeriod.get(key);
        if (!period) return "暂无SERP实测记录";
        const { point, captured, chartValue } = period;
        return [periodLabel(point), `当期非品牌原词：${point.total} 词 · 语种匹配有效采集 ${captured} 词`,
          `原有效采集（含待核语种）：${point.languageProjection?.rawCaptured ?? captured} 词`,
          chartValue === null ? "上榜证据待齐" : `${SERIES}：${chartValue} 词`,
          ...(chartValue === null ? [] : rankBuckets.map((bucket, index) => `第 ${bucket.range} 名：${point.counts[index] ?? "—"} 词`)),
          `原范围：${point.scopeLabel || "范围待核"}`,
          marketTrendComparabilityNote(point),
          `实际采集：${captureTime(point)}`].join("\n");
      } },
      grid: [{ left: 44, right: 12, top: 24, bottom: hasCaptureStatus ? 84 : 32 },
        ...(hasCaptureStatus ? [{ left: 44, right: 12, height: 16, bottom: 39 }] : [])],
      xAxis: [xAxis, ...(hasCaptureStatus ? [{ type: "category" as const, gridIndex: 1, data: dates, boundaryGap: true, show: false }] : [])],
      yAxis: [yAxis, ...(hasCaptureStatus ? [{ type: "category" as const, gridIndex: 1, data: [CAPTURE_STATUS], show: false }] : [])],
      series,
    };
    void import("@/lib/charts").then(({ init }) => {
      if (disposed) return;
      chart = init(target); chart.setOption(option);
      observer = new ResizeObserver(() => chart?.resize()); observer.observe(target);
    });
    return () => { disposed = true; observer?.disconnect(); chart?.dispose(); };
  }, [periods, segments, fixedPeriod, fixedCounts, hasCaptureStatus, hasPoints]);
  return <section className="dailyPanel trendPanel">
    <div className="dailyHeading"><div><h2>{historicalScope ? "历史目标词监控趋势" : "上榜关键词数趋势"}</h2><p className="chartNote">{region === "all" ? "原词语种匹配 · 同词只计一次" : REGIONS[region].label} · {moduleLabel}{historicalScope ? " · 原监控快照 · 全站合并总数见上方" : ""}</p></div></div>
    {module !== "all" ? <p className="chartNote">按当前登记目标页筛选历史实测；不代表当时的模块归属。</p> : null}
    {latest && !chartsOnly ? <>
      <div className="inventoryTrendSummary">
        <div className="inventoryTrendTotal">
          <span>{!latest.coverageComplete || historicalScope ? "匹配语种已确认前100" : "进入前 100"}</span>
          <strong>{latest.chartValue?.toLocaleString() ?? "数据待齐"}</strong>
        </div>
        <div className="inventoryTrendPeriod">
          <strong>{periodLabel(latest.point)}</strong>
          <span title={captureTime(latest.point)}>语种匹配有效采集 {latest.captured.toLocaleString()} / {latest.point.total.toLocaleString()} 词</span>
        </div>
      </div>
      <dl className="trendRankCounts" aria-label="最新一期各排名区间词数">
        {rankBuckets.map((bucket, index) => <div key={bucket.key}>
          <dt><i style={{ backgroundColor: bucket.color }} aria-hidden="true" />{bucket.range} 名</dt>
          <dd>{latest.chartValue === null ? "—" : latest.point.counts[index]?.toLocaleString() ?? "—"}</dd>
        </div>)}
      </dl>
    </> : null}
    {error || failed.length ? <div className="loadError"><span>{error ? "趋势暂时无法读取" : `${failed.map(market => REGIONS[market.region].label).join("、")}趋势暂时无法读取`}</span><button onClick={() => retry(value => value + 1)}>重新加载</button></div> : null}
    {historicalScope && hasPoints ? <div className={styles.legend} aria-label="趋势图图例">
      {segments.some(segment => segment.comparable) ? <span><i aria-hidden="true" />同口径折线</span> : null}
      {segments.some(segment => !segment.comparable) ? <span><i className={styles.dashed} aria-hidden="true" />不同口径的已确认词数</span> : null}
      {fixedPeriod && fixedCounts ? <span><i className={styles.fixed} aria-hidden="true" />{fixedPeriod.periodLabel} · {FIXED_CAPTURE_SERIES} · 前100 {fixedCounts.rankedKeywords.toLocaleString()} 词</span> : null}
      {hasCaptureStatus ? <span><i className={styles.marker} aria-hidden="true" />已开始采集</span> : null}
    </div> : null}
    {!markets ? error ? null : <ReportLoading label="正在读取排名趋势" compact /> : !hasPoints ? <p className="muted">{failed.length ? "部分国家数据暂时无法读取，请重试。" : periods.length ? "已有历史采集记录，上榜证据待齐。" : "暂无有效排名采集记录。"}</p> : <div ref={element} className="rankingTrend" role="img" aria-label={`${region === "all" ? "原词语种匹配 · 同词只计一次" : REGIONS[region].label}历史排名折线图${hasCaptureStatus ? "，待核验采集状态单独标记" : ""}`} />}
    {!historicalScope ? <p className="chartNote">每个点是当期已确认的上榜词数，同词跨国家、跨站只计一次。相邻两期经核定目标范围一致且均采集完整后才连线。</p> : null}
    {!chartsOnly ? <GrowthHistoricalReview points={points ?? []} /> : null}
  </section>;
}
