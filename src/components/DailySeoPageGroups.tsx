"use client";

import { useEffect, useRef, useState } from "react";
import type * as echarts from "echarts";
import type { DailySeoPageGroupsHistory } from "@/lib/daily-seo-page-groups";
import { clientReadCache, ClientReadError } from "@/lib/client-read-cache";
import styles from "./DailySeoPageGroups.module.css";

const BASE_API_URL = "/api/traffic/daily/groups?site=flatkey.ai";
const GROUPS = [
  { key: "gpu_compute", name: "GPU 页面", color: "#10b981" },
  { key: "model_list", name: "模型列表", color: "#4385ff" },
  { key: "model_detail", name: "模型详情", color: "#6c7cf2" },
  { key: "prompts", name: "提示词库", color: "#a371ef" },
] as const;
type Group = DailySeoPageGroupsHistory["groups"][number];
type Point = Group["points"][number];
type Mode = "users" | "pageViews";
const count = (value: number | null | undefined) => value == null ? "待补采" : value.toLocaleString("zh-CN");
const stamp = (value: string | null | undefined) => value ? new Date(value).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" }) : "待补采";

function isHistory(data: DailySeoPageGroupsHistory): boolean {
  const validCount = (value: number | null) => value === null || Number.isSafeInteger(value) && value >= 0;
  return data?.kind === "daily-seo-page-groups" && data.trafficScope === "organic_search" && data.channelName === "Organic Search" && data.siteDomain === "flatkey.ai" &&
    data.channelDimension === "firstUserPrimaryChannelGroup" && data.ruleVersion === 1 && data.funnelRule?.closed === true && data.funnelRule.sameDay === true &&
    Array.isArray(data.groups) && data.groups.length === GROUPS.length &&
    GROUPS.every(definition => data.groups.filter(group => group.key === definition.key).length === 1) &&
    data.groups.every(group => Array.isArray(group.points) && group.points.every(point =>
      /^\d{4}-\d{2}-\d{2}$/.test(point.date) && validCount(point.totalUsers) && validCount(point.pageViews) &&
      (point.funnel === null || Number.isSafeInteger(point.funnel?.entrants) && point.funnel.entrants >= 0 &&
        Number.isSafeInteger(point.funnel.registrations) && point.funnel.registrations >= 0 && point.funnel.registrations <= point.funnel.entrants)));
}

function SourceLinks({ sources }: { sources: string[] }) {
  return <>{sources.length ? sources.map((source, index) => <a key={source} href={source} target="_blank" rel="noreferrer">来源{sources.length > 1 ? ` ${index + 1}` : ""}</a>) : "来源待补采"}</>;
}

function PointEvidence({ point }: { point: Point }) {
  return <details><summary>查看记录</summary><div className={styles.provenance}>
    <p>访客采集：{stamp(point.totalUsersCollectedAt)}<br /><SourceLinks sources={point.totalUsersSources} /></p>
    <p>浏览次数采集：{stamp(point.pageViewsCollectedAt)}<br /><SourceLinks sources={point.pageViewsSources} /></p>
    <p>注册漏斗采集：{stamp(point.funnel?.collectedAt)}<br /><SourceLinks sources={point.funnel?.sources ?? []} /></p>
    {point.missingReason ? <p>{point.missingReason}</p> : null}
  </div></details>;
}

