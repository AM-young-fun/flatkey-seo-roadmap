"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Select } from "antd";
import { PageHeader } from "@/components/PageHeader";
import { useSeoSelection } from "@/components/useSeoSelection";
import { reportPeriods, weeklyPeriods } from "@/lib/weekly-traffic";

type Week = { newUsers: number; newRegistrations: number; registrationRate: number | null; collectedAt: string; sites?: number; timezones?: string[]; registrationMetrics?: string[] };
type InsightData = {
  periods: ReturnType<typeof weeklyPeriods>; history: string[];
  traffic: { current: Week | null; previous: Week | null; currentSites: string[]; previousSites: string[]; comparable: boolean; siteTraffic?: {siteDomain:string;current:Pick<Week,"newUsers"|"newRegistrations"|"registrationRate">|null}[]; changes: { newUsers: number | null; newRegistrations: number | null; registrationRate: number | null; ratePoints: number | null } };
  daily: { count: number; baseline: boolean; entered: string[]; lost: string[]; missing: string[]; net: number | null; detectedReduction: number | null; date: string; previousDate: string | null; unknownVolume: number; pendingSites?: string[]; pendingMarkets?:string[]; siteCaptures?: {site: string; source: string; date: string; previousDate: string | null; baseline: boolean}[] } | null;
  keywords: { id: string; text: string }[];
};

function useInsights(week: string) {
  const key = week;
  const [result, setResult] = useState<{ key: string; data: InsightData } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [version, retry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    let busy = false;
    const update = async () => {
      if (busy || document.hidden) return;
      busy = true;
      try {
        let data: InsightData | null = null;
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            const response = await fetch(`/api/insights?site=all&source=combined&region=all${week ? `&week=${encodeURIComponent(week)}` : ""}`, { cache: "no-store", signal: controller.signal });
            if (response.status === 401) { window.location.assign("/login"); return; }
            if (!response.ok) {
              const failure = await response.json().catch(()=>({})) as {code?:string};
              throw Object.assign(new Error(`周报暂时无法读取${failure.code ? `（${failure.code}）` : ""}`), { retryable: response.status >= 500 });
            }
            data = await response.json() as InsightData;
            break;
          } catch (error) {
            if (controller.signal.aborted || attempt === 1 || (error instanceof Error && "retryable" in error && error.retryable === false)) throw error;
            await new Promise(resolve=>setTimeout(resolve,600));
          }
        }
        if (!data) return;
        if (!controller.signal.aborted) { setResult({ key, data }); setError(null); }
      } catch (error) {
        if (!controller.signal.aborted) setError(error instanceof Error ? error.message : "加载失败");
      } finally { busy = false; }
    };
    void update();
    const timer = setInterval(() => void update(), 60_000);
    document.addEventListener("visibilitychange", update);
    window.addEventListener("focus", update);
    return () => { controller.abort(); clearInterval(timer); document.removeEventListener("visibilitychange", update); window.removeEventListener("focus", update); };
  }, [key, week, version]);
  return { data: result?.key === key ? result.data : null, error, retry: () => retry((n) => n + 1) };
}

const pct = (value: number | null | undefined) => value == null ? "待导入" : `${(value * 100).toFixed(1)}%`;
const change = (value: number | null | undefined) => value == null ? "暂时无法比较" : `${value > 0 ? "+" : ""}${(value * 100).toFixed(1)}%`;
const number = (value: number | null | undefined) => value == null ? "待导入" : value.toLocaleString();

