"use client";

import { useEffect, useState } from "react";
import Link from "./AppLink";
import { ArrowLeft, ArrowUpRight, RefreshCw } from "lucide-react";
import type { GrowthTarget, GrowthTargetRankDetails, GrowthTopic, GrowthWorkspace } from "@/lib/growth-types";
import { PageHeader } from "./PageHeader";
import { UiSelect } from "./UiSelect";
import { useOverviewRead, useSeoRead, type SeoReadState } from "./useSeoAnalytics";
import { FeedbackButton } from "./FeedbackButton";
import { PageLoading } from "./PageLoading";
import { SeoTablePagination } from "./SeoTablePagination";
import type { GrowthQuarterPage } from "@/lib/growth-quarter-page";
import { GrowthTopicDirections } from "./GrowthTopicDirections";
import { GrowthKeywordNetwork } from "./GrowthKeywordNetwork";
import { GrowthQuarterReview } from "./GrowthGoalSummary";
import { GrowthHotspotWorkspace } from "./GrowthHotspotWorkspace";
import { BarPlot } from "./OverviewCharts";
import { defaultGrowthScope, growthCounts, growthLink, growthMarketLabel, growthRankKind, growthRankText, readGrowthScope, selectGrowthTargets, growthRankingEvidence, quarterTargetWorkspace, type GrowthRankingView, type GrowthScope } from "./growth-topic-view";
import workspace from "./SeoWorkspace.module.css";
import styles from "./GrowthTopicWorkspace.module.css";
import { SeoAnchor } from "@/components/SeoAnchor";
import type { GrowthReportSnapshot } from "@/lib/growth-strategy";
import { growthContributionMetricNames, growthTopicContributions } from "@/lib/growth-topic-contributions";


const pageStates = { published: "已关联页面", planned: "已规划页面", unmapped: "待关联页面" };
const workStates = { planned: "已规划", scheduled: "已排期", researching: "研究中", in_progress: "制作中", completed: "已有页面记录", unknown: "进度待核" };
const sourceNames = { serp: "SERP实查", database: "域名词库", gsc: "GSC观察" };
const count = (value: number) => value.toLocaleString("zh-CN");
function safeUrl(value: string): string | null { try { const url = new URL(value); return url.protocol === "https:" ? url.href : null; } catch { return null; } }

export function GrowthTopicContributionCells({ snapshot, topic, scope }: { snapshot: GrowthReportSnapshot | null; topic: GrowthTopic; scope: GrowthScope }) {
  const rows = growthTopicContributions(snapshot, topic, scope);
  return <><td>{rows.length ? rows.map(row => <div key={JSON.stringify([row.metric, row.country, row.language, row.window])}>
    <strong>{growthContributionMetricNames[row.metric]}：{count(row.previous)} → {count(row.current)}（{row.current - row.previous >= 0 ? "+" : ""}{count(row.current - row.previous)}）</strong>
    <small>{row.country} / {row.language} · {row.source} · {row.window.start}—{row.window.end}</small>
    <details><summary>{row.urls.length} 个实际页面贡献</summary><small>对比 {row.window.previousStart}—{row.window.previousEnd} · {row.window.timezone}</small>{row.urls.map(url => <SeoAnchor key={url} href={url} target="_blank" rel="noreferrer">{url}</SeoAnchor>)}</details>
  </div>) : <small>暂无同窗口页面贡献证据</small>}</td><td><span>暂无可核归因</span><small>注册及首次付费缺同话题、同批用户来源；未用全站数字分摊或填0。</small></td></>;
}