function PageGroupCard({ definition, group, history, version, loadingFailed, onRetry }: {
  definition: typeof GROUPS[number]; group: Group | undefined; history: DailySeoPageGroupsHistory | null; version: number; loadingFailed: boolean; onRetry: () => void;
}) {
  const [mode, setMode] = useState<Mode>("users");
  const [chartError, setChartError] = useState(false);
  const element = useRef<HTMLDivElement>(null);
  const hasPoints = Boolean(group?.points.some(point => mode === "pageViews" ? point.pageViews !== null : point.totalUsers !== null || point.funnel !== null));
  useEffect(() => {
    if (!element.current || !group || !history || !hasPoints) return;
    const target = element.current;
    let disposed = false, chart: echarts.ECharts | undefined, observer: ResizeObserver | undefined;
    const byDate = new Map(group.points.map(point => [point.date, point]));
    const option: echarts.EChartsOption = {
      animation: false, color: [definition.color, "#ed9645"],
      legend: { top: 5, left: 0, textStyle: { color: "#70819a", fontSize: 11 } },
      grid: { left: 42, right: 14, top: 52, bottom: 31 },
      tooltip: { trigger: "axis", renderMode: "richText", confine: true, formatter: (raw: unknown) => {
        const point = byDate.get(String((raw as { axisValue: string }[])[0]?.axisValue));
        if (!point) return "当日数据待补采";
        return [point.date, `当日去重访客：${count(point.totalUsers)}`, `浏览次数：${count(point.pageViews)}`,
          `漏斗入口：${count(point.funnel?.entrants)}`, `访问后当日注册：${count(point.funnel?.registrations)}`,
          `报告时区：${history.timezone}`].join("\n");
      } },
      xAxis: { type: "category", data: group.points.map(point => point.date), boundaryGap: false,
        axisLabel: { formatter: (date: string) => date.slice(5), color: "#8795a9", hideOverlap: true },
        axisLine: { lineStyle: { color: "#e5eaf2" } } },
      yAxis: { type: "value", min: 0, minInterval: 1, name: mode === "pageViews" ? "次数" : "人数",
        axisLabel: { color: "#8795a9" }, splitLine: { lineStyle: { color: "#eef2f7" } } },
      series: mode === "pageViews" ? [
        { type: "line", name: "浏览次数", data: group.points.map(point => point.pageViews), connectNulls: false,
          symbolSize: 4, lineStyle: { width: 2.5 }, areaStyle: { opacity: .04 } },
      ] : [
        { type: "line", name: "当日去重访客", data: group.points.map(point => point.totalUsers), connectNulls: false,
          symbolSize: 4, lineStyle: { width: 2.5 }, areaStyle: { opacity: .04 } },
        { type: "line", name: "访问后当日注册", data: group.points.map(point => point.funnel?.registrations ?? null), connectNulls: false,
          symbolSize: 4, lineStyle: { width: 2.5 } },
      ],
    };
    void import("@/lib/charts").then(({ init }) => {
      if (disposed) return;
      chart = init(target); chart.setOption(option); setChartError(false);
      observer = new ResizeObserver(() => chart?.resize()); observer.observe(target);
    }).catch(() => { if (!disposed) setChartError(true); });
    return () => { disposed = true; observer?.disconnect(); chart?.dispose(); };
  }, [definition.color, group, history, hasPoints, mode, version]);

  return <article className={`dailyPanel ${styles.card}`} aria-label={`${definition.name}每日自然搜索数据`}>
    <div className={styles.cardHeader}><div><h3><i style={{ background: definition.color }} />{definition.name}</h3>
      {group ? <p className={styles.scope}>{group.scope}</p> : null}</div>
      <div className={styles.switch} role="group" aria-label={`${definition.name}趋势指标`}>
        {([{ key: "users", label: "访客与注册" }, { key: "pageViews", label: "浏览次数" }] as const).map(item =>
          <button key={item.key} type="button" aria-pressed={mode === item.key} onClick={() => setMode(item.key)}>{item.label}</button>)}
      </div>
    </div>
    {group ? <div className={styles.coverage}>
      <span>访客 {group.coverage.totalUsersDays}/{group.coverage.days} 天</span>
      <span>浏览 {group.coverage.pageViewsDays}/{group.coverage.days} 天</span>
      <span>漏斗 {group.coverage.funnelDays}/{group.coverage.days} 天</span>
    </div> : null}
    {chartError ? <p className={styles.chartError}>图表暂时无法显示，可查看下方每日数据。<button type="button" onClick={onRetry}>重试图表</button></p> : null}
    {hasPoints ? <div ref={element} className={styles.plot} role="img" aria-label={`${definition.name}${mode === "users" ? "每日去重访客与访问后当日注册" : "每日浏览次数"}趋势，缺失断线，零值保留`} />
      : <p className={styles.empty}>{!history ? loadingFailed ? "每日数据暂时无法读取，请重试。" : "正在读取已保存的每日数据…" : mode === "pageViews" ? "该组每日浏览次数待补采。" : "该组每日访客与注册漏斗待补采。"}</p>}
    {group && history ? <details className={styles.details}><summary>查看每日数据、来源与采集记录</summary>
      <div className="siteTrafficTable"><table><thead><tr><th>日期</th><th>去重访客</th><th>浏览次数</th><th>漏斗入口</th><th>访问后当日注册</th><th>采集记录</th></tr></thead>
        <tbody>{group.points.map(point => <tr key={point.date}><th>{point.date}</th><td>{count(point.totalUsers)}</td><td>{count(point.pageViews)}</td><td>{count(point.funnel?.entrants)}</td><td>{count(point.funnel?.registrations)}</td><td><PointEvidence point={point} /></td></tr>)}</tbody>
      </table></div>
      <div className={styles.provenance}>
        <p>日期：{history.start} — {history.end} · 报告时区：{history.timezone} · 采集时间为北京时间</p>
        <p>GA4 属性：{history.ga4PropertyId} · 首次获客渠道：Organic Search · 维度：{history.channelDimension}</p>
        <p>页面规则 v{history.ruleVersion}：<code>{group.pathPattern}</code></p>
        {group.excludePathPattern ? <p>排除规则：<code>{group.excludePathPattern}</code></p> : null}
        <p>漏斗入口 URL 规则：<code>{group.pageLocationPattern}</code></p>
        {group.excludePageLocationPattern ? <p>排除入口 URL：<code>{group.excludePageLocationPattern}</code></p> : null}
        <p>漏斗按同日先访问该组页面、再完成 sign_up_success 去重统计；入口和注册人数来自同一份顺序漏斗。</p>
      </div>
    </details> : null}
  </article>;
}