function WeeklyKeywordChanges({ data }: { data: InsightData | null }) {
  const weekly = data?.daily;
  const comparable = weekly && !weekly.baseline;
  const name = (id: string) => data?.keywords.find(word=>word.id===id)?.text ?? id;
  const cards = [
    { label: "期末前 100 关键词", value: comparable ? weekly.count : "待发布" },
    { label: "本期新增", value: comparable ? weekly.entered.length : "待比较" },
    { label: "本期减少", value: comparable ? weekly.detectedReduction : "待比较" },
    { label: "净变化", value: comparable && weekly.net != null ? `${weekly.net > 0 ? "+" : ""}${weekly.net}` : "待比较" },
  ];
  return <section className="dailyPanel weeklyKeywords">
    <div className="dailyHeading"><div><h2>关键词环比变化</h2><p className="chartNote">每周二更新 · 上期期末与本期期末相比 · 四个地区汇总 · 只统计有搜索量的前 100 关键词</p></div></div>
    <div className="weeklyKeywordCards">{cards.map(card=><div key={card.label}><span>{card.label}</span><strong>{card.value}</strong></div>)}</div>
    <p className="chartNote">{data ? `上期期末 ${data.periods.previous.end} → 本期期末 ${data.periods.current.end}。` : ""}{!weekly || weekly.baseline ? "待周二发布环比；缺少任一期末的完整数据时不计算。" : `新增 ${weekly.entered.length} 个，减少 ${weekly.detectedReduction} 个；已比较 ${weekly.siteCaptures?.length ?? 0}/12 个网站与地区组合。`}</p>
    <details className="movementDetails"><summary>数据说明与关键词列表</summary><p className="chartNote">以两个相邻周期的最后一天（周一）为准，日期必须精确匹配，不使用附近日期代替。同一网站、地区、来源比较后汇总；跨网站、跨国家分别计数。无声量和声量未知的词不计入。{weekly?.pendingMarkets?.length ? `待补齐：${weekly.pendingMarkets.join("、")}。` : ""}减少中，确认排名外 {weekly?.lost.length ?? 0} 个、未检出待核实 {weekly?.missing.length ?? 0} 个。</p>{weekly?.siteCaptures?.map(site=><p className="chartNote" key={site.site}>{site.site} · {site.source.toUpperCase()} · 上期期末 {site.previousDate} · 本期期末 {site.date}</p>)}{comparable ? [["新增进入前 100", weekly.entered], ["确认排名外", weekly.lost], ["未检出待核实", weekly.missing]].map(([label, ids])=><p key={label as string}><b>{label as string}：</b>{(ids as string[]).map(name).join("、") || "无"}</p>) : null}</details>
  </section>;
}

