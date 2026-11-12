"use client";
import { UiSelect } from "./UiSelect";
import Link from "next/link";
import { ArrowLeft, Plus } from "lucide-react";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type * as echarts from "echarts";
import { classifyPage, type InventoryPage } from "@/lib/seo-page-inventory";
import { catalogUrl, mergeCatalogRows, type CatalogRow } from "@/lib/seo-page-catalog";
import { CLUSTER_SITES } from "@/lib/seo-cluster-sites";
import { matchesDailySeoPageGroupUrl } from "@/lib/daily-seo-page-groups";
import type { landingTrafficDays } from "@/lib/seo-analytics";
import type { DateRange } from "@/lib/seo-date-range";
import { SeoAnalyticsStatus } from "./SeoAnalyticsStatus";
import { SeoPageQueries } from "./SeoPageQueries";
import { analyticsUrl, numberText, useSeoRead, type PagePerformance, type SeoAnalytics } from "./useSeoAnalytics";
import styles from "./SeoPageCatalog.module.css";
import { useSeoCountry } from "./useSeoCountry";
import { REGIONS } from "@/lib/seo";
import { WorkflowPageHistory } from "./WorkflowPageHistory";
import { PageOptimizationActions } from "./PageOptimizationActions";
export { classifyPage } from "@/lib/seo-page-inventory";
type Row = CatalogRow;
type Inventory = { pages: InventoryPage[]; capturedAt: string | null; storage: string };
type Metric = "sessions" | "registrations" | "clicks";
type PageDay = { date: string; sessions: number | null; registrations: number | null; clicks: number | null };
type Detail = SeoAnalytics & { pageDaily: PageDay[] };
type CatalogPerformance = SeoAnalytics & {
  landingDaily: ReturnType<typeof landingTrafficDays>;
};
const metricLabels: Record<Metric, string> = { sessions: "自然搜索访问", registrations: "注册人次", clicks: "Google 搜索点击" };
const metrics = Object.keys(metricLabels) as Metric[];
const daysIn = (range: DateRange) => Math.round((Date.parse(range.end) - Date.parse(range.start)) / 86400000) + 1;
const pageName = (url: string) => { const parsed = new URL(url), path = parsed.pathname + parsed.search; if (path === "/") return "首页"; try { return decodeURI(path); } catch { return path; } };
const stamp = (value: string) => new Date(value).toLocaleDateString("zh-CN", { timeZone: "Asia/Shanghai" });
const valueOf = (page: PagePerformance | undefined, metric: Metric) => metric === "clicks" ? page?.gsc?.clicks : page?.ga4?.[metric];
const sumKnown = (values: number[]) => values.length ? values.reduce((sum, count) => sum + count, 0) : null;
const siteOptions = [{ value: "flatkey.ai", label: "Flatkey" }, ...CLUSTER_SITES.map(site => ({ value: site.domain, label: site.name }))];

function readState(result: ReturnType<typeof useSeoRead<SeoAnalytics>>) {
  const data = result.data?.scope === "session-organic-search" ? result.data : null;
  return { data, byUrl: new Map(data?.pages.map(page => [page.url, page])), error: result.error ?? (result.data && !data ? "数据口径不匹配，请重试" : null) };
}