export function DailySeoPageGroups({ start, end, category = "all" }: {start?:string;end?:string;expanded?:boolean;category?:string} = {}) {
  const API_URL = BASE_API_URL + (start && end ? `&start=${start}&end=${end}` : "");
  const [data, setData] = useState<DailySeoPageGroupsHistory | null>(() => {
    const cached = clientReadCache.peek<DailySeoPageGroupsHistory>(API_URL);
    return cached && isHistory(cached) ? cached : null;
  });
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let disposed = false, busy = false, force = version > 0;
    const read = async () => {
      if (busy || document.hidden) return;
      busy = true;
      try {
        const history = await clientReadCache.read<DailySeoPageGroupsHistory>(API_URL, force);
        force = false;
        if (!isHistory(history)) throw new Error("页面组自然搜索数据口径无效，请重新加载");
        if (!disposed) { setData(history); setError(null); }
      } catch (error) {
        if (disposed) return;
        if (error instanceof ClientReadError && error.status === 401) {
          clientReadCache.clear(); window.location.assign("/login"); return;
        }
        setError(error instanceof Error ? error.message : "页面组自然搜索数据读取失败");
      } finally { busy = false; }
    };
    void read();
    const timer = setInterval(() => void read(), 5 * 60_000);
    const onUpdated = () => { force = true; void read(); };
    document.addEventListener("visibilitychange", read);
    window.addEventListener("focus", read);
    window.addEventListener("seo-rankings-updated", onUpdated);
    return () => {
      disposed = true; clearInterval(timer);
      document.removeEventListener("visibilitychange", read);
      window.removeEventListener("focus", read);
      window.removeEventListener("seo-rankings-updated", onUpdated);
    };
  }, [version, API_URL]);
  const retry = () => setVersion(value => value + 1);
  return <section className={styles.section} aria-label="四类页面每日自然搜索数据">
    <div className={styles.heading}><div><h2>页面组每日 SEO</h2><p className="chartNote">首次来自自然搜索的用户 · 所选已结束日 · 四类页面分别记录</p></div>
      {data ? <span className={styles.range}>{data.start} — {data.end}</span> : null}
    </div>
    {error ? <div className="loadError"><span>{error}</span><button type="button" onClick={retry}>重新加载</button></div> : null}
    <div className={styles.grid}>{GROUPS.filter(d => category === "all" || category === "models" && d.key.startsWith("model_") || category === "prompts" && d.key === "prompts" || category === "gpu" && d.key === "gpu_compute").map(definition => <PageGroupCard key={definition.key} definition={definition}
      group={data?.groups.find(group => group.key === definition.key)} history={data} version={version} loadingFailed={Boolean(error)} onRetry={retry} />)}</div>
    <p className={`chartNote ${styles.note}`}>访客和浏览次数按天、按页面组独立统计。注册记录当天先访问该组页面、再完成注册的人；同一人可访问多个组，组间人数和每日人数均不相加为去重总数。待补采留空，真实零值显示为 0。</p>
  </section>;
}
