"use client";
import { UiSelect } from "./UiSelect";
import { WeeklyDailySummary } from "./WeeklyDailySummary";
import { ClusterSiteTable } from "./SeoClusterReport";
import { CLUSTER_SITES, siteReportToday, type ClusterDomain } from "@/lib/seo-cluster-sites";
import { PageTrafficCharts } from "./PageTrafficCharts";

import type { PageTrafficSeries } from "@/lib/page-traffic-history";
import { useEffect, useState } from "react";
import { propertyToday, shiftDay, validRange } from "@/lib/seo-date-range";
import { SessionSeoReport } from "./SessionSeoReport";
import { PageHeader } from "@/components/PageHeader";
import { useSeoCountry } from "./useSeoCountry";
import { REGIONS } from "@/lib/seo";
import { reportPeriods, activeReportPeriods, relativeChange } from "@/lib/weekly-traffic";
import type { WeeklyKeywordComparison } from "@/lib/weekly-keyword-comparison";
import type { WeeklyTrafficEvidence } from "@/lib/weekly-traffic-evidence";
import type { WeeklyReportDiagnosis } from "@/lib/weekly-report-diagnosis";
import type { WeeklyReportDraftPayload } from "@/lib/weekly-report-draft";
import { clientReadCache, ClientReadError } from "@/lib/client-read-cache";
import { pageVisitorRows, type WeeklyPageVisitors } from "@/lib/weekly-page-visitors";
import type { WeeklyReportingCutoff } from "@/lib/weekly-cutoff";
import styles from "./WeeklyReport.module.css";
import workspace from "./SeoWorkspace.module.css";

type Week = { newUsers: number; newRegistrations: number; registrationRate: number | null; collectedAt: string; sites?: number; timezones?: string[]; registrationMetrics?: string[] };
type InsightData = {
  trafficScope?: "organic_search";
  pageVisitors?: WeeklyPageVisitors | null;
  pageTrafficHistory?: PageTrafficSeries;
  reportingCutoff?: (WeeklyReportingCutoff & {collectedAt:string;comparable:boolean}) | null;
  displaySnapshot?: {pending?:boolean};
  periods: ReturnType<typeof activeReportPeriods>; history: string[];
  traffic: { trafficScope?: "organic_search"; current: Week | null; previous: Week | null; currentSites: string[]; previousSites: string[]; comparable: boolean; complete?: boolean; siteTraffic?: {siteDomain:string;current:Pick<Week,"newUsers"|"newRegistrations"|"registrationRate">|null}[]; changes: { newUsers: number | null; newRegistrations: number | null; registrationRate: number | null; ratePoints: number | null } };
  comparison: WeeklyKeywordComparison | null;
  ranking?: { captureWeek: boolean; waiting: boolean; baseline: boolean; noNewCapture: boolean; comparisonReference?: {kind:"FIRST_ISSUE";label:string;checkedAt:string|null;capturedKeywords:number} | null; unresolvedWords?: number; capturedKeywords: number; latestCheckedAt: string | null; status: string; sampleOnly: boolean };
  evidence?: (WeeklyTrafficEvidence & { collectedAt: string; timezone: string }) | null;
  diagnosis: WeeklyReportDiagnosis;
  draft?: WeeklyReportDraftPayload | null;
};

