"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Select } from "antd";
import { PageHeader } from "@/components/PageHeader";
import { useSeoSelection, type SeoSelection } from "@/components/useSeoSelection";
import { reportPeriods, weeklyPeriods } from "@/lib/weekly-traffic";
import { REGIONS } from "@/lib/seo";

type Week = { newUsers: number; newRegistrations: number; registrationRate: number | null; collectedAt: string; sites?: number; timezones?: string[]; registrationMetrics?: string[] };
type InsightData = {
  periods: ReturnType<typeof weeklyPeriods>; history: string[];
  traffic: { current: Week | null; previous: Week | null; currentSites: string[]; previousSites: string[]; comparable: boolean; changes: { newUsers: number | null; newRegistrations: number | null; registrationRate: number | null; ratePoints: number | null } };
  daily: { count: number; baseline: boolean; entered: string[]; lost: string[]; missing: string[]; net: number | null; detectedReduction: number | null; date: string; previousDate: string | null; unknownVolume: number; pendingSites?: string[]; siteCaptures?: {site: string; source: string; date: string; previousDate: string | null; baseline: boolean}[] } | null;
  keywords: { id: string; text: string }[];
};

function useInsights(selection: SeoSelection, week: string) {
  const key = `${selection.site}:${selection.source}:${selection.region}:${week}`;
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
        const response = await fetch(`/api/insights?site=${encodeURIComponent(selection.site)}&source=${selection.source}&region=${selection.region}${week ? `&week=${encodeURIComponent(week)}` : ""}`, { cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new Error("周报暂时无法读取");
        const data = await response.json() as InsightData;
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
  }, [key, selection.site, selection.source, selection.region, week, version]);
  return { data: result?.key === key ? result.data : null, error, retry: () => retry((n) => n + 1) };
}

const pct = (value: number | null | undefined) => value == null ? "待导入" : `${(value * 100).toFixed(1)}%`;
const change = (value: number | null | undefined) => value == null ? "暂时无法比较" : `${value > 0 ? "+" : ""}${(value * 100).toFixed(1)}%`;
const number = (value: number | null | undefined) => value == null ? "待导入" : value.toLocaleString();

function WeeklyKeywordChanges({ data, region }: { data: InsightData | null; region: string }) {
  const weekly = data?.daily;
  const comparable = weekly && !weekly.baseline;
  const name = (id: string) => data?.keywords.find(word=>word.id===id)?.text ?? id;
  const cards = [
    { label: "前 100 关键词", value: weekly && !weekly.pendingSites?.length ? weekly.count : "待采集" },
    { label: "本周新增", value: comparable ? weekly.entered.length : "待比较" },
    { label: "本周减少", value: comparable ? weekly.detectedReduction : "待比较" },
    { label: "净变化", value: comparable && weekly.net != null ? `${weekly.net > 0 ? "+" : ""}${weekly.net}` : "待比较" },
  ];
  return <section className="dailyPanel weeklyKeywords">
    <div className="dailyHeading"><div><h2>关键词周变化</h2><p className="chartNote">{region} · 本周与上周相比 · 只统计有搜索量的前 100 关键词</p></div></div>
    <div className="weeklyKeywordCards">{cards.map(card=><div key={card.label}><span>{card.label}</span><strong>{card.value}</strong></div>)}</div>
    <p className="chartNote">{!weekly ? "本期尚无完整排名采集记录，采集完成后展示结果。" : weekly.baseline ? "缺少本期或上期的完整记录，暂时无法比较。" : `本周新增 ${weekly.entered.length} 个，减少 ${weekly.detectedReduction} 个。`}</p>
    <details className="movementDetails"><summary>数据说明与关键词列表</summary><p className="chartNote">按两周各自最近一次完整报告比较，同一网站和来源保持一致。无声量和声量未知的词不计入。{weekly?.pendingSites?.length ? `本期待采集：${weekly.pendingSites.join("、")}。` : ""}减少中，确认排名外 {weekly?.lost.length ?? 0} 个、未检出待核实 {weekly?.missing.length ?? 0} 个。</p>{weekly?.siteCaptures?.map(site=><p className="chartNote" key={site.site}>{site.site} · {site.source.toUpperCase()} · 本期 {site.date} · 上期 {site.previousDate ?? "暂无记录"}</p>)}{comparable ? [["新增进入前 100", weekly.entered], ["确认排名外", weekly.lost], ["未检出待核实", weekly.missing]].map(([label, ids])=><p key={label as string}><b>{label as string}：</b>{(ids as string[]).map(name).join("、") || "无"}</p>) : null}</details>
  </section>;
}

