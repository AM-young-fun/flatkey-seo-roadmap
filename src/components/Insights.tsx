"use client";
import { useEffect, useState } from "react";
import { Select } from "antd";
import { PageHeader } from "@/components/PageHeader";
import { reportPeriods, activeReportPeriods, relativeChange } from "@/lib/weekly-traffic";
import { REGIONS, type SearchRegionCode } from "@/lib/seo";
import type { WeeklyKeywordComparison } from "@/lib/weekly-keyword-comparison";
import type { WeeklyTrafficEvidence } from "@/lib/weekly-traffic-evidence";
import type { WeeklyReportDiagnosis } from "@/lib/weekly-report-diagnosis";
import type { WeeklyReportDraftPayload } from "@/lib/weekly-report-draft";
import { clientReadCache, ClientReadError } from "@/lib/client-read-cache";
import { weeklyFunnelMetrics } from "@/lib/weekly-funnel-metrics";

type Week = { newUsers: number; newRegistrations: number; registrationRate: number | null; collectedAt: string; sites?: number; timezones?: string[]; registrationMetrics?: string[] };
type InsightData = {
  displaySnapshot?: {pending?:boolean};
  periods: ReturnType<typeof activeReportPeriods>; history: string[];
  traffic: { current: Week | null; previous: Week | null; currentSites: string[]; previousSites: string[]; comparable: boolean; complete?: boolean; siteTraffic?: {siteDomain:string;current:Pick<Week,"newUsers"|"newRegistrations"|"registrationRate">|null}[]; changes: { newUsers: number | null; newRegistrations: number | null; registrationRate: number | null; ratePoints: number | null } };
  comparison: WeeklyKeywordComparison | null;
  ranking?: { captureWeek: boolean; waiting: boolean; baseline: boolean; noNewCapture: boolean; unresolvedWords?: number; capturedKeywords: number; latestCheckedAt: string | null; status: string; sampleOnly: boolean };
  evidence?: (WeeklyTrafficEvidence & { collectedAt: string; timezone: string }) | null;
  diagnosis: WeeklyReportDiagnosis;
  draft?: WeeklyReportDraftPayload | null;
};

function useInsights(week: string) {
  const key = week;
  const url = `/api/views?view=traffic${week ? `&week=${encodeURIComponent(week)}` : ""}`;
  const [result, setResult] = useState<{ key: string; data: InsightData } | null>(() => {
    const data = clientReadCache.peek<InsightData>(url);
    return data ? { key, data } : null;
  });
  const [error, setError] = useState<string | null>(null);
  const [version, retry] = useState(0);
  useEffect(() => {
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
        if (error instanceof ClientReadError && error.status === 401) { clientReadCache.clear(); window.location.assign("/login"); return; }
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
  }, [key, url, version]);
  return { data: result?.key === key ? result.data : clientReadCache.peek<InsightData>(url), error, retry: () => retry((n) => n + 1) };
}