function useInsights(week: string, enabled: boolean) {
  const key = week;
  const url = `/api/views?view=traffic${week ? `&week=${encodeURIComponent(week)}` : ""}`;
  const [result, setResult] = useState<{ key: string; data: InsightData } | null>(() => {
    const data = clientReadCache.peek<InsightData>(url);
    return data ? { key, data } : null;
  });
  const [error, setError] = useState<string | null>(null);
  const [version, retry] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    let pendingTimer: ReturnType<typeof setTimeout>;
    let busy = false, forceNext = version > 0;
    const update = async () => {
      if (busy || document.hidden) return;
      busy = true;
      try {
        let data: InsightData | null = null;
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            data = await clientReadCache.read<InsightData>(url, forceNext);
            forceNext = false;
            break;
          } catch (error) {
            if (controller.signal.aborted || attempt === 1 || error instanceof ClientReadError && error.status < 500) throw error;
            await new Promise(resolve=>setTimeout(resolve,600));
          }
        }
        if (!data) return;
        if (data.displaySnapshot?.pending) pendingTimer=setTimeout(()=>{forceNext=true;void update();},5000);
        if (!controller.signal.aborted) { setResult({ key, data }); setError(null); }
      } catch (error) {
        if (!controller.signal.aborted && error instanceof ClientReadError && error.status === 401) { clientReadCache.clear(); window.location.assign("/login"); return; }
        if (!controller.signal.aborted) setError(error instanceof Error ? error.message : "加载失败");
      } finally { busy = false; }
    };
    void update();
    const timer = setInterval(() => void update(), 5 * 60_000);
    const onUpdated = () => { forceNext = true; void update(); };
    document.addEventListener("visibilitychange", update);
    window.addEventListener("focus", update);
    window.addEventListener("seo-rankings-updated", onUpdated);
    return () => { controller.abort(); clearTimeout(pendingTimer); clearInterval(timer); document.removeEventListener("visibilitychange", update); window.removeEventListener("focus", update); window.removeEventListener("seo-rankings-updated", onUpdated); };
  }, [enabled, key, url, version]);
  return { data: result?.key === key ? result.data : clientReadCache.peek<InsightData>(url), error, retry: () => retry((n) => n + 1) };
}

const pct = (value: number | null | undefined) => value == null ? "待补采" : `${(value * 100).toFixed(1)}%`;
const change = (value: number | null | undefined) => value == null ? "暂时无法比较" : `${value > 0 ? "+" : ""}${(value * 100).toFixed(1)}%`;
const number = (value: number | null | undefined) => value == null ? "待补采" : value.toLocaleString();

const delta = (value: number) => `${value > 0 ? "+" : ""}${value.toLocaleString()}`;
function WeeklyKeywordChanges({ data }: { data: InsightData | null }) {
  const report = data?.comparison, ranking = data?.ranking;
  const showChanges = !ranking?.waiting && (!ranking?.noNewCapture || ranking?.baseline);
  const rows: { label: string; current?: number; previous?: number; delta?: number; color: string }[] = report
    ? [{ label: "前100合计", current: report.current, previous: report.previous, delta: report.net, color: "#23395c" }, ...report.buckets]
    : ["前100合计", "前10名", "11–30名", "31–50名", "51–100名"].map((label, index) => ({ label, color: ["#23395c", "#10b981", "#4385ff", "#f5a000", "#ff791b"][index] }));
  const maximum = Math.max(1, ...rows.flatMap(row => [row.current ?? 0, row.previous ?? 0]));
  return <section className="dailyPanel weeklyKeywords">
    <div className="dailyHeading"><div><h2>关键词排名环比</h2><p className="chartNote">DataForSEO SERP · 四国关键词去重{ranking?.latestCheckedAt ? ` · 最近采集 ${new Date(ranking.latestCheckedAt).toLocaleDateString("zh-CN", { timeZone: "Asia/Shanghai" })}` : ""}</p></div></div>
    {!data ? <p className="muted">正在读取关键词报告…</p> : <>
      {ranking ? <p className="weeklyRankingState">{ranking.waiting ? "关键词采集中，完成后整理本周变化。" : ranking.baseline ? `首次基线：已采集 ${ranking.capturedKeywords} 个词，实际有排名的 ${report?.current ?? 0} 个词全部记为新增。${ranking.sampleOnly ? "当前仅为已保存的小批结果，全量付费未执行。" : ""}` : !ranking.captureWeek ? "本周未安排关键词采集，展示最近一期结果，不计算新的排名变化。" : ranking.status === "PAID_DISABLED" ? "本周为采集周，付费抓取尚未开启。" : ranking.status === "FAILED" ? "本轮部分结果不可用，仅展示有效记录，不计作排名流失。" : "本轮采集已完成。"}</p> : null}
      {ranking?.comparisonReference ? <p className="chartNote">对比第一期 · {ranking.comparisonReference.label}{ranking.comparisonReference.checkedAt ? `（${new Date(ranking.comparisonReference.checkedAt).toLocaleDateString("zh-CN",{timeZone:"Asia/Shanghai"})}）` : ""}：已查 {ranking.comparisonReference.capturedKeywords} 词，本期已查 {ranking.capturedKeywords} 词。新增含采集范围扩大后首次发现的排名词。</p> : null}
      {!report ? <p className="chartNote">尚无已保存的有效排名结果，完成采集后展示。</p> : null}
      <div className="keywordComparisonSummary"><div><span>本期新增</span><strong className="metricIncrease">{report && showChanges ? `+${report.entered}` : "—"}</strong></div><div><span>本期减少</span><strong className="metricDecrease">{report && showChanges ? report.removed ? `−${report.removed}` : "0" : "—"}</strong></div><div><span>净变化</span><strong>{report && showChanges ? delta(report.net) : "—"}</strong></div></div>
      <div className="siteTrafficTable keywordComparisonTable"><table><thead><tr><th>排名区间</th><th>{ranking?.comparisonReference ? "第一期词数" : "上期词数"}</th><th>本期词数</th><th>数量变化</th></tr></thead><tbody>{rows.map(row => <tr key={row.label}><th><i style={{ background: row.color }} />{row.label}</th><td><div className="reportBarCell"><span className="reportBarTrack"><i className="previousReportBar" style={{ width: `${(row.previous ?? 0) / maximum * 100}%` }} /></span><strong>{ranking?.baseline ? "—" : row.previous?.toLocaleString() ?? "—"}</strong></div></td><td><div className="reportBarCell"><span className="reportBarTrack"><i style={{ width: `${(row.current ?? 0) / maximum * 100}%`, background: row.color }} /></span><strong>{row.current?.toLocaleString() ?? "—"}</strong></div></td><td><span className={`reportDelta ${(row.delta ?? 0) > 0 ? "increase" : (row.delta ?? 0) < 0 ? "decrease" : ""}`}>{row.delta == null || !showChanges ? "—" : delta(row.delta)}</span></td></tr>)}</tbody></table></div>
      {ranking?.unresolvedWords ? <p className="chartNote">另有 {ranking.unresolvedWords} 个上期排名词本次缺少有效结果，未计为排名流失；净变化表示已取得的排名记录数量变化。</p> : null}
    </>}
  </section>;
}