export function TrafficReport() {
  const selection = useSeoSelection();
  const [week, setWeek] = useState("");
  const { data, error, retry } = useInsights(selection, week);
  const periods = data?.periods ?? (week ? reportPeriods(week) : weeklyPeriods());
  const traffic = data?.traffic;
  const history = data?.history ?? [weeklyPeriods().current.start, ...(week ? [week] : [])];
  const metrics = [
    { label: "新用户数量", key: "newUsers" as const, format: number },
    { label: "新注册用户数量", key: "newRegistrations" as const, format: number },
    { label: "注册率", key: "registrationRate" as const, format: pct },
  ];
  return <main className="appShell"><PageHeader active="traffic" selection={selection} />
    <div className="reportIntro"><div className="pageIntro"><h1>流量周报</h1><p>流量、注册与关键词变化 · 每期自动对比上一周</p></div><label className="originSelectField"><span>历史周报</span><Select aria-label="历史周报" className="reportWeekSelect" value={week || weeklyPeriods().current.start} onChange={(start) => setWeek(start === weeklyPeriods().current.start ? "" : start)} options={[...new Set(history)].map(start=>({value:start,label:`${start} — ${reportPeriods(start).current.end}${start === weeklyPeriods().current.start ? " · 最新" : ""}`}))} /></label></div>
    <div className="periodComparison"><span><i className="currentDot" />本周 {periods.current.start} — {periods.current.end}</span><span><i />上周 {periods.previous.start} — {periods.previous.end}</span></div>
    {error ? <div className="loadError"><span>{error}</span><button onClick={retry}>重新加载</button></div> : null}
    <p className="chartNote">流量与注册为全站所有地区的数据；顶部国家只影响关键词排名。周二至周一，共 7 天。{!data ? "正在读取周报…" : traffic?.currentSites.length ? `已采集：${traffic.currentSites.join("、")}（${traffic.currentSites.length}/3 个网站）。` : "等待 GA4 数据导入。"}</p>
    <section className="trafficGrid">{metrics.map((metric) => {
      const current = traffic?.current?.[metric.key]; const previous = traffic?.previous?.[metric.key];
      const maximum = Math.max(current ?? 0, previous ?? 0, 1);
      return <article className="trafficCard" key={metric.key}><h2>{metric.label}</h2><strong>{metric.format(current)}</strong><p className="trafficChange">环比 {change(traffic?.changes[metric.key])}</p>
        <div className="compareBar"><span>本周</span><div><i style={{ width: `${(current ?? 0) / maximum * 100}%` }} /></div><b>{metric.format(current)}</b></div>
        <div className="compareBar previous"><span>上周</span><div><i style={{ width: `${(previous ?? 0) / maximum * 100}%` }} /></div><b>{metric.format(previous)}</b></div>
        {metric.key === "registrationRate" && traffic?.changes.ratePoints != null ? <p className="chartNote">变化 {traffic.changes.ratePoints > 0 ? "+" : ""}{traffic.changes.ratePoints.toFixed(2)} 个百分点</p> : null}
      </article>;
    })}</section>
    <WeeklyKeywordChanges data={data} region={REGIONS[selection.region].label} />
    <details className="reportNote"><summary>数据说明</summary><p>注册人数为 GA4 注册成功事件的整周去重用户数，注册率 = 注册人数 ÷ 新用户数。GA4 按各网站原报告时区统计：{traffic?.current?.timezones?.join("、") ?? "等待采集"}；每天 10:30 为北京时间的采集时间。</p><p>两期采集的网站范围、GA4 属性、事件和时区一致时才计算环比；缺少网站的数据不会补成 0。多个网站的用户数相加，同一人访问多个网站可能重复计数。上一期为 0 时无法计算环比。</p><p>注册事件口径：{traffic?.current?.registrationMetrics?.join("、") ?? "待导入"}。本周采集时间：{traffic?.current?.collectedAt ? new Date(traffic.current.collectedAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" }) : "待导入"}。历史周报保留每个已导入周期；选择后对比它的前一周。</p><Link href="/manage" className="textLink">前往数据管理 →</Link></details>
  </main>;
}
