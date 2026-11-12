"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useSearchParams } from "next/navigation";
import { ArrowUpRight, ChevronRight, RefreshCw, Search } from "lucide-react";
import { formatCtr, formatDelta, gscDate, gscPeriodEnd, optimizationRange, optimizationWeekComparison, type OptimizationEffect, type OptimizedEffectPage, type OptimizedEffectVersion } from "@/lib/seo-page-effects";
import { CLUSTER_SITES } from "@/lib/seo-cluster-sites";
import { propertyToday, shiftDay } from "@/lib/seo-date-range";
import type { SeoCountry } from "@/lib/seo";
import { UiSelect } from "./UiSelect";
import { useSeoCountry } from "./useSeoCountry";
import { analyticsUrl, numberText, shanghaiStamp, useSeoRead } from "./useSeoAnalytics";
import styles from "./SeoWorkWorkspace.module.css";
import effects from "./OptimizationEffects.module.css";

type GaDay = { date: string; sessions: number | null; registrations: number | null };
type Metric = keyof typeof labels;
const labels = {
  clicks: "Google 点击", impressions: "Google 曝光", ctr: "点击率", position: "平均排名",
  sessions: "自然搜索访问", registrations: "可归属注册",
} as const;
const metrics = Object.keys(labels) as Metric[];
const seriesColors: Record<Metric, string> = {
  clicks: "#2563eb", impressions: "#047857", ctr: "#a14d0c", position: "#7c3aed", sessions: "#036b82", registrations: "#be185d",
};
const axisFor = (metric: Metric) => metric === "ctr" ? "percent" : metric === "position" ? "rank" : "count";
const axisLabels = { count: "次数", percent: "点击率", rank: "排名" };
const sites = [{ value: "flatkey.ai", label: "Flatkey" }, ...CLUSTER_SITES.map(site => ({ value: site.domain, label: site.name }))];
const siteName = (domain: string) => sites.find(site => site.value === domain)?.label ?? domain;
const baseHref = (country: SeoCountry) => country === "all" ? "/optimization-effects" : `/optimization-effects?country=${country}`;
const detailHref = (id: string, country: SeoCountry) => "/optimization-effects?" + new URLSearchParams({ publication: id, ...(country === "all" ? {} : { country }) });
const dateLabel = (date: string) => date.length === 10 ? date : shanghaiStamp(date);
const isGaMetric = (metric: Metric): metric is "sessions" | "registrations" => metric === "sessions" || metric === "registrations";