const pct = (value: number | null | undefined) => value == null ? "待导入" : `${(value * 100).toFixed(1)}%`;
const change = (value: number | null | undefined) => value == null ? "暂时无法比较" : `${value > 0 ? "+" : ""}${(value * 100).toFixed(1)}%`;
const number = (value: number | null | undefined) => value == null ? "待导入" : value.toLocaleString();

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
      {!report ? <p className="chartNote">尚无已保存的有效排名结果，完成采集后展示。</p> : null}
      <div className="keywordComparisonSummary"><div><span>本期新增</span><strong className="metricIncrease">{report && showChanges ? `+${report.entered}` : "—"}</strong></div><div><span>本期减少</span><strong className="metricDecrease">{report && showChanges ? report.removed ? `−${report.removed}` : "0" : "—"}</strong></div><div><span>净变化</span><strong>{report && showChanges ? delta(report.net) : "—"}</strong></div></div>
      <div className="siteTrafficTable keywordComparisonTable"><table><thead><tr><th>排名区间</th><th>上期词数</th><th>本期词数</th><th>数量变化</th></tr></thead><tbody>{rows.map(row => <tr key={row.label}><th><i style={{ background: row.color }} />{row.label}</th><td><div className="reportBarCell"><span className="reportBarTrack"><i className="previousReportBar" style={{ width: `${(row.previous ?? 0) / maximum * 100}%` }} /></span><strong>{ranking?.baseline ? "—" : row.previous?.toLocaleString() ?? "—"}</strong></div></td><td><div className="reportBarCell"><span className="reportBarTrack"><i style={{ width: `${(row.current ?? 0) / maximum * 100}%`, background: row.color }} /></span><strong>{row.current?.toLocaleString() ?? "—"}</strong></div></td><td><span className={`reportDelta ${(row.delta ?? 0) > 0 ? "increase" : (row.delta ?? 0) < 0 ? "decrease" : ""}`}>{row.delta == null || !showChanges ? "—" : delta(row.delta)}</span></td></tr>)}</tbody></table></div>
      <div className="pageLossSummary"><h3>主要排名流失页面</h3>{report?.pageLosses.length ? <div className="siteTrafficTable"><table><thead><tr><th>页面 / 相关词</th><th>流失词数</th><th>下降词数</th><th>变化情况</th></tr></thead><tbody>{report.pageLosses.slice(0, 10).map(page => <tr key={page.url}><td><a href={page.url} target="_blank" rel="noreferrer">{page.url.replace(/^https?:\/\//, "")}</a><small>{page.keywords.slice(0, 3).join("、")}{page.keywords.length > 3 ? ` 等 ${page.keywords.length} 词` : ""}</small></td><td>{page.lost}</td><td>{page.declined}</td><td><strong>{page.reasons.join(" · ")}</strong><small>{page.regions.map(region => REGIONS[region as SearchRegionCode]?.label ?? region).join("、")}</small></td></tr>)}</tbody></table></div> : <p className="muted">{!report || report.removed || report.unattributed ? "尚无可比的页面排名，首次基线不计算流失。" : "同期页面明细中暂无排名流失记录。"}</p>}
      {ranking?.unresolvedWords ? <p className="chartNote">另有 {ranking.unresolvedWords} 个上期排名词本次缺少有效结果，未计为排名流失；净变化表示已取得的排名记录数量变化。</p> : null}
      {report?.unattributed ? <p className="chartNote">另有 {report.unattributed} 条减少记录缺少同期页面证据，未归因到页面。</p> : null}
      {report?.pageLosses.some(page => page.reasons.includes("本期报告未检出")) ? <p className="chartNote">“本期报告未检出”不等于已确认跌出前100。</p> : null}</div>
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

function WeeklyChannelComparison({ evidence, period }: { evidence: WeeklyTrafficEvidence; period?: string }) {
  const [metric, setMetric] = useState<"newUsers" | "registrations">("newUsers");
  const names: Record<string, string> = { Direct: "直接访问", "Paid Search": "付费搜索", "Organic Search": "自然搜索", Referral: "外部推荐", "Organic Social": "自然社交", Unassigned: "未归类", "AI Assistant": "AI 助手", "Cross-network": "跨广告网络", "Organic Video": "自然视频", "Paid Social": "付费社交", "Paid Other": "其他付费" };
  const channels = evidence.channels.map(channel => ({ name: names[channel.name] ?? channel.name, ...channel[metric] }))
    .sort((a, b) => Math.max(b.current, b.previous) - Math.max(a.current, a.previous));
  const remaining = channels.slice(5);
  const rows = channels.slice(0, 5).map(row => ({ ...row, detail: row.name }));
  if (remaining.length) rows.push({ name: "其他渠道", current: remaining.reduce((sum, row) => sum + row.current, 0), previous: remaining.reduce((sum, row) => sum + row.previous, 0), detail: remaining.map(row => `${row.name}：${row.previous} → ${row.current}`).join("；") });
  return <section className="dailyPanel channelDashboard" aria-label="渠道对比">
    <div className="dailyHeading"><div><h2>渠道对比</h2><p className="chartNote">Flatkey · 首次来源{period ? ` · ${period}` : ""}</p></div>
      <div className="channelMetricSwitch" role="group" aria-label="渠道对比指标">{([{ key: "newUsers", label: "新用户" }, { key: "registrations", label: "注册用户" }] as const).map(item => <button key={item.key} type="button" aria-pressed={metric === item.key} onClick={() => setMetric(item.key)}>{item.label}</button>)}</div>
    </div>
    <PeriodBarsTable rows={rows} label={`${metric === "newUsers" ? "新用户" : "注册用户"}渠道环比`} heading="渠道" complete={evidence.complete} />
  </section>;
}

function WeeklyEvidenceTables({ data }: { data: InsightData | null }) {
  const evidence = data?.evidence;
  if (!evidence) return null;
  return <>
    <WeeklyChannelComparison evidence={evidence} period={data?.draft ? `${data.draft.comparisonPeriods.current.start}—${data.draft.comparisonPeriods.current.end} 对比 ${data.draft.comparisonPeriods.previous.start}—${data.draft.comparisonPeriods.previous.end}` : !evidence.complete ? "本周更新中，暂不计算环比" : undefined} />
    {evidence.search?.decliningPages.length ? <section className="dailyPanel"><h2>自然搜索点击下降页面</h2><p className="chartNote">GSC 全站七天对比 · 点击下降与关键词跌出排名分别判断</p><div className="siteTrafficTable"><table><thead><tr><th>页面</th><th>上期点击</th><th>本期点击</th><th>平均位置：上期 → 本期</th></tr></thead><tbody>{evidence.search.decliningPages.map(page=><tr key={page.url}><td><a href={page.url} target="_blank" rel="noreferrer">{page.url.replace(/^https?:\/\//, "")}</a></td><td>{page.clicks.previous}</td><td>{page.clicks.current}</td><td>{page.position.previous ?? "—"} → {page.position.current ?? "—"}</td></tr>)}</tbody></table></div></section> : null}
  </>;
}

function WeeklyDiagnosis({ diagnosis }: { diagnosis: WeeklyReportDiagnosis }) {
  if (!diagnosis.significant) return null;
  return <section className="dailyPanel reportDiagnosis compactDiagnosis" aria-label="大幅波动原因排查"><h2>波动原因排查</h2><div>{diagnosis.findings.map((finding, index) => {
    const firstSentence = finding.evidence.split("。")[0];
    const clauses = firstSentence.split("；");
    let excerpt = clauses[0];
    for (const clause of clauses.slice(1)) { if (excerpt.length + clause.length > 100) break; excerpt += `；${clause}`; }
    return <article className={`diagnosisFinding ${finding.level}`} key={`${finding.title}:${finding.url ?? index}`}>
      <div className="diagnosisTitle"><h3>{finding.title}</h3><span>{finding.level === "unresolved" ? "待确认" : finding.level === "issue" ? "需处理" : "已观察"}</span></div>
      <p>{excerpt}。</p>
      <details><summary>依据与下一步</summary>{finding.url ? <a href={finding.url} target="_blank" rel="noreferrer">{finding.url.replace(/^https?:\/\//, "")}</a> : null}<p>{finding.evidence}</p><p className="diagnosisAction">{finding.action}</p>{finding.checkedAt ? <small>检查于 {new Date(finding.checkedAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}</small> : null}</details>
    </article>;
  })}</div></section>;
}

export function TrafficReport() {
  const [week, setWeek] = useState("");
  const { data, error, retry } = useInsights(week);
  const periods = data?.periods ?? (week ? reportPeriods(week) : activeReportPeriods());
  const traffic = data?.traffic;
  const draft = data?.draft;
  const sameDays = draft?.evidence.totals;
  const displayTraffic = sameDays ? {...sameDays,changes:{newUsers:relativeChange(sameDays.current.newUsers,sameDays.previous.newUsers),newRegistrations:relativeChange(sameDays.current.newRegistrations,sameDays.previous.newRegistrations)}} : traffic;
  const history = data?.history ?? [activeReportPeriods().current.start, ...(week ? [week] : [])];
  const funnel = weeklyFunnelMetrics(data?.evidence?.newVisitorFunnel);
  const conversionComparable = Boolean(data?.evidence?.complete && funnel);
  const metrics = [
    { label: "新用户总数", key: "newUsers", format: number, current: displayTraffic?.current?.newUsers, previous: displayTraffic?.previous?.newUsers, change: displayTraffic?.changes.newUsers },
    { label: "注册用户总数（去重）", key: "newRegistrations", format: number, current: displayTraffic?.current?.newRegistrations, previous: displayTraffic?.previous?.newRegistrations, change: displayTraffic?.changes.newRegistrations },
    { label: "新访客注册转化率", key: "conversion", format: pct, current: funnel?.current.rate, previous: funnel?.previous.rate, change: conversionComparable ? funnel?.change : null },
  ];
  return <main className="appShell"><PageHeader active="traffic" />
    <div className="reportIntro"><div className="pageIntro"><h1>流量周报</h1><p>流量、注册与关键词按周期环比 · 每周二更新</p></div><label className="originSelectField"><span>历史周报</span><Select aria-label="历史周报" className="reportWeekSelect" value={week || activeReportPeriods().current.start} onChange={(start) => setWeek(start === activeReportPeriods().current.start ? "" : start)} options={[...new Set(history)].map(start=>({value:start,label:`${start} — ${reportPeriods(start).current.end}${start === activeReportPeriods().current.start ? " · 最新" : ""}`}))} /></label></div>
    <div className="periodComparison"><span><i className="currentDot" />本期 {periods.current.start} — {periods.current.end}</span><span><i />上期 {periods.previous.start} — {periods.previous.end}</span></div>
    {error ? <div className="loadError"><span>{error}</span><button onClick={retry}>重新加载</button></div> : null}
    {draft ? <div className="weeklyRankingState"><strong>本周草稿 · 完整周尚未结束</strong><p>阶段累计：{draft.stageTotals.newUsers.toLocaleString()} 位新用户、{draft.stageTotals.newRegistrations.toLocaleString()} 位注册。采集于{new Date(draft.stageTotals.collectedAt).toLocaleString("zh-CN",{timeZone:"Asia/Shanghai"})}（北京时间）。</p><p>以下图表和原因排查：{draft.comparisonPeriods.current.start}—{draft.comparisonPeriods.current.end} 对比 {draft.comparisonPeriods.previous.start}—{draft.comparisonPeriods.previous.end}，均为已结束的相同星期区间。</p></div> : traffic?.complete === false ? <p className="weeklyRankingState">本期周报尚未开始整理，待确认后更新完整周数据。</p> : null}
    <p className="chartNote reportScope">GA4 · {draft ? "Flatkey · 同星期等长对比" : `三站汇总${data ? ` · 已导入 ${traffic?.currentSites.length ?? 0}/3 个网站` : " · 正在加载…"}`}</p>
    <section className="trafficGrid" aria-label="流量与注册概览">{metrics.map((metric) => {
      const current = metric.current; const previous = metric.previous;
      const maximum = Math.max(current ?? 0, previous ?? 0, 1);
      return <article className="trafficCard" key={metric.key}><h2>{metric.label}</h2><strong>{data ? metric.key === "conversion" && !funnel ? "暂无漏斗数据" : metric.format(current) : "加载中…"}</strong><p className="trafficChange">{draft?"同窗变化":"环比"} {data ? change(metric.change) : "加载中…"}</p>
        <div className="compareBar"><span>本期</span><div><i style={{ width: `${(current ?? 0) / maximum * 100}%` }} /></div><b>{data ? metric.format(current) : "加载中…"}</b></div>
        <div className="compareBar previous"><span>上期</span><div><i style={{ width: `${(previous ?? 0) / maximum * 100}%` }} /></div><b>{data ? metric.format(previous) : "加载中…"}</b></div>
        {metric.key === "conversion" && funnel ? <div className="conversionBasis"><p>Flatkey · 新访客注册人数 / 漏斗新访客</p><p>本期 {funnel.current.registrations.toLocaleString()} / {funnel.current.visitors.toLocaleString()} · 上期 {funnel.previous.registrations.toLocaleString()} / {funnel.previous.visitors.toLocaleString()}</p>{conversionComparable && funnel.ratePoints != null ? <p className={`reportDelta ${funnel.ratePoints > 0 ? "increase" : funnel.ratePoints < 0 ? "decrease" : ""}`}>{funnel.ratePoints > 0 ? "+" : ""}{funnel.ratePoints.toFixed(2)} 个百分点</p> : null}</div> : null}
      </article>;
    })}</section>
    <WeeklyEvidenceTables data={data} />
    <WeeklyKeywordChanges data={data} />
    {data?.diagnosis ? <WeeklyDiagnosis diagnosis={data.diagnosis} /> : null}

  </main>;
}