type ComparisonRow = { name: string; current: number; previous: number; detail?: string };
function PeriodBarsTable({ rows, label, heading, complete }: { rows: ComparisonRow[]; label: string; heading: string; complete: boolean }) {
  const maximum = Math.max(1, ...rows.flatMap(row => [row.current, row.previous]));
  return <div className="channelChart" role="table" aria-label={label}>
    <div className="channelChartRow channelChartHead" role="row"><span role="columnheader">{heading}</span><span role="columnheader" className="channelPeriodLegend"><span><i />上期</span><span><i />本期</span></span><span role="columnheader">增减人数</span><span role="columnheader">环比</span></div>
    {rows.map(row => {
      const difference = row.current - row.previous;
      const rateLabel = !complete ? "—" : row.previous === 0 ? row.current > 0 ? "新增" : "0.0%" : change(relativeChange(row.current, row.previous));
      const tone = complete ? difference > 0 ? "increase" : difference < 0 ? "decrease" : "" : "";
      return <div className="channelChartRow" role="row" key={row.name}>
        <span role="rowheader" className="channelName" title={row.detail}>{row.name}</span>
        <div role="cell" className="channelPairedBars" aria-label={`上期 ${row.previous} 人，本期 ${row.current} 人`}>
          {(["previous", "current"] as const).map(key => <div key={key} className={`channelBar ${key}`}><span><i style={{ width: `${row[key] / maximum * 100}%`, minWidth: row[key] ? 2 : 0 }} /></span><b>{row[key].toLocaleString()}</b></div>)}
        </div>
        <strong role="cell" className={`reportDelta ${tone}`}>{complete ? delta(difference) : "—"}</strong>
        <span role="cell" className={`channelRate reportDelta ${tone}`}>{rateLabel}</span>
      </div>;
    })}
  </div>;
}

