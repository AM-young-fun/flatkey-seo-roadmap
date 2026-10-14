"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { useSeoSelection, type SeoSelection } from "@/components/useSeoSelection";
import { weeklyPeriods } from "@/lib/weekly-traffic";

type Week = { newUsers: number; newRegistrations: number; registrationRate: number | null; collectedAt: string; ga4PropertyId: string | null; sites?: number };
type InsightData = {
  periods: ReturnType<typeof weeklyPeriods>;
  traffic: { current: Week | null; previous: Week | null; missingCurrent?: string[]; missingPrevious?: string[]; changes: { newUsers: number | null; newRegistrations: number | null; registrationRate: number | null; ratePoints: number | null } };
  daily: { count: number; baseline: boolean; entered: string[]; lost: string[]; missing: string[]; net: number | null; detectedReduction: number | null; date: string; previousDate: string | null; unknownVolume: number; pendingSites?: string[]; siteCaptures?: {site: string; source: string; date: string; previousDate: string | null; baseline: boolean}[] } | null;
  keywords: { id: string; text: string }[];
  pages: { id: string; keyword: string; url: string; rank: number | null; clicks: number | null; impressions: number | null; source: string; siteDomain?: string; collectedAt: string; periodStart: string | null; periodEnd: string | null }[];
};

function useInsights(selection: SeoSelection) {
  const key = `${selection.site}:${selection.source}:${selection.region}`;
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
        const response = await fetch(`/api/insights?site=${encodeURIComponent(selection.site)}&source=${selection.source}&region=${selection.region}`, { cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new Error("分析数据加载失败");
        const data = await response.json() as InsightData;
        if (!controller.signal.aborted) { setResult({ key, data }); setError(null); }
      } catch (error) {
        if (!controller.signal.aborted) setError(error instanceof Error ? error.message : "加载失败");
      } finally { busy = false; }
    };
    void update();
    const timer = setInterval(() => void update(), 60_000);
    return () => { controller.abort(); clearInterval(timer); };
  }, [key, selection.site, selection.source, selection.region, version]);
  return { data: result?.key === key ? result.data : null, error, retry: () => retry((n) => n + 1) };
}

const pct = (value: number | null | undefined) => value == null ? "—" : `${(value * 100).toFixed(1)}%`;
const change = (value: number | null | undefined) => value == null ? "无可比基线" : `${value > 0 ? "+" : ""}${pct(value)}`;
const number = (value: number | null | undefined) => value == null ? "待导入" : value.toLocaleString();

export function DailyChanges({ selection }: { selection: SeoSelection }) {
  const { data, error, retry } = useInsights(selection);
  const daily = data?.daily;
  const name = (id: string) => data?.keywords.find((word) => word.id === id)?.text ?? id;
  return <section className="dailyPanel">
    <div className="dailyHeading"><div><p className="eyebrow">DAILY MOVEMENT</p><h2>有声量关键词 · 前 100 变化</h2></div><Link href="/traffic" className="textLink">查看流量周报 →</Link></div>
    {error ? <div className="loadError"><span>{error}</span><button onClick={retry}>重新加载</button></div> : !data ? <p className="muted">正在加载变化数据…</p> : !daily ? <p className="muted">等待首次完整采集；完成后建立基线，第二次完整采集后展示新增和减少。</p> : <>
      <div className="dailyNumbers"><span>完整报告前 100 <strong>{daily.count}</strong></span><span className="positive">新增检出 <strong>{daily.baseline ? "—" : daily.entered.length}</strong></span><span>减少检出 <strong>{daily.detectedReduction ?? "—"}</strong></span><span>净变化 <strong>{daily.net == null ? "—" : `${daily.net > 0 ? "+" : ""}${daily.net}`}</strong></span></div>
      <p className="chartNote">{daily.date} {daily.previousDate ? `对比 ${daily.previousDate}` : "首次采集，建立基线"} · 声量 &gt; 0 · 同一来源的完整报告比较。减少检出中确认排名外 {daily.lost.length} 个，缺失待核实 {daily.missing.length} 个；声量未知 {daily.unknownVolume} 个未纳入。</p>
      <p className="chartNote">每日变化使用完整采集报告；缺少网站或比较基线时，整体增减暂不计算。</p>
      {daily.siteCaptures ? <p className="chartNote">{daily.siteCaptures.map((site) => `${site.site} · ${site.source.toUpperCase()} · ${site.date}${site.previousDate ? ` 对比 ${site.previousDate}` : " 首次基线"}`).join("；")}。{daily.pendingSites?.length ? `待采集：${daily.pendingSites.join("、")}` : ""}</p> : null}
      {!daily.baseline ? <details className="movementDetails"><summary>查看新增与减少的关键词</summary>{[["新增检出", daily.entered], ["确认排名外", daily.lost], ["缺失待核实", daily.missing]].map(([label, ids]) => <div key={label as string}><b>{label as string}</b><p>{(ids as string[]).map(name).join("、") || "无"}</p></div>)}</details> : null}
    </>}
  </section>;
}