function OptimizationTrend({ series, gaDays, launchDay }: { series: OptimizationEffect["series"]; gaDays: GaDay[]; launchDay: string }) {
  const element = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(metrics);
  const [failed, setFailed] = useState(false);
  const hasData = (key: Metric) => isGaMetric(key) ? gaDays.some(row => row[key] != null) : series.some(row => row[key] != null);
  const visibleLabels = visible.filter(hasData).map(key => labels[key]);

  useEffect(() => {
    const target = element.current;
    if (!target) return;
    const gaByDay = new Map(gaDays.map(day => [day.date, day]));
    const data = visible.map(key => ({ key, values: series.map(day => isGaMetric(key) ? gaByDay.get(day.date)?.[key] ?? null : day[key]) }))
      .filter(line => line.values.some(value => value !== null));
    if (!data.length) return;
    const axes = (["count", "percent", "rank"] as const).filter(axis => data.some(line => axisFor(line.key) === axis));
    let disposed = false, chart: ReturnType<typeof import("@/lib/charts")["init"]> | undefined, observer: ResizeObserver | undefined;
    void import("@/lib/charts").then(({ init }) => {
      if (disposed) return;
      chart = init(target);
      chart.setOption({
        animation: false,
        tooltip: { trigger: "axis", confine: true, renderMode: "richText" },
        grid: { left: 48, right: axes.length === 3 ? 84 : axes.length === 2 ? 52 : 20, top: 36, bottom: 32 },
        xAxis: { type: "category", data: series.map(day => day.date), axisTick: { show: false },
          axisLabel: { hideOverlap: true, formatter: (date: string) => date.slice(5) }, axisLine: { lineStyle: { color: "#dce4ef" } } },
        yAxis: axes.map((axis, index) => ({
          type: "value", name: axisLabels[axis], position: index ? "right" : "left", offset: index > 1 ? 43 : 0,
          min: axis === "rank" ? 1 : 0, inverse: axis === "rank", minInterval: axis === "percent" ? undefined : 1,
          axisLabel: axis === "percent" ? { formatter: (value: number) => `${+(value * 100).toFixed(2)}%` } : undefined,
          splitLine: { show: index === 0, lineStyle: { color: "#edf1f6" } },
        })),
        series: data.map(({ key, values }, index) => ({
          name: labels[key], type: "line", data: values, yAxisIndex: axes.indexOf(axisFor(key)),
          connectNulls: false, symbolSize: 5, lineStyle: { color: seriesColors[key], width: 2 }, itemStyle: { color: seriesColors[key] },
          tooltip: { valueFormatter: (value: unknown) => typeof value === "number" ? key === "ctr" ? formatCtr(value) : key === "position" ? value.toFixed(2) : numberText(value) : "—" },
          ...(!index && series.some(day => day.date === launchDay) ? { markLine: { silent: true, symbol: "none",
            label: { formatter: "优化", color: "#52647b" }, lineStyle: { color: "#64748b", type: "dashed" }, data: [{ xAxis: launchDay }] } } : {}),
        })),
      });
      setFailed(false);
      observer = new ResizeObserver(() => chart?.resize());
      observer.observe(target);
    }).catch(() => { if (!disposed) setFailed(true); });
    return () => { disposed = true; observer?.disconnect(); chart?.dispose(); };
  }, [series, gaDays, launchDay, visible]);

  return <section className={effects.panel} aria-labelledby="optimization-trend">
    <h2 id="optimization-trend">每日趋势</h2>
    <div className={effects.legend} role="group" aria-label="筛选趋势指标">
      {metrics.map(key => <button type="button" key={key} aria-pressed={visible.includes(key)}
        title={hasData(key) ? undefined : "暂无日数据"} style={{ "--line-color": seriesColors[key] } as CSSProperties}
        onClick={() => setVisible(current => current.includes(key) ? current.filter(item => item !== key) : metrics.filter(item => item === key || current.includes(item)))}>
        <span aria-hidden="true" />{labels[key]}
      </button>)}
    </div>
    {visibleLabels.length ? <div className={effects.chart} ref={element} role="img" aria-label={`每日趋势：${visibleLabels.join("、")}`} />
      : <p className={effects.note}>{visible.length ? "所选指标暂无日数据。" : "请选择要查看的指标。"}</p>}
    {failed ? <p className={effects.note} role="status">图表暂时无法加载。</p> : null}
  </section>;
}

function EffectComparison({ page, optimizedAt, country }: { page: OptimizedEffectPage; optimizedAt: string; country: SeoCountry }) {
  const stamp = optimizedAt.length === 10 ? optimizedAt + "T20:00:00Z" : optimizedAt;
  const timezone = CLUSTER_SITES.find(site => site.domain === page.site)?.ga4TimeZone ?? "America/Los_Angeles";
  const gaToday = propertyToday(timezone);
  const gaDay = new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(new Date(stamp));
  const gscDay = gscDate(new Date(stamp));
  const maxEnd = shiftDay(gscDay, 90), latest = gscPeriodEnd(new Date());
  const range = optimizationRange(stamp, latest < maxEnd ? latest : maxEnd);
  const result = useSeoRead<{ pageDaily: GaDay[]; optimizationEffect: OptimizationEffect }>(
    range.start <= range.end ? analyticsUrl(range, [page.url], country, page.site) + "&pageDaily=1&effectAt=" + encodeURIComponent(stamp) : null,
  );
  if (result.error) return <div className={effects.panel} role="alert"><p>{result.error}</p><button type="button" className={styles.secondary} onClick={result.retry}>重试</button></div>;
  if (!result.data) return <p className={effects.panel} role="status">{range.start <= range.end ? "正在读取页面数据…" : "暂无完整日期的数据。"}</p>;
  const { pageDaily, optimizationEffect: { series, launchDay } } = result.data;
  const gaDays = pageDaily.filter(day => day.date < gaToday);
  const value = (key: Metric, number: number | null | undefined) => key === "ctr" ? formatCtr(number)
    : key === "position" && number != null ? number.toFixed(2) : numberText(number);
  return <>
    <section className={effects.panel} aria-labelledby="optimization-comparison">
      <h2 id="optimization-comparison">优化前后对比</h2>
      <p className={effects.note}>在优化前后各 7 天内配对同一星期几的数据，跳过优化当天。注册按日去重后加总。</p>
      <div className={effects.tableScroll}><table className={effects.table}>
        <thead><tr><th scope="col">指标</th><th scope="col">优化前 7 天</th><th scope="col">优化后 7 天</th><th scope="col">变化</th></tr></thead>
        <tbody>{metrics.map(key => {
          const ga = isGaMetric(key);
          const days = ga ? gaDays.map(day => ({ date: day.date, value: day[key] }))
            : series.map(day => ({ date: day.date, value: day[key], weight: key === "ctr" || key === "position" ? day.impressions : undefined }));
          const { beforeValue, afterValue, paired, beforeDays, afterDays } = optimizationWeekComparison(days, ga ? gaDay : launchDay);
          const change = !paired || beforeValue == null || afterValue == null ? null : (afterValue - beforeValue) * (key === "ctr" ? 100 : 1);
          return <tr key={key}><th scope="row">{labels[key]}</th>
            <td>{value(key, beforeValue)}{beforeDays > 0 && beforeDays < 7 ? <small>{beforeDays}/7 天</small> : null}</td>
            <td>{value(key, afterValue)}{afterDays > 0 && afterDays < 7 ? <small>{afterDays}/7 天</small> : null}</td>
            <td>{change == null ? "—" : formatDelta(change) + (key === "ctr" ? " 个百分点" : key === "position" ? " 位" : "")}</td></tr>;
        })}</tbody>
      </table></div>
    </section>
    <OptimizationTrend series={series} gaDays={gaDays} launchDay={launchDay} />
  </>;
}