function useGrowthScope() {
  const [scope, setScope] = useState<GrowthScope>(defaultGrowthScope);
  const [selectedTarget, setSelectedTarget] = useState<string | null>(null);
  useEffect(() => {
    const read = () => { const params = new URLSearchParams(location.search); setScope(readGrowthScope(params)); setSelectedTarget(params.get("target")); };
    read(); addEventListener("popstate", read); return () => removeEventListener("popstate", read);
  }, []);
  const change = (patch: Partial<GrowthScope>) => {
    const next = { ...scope, ...patch };
    setScope(next);
    const params = new URLSearchParams(location.search);
    const nextParams = new URLSearchParams(growthLink(next).split("?")[1] || "");
    for (const key of ["site", "country", "language", "pool", "q", "target"]) {
      const value = nextParams.get(key); if (value) params.set(key, value); else params.delete(key);
    }
    history.replaceState(null, "", location.pathname + (params.size ? `?${params}` : ""));
    dispatchEvent(new PopStateEvent("popstate"));
  };
  return { scope, change, selectedTarget };
}

function GrowthFilters({ data, scope, change, fixedSite }: { data: Pick<GrowthWorkspace, "sites" | "markets">; scope: GrowthScope; change: (patch: Partial<GrowthScope>) => void; fixedSite?: boolean }) {
  const countries = [...new Set(data.markets.map(market => market.country))];
  const languages = [...new Set(data.markets.filter(market => scope.country === "all" || market.country === scope.country).map(market => market.language))];
  return <div className={styles.filters}>
    {!fixedSite ? <label>站点<UiSelect aria-label="规划站点" value={scope.site} onChange={site => change({ site })} options={[{ value: "all", label: "全部规划站点" }, ...data.sites.filter(site => site.keywordGoals).map(site => ({ value: site.domain, label: site.name }))]} /></label> : null}
    <label>国家 / 地区<UiSelect aria-label="目标国家或地区" value={scope.country} onChange={country => change({ country, language: "all" })} options={[{ value: "all", label: "全部国家 / 地区" }, ...countries.map(country => ({ value: country, label: data.markets.find(market => market.country === country)?.label.split(" · ")[0] || country }))]} /></label>
    <label>关键词语言<UiSelect aria-label="关键词语言" value={scope.language} onChange={language => change({ language })} options={[{ value: "all", label: "全部语言" }, ...languages.map(language => ({ value: language, label: data.markets.find(market => market.language === language)?.label.split(" · ").slice(1).join(" · ") || language }))]} /></label>
    <label className={styles.search}>搜索话题或关键词<input aria-label="搜索话题或关键词" value={scope.search} onChange={event => change({ search: event.target.value })} placeholder="按话题方向、关键词查找" /></label>
  </div>;
}

function Summary({ stats, rankAvailable }: { stats: ReturnType<typeof growthCounts>; rankAvailable: boolean }) {
  return <div className={styles.stats}>{[["目标关键词", stats.total], ["已关联页面目标", stats.built], [stats.unknown ? "已证实前100（部分）" : "有效前100", rankAvailable ? stats.ranked : "待核"], ["其中前50", rankAvailable ? stats.top50 : "待核"]].map(([label, value]) => <div key={label}><span>{label}</span><strong>{typeof value === "number" ? count(value) : value}</strong></div>)}</div>;
}