export function TrafficReport() {
  const selection = useSeoSelection();
  const [week, setWeek] = useState("");
  const { data, error, retry } = useInsights(week);
  const periods = data?.periods ?? (week ? reportPeriods(week) : weeklyPeriods());
  const traffic = data?.traffic;
  const history = data?.history ?? [weeklyPeriods().current.start, ...(week ? [week] : [])];
  const metrics = [
    { label: "新用户数量", key: "newUsers" as const, format: number, note:"GA4 首次访问的新用户数" },
    { label: "注册成功用户（去重）", key: "newRegistrations" as const, format: number, note:"成功注册事件的整周去重用户数，不是事件次数" },
    { label: "注册人数 / 新用户数", key: "registrationRate" as const, format: pct, note:"自定义比例，与 GA4「用户关键事件率」口径不同" },
  ];
  return <main className="appShell"><PageHeader active="traffic" selection={selection} />
    <div className="reportIntro"><div className="pageIntro"><h1>流量周报</h1><p>流量、注册与关键词按周期环比 · 每周二更新</p></div><label className="originSelectField"><span>历史周报</span><Select aria-label="历史周报" className="reportWeekSelect" value={week || weeklyPeriods().current.start} onChange={(start) => setWeek(start === weeklyPeriods().current.start ? "" : start)} options={[...new Set(history)].map(start=>({value:start,label:`${start} — ${reportPeriods(start).current.end}${start === weeklyPeriods().current.start ? " · 最新" : ""}`}))} /></label></div>
    <div className="periodComparison"><span><i className="currentDot" />本期 {periods.current.start} — {periods.current.end}</span><span><i />上期 {periods.previous.start} — {periods.previous.end}</span></div>
    {error ? <div className="loadError"><span>{error}</span><button onClick={retry}>重新加载</button></div> : null}
    <p className="chartNote reportScope">每周二补充周报，其他日期不补充。流量与注册汇总所有地区，按周二至周一的 7 天统计。{!data ? "正在读取周报…" : traffic?.currentSites.length ? `已采集：${traffic.currentSites.join("、")}（${traffic.currentSites.length}/3 个网站）。` : "等待 GA4 数据导入。"}</p>
    <section className="trafficGrid">{metrics.map((metric) => {
      const current = traffic?.current?.[metric.key]; const previous = traffic?.previous?.[metric.key];
      const maximum = Math.max(current ?? 0, previous ?? 0, 1);
      return <article className="trafficCard" key={metric.key}><h2>{metric.label}</h2><p className="trafficMetricNote">{metric.note}</p><strong>{data ? metric.format(current) : "加载中…"}</strong><p className="trafficChange">环比 {data ? change(traffic?.changes[metric.key]) : "加载中…"}</p>
        <div className="compareBar"><span>本期</span><div><i style={{ width: `${(current ?? 0) / maximum * 100}%` }} /></div><b>{data ? metric.format(current) : "加载中…"}</b></div>
        <div className="compareBar previous"><span>上期</span><div><i style={{ width: `${(previous ?? 0) / maximum * 100}%` }} /></div><b>{data ? metric.format(previous) : "加载中…"}</b></div>
        {metric.key === "registrationRate" && traffic?.changes.ratePoints != null ? <p className="chartNote">变化 {traffic.changes.ratePoints > 0 ? "+" : ""}{traffic.changes.ratePoints.toFixed(2)} 个百分点</p> : null}
      </article>;
    })}</section>
    <section className="dailyPanel siteTrafficPanel"><h2>各网站数据</h2><div className="siteTrafficTable"><table><thead><tr><th>网站</th><th>新用户</th><th>注册用户（去重）</th><th>注册人数 / 新用户数</th><th>本期状态</th></tr></thead><tbody>{["flatkey.ai","rackrate.org","modelfit.cc"].map(domain=>{const row=traffic?.siteTraffic?.find(site=>site.siteDomain===domain)?.current;return <tr key={domain}><th>{domain}</th><td>{data?number(row?.newUsers):"加载中…"}</td><td>{data?number(row?.newRegistrations):"加载中…"}</td><td>{data?pct(row?.registrationRate):"加载中…"}</td><td>{!data?"读取中":row?"已采集":"本期暂无有效周报"}</td></tr>;})}</tbody></table></div></section>
    <WeeklyKeywordChanges data={data} />
    <details className="reportNote"><summary>数据说明</summary><p>注册人数为 GA4 注册成功事件的整周去重用户数。同一用户触发多次事件只算一人，不能把事件次数当成人数。「注册人数 / 新用户数」为自定义比例，并非 GA4「用户关键事件率」，也未限定为首次访问的新用户群体，不能当作新用户转化率。GA4 按各网站原报告时区统计：{traffic?.current?.timezones?.join("、") ?? "等待采集"}；每天 10:30 为北京时间的采集时间。</p><p>两期采集的网站范围、GA4 属性、事件和时区一致时才计算环比；缺少网站的数据不会补成 0。多个网站的用户数相加，同一人访问多个网站可能重复计数。上一期为 0 时无法计算环比。</p><p>注册事件口径：{traffic?.current?.registrationMetrics?.join("、") ?? "待导入"}。本期采集时间：{traffic?.current?.collectedAt ? new Date(traffic.current.collectedAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" }) : "待导入"}。历史周报保留每个已导入周期；选择后对比它的前一周。</p><Link href="/manage" className="textLink">前往数据管理 →</Link></details>
  </main>;
}
