"use client";
import { useEffect, useState } from "react";
import { Select } from "antd";
import { PageHeader } from "@/components/PageHeader";
import { reportPeriods, weeklyPeriods } from "@/lib/weekly-traffic";
import { REGIONS, type SearchRegionCode } from "@/lib/seo";
import type { WeeklyKeywordComparison } from "@/lib/weekly-keyword-comparison";
import type { WeeklyReportDiagnosis } from "@/lib/weekly-report-diagnosis";

type Week = { newUsers: number; newRegistrations: number; registrationRate: number | null; collectedAt: string; sites?: number; timezones?: string[]; registrationMetrics?: string[] };
type InsightData = {
  periods: ReturnType<typeof weeklyPeriods>; history: string[];
  traffic: { current: Week | null; previous: Week | null; currentSites: string[]; previousSites: string[]; comparable: boolean; siteTraffic?: {siteDomain:string;current:Pick<Week,"newUsers"|"newRegistrations"|"registrationRate">|null}[]; changes: { newUsers: number | null; newRegistrations: number | null; registrationRate: number | null; ratePoints: number | null } };
  comparison: WeeklyKeywordComparison | null;
  diagnosis: WeeklyReportDiagnosis;
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

const delta = (value: number) => `${value > 0 ? "+" : ""}${value.toLocaleString()}`;
function WeeklyKeywordChanges({ data }: { data: InsightData | null }) {
  const report = data?.comparison;
  const rows = report ? [{ label: "前100合计", current: report.current, previous: report.previous, delta: report.net, color: "#23395c" }, ...report.buckets] : [];
  const maximum = Math.max(1, ...rows.flatMap(row => [row.current, row.previous]));
  return <section className="dailyPanel weeklyKeywords">
    <div className="dailyHeading"><div><h2>历史报告关键词环比</h2><p className="chartNote">GSC / Ahrefs 历史记录 · 四国关键词去重{report ? ` · 可比范围 ${report.comparedMarkets}/12 个网站与国家组合` : ""}</p></div></div>
    {!data ? <p className="muted">正在读取关键词报告…</p> : !report ? <p className="muted">缺少相邻两期完整报告，暂无法比较。</p> : <>
      <div className="keywordComparisonSummary"><div><span>本期新增</span><strong className="metricIncrease">+{report.entered}</strong></div><div><span>本期减少</span><strong className="metricDecrease">{report.removed ? `−${report.removed}` : "0"}</strong></div><div><span>净变化</span><strong>{delta(report.net)}</strong></div></div>
      <div className="siteTrafficTable keywordComparisonTable"><table><thead><tr><th>排名区间</th><th>上期词数</th><th>本期词数</th><th>数量变化</th></tr></thead><tbody>{rows.map(row => <tr key={row.label}><th><i style={{ background: row.color }} />{row.label}</th><td><div className="reportBarCell"><span className="reportBarTrack"><i className="previousReportBar" style={{ width: `${row.previous / maximum * 100}%` }} /></span><strong>{row.previous.toLocaleString()}</strong></div></td><td><div className="reportBarCell"><span className="reportBarTrack"><i style={{ width: `${row.current / maximum * 100}%`, background: row.color }} /></span><strong>{row.current.toLocaleString()}</strong></div></td><td><span className={`reportDelta ${row.delta > 0 ? "increase" : row.delta < 0 ? "decrease" : ""}`}>{delta(row.delta)}</span></td></tr>)}</tbody></table></div>
      <div className="pageLossSummary"><h3>主要排名流失页面</h3>{report.pageLosses.length ? <div className="siteTrafficTable"><table><thead><tr><th>页面 / 相关词</th><th>流失词数</th><th>下降词数</th><th>变化情况</th></tr></thead><tbody>{report.pageLosses.slice(0, 10).map(page => <tr key={page.url}><td><a href={page.url} target="_blank" rel="noreferrer">{page.url.replace(/^https?:\/\//, "")}</a><small>{page.keywords.slice(0, 3).join("、")}{page.keywords.length > 3 ? ` 等 ${page.keywords.length} 词` : ""}</small></td><td>{page.lost}</td><td>{page.declined}</td><td><strong>{page.reasons.join(" · ")}</strong><small>{page.regions.map(region => REGIONS[region as SearchRegionCode]?.label ?? region).join("、")}</small></td></tr>)}</tbody></table></div> : <p className="muted">{report.removed || report.unattributed ? "本期缺少可比的页面明细，暂无法确定排名流失页面。" : "同期页面明细中暂无排名流失记录。"}</p>}
      {report.unattributed ? <p className="chartNote">另有 {report.unattributed} 条减少记录缺少同期页面证据，未归因到页面。</p> : null}
      {report.pageLosses.some(page => page.reasons.includes("本期报告未检出")) ? <p className="chartNote">“本期报告未检出”不等于已确认跌出前100。</p> : null}</div>
    </>}
  </section>;
}

function WeeklySummary({ data }: { data: InsightData | null }) {
  const traffic = data?.traffic, ranks = data?.comparison;
  const trafficChange = traffic?.comparable && traffic.current && traffic.previous
    ? `新用户 ${delta(traffic.current.newUsers - traffic.previous.newUsers)} 人（${change(traffic.changes.newUsers)}），注册用户 ${delta(traffic.current.newRegistrations - traffic.previous.newRegistrations)} 人（${change(traffic.changes.newRegistrations)}）。`
    : data ? "两期流量数据尚不可比，暂不计算增减。" : "正在读取流量数据…";
  const largest = ranks?.buckets.filter(row => row.delta !== 0).sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))[0];
  const rankChange = ranks ? `前100关键词由 ${ranks.previous} 个变为 ${ranks.current} 个，新增 ${ranks.entered} 个、减少 ${ranks.removed} 个，净变化 ${delta(ranks.net)} 个。${largest ? `变化最多：${largest.label} ${delta(largest.delta)} 个。` : "各排名区间数量持平。"}`
    : data ? "缺少相邻两期关键词报告，暂无法总结变化。" : "正在读取关键词数据…";
  return <section className="dailyPanel reportSummary" aria-label="本周变化总结"><h2>本周变化</h2><div><span>流量与注册</span><p>{trafficChange}</p></div><div><span>关键词排名</span><p>{rankChange}</p></div>{ranks ? <div><span>重点页面</span><p>{ranks.pageLosses.length ? <>优先关注 {ranks.pageLosses.slice(0, 3).map((page, index) => <span key={page.url}>{index ? "、" : ""}<a href={page.url} target="_blank" rel="noreferrer">{page.url.replace(/^https?:\/\//, "")}</a>（流失 {page.lost} 词、下降 {page.declined} 词）</span>)}。</> : ranks.removed || ranks.unattributed ? "减少记录缺少同期页面证据，暂无法确定需关注的页面。" : "同期页面明细中暂无排名流失记录。"}</p></div> : null}</section>;
}

export function TrafficReport() {
  const [week, setWeek] = useState("");
  const { data, error, retry } = useInsights(week);
  const periods = data?.periods ?? (week ? reportPeriods(week) : weeklyPeriods());
  const traffic = data?.traffic;
  const history = data?.history ?? [weeklyPeriods().current.start, ...(week ? [week] : [])];
  const metrics = [
    { label: "新用户", key: "newUsers" as const, format: number },
    { label: "注册用户（去重）", key: "newRegistrations" as const, format: number },
    { label: "注册人数 / 新用户数", key: "registrationRate" as const, format: pct },
  ];
  return <main className="appShell"><PageHeader active="traffic" />
    <div className="reportIntro"><div className="pageIntro"><h1>流量周报</h1><p>流量、注册与关键词按周期环比 · 每周二更新</p></div><label className="originSelectField"><span>历史周报</span><Select aria-label="历史周报" className="reportWeekSelect" value={week || weeklyPeriods().current.start} onChange={(start) => setWeek(start === weeklyPeriods().current.start ? "" : start)} options={[...new Set(history)].map(start=>({value:start,label:`${start} — ${reportPeriods(start).current.end}${start === weeklyPeriods().current.start ? " · 最新" : ""}`}))} /></label></div>
    <div className="periodComparison"><span><i className="currentDot" />本期 {periods.current.start} — {periods.current.end}</span><span><i />上期 {periods.previous.start} — {periods.previous.end}</span></div>
    {error ? <div className="loadError"><span>{error}</span><button onClick={retry}>重新加载</button></div> : null}
    <WeeklySummary data={data} />
    {data?.diagnosis?.significant ? <section className="dailyPanel reportDiagnosis" aria-label="大幅波动原因排查"><h2>波动原因排查</h2><div>{data.diagnosis.findings.map((finding, index) => <article className={`diagnosisFinding ${finding.level}`} key={`${finding.title}:${finding.url ?? index}`}><h3>{finding.title}</h3>{finding.url ? <a href={finding.url} target="_blank" rel="noreferrer">{finding.url.replace(/^https?:\/\//, "")}</a> : null}<p>{finding.evidence}</p><p className="diagnosisAction">{finding.action}</p>{finding.checkedAt ? <small>页面检查 {new Date(finding.checkedAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}</small> : null}</article>)}</div></section> : null}
    <p className="chartNote reportScope">GA4 · 三站汇总{data ? ` · 已导入 ${traffic?.currentSites.length ?? 0}/3 个网站` : " · 正在加载…"}</p>
    <section className="trafficGrid">{metrics.map((metric) => {
      const current = traffic?.current?.[metric.key]; const previous = traffic?.previous?.[metric.key];
      const maximum = Math.max(current ?? 0, previous ?? 0, 1);
      return <article className="trafficCard" key={metric.key}><h2>{metric.label}</h2><strong>{data ? metric.format(current) : "加载中…"}</strong><p className="trafficChange">环比 {data ? change(traffic?.changes[metric.key]) : "加载中…"}</p>
        <div className="compareBar"><span>本期</span><div><i style={{ width: `${(current ?? 0) / maximum * 100}%` }} /></div><b>{data ? metric.format(current) : "加载中…"}</b></div>
        <div className="compareBar previous"><span>上期</span><div><i style={{ width: `${(previous ?? 0) / maximum * 100}%` }} /></div><b>{data ? metric.format(previous) : "加载中…"}</b></div>
        {metric.key === "registrationRate" && traffic?.changes.ratePoints != null ? <p className="chartNote">变化 {traffic.changes.ratePoints > 0 ? "+" : ""}{traffic.changes.ratePoints.toFixed(2)} 个百分点</p> : null}
      </article>;
    })}</section>
    <section className="dailyPanel siteTrafficPanel"><h2>各网站数据</h2><div className="siteTrafficTable"><table><thead><tr><th>网站</th><th>新用户</th><th>注册用户（去重）</th><th>注册人数 / 新用户数</th><th>本期状态</th></tr></thead><tbody>{["flatkey.ai","rackrate.org","modelfit.cc"].map(domain=>{const row=traffic?.siteTraffic?.find(site=>site.siteDomain===domain)?.current;return <tr key={domain}><th>{domain}</th><td>{data?number(row?.newUsers):"加载中…"}</td><td>{data?number(row?.newRegistrations):"加载中…"}</td><td>{data?pct(row?.registrationRate):"加载中…"}</td><td>{!data?"读取中":row?"已采集":"本期暂无有效周报"}</td></tr>;})}</tbody></table></div></section>
    <WeeklyKeywordChanges data={data} />

  </main>;
}