export function TrafficReport() {
  const selection = useSeoSelection();
  const { data, error, retry } = useInsights(selection);
  const periods = data?.periods ?? weeklyPeriods();
  const traffic = data?.traffic;
  const metrics = [
    { label: "新用户数量", key: "newUsers" as const, format: number },
    { label: "新注册用户数量", key: "newRegistrations" as const, format: number },
    { label: "注册率", key: "registrationRate" as const, format: pct },
  ];
  return <main className="appShell"><PageHeader active="traffic" selection={selection} />
    <div className="pageIntro"><p className="eyebrow">ACQUISITION & CONVERSION</p><h1>流量与注册周报</h1><p>全部网站汇总 · GA4 · 全站用户 · 北京时间</p></div>
    <div className="periodComparison"><span><i className="currentDot" />本期 {periods.current.start} — {periods.current.end}</span><span><i />上一期 {periods.previous.start} — {periods.previous.end}</span></div>
    {error ? <div className="loadError"><span>{error}</span><button onClick={retry}>重新加载</button></div> : null}
    {traffic?.missingCurrent?.length || traffic?.missingPrevious?.length ? <p className="muted reportMissing">本期已导入 {traffic.current?.sites ?? 0}/3 个网站，上一期已导入 {traffic.previous?.sites ?? 0}/3 个网站。缺少网站的数据时保留已导入部分，整体环比等待三个网站都齐全后计算。</p> : null}
    <section className="trafficGrid">{metrics.map((metric) => {
      const current = traffic?.current?.[metric.key]; const previous = traffic?.previous?.[metric.key];
      const maximum = Math.max(current ?? 0, previous ?? 0, 1);
      return <article className="trafficCard" key={metric.key}><h2>{metric.label}</h2><strong>{metric.format(current)}</strong><p className="trafficChange">环比 {change(traffic?.changes[metric.key])}</p>
        <div className="compareBar"><span>本期</span><div><i style={{ width: `${(current ?? 0) / maximum * 100}%` }} /></div><b>{metric.format(current)}</b></div>
        <div className="compareBar previous"><span>上一期</span><div><i style={{ width: `${(previous ?? 0) / maximum * 100}%` }} /></div><b>{metric.format(previous)}</b></div>
        {metric.key === "registrationRate" ? <p className="chartNote">变化 {traffic?.changes.ratePoints == null ? "—" : `${traffic.changes.ratePoints > 0 ? "+" : ""}${traffic.changes.ratePoints.toFixed(2)} 个百分点`}</p> : null}
      </article>;
    })}</section>
    <div className="reportNote"><h2>统计口径</h2><p>两个相邻的周二至周一，共 7 天。新注册用户为 GA4 sign_up 成功事件的区间去重用户数；注册率 = 新注册用户数 ÷ 新用户数。去重用户数需直接按整个 7 天查询，不能把每日去重人数相加。</p><p>每个网站必须使用自己的同一 GA4 属性、同一时区与全站范围。汇总为各站去重用户数之和，同一人访问多个网站可能重复计数；跨网站无法全域去重。缺少数据或上一期为 0 时，环比显示无可比基线。注册用户可能包含老访客，因此该比率不代表新用户群的转化率。</p><p>本期导入：{traffic?.current?.collectedAt ? new Date(traffic.current.collectedAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" }) : "待导入"} · 上一期导入：{traffic?.previous?.collectedAt ? new Date(traffic.previous.collectedAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" }) : "待导入"}</p><Link href="/manage" className="textLink">前往数据管理导入周报 →</Link></div>
  </main>;
}