export function GrowthTargetTable({ data, targets, scope, topic, selectedTarget, rankWait }: { data: Pick<GrowthWorkspace, "sites" | "markets" | "topics">; targets: GrowthTarget[]; scope: GrowthScope; topic?: GrowthTopic; selectedTarget?: string | null; rankWait?: string }) {
  if (!targets.length) return <p className={styles.empty}>当前筛选没有关键词，原始记录仍保留。</p>;
  return <><div className={styles.tableScroll}><table className={styles.table}><thead><tr><th>关键词与市场</th><th>建设进度</th><th>排名证据</th><th>页面与效果</th><th>关联任务</th></tr></thead><tbody>
    {targets.map(target => {
      const actualUrls = target.publishedUrls.map(safeUrl).filter((url): url is string => Boolean(url));
      const plannedUrls = target.plannedUrls.map(safeUrl).filter((url): url is string => Boolean(url) && !actualUrls.includes(url!));
      const linkedTopic = data.topics.find(item => item.topicId === target.topicId && item.site === target.site);
      return <tr key={target.id} data-selected={target.id === selectedTarget || undefined} id={`target-${target.id}`}>
        <th scope="row"><strong>{target.keyword}</strong><small>{growthMarketLabel(data, target.country, target.language)}</small>{target.wordLanguage&&!target.language?<small>原词语种 {target.wordLanguage}；目标国家待核</small>:null}{!topic && linkedTopic ? <Link href={growthLink(scope, linkedTopic, target.id)} className={styles.textLink}>{linkedTopic.name} →</Link> : null}<small>{data.sites.find(site => site.domain === target.site)?.name || target.site}</small>{target.aliasKeywordIds?.length?<small>另保留 {target.aliasKeywordIds.length} 个历史同词 ID，未替换当前正式成员</small>:null}</th>
        <td><span className={styles.badge} data-kind={target.pageState}>{pageStates[target.pageState]}</span><small title={target.workStateProof?.reason}>{workStates[target.workState]}</small>{target.workState === "scheduled" && target.workStateProof?.planIds.length ? <small>原计划：{target.workStateProof.planIds.join("、")}</small> : null}{target.membership !== "formal"||target.membershipSource==="committed_task" ? <small>{target.reason}</small> : null}</td>
        <td><span className={styles.rank} data-kind={growthRankKind(target)}>{rankWait && !target.rankSource ? rankWait : growthRankText(target)}</span><small>{target.rankSource ? sourceNames[target.rankSource] : target.relatedObservations?.length?"已有同原 ID 观测，目标身份仍待核":rankWait?null:"暂无可归属的排名证据"}{target.checkedAt ? ` · ${new Date(target.checkedAt).toLocaleDateString("zh-CN", { timeZone: "Asia/Shanghai" })}` : ""}</small>{target.languageStatus !== "match" ? <small>{target.languageReason}</small> : null}{target.rankUrl && safeUrl(target.rankUrl) ? <SeoAnchor className={styles.textLink} href={safeUrl(target.rankUrl)!} target="_blank" rel="noreferrer">实际排名页 ↗</SeoAnchor> : null}{target.relatedObservations?.length?<div><small>原国家观测（当次查询环境），未授长期主国，不计正式抢占：</small>{target.relatedObservations.slice(0,3).map(observation=>safeUrl(observation.url)?<SeoAnchor key={`${observation.country}:${observation.source}:${observation.url}:${observation.checkedAt}`} className={styles.textLink} href={safeUrl(observation.url)!} target="_blank" rel="noreferrer">{observation.country} · {observation.language||"语种待核"} · {observation.source==="gsc"?"平均位置":"第"} {observation.rank}{observation.source==="gsc"?"":" 名"} · {sourceNames[observation.source]}{observation.checkedAt?` · ${new Date(observation.checkedAt).toLocaleDateString("zh-CN",{timeZone:"Asia/Shanghai"})}`:""} ↗</SeoAnchor>:null)}</div>:null}</td>
        <td>{actualUrls.map(url => <div key={url} className={styles.pageLink}><SeoAnchor href={url} target="_blank" rel="noreferrer">{new URL(url).pathname || "/"} ↗</SeoAnchor><Link href={"/opportunities?" + new URLSearchParams({ view: "analysis", targetUrl: url, site: target.site, ...(target.country ? { country: target.country.toLowerCase() } : {}) })}>页面分析与效果</Link></div>)}
          {plannedUrls.length ? <details className={styles.planned}><summary>{plannedUrls.length} 个规划地址</summary>{plannedUrls.map(url => <span key={url}>{url}</span>)}</details> : null}{!actualUrls.length && !plannedUrls.length ? <small>尚未关联页面</small> : null}</td>
        <td>{target.taskIds.length ? target.taskIds.map(id => { const relation=target.taskRelations?.find(link=>link.taskId===id&&link.status==="confirmed");return <div key={id}><Link className={styles.task} href={`/work/${encodeURIComponent(id)}`}>{id} ↗</Link>{relation?<small>同页原任务 · 原主词：{relation.originalKeyword||"未登记"} · {relation.country} / {relation.language}</small>:null}</div>; }) : <small>尚未确认关联任务</small>}
          {target.taskRelations?.some(link=>link.status==="candidate")?<details className={styles.planned}><summary>同页任务线索（市场待核）</summary><small>仅供复用核对，不授目标市场或执行批准。</small>{[...new Map(target.taskRelations.filter(link=>link.status==="candidate").map(link=>[link.taskId,link])).values()].map(link=><div key={link.taskId}><Link className={styles.task} href={`/work/${encodeURIComponent(link.taskId)}`}>{link.taskId} ↗</Link><small>原主词：{link.originalKeyword||"未登记"} · {link.country||"国家待核"} / {link.language||"语言待核"}</small></div>)}</details>:null}</td>
      </tr>;
    })}
  </tbody></table></div></>;
}