function PageEffectDetail({ page, version, country }: { page: OptimizedEffectPage; version: OptimizedEffectVersion; country: SeoCountry }) {
  return version.date ? <EffectComparison key={`${version.id}:${country}`} page={page} optimizedAt={version.date} country={country} />
    : <p className={effects.panel}>这条记录缺少优化日期，暂时无法计算前后变化。</p>;
}

export function OptimizationEffects() {
  const result = useSeoRead<{ pages: OptimizedEffectPage[]; partial: boolean }>("/api/seo/optimized-pages");
  const params = useSearchParams();
  const [country] = useSeoCountry();
  const [site, setSite] = useState("all"), [query, setQuery] = useState("");
  const selected = params.get("publication");
  const pages = result.data?.pages ?? [];
  const active = selected ? pages.find(page => page.versions.some(version => version.id === selected)) : undefined;
  const version = active?.versions.find(item => item.id === selected);
  const search = query.trim().toLowerCase();
  const filtered = pages.filter(page => (site === "all" || page.site === site) &&
    (page.title.toLowerCase().includes(search) || page.url.toLowerCase().includes(search)));
  return <div className={effects.workspace}>
    <div className={effects.header}><h1>优化效果</h1><div className={styles.toolbarActions}>
      {selected ? <Link className={styles.secondary} href={baseHref(country)}>返回优化页面列表</Link> : null}
      <button type="button" className={styles.secondary} onClick={result.retry}><RefreshCw size={14} aria-hidden="true" />刷新</button>
    </div></div>
    {result.error ? <p className={effects.panel} role="alert">{result.error}</p>
      : !result.data ? <p className={effects.panel} role="status">正在读取已优化页面…</p> : <>
        {result.data.partial ? <p className={effects.panel} role="status">部分优化记录暂时无法读取。</p> : null}
        {active && version ? <PageEffectDetail page={active} version={version} country={country} /> : selected
          ? <p className={effects.panel}>找不到这条优化记录。</p> : <section className={effects.panel} aria-labelledby="optimized-pages-title">
            <div className={effects.listHeading}><h2 id="optimized-pages-title">已优化页面</h2><span>{filtered.length} 个页面</span></div>
            <div className={effects.filters}>
              <label className={effects.search}><Search size={17} aria-hidden="true" /><input aria-label="搜索已优化页面" placeholder="搜索页面标题或链接" value={query} onChange={event => setQuery(event.target.value)} /></label>
              <UiSelect aria-label="优化站点" value={site} onChange={setSite} options={[{ value: "all", label: "全部站点" }, ...sites]} />
            </div>
            {filtered.length ? <ul className={effects.list}>{filtered.map(page => <li className={effects.row} key={page.url}>
              <div className={effects.rowPage}><strong>{page.title}</strong>
                <a href={page.url} target="_blank" rel="noreferrer">{page.url} <ArrowUpRight size={12} aria-hidden="true" /></a></div>
              <span className={effects.site}>{siteName(page.site)}</span>
              <span className={effects.date}>{page.versions[0].date ? dateLabel(page.versions[0].date) : "日期待核实"}</span>
              <Link className={`${styles.secondary} ${effects.open}`} href={detailHref(page.versions[0].id, country)} prefetch={false}>查看详情 <ChevronRight size={15} aria-hidden="true" /></Link>
            </li>)}</ul> : <p className={effects.note}>{pages.length ? "没有匹配的页面。" : "暂无已优化页面。"}</p>}
          </section>}
      </>}
  </div>;
}
