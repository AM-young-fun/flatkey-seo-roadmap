"use client";

import { useEffect, useRef, useState } from "react";
import type * as echarts from "echarts";
import type { DailySeoTrafficHistory } from "@/lib/daily-seo-traffic";
import { clientReadCache, ClientReadError } from "@/lib/client-read-cache";
import styles from "./DailySeoTrafficTrend.module.css";

const URL = "/api/traffic/daily?site=flatkey.ai";
const count = (value: number | null | undefined) => value == null ? "待补采" : value.toLocaleString("zh-CN");
const stamp = (value: string | null | undefined) => value ? new Date(value).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" }) : "待补采";

function isHistory(data: DailySeoTrafficHistory): boolean {
  const validCount = (value: number | null) => value === null || Number.isSafeInteger(value) && value >= 0;
  return data?.kind === "daily-seo-traffic" && data.trafficScope === "organic_search" && data.channelName === "Organic Search" &&
    data.siteDomain === "flatkey.ai" && Array.isArray(data.points) && data.points.every(point =>
      /^\d{4}-\d{2}-\d{2}$/.test(point.date) && validCount(point.newUsers) && validCount(point.newRegistrations));
}

export function DailySeoTrafficTrend() {
  const [data, setData] = useState<DailySeoTrafficHistory | null>(() => {
    const cached = clientReadCache.peek<DailySeoTrafficHistory>(URL);
    return cached && isHistory(cached) ? cached : null;
  });
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const [chartError, setChartError] = useState(false);
  const element = useRef<HTMLDivElement>(null);
  const hasPoints = Boolean(data?.points.some(point => point.newUsers !== null || point.newRegistrations !== null));

  useEffect(() => {
    let disposed = false, busy = false, force = version > 0;
    const read = async () => {
      if (busy || document.hidden) return;
      busy = true;
      try {
        const history = await clientReadCache.read<DailySeoTrafficHistory>(URL, force);
        force = false;
        if (!isHistory(history)) throw new Error("自然搜索日数据口径无效，请重新加载");
        if (!disposed) { setData(history); setError(null); }
      } catch (error) {
        if (disposed) return;
        if (error instanceof ClientReadError && error.status === 401) {
          clientReadCache.clear(); window.location.assign("/login"); return;
        }
        setError(error instanceof Error ? error.message : "自然搜索趋势读取失败");
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
  }, [version]);

  useEffect(() => {
    if (!element.current || !data || !hasPoints) return;
    const target = element.current;
    let disposed = false, chart: echarts.ECharts | undefined, observer: ResizeObserver | undefined;
    const byDate = new Map(data.points.map(point => [point.date, point]));
    const option: echarts.EChartsOption = {
      animation: false, color: ["#4385ff", "#ed9645"],
      legend: { top: 4, left: 0, textStyle: { color: "#70819a", fontSize: 12 } },
      grid: { left: 48, right: 20, top: 56, bottom: 34 },
      tooltip: { trigger: "axis", renderMode: "richText", confine: true, formatter: (raw: unknown) => {
        const values = raw as { axisValue: string }[];
        const point = byDate.get(String(values[0]?.axisValue));
        if (!point) return "当日数据待补采";
        return [point.date, `自然搜索新用户：${count(point.newUsers)}`, `当日注册用户：${count(point.newRegistrations)}`,
          `新用户采集：${stamp(point.newUsersCollectedAt)}`, `注册采集：${stamp(point.newRegistrationsCollectedAt)}`,
          `报告时区：${data.timezone}`, "采集时间为北京时间"].join("\n");
      } },
      xAxis: { type: "category", boundaryGap: false, data: data.points.map(point => point.date),
        axisLabel: { formatter: (date: string) => date.slice(5), color: "#8795a9", hideOverlap: true },
        axisLine: { lineStyle: { color: "#e5eaf2" } } },
      yAxis: { type: "value", min: 0, minInterval: 1, name: "人数", axisLabel: { color: "#8795a9" },
        splitLine: { lineStyle: { color: "#eef2f7" } } },
      series: [
        { type: "line", name: "自然搜索新用户", data: data.points.map(point => point.newUsers), connectNulls: false,
          symbolSize: 5, showSymbol: true, lineStyle: { width: 2.5 }, areaStyle: { opacity: .04 } },
        { type: "line", name: "当日注册用户", data: data.points.map(point => point.newRegistrations), connectNulls: false,
          symbolSize: 5, showSymbol: true, lineStyle: { width: 2.5 } },
      ],
    };
    void import("@/lib/charts").then(({ init }) => {
      if (disposed) return;
      chart = init(target); chart.setOption(option); setChartError(false);
      observer = new ResizeObserver(() => chart?.resize()); observer.observe(target);
    }).catch(() => { if (!disposed) setChartError(true); });
    return () => { disposed = true; observer?.disconnect(); chart?.dispose(); };
  }, [data, hasPoints, version]);

  const newUserDays = data?.points.filter(point => point.newUsers !== null).length ?? 0;
  const registrationDays = data?.points.filter(point => point.newRegistrations !== null).length ?? 0;
  const days = data?.points.length ?? 0;
  const retry = () => setVersion(value => value + 1);
  return <section className={`dailyPanel ${styles.panel}`} aria-label="自然搜索每日趋势">
    <div className={styles.heading}><div><h2>自然搜索每日趋势</h2><p className="chartNote">Flatkey · 最近30个已结束日 · Organic Search</p></div>
      {data ? <span className={styles.range}>{data.start} — {data.end}</span> : null}
    </div>
    {error || chartError ? <div className="loadError"><span>{error ?? "趋势图暂时无法显示，可查看下方每日数据"}</span><button type="button" onClick={retry}>重新加载</button></div> : null}
    {!data ? <p className={styles.empty}>{error ? "自然搜索日数据读取失败，请重试。" : "正在读取已保存的自然搜索日数据…"}</p> : <>
      <div className={styles.metadata}>
        <span>报告时区：{data.timezone}</span>
        <span>新用户已采集 {newUserDays}/{days} 天</span><span>注册已采集 {registrationDays}/{days} 天</span>
      </div>
      {hasPoints ? <div ref={element} className={styles.plot} role="img" aria-label={`${data.start}至${data.end}自然搜索每日新用户与当日注册用户趋势，缺失数据断线，真实零值显示为零`} />
        : <p className={styles.empty}>该区间自然搜索日数据待补采，采集后显示趋势。</p>}
      <p className={`chartNote ${styles.basis}`}>新用户首次来自自然搜索；注册按这类用户当天去重，包含以前来过的人。转化率需另看同一批新访客的注册漏斗。</p>
      <details className={styles.details}><summary>查看每日数据与采集记录</summary>
        <div className="siteTrafficTable"><table><thead><tr><th>日期</th><th>自然搜索新用户</th><th>当日注册用户（去重）</th><th>新用户采集时间</th><th>注册采集时间</th></tr></thead>
          <tbody>{data.points.map(point => <tr key={point.date}><th>{point.date}</th><td>{count(point.newUsers)}</td><td>{count(point.newRegistrations)}</td><td>{stamp(point.newUsersCollectedAt)}</td><td>{stamp(point.newRegistrationsCollectedAt)}</td></tr>)}</tbody>
        </table></div>
        <p className={styles.provenance}>GA4 属性：{data.ga4PropertyId} · 渠道维度：{data.channelDimension} · 注册事件：sign_up_success</p>
      </details>
      <div className={styles.provenance}><span>最近采集：{stamp(data.collectedAt)}{data.collectedAt ? "（北京时间）" : ""}</span>
        {data.sources.length ? <span>数据来源：{data.sources.map((source, index) => <a key={source} href={source} target="_blank" rel="noreferrer">GA4{data.sources.length > 1 ? ` ${index + 1}` : ""}</a>)}</span> : null}
      </div>
    </>}
  </section>;
}