/** One stable circular point cloud, one point per original word. */
export function GrowthTopicClusters(props: { data: GrowthWorkspace; scope: GrowthScope; targets: GrowthTarget[] }) { return <GrowthKeywordNetwork {...props} />; }

export function GrowthTopicNetwork({ read }: { read: SeoReadState<GrowthWorkspace> }) {
  const { error, retry } = read, data = read.data ? quarterTargetWorkspace(read.data) : null;
  const { scope: savedScope, change: changeScope } = useGrowthScope();
  const scope = { ...savedScope, membership: "formal" as const };
  const change = (patch: Partial<GrowthScope>) => changeScope({ ...patch, membership: "formal" });
  if (error) return <section className={styles.panel}><p role="alert">话题关系图读取失败：{error}</p><button className={styles.more} onClick={retry}>重新读取</button></section>;
  if (!data) return <section className={styles.panel}><p role="status">正在读取话题与目标关键词…</p></section>;
  if (!data.quarter) return <section className={styles.panel}><p role="status">季度1600词清单尚未审核冻结，话题关系图待清单核定后展示。</p></section>;
  const targets = selectGrowthTargets(data, scope);
  return <section className={styles.panel}><GrowthFilters data={data} scope={scope} change={change} /><GrowthTopicClusters data={data} scope={scope} targets={targets} />
    <p className={styles.note}>{data.reconciliation.sources.some(source => source.name === "最近14天的已存SERP" && !source.available) ? "近期SERP暂时无法读取。" : "关系图使用最近14天的SERP。"}历史排名与其他来源可在关键词详情查看。</p>
    <Link className={styles.textLink} href={growthLink(scope)}>打开话题与关键词目标 →</Link></section>;
}