type ChartMetric = Metric | "impressions" | "ctr";
const chartLabels = { ...metricLabels, impressions: "Google 搜索曝光", ctr: "Google 搜索点击率" };
export function PageChart({ points, metric, label, launchDay }: {
  points: ({ date: string } & Partial<Record<ChartMetric, number | null>>)[]; metric: ChartMetric; label?: string; launchDay?: string;
}) {
  const element = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const target = element.current;
    if (!target) return;
    let disposed = false, chart: echarts.ECharts | undefined, observer: ResizeObserver | undefined;
    void import("@/lib/charts").then(({ init }) => {
      if (disposed) return;
      chart = init(target);
      chart.setOption({ animation: false, color: ["#3473bd"], tooltip: { trigger: "axis", confine: true, renderMode: "richText", valueFormatter: (value: unknown) => typeof value === "number" && metric === "ctr" ? (value * 100).toFixed(2) + "%" : String(value ?? "—") },
        grid: { left: 42, right: 18, top: 20, bottom: 32 },
        xAxis: { type: "category", data: points.map(point => point.date), axisLabel: { hideOverlap: true, formatter: (date: string) => date.slice(5) }, axisTick: { show: false }, axisLine: { lineStyle: { color: "#e5e7eb" } } },
        yAxis: { type: "value", min: 0, ...(metric === "ctr" ? { axisLabel: { formatter: (value: number) => (value * 100).toLocaleString("zh-CN") + "%" } } : { minInterval: 1 }), splitLine: { lineStyle: { color: "#eef0f3" } } },
        series: [{ type: "line", name: chartLabels[metric], data: points.map(point => point[metric] ?? null), connectNulls: false, symbolSize: 5, lineStyle: { width: 2 }, ...(launchDay && points.some(point => point.date === launchDay) ? { markLine: { silent: true, symbol: "none", label: { formatter: "上线" }, data: [{ xAxis: launchDay }] } } : {}) }],
      });
      setFailed(false); observer = new ResizeObserver(() => chart?.resize()); observer.observe(target);
    }).catch(() => { if (!disposed) setFailed(true); });
    return () => { disposed = true; observer?.disconnect(); chart?.dispose(); };
  }, [points, metric, launchDay]);
  return <><div ref={element} className={styles.chart} role="img" aria-label={label ?? `当前页面每日${chartLabels[metric]}趋势`} />{failed ? <p>图表暂时无法加载。</p> : null}</>;
}