function WeeklyChannelComparison({ evidence, period, comparable = true }: { evidence: WeeklyTrafficEvidence; period?: string; comparable?: boolean }) {
  const [metric, setMetric] = useState<"newUsers" | "registrations">("newUsers");
  const rows = evidence.channels.filter(channel => channel.name === "Organic Search").map(channel => ({ name: "自然搜索", ...channel[metric] }));
  return <section className="dailyPanel channelDashboard" aria-label="自然搜索周度对比">
    <div className="dailyHeading"><div><h2>自然搜索周度对比</h2><p className="chartNote">Flatkey · 首次来源为自然搜索{period ? ` · ${period}` : ""}</p></div>
      <div className="channelMetricSwitch" role="group" aria-label="渠道对比指标">{([{ key: "newUsers", label: "新用户" }, { key: "registrations", label: "注册用户" }] as const).map(item => <button key={item.key} type="button" aria-pressed={metric === item.key} onClick={() => setMetric(item.key)}>{item.label}</button>)}</div>
    </div>
    <PeriodBarsTable rows={rows} label={`${metric === "newUsers" ? "新用户" : "注册用户"}渠道环比`} heading="渠道" complete={evidence.complete && comparable} />
  </section>;
}

function WeeklyEvidenceTables({ data }: { data: InsightData | null }) {
  const evidence = data?.evidence;
  if (evidence?.trafficScope !== "organic_search") return null;
  return <>
    <WeeklyChannelComparison evidence={evidence} comparable={data?.reportingCutoff?.comparable ?? true} period={data?.draft ? `${data.draft.comparisonPeriods.current.start}—${data.draft.comparisonPeriods.current.end} 对比 ${data.draft.comparisonPeriods.previous.start}—${data.draft.comparisonPeriods.previous.end}` : !evidence.complete ? "本周更新中，暂不计算环比" : undefined} />
    {evidence.search?.decliningPages.length ? <section className="dailyPanel"><h2>自然搜索点击下降页面</h2><p className="chartNote">GSC 全站七天对比 · 点击下降与关键词跌出排名分别判断</p><div className="siteTrafficTable"><table><thead><tr><th>页面</th><th>上期点击</th><th>本期点击</th><th>平均位置：上期 → 本期</th></tr></thead><tbody>{evidence.search.decliningPages.map(page=><tr key={page.url}><td><a href={page.url} target="_blank" rel="noreferrer">{page.url.replace(/^https?:\/\//, "")}</a></td><td>{page.clicks.previous}</td><td>{page.clicks.current}</td><td>{page.position.previous ?? "—"} → {page.position.current ?? "—"}</td></tr>)}</tbody></table></div></section> : null}
  </>;
}

function WeeklyPillarVisitors({ data }: { data: InsightData | null }) {
  if (!data?.pageVisitors) return null;
  const periods = data?.periods;
  const rows = pageVisitorRows(data?.pageVisitors, Boolean(data?.pageVisitors && !data.draft));
  return <section className="dailyPanel" aria-label="核心业务自然搜索访客占比"><h2>模型详情与 Prompt Library 自然搜索访客占比</h2>
    <p className="chartNote">Flatkey · {data?.reportingCutoff ? `${data.reportingCutoff.kind === "FRIDAY_1010_SNAPSHOT" ? "周五" : "周二"}10:10截数快照 · 区间去重访客` : "整周去重访客"} · 自然搜索新老访客 · 每周更新{periods ? ` · 本期 ${periods.current.start}—${periods.current.end}` : ""}</p>
    <div className="siteTrafficTable"><table><thead><tr><th>页面类型</th><th>本周占比</th><th>上周占比</th><th>占比变化</th><th>上周访客量</th><th>本周访客量</th><th>增减人数</th><th>环比</th></tr></thead><tbody>{rows.map(row => <tr key={row.key}>
      <th>{row.name}<small>{row.scope}</small></th>
      <td><strong>{row.currentShare == null ? "待采集" : pct(row.currentShare)}</strong></td>
      <td>{row.previousShare == null ? "—" : pct(row.previousShare)}</td>
      <td>{row.sharePoints == null ? "—" : `${row.sharePoints > 0 ? "+" : ""}${row.sharePoints.toFixed(1)} 个百分点`}</td>
      <td>{!data ? "加载中…" : row.previous == null ? "待采集" : row.previous.toLocaleString()}</td>
      <td>{!data ? "加载中…" : row.current == null ? "待采集" : row.current.toLocaleString()}</td>
      <td>{row.delta == null ? "—" : delta(row.delta)}</td>
      <td>{row.newTraffic ? "新增" : row.delta === 0 ? "0.0%" : row.rate == null ? "—" : change(row.rate)}</td>
    </tr>)}</tbody></table></div>
    <p className="chartNote">占比 = 该组自然搜索去重访客 / 同期全站自然搜索去重访客（包含新老访客）。同一人可访问两组，占比存在重叠，不相加为100%。模型详情不含模型目录；Prompt Library 包含提示词库、详情及模型内提示词。{data?.draft ? "完整周数据待补齐。" : ""}</p>
  </section>;
}

type ReportMode = "day" | "current" | "previous" | "legacy";

export function TrafficReport() {
  const [country] = useSeoCountry();
  const [site, setSite] = useState<ClusterDomain | undefined>();
  const [week, setWeek] = useState("");
  const [mode, setMode] = useState<ReportMode>("current");
  const [day, setDay] = useState(() => shiftDay(propertyToday(), -1));
  const { data: loadedData, error, retry } = useInsights(week, !site);
  const data = loadedData?.traffic.trafficScope === "organic_search" ? loadedData : null;
  const periods = data?.periods ?? (week ? reportPeriods(week) : activeReportPeriods());
  const traffic = data?.traffic;
  const draft = data?.draft;
  const trafficPeriods = draft?.comparisonPeriods ?? periods;
  const sameDays = draft?.evidence.totals;
  const displayTraffic = sameDays ?? traffic;
  const history = data?.history ?? [activeReportPeriods().current.start];
  const comparable = Boolean((draft || traffic?.comparable) && (data?.reportingCutoff?.comparable ?? true));
  const metrics = [
    { label: "自然搜索新用户", current: displayTraffic?.current?.newUsers, previous: displayTraffic?.previous?.newUsers },
    { label: "自然搜索获客注册（去重）", current: displayTraffic?.current?.newRegistrations, previous: displayTraffic?.previous?.newRegistrations },
  ];
  useEffect(() => {
    const read = () => {
      const params = new URLSearchParams(location.search), report = params.get("report");
      const requestedSite = CLUSTER_SITES.find(entry => entry.domain === params.get("site"))?.domain;
      setSite(requestedSite);
      const requestedDay = params.get("day");
      const today = siteReportToday(requestedSite);
      setDay(requestedDay && requestedDay < today && validRange({ start: requestedDay, end: requestedDay })
        ? requestedDay
        : shiftDay(today, -1));
      if (!requestedSite && report?.startsWith("legacy:")) {
        const start = report.slice(7);
        try { reportPeriods(start); setWeek(start); setMode("legacy"); return; } catch { /* Ignore invalid saved links. */ }
      }
      setMode(report === "day" ? "day" : report === "previous" ? "previous" : "current");
    };
    read(); addEventListener("popstate", read);
    return () => removeEventListener("popstate", read);
  }, []);
  function selectReport(value: string) {
    const params = new URLSearchParams(location.search);
    params.set("report", value);
    historyPush(params);
  }
  function selectSite(value: string) {
    const params = new URLSearchParams(location.search);
    if (value === "flatkey.ai") params.delete("site");
    else {
      params.set("site", value);
      if (mode === "legacy") params.set("report", "current");
    }
    historyPush(params);
  }
  const selected = mode === "legacy" ? `legacy:${week || periods.current.start}` : mode;
  const priorDay = shiftDay(day, -1);
  const today = siteReportToday(site);
  function selectDay(value: string) {
    if (value === day || value >= today || !validRange({ start: value, end: value })) return;
    const params = new URLSearchParams(location.search);
    if (params.get("day") === value) return;
    params.set("day", value);
    historyPush(params);
  }
  return <main className={workspace.shell}>
    <PageHeader active="traffic" />
    <div className={workspace.titleRow}>
      <h1 className={workspace.title}>日/周总结</h1>
      <div className={styles.reportControls}>
        <UiSelect className={styles.reportSelect} aria-label="选择站点" value={site ?? "flatkey.ai"} onChange={selectSite}
          options={[{ value: "flatkey.ai", label: "Flatkey" }, ...CLUSTER_SITES.map(entry => ({ value: entry.domain, label: entry.name }))]} />
        <UiSelect className={styles.reportSelect} aria-label="选择报告" value={selected} onChange={selectReport} options={[
        { value: "day", label: "日总结" }, { value: "current", label: "本周总结" }, { value: "previous", label: "上周总结" },
        ...(site ? [] : [...new Set([...history, ...(week ? [week] : [])])].map(start => ({ value: `legacy:${start}`, label: `历史获客 · ${start} — ${reportPeriods(start).current.end}` }))),
        ]} />
      </div>
    </div>
    {mode === "day" ? <>
      <label className={styles.dayPicker}>日期
        <input aria-label="日总结日期" type="date" value={day} max={shiftDay(today, -1)}
          onInput={event => selectDay(event.currentTarget.value)} onChange={event => selectDay(event.target.value)} />
      </label>
      {site ? <ClusterSiteTable range={{ start: day, end: day }} domain={site} label="站点日总结" />
        : <SessionSeoReport range={{ start: day, end: day }} comparison={{ start: priorDay, end: priorDay }}
          summary showTrend={false} showDetails={false} />}
    </> : mode === "current" || mode === "previous" ? <WeeklyDailySummary previous={mode === "previous"} site={site} /> : country !== "all" ? (
      <p className={styles.empty}>{REGIONS[country].label}的历史获客报告未按国家归档。可查看日总结或周总结中的国家数据。</p>
    ) : <>
      <p className={styles.period}>首次自然搜索获客口径 · {trafficPeriods.current.start} — {trafficPeriods.current.end}</p>
      {error ? <div className="loadError"><span>{error}</span><button onClick={retry}>重新加载</button></div> : null}
      {!data && !error ? <p className={styles.empty}>正在读取历史周报…</p> : null}
      {data ? <>
        <p className={styles.conclusion}>{displayTraffic?.current
          ? `本期归档记录了 ${number(displayTraffic.current.newUsers)} 位自然搜索新用户、${number(displayTraffic.current.newRegistrations)} 位获客注册用户。${comparable ? "" : "对比数据尚不完整，暂不计算涨跌。"}`
          : "本期尚无完整获客记录。"}</p>
        <section className={styles.metrics} aria-label="历史获客指标">{metrics.map(metric => <article key={metric.label}>
          <h2>{metric.label}</h2><strong>{number(metric.current)}</strong>
          <p>{comparable && metric.current != null && metric.previous != null
            ? metric.previous === 0 ? `上期为 0，本期增加 ${number(metric.current)}` : `比上期 ${change(relativeChange(metric.current, metric.previous))}`
            : "对比数据待补齐"}</p>
        </article>)}</section>
        <details className={styles.evidence}>
          <summary>查看报告证据</summary>
          <p className={styles.period}>本期 {trafficPeriods.current.start} — {trafficPeriods.current.end}，上期 {trafficPeriods.previous.start} — {trafficPeriods.previous.end}。本报告按历史首次获客口径归档，与当次自然搜索访问次数分开查看。</p>
          {data.reportingCutoff ? <p className={styles.period}>采集于 {new Date(data.reportingCutoff.collectedAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}（北京时间）</p> : null}
          {data.pageTrafficHistory?.some(series => series.points.length || series.weeks?.length) ? <PageTrafficCharts series={data.pageTrafficHistory} /> : null}
          <WeeklyPillarVisitors data={data} />
          <WeeklyEvidenceTables data={data} />
          <WeeklyKeywordChanges data={data} />
        </details>
      </> : null}
    </>}
  </main>;
}

function historyPush(params: URLSearchParams) {
  window.history.pushState(null, "", location.pathname + "?" + params);
  dispatchEvent(new PopStateEvent("popstate"));
}