export function GrowthRankingCoverage({ initialView = "all", read }: { initialView?: GrowthRankingView; read?: SeoReadState<GrowthWorkspace> } = {}) {
  const localRead = useSeoRead<GrowthWorkspace>(read ? null : "/api/seo/growth");
  const { data, error, retry } = read ?? localRead;
  const { scope } = useGrowthScope();
  const [view, setView] = useState<GrowthRankingView>(initialView);
  if (error) return <section className={styles.panel}><h2 className={styles.panelTitle}>当前有效关键词排名</h2><p role="alert">排名汇总读取失败：{error}</p><button className={styles.more} onClick={retry}>重新读取</button></section>;
  if (!data) return <section className={styles.panel}><p role="status">正在汇总有效实测与正式目标…</p></section>;
  if (data.reconciliation.sources.some(source => source.name === "最近14天的已存SERP" && !source.available)) {
    return <section className={styles.panel}><h2 className={styles.panelTitle}>当前有效关键词排名</h2><p role="alert">近期SERP暂时无法读取。</p><button className={styles.more} onClick={retry}>重新读取</button></section>;
  }
  const formalScope = { ...scope, membership: "formal" as const, search: "" };
  const { targets, ranked, summary } = growthRankingEvidence(view === "formal" ? quarterTargetWorkspace(data) : data, scope, view);
  const stats = growthCounts(targets);
  const markets = summary.countries.map(market => ({ ...market, label: growthMarketLabel(data, market.country, market.language) }));
  return <section className={styles.panel} aria-label="当前有效关键词排名汇总">
    <div className={`${styles.sectionHeading} ${styles.rankingHeading}`}>
      <div><h2>当前有效关键词排名</h2><p>{view === "all" ? "各站已保存的有效排名实测，同一关键词只计一次；季度目标在对应话题清单中单独跟进。" : "当前正式TopicMap目标，各建设阶段均保留在N中。"}</p></div>
      <div className={styles.rankingActions}>
        <div className={styles.rankingSegments} role="group" aria-label="排名统计范围">
          <button type="button" aria-pressed={view === "all"} onClick={() => setView("all")}>全部有效实测</button>
          <button type="button" aria-pressed={view === "formal"} onClick={() => setView("formal")}>正式目标实测</button>
        </div>
        <Link className={styles.textLink} href={growthLink(formalScope)}>查看话题与关键词 <span aria-hidden="true">→</span></Link>
      </div>
    </div>
    <BarPlot rows={view === "formal" ? [{ label: "当前季度成员 N", value: stats.total }, { label: "已证实前100 R", value: ranked.length }, { label: "其中前50 F", value: stats.top50 }] : [{ label: "已获排名关键词", value: summary.total }, { label: "其中前50关键词", value: summary.top50 }, { label: "其中正式目标词", value: summary.formalWords }]} unit="个原词" denominator={`同词跨国、跨站只计一次；汇总时点 ${data.generatedAt}`} />
    {view === "formal" ? <p className={styles.note}>当前正式目标记录 R/N：{ranked.length} / {stats.total}{stats.total ? `（${(ranked.length / stats.total * 100).toFixed(1)}%）` : "（分母为空，暂不可计算）"}。未知目标留N，未计R。</p> : null}
    <p className={styles.note}>{count(summary.total)} 个当前有效原词，同词跨国、跨站只计一次。仅在关键词语种匹配的真实观测中择最佳排名，保留该观测原国家和页面；国家与区间占比均以这 {count(summary.total)} 个词为分母，无有效词时不计算百分比。</p>
    <div className={styles.coverageGrid}><section><h3>有效前100关键词：国家 / 地区占比</h3><BarPlot rows={markets.map(market => ({ label: market.label, value: market.share === null ? null : market.share * 100, suffix: `${market.count}词 · ${market.share === null ? "—" : `${(market.share * 100).toFixed(1)}%`}` }))} unit="%" denominator={`${summary.total}个已证实有效前100原词`} empty="尚无有效排名，国家占比暂不可计算" /></section>
      <section><h3>有效前100关键词：排名区间占比</h3><BarPlot rows={summary.bands.map(band => ({ label: `${band.label} 名`, value: band.share === null ? null : band.share * 100, suffix: `${band.count}词 · ${band.share === null ? "—" : `${(band.share * 100).toFixed(1)}%`}` }))} unit="%" denominator={`${summary.total}个已证实有效前100原词`} empty="尚无有效排名，区间占比暂不可计算" /></section></div>
    <p className={styles.note}>统计采用 14 天内原词、原国家及语种匹配的完整 SERP。数据库、GSC、过期及待核名次均不计入当前数或季度 R。{data.reconciliation.sources.some(source => !source.available) ? "部分来源未读齐，当前为已有有效证据范围。" : ""}</p>
  </section>;
}