export function PageCatalog({ category, categoryLabel, range, comparison, categoryControl }: { category: string; categoryLabel: string; range: DateRange; comparison: DateRange | null; categoryControl?: ReactNode }) {
  const [country] = useSeoCountry();
  const [site, setSite] = useState("flatkey.ai");
  const [targets, setTargets] = useState<Row[]>([]), [inventory, setInventory] = useState<Inventory | null>(null);
  const [error, setError] = useState(""), [loading, setLoading] = useState(true);
  const [search, setSearch] = useState(""), [page, setPage] = useState(1);
  const [sort, setSort] = useState<Metric>("sessions"), [ascending, setAscending] = useState(false);
  const [selected, setSelected] = useState<string | null>(null), [metric, setMetric] = useState<Metric>("sessions");
  const detailHeading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { setPage(1); }, [category]);
  useEffect(() => {
    const read = () => { const params = new URLSearchParams(location.search), url = params.get("pageUrl");
      const inferred = url ? siteOptions.find(entry => catalogUrl(url, entry.value))?.value : undefined;
      const domain = siteOptions.find(entry => entry.value === params.get("site"))?.value ?? inferred ?? "flatkey.ai";
      setSite(domain); setSelected(url ? catalogUrl(url, domain) : null);
    };
    read(); addEventListener("popstate", read); return () => removeEventListener("popstate", read);
  }, []);
  const select = (url: string | null) => {
    const params = new URLSearchParams(location.search);
    params.set("site", site);
    if (url) params.set("pageUrl", url); else params.delete("pageUrl");
    history.pushState(null, "", location.pathname + "?" + params);
    setSelected(url); setMetric("sessions");
  };
  const changeSite = (value: string) => {
    const params = new URLSearchParams(location.search); params.set("site", value); params.delete("pageUrl");
    history.pushState(null, "", location.pathname + "?" + params); dispatchEvent(new PopStateEvent("popstate")); setPage(1);
  };
  useEffect(() => { if (selected) detailHeading.current?.focus(); }, [selected]);
  useEffect(() => {
    const controller = new AbortController();
    const read = async (url: string) => { const response = await fetch(url, { signal: controller.signal }); const data = await response.json(); if (!response.ok) throw Error(data.message ?? "清单读取失败"); return data; };
    Promise.allSettled([read("/api/seo/worklist"), read("/api/seo/pages")]).then(results => {
      if (controller.signal.aborted) return;
      const [worklist, catalog] = results; const urls = new Map<string, Set<string>>();
      if (worklist.status === "fulfilled") {
        for (const keyword of worklist.value.sites?.find((entry: { domain: string }) => entry.domain === site)?.keywords ?? []) {
          for (const target of keyword.targetUrls ?? []) {
          const url = catalogUrl(target, site); if (!url) continue;
            if (!urls.has(url)) urls.set(url, new Set()); urls.get(url)!.add(keyword.keyword);
          }
        }
        setTargets([...urls].map(([url, keywords]) => ({ url, keywords: [...keywords] })));
      }
      if (catalog.status === "fulfilled") setInventory(catalog.value);
      setError(results.flatMap((result, index) => result.status === "rejected"
        ? [`${index === 0 ? "工作清单" : "Sitemap 清单"} · ${result.reason.message}`] : []).join("；"));
      setLoading(false);
    });
    return () => controller.abort();
  }, [site]);
  const performance = useSeoRead<CatalogPerformance>(analyticsUrl(range, [], country, site) + "&pages=all&landingDaily=1");
  const current = readState(performance);
  const details = useSeoRead<Detail>(selected ? analyticsUrl(range, [selected], country, site) + "&pageDaily=1" : null);
  const comparePerformance = useSeoRead<SeoAnalytics>(selected && comparison ? analyticsUrl(comparison, [selected], country, site) : null);
  const prior = readState(comparePerformance);
  const detail = details.data?.scope === "session-organic-search" ? details.data : null;
  const rows = useMemo(() => mergeCatalogRows(targets, inventory?.pages ?? [], performance.data?.pages ?? [], site), [targets, inventory, performance.data, site]);
  const categoryRows = useMemo(() => rows.filter(row => {
    if (category === "all") return true;
    if (category === "new") return row.inventory?.baseline === false;
    if (category === "model_list" || category === "model_detail") return matchesDailySeoPageGroupUrl(category, row.url);
    return classifyPage(row.url) === category;
  }), [category, rows]);
  const categoryTrend = useMemo(() => {
    const paths = new Set(categoryRows.map(row => new URL(row.url)).filter(url => !url.search).map(url => url.origin + url.pathname));
    return (performance.data?.landingDaily ?? []).map(({ date, paths: daily, registrationsComplete }) => {
      const matching = daily?.filter(([path]) => paths.has(path));
      const total = (index: 1 | 2) => !paths.size || !matching || matching.some(row => row[index] == null)
        ? null : matching.reduce((sum, row) => sum + (row[index] ?? 0), 0);
      return { date, sessions: total(1), registrations: registrationsComplete ? total(2) : null, clicks: null };
    });
  }, [categoryRows, performance.data]);
  const sessionDays = categoryTrend.flatMap(day => day.sessions === null ? [] : [day.sessions]);
  const registrationDays = categoryTrend.flatMap(day => day.registrations === null ? [] : [day.registrations]);
  const pageClicks = categoryRows.flatMap(row => {
    const clicks = current.byUrl.get(row.url)?.gsc?.clicks;
    return clicks == null ? [] : [clicks];
  });
  const totals = { sessions: sumKnown(sessionDays), registrations: sumKnown(registrationDays), clicks: sumKnown(pageClicks) };
  const incomplete = { sessions: sessionDays.length < daysIn(range), registrations: registrationDays.length < daysIn(range), clicks: current.data?.gsc.status !== "ready" };
  const recordedDays = sessionDays.length;
  const visible = categoryRows.filter(row => (row.url + " " + row.keywords.join(" ")).toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => {
      const first = valueOf(current.byUrl.get(a.url), sort), second = valueOf(current.byUrl.get(b.url), sort);
      if (first == null && second != null) return 1; if (second == null && first != null) return -1;
      return first != null && second != null && first !== second ? (ascending ? first - second : second - first) : a.url.localeCompare(b.url);
    });
  const pageCount = Math.max(1, Math.ceil(visible.length / 25)), currentPage = Math.min(page, pageCount);
  const pageRows = visible.slice((currentPage - 1) * 25, currentPage * 25);
  const selectedRow = rows.find(row => row.url === selected);
  const selectedMetrics = detail?.pages[0];
  const sourceUrls = [...new Set([...(selectedRow?.sourceUrls ?? []), ...(selectedMetrics?.sourceUrls ?? [])])].sort();
  const hasVariants = sourceUrls.some(url => url !== selected);
  const partial = (metrics: PagePerformance | undefined, key: Metric) => {
    const entry = key === "clicks" ? metrics?.gsc : metrics?.ga4;
    const status = key === "clicks" ? current.data?.gsc : current.data?.ga4;
    const metricStatus = key === "sessions" ? status?.sessionsStatus ?? status?.status : key === "registrations" ? status?.registrationsStatus ?? status?.status : status?.status;
    return entry && (entry.days < daysIn(range) || metricStatus !== "ready");
  };
  const sources = selected ? detail : current.data;
  return <section className={styles.catalog} aria-label="选择页面并安排优化">
    {selected ? <>
      <button type="button" className={styles.back} onClick={() => select(null)}><ArrowLeft size={14} aria-hidden="true" />返回页面列表</button>
      <h2 className={styles.detailTitle} tabIndex={-1} ref={detailHeading}>{pageName(selected)}</h2>
      <a className={styles.url} href={selected} target="_blank" rel="noreferrer">{selected} ↗</a>
      <PageOptimizationActions key={`${selected}:${country}`} pageUrl={selected} site={site} country={country} />
      <div className={styles.metrics} aria-label="所选区间页面指标" role="group">{metrics.map(key => <div key={key}><span>{metricLabels[key]}</span><strong>{numberText(valueOf(selectedMetrics, key))}</strong>{partial(selectedMetrics, key) ? <small>部分数据</small> : null}</div>)}</div>
      <details className={styles.disclosure}><summary>流量趋势与 Google 搜索词</summary>
      <div className={styles.chartHeading}><h3>每日趋势</h3><div className={styles.tabs}>{(Object.keys(metricLabels) as Metric[]).map(key => <button key={key} aria-pressed={metric === key} onClick={() => setMetric(key)}>{key === "sessions" ? "访问" : key === "registrations" ? "注册" : "搜索点击"}</button>)}</div></div>
      {details.error ? <p role="alert">{details.error} <button onClick={details.retry}>重试</button></p> : !detail ? <p className={styles.empty}>读取页面趋势…</p> : <><PageChart points={detail.pageDaily} metric={metric} />
      {!detail.pageDaily.some(point => point[metric] !== null) ? <p className={styles.note}>所选区间暂无该页面的{metricLabels[metric]}记录。</p> : null}</>}
      <SeoPageQueries key={`${site}:${country}:${selected}:${range.start}:${range.end}`} range={range} url={selected} country={country} site={site} />
      </details>
      <details className={styles.disclosure}><summary>搜索表现与关联词</summary><dl className={styles.metadata}><div><dt>搜索曝光</dt><dd>{numberText(selectedMetrics?.gsc?.impressions)}</dd></div><div><dt>点击率</dt><dd>{selectedMetrics?.gsc?.ctr == null ? "—" : (selectedMetrics.gsc.ctr * 100).toFixed(2) + "%"}</dd></div><div><dt>平均排名</dt><dd>{selectedMetrics?.gsc?.position?.toFixed(1) ?? "—"}</dd></div></dl><p>关联目标词：{selectedRow?.keywords.length ? selectedRow.keywords.join(" · ") : "尚未关联"}</p><a href={"/opportunities?" + new URLSearchParams({ targetUrl: selected, country, ...range })}>查看关键词声量与优化预估 →</a></details>
      <details className={styles.disclosure}><summary>每日明细{comparison ? "与对比区间" : ""}</summary>
        {detail ? <div className={styles.scroll}><table className={styles.daily}><thead><tr><th>日期</th><th>访问</th><th>注册</th><th>搜索点击</th></tr></thead><tbody>{detail.pageDaily.map(day => <tr key={day.date}><td>{day.date}</td><td>{numberText(day.sessions)}</td><td>{numberText(day.registrations)}</td><td>{numberText(day.clicks)}</td></tr>)}</tbody></table></div> : null}
        {comparison ? <><p>对比区间：{comparison.start} — {comparison.end}</p>{prior.error ? <p role="alert">{prior.error} <button onClick={comparePerformance.retry}>重试</button></p> : <p>访问 {numberText(prior.data?.pages[0]?.ga4?.sessions)} · 注册 {numberText(prior.data?.pages[0]?.ga4?.registrations)} · 搜索点击 {numberText(prior.data?.pages[0]?.gsc?.clicks)}</p>}{prior.data ? <><SeoAnalyticsStatus name="GA4 对比期" source={prior.data.ga4} /><SeoAnalyticsStatus name="GSC 对比期" source={prior.data.gsc} /></> : null}</> : null}
      </details>
      {hasVariants ? <details className={styles.disclosure}><summary>原始 URL 来源（{sourceUrls.length}）</summary><p>章节锚点和跟踪参数合并为一页；访问量只计一次。Google 指标采用页面原始记录，不叠加章节曝光。</p><ul>{sourceUrls.map(url => <li key={url}><a href={url} target="_blank" rel="noreferrer">{url}</a></li>)}</ul></details> : null}
      <details className={styles.disclosure}><summary>页面发现记录</summary>{selectedRow?.inventory ? <><p>{selectedRow.inventory.baseline ? "存量页面" : "新发现页面"} · 首次发现 {stamp(selectedRow.inventory.firstSeen)} · 最近发现 {stamp(selectedRow.inventory.lastSeen)}</p><p>首次发现日期可能晚于上线日期。</p><a href={selectedRow.inventory.sourceUrl} target="_blank" rel="noreferrer">查看 Sitemap 来源 ↗</a></> : <p>尚未在 Sitemap 清单中发现。</p>}</details>
      <details className={styles.disclosure}><summary>任务、修改与复盘记录</summary><WorkflowPageHistory pageUrl={selected} country={country} /></details>
    </> : <>
      <div className={styles.listActions}>
        <div><h2>页面列表</h2>{!loading || rows.length ? <span className={styles.note}>{visible.length.toLocaleString("zh-CN")} 个页面</span> : null}</div>
        <Link className={styles.actionPrimary} href={"/work?" + new URLSearchParams({ new: "1", kind: "optimization", site, ...(country === "all" ? {} : { country }) })}><Plus size={14} aria-hidden="true" />新建优化任务</Link>
      </div>
      <div className={styles.filters}><UiSelect aria-label="页面所属站点" value={site} onChange={changeSite} options={siteOptions} />{categoryControl}<input aria-label="搜索页面或关键词" placeholder="搜索页面 URL 或关键词" value={search} onChange={event => { setSearch(event.target.value); setPage(1); }} /></div>
      {error ? <p className={styles.note} role="alert">{error}</p> : null}
      {current.error ? <p role="alert">{current.error} <button onClick={performance.retry}>重试指标</button></p> : null}
      {!current.data && !current.error ? <p role="status" className={styles.note}>正在读取页面指标…</p> : null}
      {loading && !rows.length ? <p className={styles.empty}>正在读取页面清单…</p> : <>
        <table className={styles.table}><thead><tr><th scope="col">页面</th>{(Object.keys(metricLabels) as Metric[]).map(key => <th scope="col" key={key} aria-sort={sort === key ? ascending ? "ascending" : "descending" : "none"}><button onClick={() => { if (sort === key) setAscending(!ascending); else { setSort(key); setAscending(false); } setPage(1); }}>{metricLabels[key]}{sort === key ? ascending ? " ↑" : " ↓" : ""}</button></th>)}</tr></thead><tbody>{pageRows.map(row => {
          const metrics = current.byUrl.get(row.url);
          return <tr key={row.url}><th scope="row"><button className={styles.pageLink} onClick={() => select(row.url)}>{pageName(row.url)}</button>{new URL(row.url).hostname !== "flatkey.ai" ? <small>{new URL(row.url).hostname}</small> : null}</th>{(Object.keys(metricLabels) as Metric[]).map(key => <td key={key} data-label={metricLabels[key]}>{numberText(valueOf(metrics, key))}{partial(metrics, key) ? <small>部分数据</small> : null}</td>)}</tr>;
        })}</tbody></table>
        {!visible.length ? <p className={styles.empty}>没有匹配的页面，请调整分类或搜索词。</p> : null}
        <div className={styles.footer}><UiSelect className={styles.mobileSort} aria-label="页面排序" value={`${sort}:${ascending ? "asc" : "desc"}`} onChange={value => { const [key, order] = value.split(":"); setSort(key as Metric); setAscending(order === "asc"); setPage(1); }} options={(Object.keys(metricLabels) as Metric[]).flatMap(key => [{ value: key + ":desc", label: metricLabels[key] + " ↓" }, { value: key + ":asc", label: metricLabels[key] + " ↑" }])} /><div><button disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)}>上一页</button><span>第 {currentPage} / {pageCount} 页</span><button disabled={currentPage >= pageCount} onClick={() => setPage(currentPage + 1)}>下一页</button></div></div>
        {current.data && categoryRows.length > 0 ? <details className={styles.disclosure}><summary>{categoryLabel}合计与流量趋势</summary><section className={styles.categoryTrend} aria-label="分类流量趋势">
          <div className={styles.categorySummary} aria-label="所选周期合计" role="group">
            <h2>{categoryLabel} · 所选周期合计</h2>
            <div className={styles.metrics}>{metrics.map(key => <div key={key}>
              <span>{metricLabels[key]}</span><strong>{numberText(totals[key])}</strong>
              {totals[key] !== null && incomplete[key] ? <small>部分数据</small> : null}
            </div>)}</div>
          </div>
          <div className={styles.chartHeading}><h2>{categoryLabel} · 每日自然搜索访问</h2>
            {recordedDays > 0 && recordedDays < categoryTrend.length ? <span className={styles.note}>{recordedDays}/{categoryTrend.length} 天有记录</span> : null}
          </div>
          {recordedDays > 0 ? <PageChart points={categoryTrend} metric="sessions" label={`${categoryLabel}每日自然搜索访问趋势`} /> : <p className={styles.note}>{country === "all" ? "所选区间暂无访问记录。" : `${REGIONS[country].label}在所选区间的页面访问待采集。`}</p>}
        </section></details> : null}
      </>}
    </>}
    <details className={styles.disclosure}>
      <summary>数据来源与口径</summary>
      {sources ? <><SeoAnalyticsStatus name="GA4" source={sources.ga4} /><SeoAnalyticsStatus name="GSC" source={sources.gsc} /></> : <p className={styles.note}>当前区间的来源状态待获取。</p>}
      {inventory?.capturedAt ? <p>页面清单快照 {stamp(inventory.capturedAt)}</p> : null}
      <p>GA4 入口会话按主机与路径归属。缺少主机的历史数据不分配到页面，逐页注册待跨域归因核实。— 表示数据缺失。</p>
    </details>
    <p className={styles.connection}>GA4 自然来源行为与转化归因待核验 · <Link href="/issues#issue-ga4-business-journey-pending">查看待办</Link></p>
  </section>;
}