export function GrowthTopicWorkspace({ topicId, initialTab = "quarter" }: { topicId?: string; initialTab?: "quarter" | "hotspots" }) {
  const [tab, setTab] = useState<"quarter" | "hotspots">(initialTab);
  const [page, setPage] = useState(1);
  const [related, setRelated] = useState(false);
  const [useSelectedTarget, setUseSelectedTarget] = useState(true);
  useEffect(() => { const readTab = () => setTab(new URLSearchParams(location.search).get("tab") === "hotspots" ? "hotspots" : "quarter"); readTab(); addEventListener("popstate", readTab); return () => removeEventListener("popstate", readTab); }, []);
  const changeTab = (value: "quarter" | "hotspots") => { setTab(value); const params = new URLSearchParams(location.search); if (value === "hotspots") params.set("tab", value); else params.delete("tab"); history.replaceState(null, "", location.pathname + (params.size ? `?${params}` : "")); };
  const quarter = Boolean(topicId) || tab === "quarter";
  const { scope: savedScope, change: changeScope, selectedTarget } = useGrowthScope();
  const scope = { ...savedScope, membership: "formal" as const };
  const query = new URLSearchParams({ view: "quarter", page: String(page) });
  if (topicId) query.set("topic", topicId);
  if (scope.site !== "all") query.set("site", scope.site);
  if (scope.country !== "all") query.set("country", scope.country);
  if (scope.language !== "all") query.set("language", scope.language);
  if (scope.search.trim()) query.set("q", scope.search.trim().slice(0, 240));
  if (related) query.set("related", "1");
  if (useSelectedTarget && selectedTarget) query.set("target", selectedTarget);
  const read = useOverviewRead<GrowthQuarterPage>(quarter ? "/api/seo/growth?" + query : null);
  const strategy = useOverviewRead<{ snapshot: GrowthReportSnapshot }>(!topicId && quarter ? "/api/seo/growth/strategy?view=dashboard" : null);
  const result = read.data;
  const data = result?.data;
  const topic = result?.topic;
  const evidenceQuery = new URLSearchParams(query);
  evidenceQuery.set("view", "quarter-evidence");
  const evidence = useOverviewRead<{ targets: GrowthTargetRankDetails[]; partial: boolean }>(topic && data?.targets.length ? "/api/seo/growth?" + evidenceQuery : null);
  const rankedTargets = new Map(evidence.data?.targets.map(row => [row.id, row]));
  const rankWait = evidence.error || evidence.data?.partial ? "部分排名来源待核" : evidence.loading ? "正在读取已存排名" : undefined;
  const effectiveScope = result?.scope ?? scope;
  const change = (patch: Partial<GrowthScope>) => {
    setPage(1); setUseSelectedTarget(false); setRelated(false);
    changeScope({ ...patch, membership: "formal" });
  };
  const turnPage = (next: number) => {
    setUseSelectedTarget(false); setRelated(Boolean(result?.showRelated)); setPage(next);
  };
  const loading = quarter && read.loading && !read.retrying;
  return <main className={workspace.shell}><PageHeader active="opportunities" marketControl={false} /><div className={styles.content} inert={loading} aria-busy={loading}>
    <div className={styles.heading}><div>{topicId ? <Link className={styles.back} href={growthLink(scope)}><ArrowLeft size={14} aria-hidden="true" />返回话题列表</Link> : null}<h1>{topicId ? topic?.name || "话题详情" : "关键词目标"}</h1><p>{topicId ? "同一话题下按国家、语言查看关键词、页面、任务与排名。" : "以 TopicMap 话题为主线，包含规划中、进行中与已完成目标。"}</p></div>{quarter && (data || read.error || read.retrying) ? <FeedbackButton className={styles.more} onClick={read.retry} pending={read.retrying} pendingLabel="正在刷新…"><RefreshCw size={14} aria-hidden="true" />刷新</FeedbackButton> : null}</div>
    {!topicId ? <div className={styles.tabs} role="group" aria-label="关键词目标范围"><button type="button" aria-pressed={tab === "quarter"} onClick={() => changeTab("quarter")}>季度关键词 <span>1600 · 固定</span></button><button type="button" aria-pressed={tab === "hotspots"} onClick={() => changeTab("hotspots")}>近期热点词 <span>动态</span></button></div> : null}
    {!topicId && tab === "hotspots" ? <GrowthHotspotWorkspace /> : <>
    {read.error && !read.retrying ? <div className={styles.panel} role="alert">话题与关键词暂时无法读取：{read.error}</div> : !result || !data ? null : !result.frozen ? <section className={styles.panel}><p>季度1600词目标尚未完成冻结。</p><GrowthQuarterReview /></section> : topicId && !topic ? <div className={styles.panel}>此站点下未找到对应话题。<Link href={growthLink({ ...scope, site: "all" })}>返回全部话题</Link></div> : <>
      <section className={styles.panel}>
        <GrowthFilters data={data} scope={effectiveScope} change={change} fixedSite={Boolean(topic)} />
        <Summary stats={result.stats} rankAvailable={result.rankAvailable} />
        {topic ? <>
          <div className={styles.marketSlices}>{result.markets.map(market => <button type="button" key={`${market.country}:${market.language}`} onClick={() => change({ country: market.country || "all", language: market.language || "all" })} aria-pressed={scope.country === market.country && scope.language === market.language}>{growthMarketLabel(data, market.country, market.language)}<span>{market.total} 目标 · {result.rankAvailable ? `${market.ranked} 前100` : "排名待核"}</span></button>)}</div>
          <p className={styles.note}>主归属目标 {result.ownTotal} 个，含子话题 {result.stats.total} 个。</p>
          {result.relatedTotal > 0 ? <div className={styles.tabs} role="group" aria-label="关键词归属">
            <button type="button" aria-pressed={!result.showRelated} onClick={() => { setUseSelectedTarget(false); setRelated(false); setPage(1); }}>本话题</button>
            <button type="button" aria-pressed={result.showRelated} onClick={() => { setUseSelectedTarget(false); setRelated(true); setPage(1); }}>关联关键词 {result.relatedTotal}</button>
          </div> : null}
          {evidence.error || evidence.data?.partial ? <p className={styles.note} role="status">部分已存排名读取失败。<button type="button" onClick={evidence.retry}>重读排名证据</button></p> : null}
          <GrowthTargetTable data={data} targets={data.targets.map(row => ({ ...row, ...rankedTargets.get(row.id) }))} scope={effectiveScope} topic={result.showRelated ? undefined : topic} selectedTarget={selectedTarget} rankWait={rankWait} />
        </> : result.topicRows.length ? <div className={styles.tableScroll}><table className={styles.table}><thead><tr><th>话题方向</th><th>站点 / 市场</th><th>主归属目标</th><th>关联页面（含子话题）</th><th>前100 / 前50（含子话题）</th><th>同窗口流量贡献（本话题）</th><th>注册 / 首次付费归因</th></tr></thead><tbody>
          {result.topicRows.map(({ topic: item, stats, ownCount, marketCount, relatedTotal }) => <tr key={item.id}>
            <th scope="row"><Link className={styles.topicName} href={growthLink(effectiveScope, item)}>{item.name}<ArrowUpRight size={14} aria-hidden="true" /></Link>{item.parentIds.length ? <small>关联 {item.parentIds.length} 个上级话题</small> : null}{relatedTotal ? <small>另有关联浏览 {relatedTotal} 词，不计主归属</small> : null}</th>
            <td>{data.sites.find(site => site.domain === item.site)?.name || item.site}<small>{marketCount} 个市场语言组合</small></td>
            <td>{count(ownCount)}{ownCount !== stats.total ? <small>含子话题 {count(stats.total)}</small> : null}</td><td>{count(stats.built)}</td><td>{result.rankAvailable ? `${count(stats.ranked)} / ${count(stats.top50)}` : "待核"}</td>
            <GrowthTopicContributionCells snapshot={strategy.data?.snapshot ?? null} topic={item} scope={effectiveScope} />
          </tr>)}
        </tbody></table></div> : <p className={styles.empty}>当前筛选没有季度话题。</p>}
        <SeoTablePagination pagination={result.pagination} onPage={turnPage} />
      </section>
      {topic ? <GrowthTopicDirections site={topic.site} topicId={topic.topicId} country={effectiveScope.country} language={effectiveScope.language} /> : null}
      {!topic ? <GrowthQuarterReview /> : null}
      <div className={styles.related}><Link href="/">总览与业务词库关系图</Link><Link href="/work">工作任务</Link><Link href="/reports?period=weekly">历史周报</Link></div>
    </>}
    </>}
  </div>{loading && <PageLoading />}</main>;
}
