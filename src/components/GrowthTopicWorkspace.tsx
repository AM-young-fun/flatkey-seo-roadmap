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
import type { QuarterCalendarDisplay } from "@/lib/growth-quarter-display";
import type { GrowthQuarterPage } from "@/lib/growth-quarter-page";
import type { PublishedKeywordWords } from "@/lib/growth-keyword-inventory";
import { publishedKeywordRankLabels, publishedRankFilters, type PublishedKeywordRank, type PublishedRankFilter } from "@/lib/published-keyword-rank";
import { GrowthTopicDirections } from "./GrowthTopicDirections";
import { GrowthKeywordNetwork } from "./GrowthKeywordNetwork";
import { GrowthQuarterReview } from "./GrowthGoalSummary";
import { GrowthKeywordCatalog } from "./GrowthKeywordCatalog";
import { GrowthQuarterCalendarWorkspace } from "./GrowthQuarterCalendarWorkspace";
import { GrowthHotspotWorkspace } from "./GrowthHotspotWorkspace";
import { BarPlot } from "./OverviewCharts";
import { defaultGrowthScope, growthLink, growthMarketLabel, growthRankKind, growthRankText, parseGrowthKeywordTab, readGrowthScope, selectGrowthTargets, growthRankingEvidence, type GrowthKeywordTab, type GrowthScope } from "./growth-topic-view";
import workspace from "./SeoWorkspace.module.css";
import styles from "./GrowthTopicWorkspace.module.css";
import { SeoAnchor } from "@/components/SeoAnchor";
import type { GrowthReportSnapshot } from "@/lib/growth-strategy";
import { growthContributionMetricNames, growthTopicContributions } from "@/lib/growth-topic-contributions";


const pageStates = { published: "已关联页面", planned: "已规划页面", unmapped: "待关联页面" };
const workStates = { planned: "已规划", scheduled: "已排期", researching: "研究中", in_progress: "制作中", completed: "已有页面记录", unknown: "进度待核" };
const sourceNames = { serp: "SERP实查", database: "域名词库", gsc: "GSC观察" };
const count = (value: number) => value.toLocaleString("zh-CN");
const keywordTabs = [
  { id: "keywords", label: "全部关键词", description: "原词、市场与关联任务" },
  { id: "quarter", label: "季度关键词", description: "固定清单里的待新增词" },
  { id: "hotspots", label: "近期热点词", description: "按话题查看每周新增热点" },
  { id: "published", label: "已有内容与排名", description: "已上线页面、排名与优化线索" },
] as const;
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

export function GrowthTargetTable({ data, targets, scope, topic, selectedTarget, rankWait, publishedRanks }: { data: Pick<GrowthWorkspace, "sites" | "markets" | "topics">; targets: GrowthTarget[]; scope: GrowthScope; topic?: GrowthTopic; selectedTarget?: string | null; rankWait?: string; publishedRanks?: Record<string, PublishedKeywordRank> }) {
  if (!targets.length) return <p className={styles.empty}>当前筛选没有关键词，原始记录仍保留。</p>;
  return <><div className={styles.tableScroll}><table className={styles.table}><thead><tr><th>关键词与市场</th><th>建设进度</th><th>排名证据</th><th>页面与效果</th><th>关联任务</th></tr></thead><tbody>
    {targets.map(target => {
      const actualUrls = target.publishedUrls.map(safeUrl).filter((url): url is string => Boolean(url));
      const publishedRank = publishedRanks?.[target.id];
      const hasRank = !publishedRank || publishedRank === "ranked";
      const plannedUrls = publishedRanks ? [] : target.plannedUrls.map(safeUrl).filter((url): url is string => Boolean(url) && !actualUrls.includes(url!));
      const linkedTopic = data.topics.find(item => item.topicId === target.topicId && item.site === target.site);
      return <tr key={target.id} data-selected={target.id === selectedTarget || undefined} id={`target-${target.id}`}>
        <th scope="row"><strong>{target.keyword}</strong><small>{growthMarketLabel(data, target.country, target.language)}</small>{target.wordLanguage&&!target.language?<small>原词语种 {target.wordLanguage}；目标国家待核</small>:null}{!topic && linkedTopic ? <Link href={growthLink(scope, linkedTopic, target.id)} className={styles.textLink}>{linkedTopic.name} →</Link> : null}<small>{data.sites.find(site => site.domain === target.site)?.name || target.site}</small>{target.aliasKeywordIds?.length?<small>另保留 {target.aliasKeywordIds.length} 个历史同词 ID，未替换当前正式成员</small>:null}</th>
        <td><span className={styles.badge} data-kind={target.pageState}>{pageStates[target.pageState]}</span><small title={target.workStateProof?.reason}>{workStates[target.workState]}</small>{target.workState === "scheduled" && target.workStateProof?.planIds.length ? <small>原计划：{target.workStateProof.planIds.join("、")}</small> : null}{target.membership !== "formal"||target.membershipSource==="committed_task" ? <small>{target.reason}</small> : null}</td>
        <td><span className={styles.rank} data-kind={hasRank ? growthRankKind(target) : undefined}>{publishedRank && publishedRank !== "ranked" ? publishedKeywordRankLabels[publishedRank] : rankWait && !target.rankSource ? rankWait : growthRankText(target)}</span><small>{target.rankSource ? sourceNames[target.rankSource] : target.relatedObservations?.length?"已有同原 ID 观测，目标身份仍待核":rankWait?null:"暂无可归属的排名证据"}{target.checkedAt ? ` · ${new Date(target.checkedAt).toLocaleDateString("zh-CN", { timeZone: "Asia/Shanghai" })}` : ""}</small>{target.languageStatus !== "match" ? <small>{target.languageReason}</small> : null}{hasRank && target.rankUrl && safeUrl(target.rankUrl) ? <SeoAnchor className={styles.textLink} href={safeUrl(target.rankUrl)!} target="_blank" rel="noreferrer">实际排名页 ↗</SeoAnchor> : null}{target.relatedObservations?.length?<div><small>原国家观测（当次查询环境），未授长期主国，不计正式抢占：</small>{target.relatedObservations.slice(0,3).map(observation=>safeUrl(observation.url)?<SeoAnchor key={`${observation.country}:${observation.source}:${observation.url}:${observation.checkedAt}`} className={styles.textLink} href={safeUrl(observation.url)!} target="_blank" rel="noreferrer">{observation.country} · {observation.language||"语种待核"} · {observation.source==="gsc"?"平均位置":"第"} {observation.rank}{observation.source==="gsc"?"":" 名"} · {sourceNames[observation.source]}{observation.checkedAt?` · ${new Date(observation.checkedAt).toLocaleDateString("zh-CN",{timeZone:"Asia/Shanghai"})}`:""} ↗</SeoAnchor>:null)}</div>:null}</td>
        <td>{actualUrls.map(url => <div key={url} className={styles.pageLink}><SeoAnchor href={url} target="_blank" rel="noreferrer">{new URL(url).pathname || "/"} ↗</SeoAnchor><Link href={"/opportunities?" + new URLSearchParams({ view: "analysis", targetUrl: url, site: target.site, ...(target.country ? { country: target.country.toLowerCase() } : {}) })}>页面分析与效果</Link></div>)}
          {plannedUrls.length ? <details className={styles.planned}><summary>{plannedUrls.length} 个规划地址</summary>{plannedUrls.map(url => <span key={url}>{url}</span>)}</details> : null}{!actualUrls.length && !plannedUrls.length ? <small>尚未关联页面</small> : null}</td>
        <td>{target.taskIds.length ? target.taskIds.map(id => { const relation=target.taskRelations?.find(link=>link.taskId===id&&link.status==="confirmed");return <div key={id}><Link className={styles.task} href={`/work/${encodeURIComponent(id)}`}>{id} ↗</Link>{relation?<small>同页原任务 · 原主词：{relation.originalKeyword||"未登记"} · {relation.country} / {relation.language}</small>:null}</div>; }) : <small>尚未确认关联任务</small>}
          {target.taskRelations?.some(link=>link.status==="candidate")?<details className={styles.planned}><summary>同页任务线索（市场待核）</summary><small>仅供复用核对，不授目标市场或执行批准。</small>{[...new Map(target.taskRelations.filter(link=>link.status==="candidate").map(link=>[link.taskId,link])).values()].map(link=><div key={link.taskId}><Link className={styles.task} href={`/work/${encodeURIComponent(link.taskId)}`}>{link.taskId} ↗</Link><small>原主词：{link.originalKeyword||"未登记"} · {link.country||"国家待核"} / {link.language||"语言待核"}</small></div>)}</details>:null}</td>
      </tr>;
    })}
  </tbody></table></div></>;
}

function KeywordInventory({ scope, change, page, setPage }: { scope: GrowthScope; change: (patch: Partial<GrowthScope>) => void; page: number; setPage: (page: number) => void }) {
  const [rank, setRank] = useState<PublishedRankFilter>("all");
  const params = new URLSearchParams({ view: "published-words", page: String(page) });
  if (rank !== "all") params.set("rank", rank);
  if (scope.site !== "all") params.set("site", scope.site);
  if (scope.country !== "all") params.set("country", scope.country);
  if (scope.language !== "all") params.set("language", scope.language);
  if (scope.search.trim()) params.set("q", scope.search.trim().slice(0, 240));
  const { data, previousData, error, retry, retrying } = useSeoRead<PublishedKeywordWords>("/api/seo/growth?" + params, { showFeedback: false, keepPreviousData: true });
  const filters = data ?? previousData;
  const title = "已有内容与排名";
  return <section className={styles.panel} aria-label={title}>
    <div className={styles.sectionHeading}>
      <div><h2>{title}</h2><p>选做页面优化或旧文重写前，先核验原词与已上线页面的搜索意图。</p></div>
      <FeedbackButton className={styles.more} onClick={retry} pending={retrying} pendingLabel="正在刷新…"><RefreshCw size={14} aria-hidden="true" />刷新</FeedbackButton>
    </div>
    {filters ? <div className={styles.inventoryFilters}><GrowthFilters data={filters} scope={scope} change={change} /></div> : null}
    {error ? <p role="alert">关键词暂时无法读取：{error}</p> : !data ? <p role="status">正在读取已存关键词…</p> : <>
      <div className={styles.rankFilter}><label>排名
        <UiSelect aria-label="排名" value={rank} onChange={value => {
          const option = publishedRankFilters.find(option => option.value === value);
          if (option) { setRank(option.value); setPage(1); }
        }} options={publishedRankFilters.map(({ value, label }) => ({ value, label: `${label} · ${count(data.counts[value])}` }))} />
      </label></div>
      <p className={styles.note}>{count(data.pagination.total)} 个关键词</p>
      {data.rows.length ? <div className={styles.tableScroll}><table className={styles.table}>
        <thead><tr><th>关键词</th><th>排名</th><th>已关联页面</th></tr></thead>
        <tbody>{data.rows.map(row => <tr key={row.keyword}>
          <th scope="row">{row.keyword}</th>
          <td>{row.best ? <><strong>第 {row.best.position} 名</strong>
            <small>{growthMarketLabel(data, row.best.country, row.best.language)}{row.best.checkedAt ? ` · ${row.best.checkedAt.slice(0, 10)}` : ""}{row.best.historical ? " · 历史实测" : ""}</small>
          </> : publishedKeywordRankLabels[row.status]}</td>
          <td>{row.urls.map(url => <SeoAnchor key={url} href={url} target="_blank" rel="noreferrer">{url}</SeoAnchor>)}</td>
        </tr>)}</tbody>
      </table></div> : <p className={styles.empty}>当前筛选没有关键词。</p>}
      <SeoTablePagination pagination={data.pagination} onPage={setPage} />
    </>}
  </section>;
}

/** One stable circular point cloud, one point per original word. */
export function GrowthTopicClusters(props: { data: GrowthWorkspace; scope: GrowthScope; targets: GrowthTarget[] }) { return <GrowthKeywordNetwork {...props} />; }

export function GrowthTopicNetwork({ read }: { read: SeoReadState<GrowthWorkspace> }) {
  const { data, error, retry } = read;
  const { scope, change } = useGrowthScope();
  if (error) return <section className={styles.panel}><p role="alert">话题关系图读取失败：{error}</p><button className={styles.more} onClick={retry}>重新读取</button></section>;
  if (!data) return <section className={styles.panel}><p role="status">正在读取话题与目标关键词…</p></section>;
  const targets = selectGrowthTargets(data, scope, undefined, true);
  return <section className={styles.panel}><GrowthFilters data={data} scope={scope} change={change} /><GrowthTopicClusters data={data} scope={scope} targets={targets} /></section>;
}

export function GrowthRankingCoverage({ read }: { read?: SeoReadState<GrowthWorkspace> } = {}) {
  const localRead = useSeoRead<GrowthWorkspace>(read ? null : "/api/seo/growth?view=all-keyword-overview");
  const { data, error, retry } = read ?? localRead;
  const { scope } = useGrowthScope();
  if (error) return <section className={styles.panel}><h2 className={styles.panelTitle}>当前有效关键词排名</h2><p role="alert">排名汇总读取失败：{error}</p><button className={styles.more} onClick={retry}>重新读取</button></section>;
  if (!data) return <section className={styles.panel}><p role="status">正在汇总有效排名…</p></section>;
  if (data.reconciliation.sources.some(source => source.name === "最近14天的已存SERP" && !source.available)) {
    return <section className={styles.panel}><h2 className={styles.panelTitle}>当前有效关键词排名</h2><p role="alert">近期SERP暂时无法读取。</p><button className={styles.more} onClick={retry}>重新读取</button></section>;
  }
  const { summary } = growthRankingEvidence(data, scope, "all");
  const markets = summary.countries.map(market => ({ ...market, label: growthMarketLabel(data, market.country, market.language) }));
  return <section className={styles.panel} aria-label="当前有效关键词排名汇总">
    <div className={styles.sectionHeading}>
      <div><h2>当前有效关键词排名</h2><p>统计全部关键词中已确认的前 100 排名，同一个词只计一次。</p></div>
    </div>
    <BarPlot rows={[{ label: "已获排名关键词", value: summary.total }, { label: "其中前50关键词", value: summary.top50 }]} unit="个原词" showAxis={false} />
    <div className={styles.coverageGrid}><section><h3>有效前100关键词：国家 / 地区占比</h3><BarPlot rows={markets.map(market => ({ label: market.label, value: market.share === null ? null : market.share * 100, suffix: `${market.count}词 · ${market.share === null ? "—" : `${(market.share * 100).toFixed(1)}%`}` }))} unit="%" denominator={`${summary.total}个已证实有效前100原词`} empty="尚无有效排名，国家占比暂不可计算" /></section>
      <section><h3>有效前100关键词：排名区间占比</h3><BarPlot rows={summary.bands.map(band => ({ label: `${band.label} 名`, value: band.share === null ? null : band.share * 100, suffix: `${band.count}词 · ${band.share === null ? "—" : `${(band.share * 100).toFixed(1)}%`}` }))} unit="%" denominator={`${summary.total}个已证实有效前100原词`} empty="尚无有效排名，区间占比暂不可计算" /></section></div>
    {data.reconciliation.sources.some(source => !source.available) ? <p className={styles.note}>部分来源暂未读齐。</p> : null}
  </section>;
}

export function GrowthTopicWorkspace({ topicId, initialTab = "quarter", hotspotTopic, hotspotPage = 1 }: { topicId?: string; initialTab?: GrowthKeywordTab; hotspotTopic?: string; hotspotPage?: number }) {
  const [tab, setTab] = useState(initialTab);
  const [page, setPage] = useState(1);
  const [related, setRelated] = useState(false);
  const [useSelectedTarget, setUseSelectedTarget] = useState(true);
  useEffect(() => {
    const readTab = () => {
      const params = new URLSearchParams(location.search);
      setTab(parseGrowthKeywordTab(params.get("tab")));
    };
    readTab(); addEventListener("popstate", readTab);
    return () => removeEventListener("popstate", readTab);
  }, [initialTab]);
  const changeTab = (value: GrowthKeywordTab) => {
    setTab(value);
    setPage(1);
    const params = new URLSearchParams(location.search);
    params.delete("publishedView");
    if (value === "quarter") params.delete("tab"); else params.set("tab", value);
    history.replaceState(null, "", location.pathname + (params.size ? `?${params}` : ""));
  };
  const published = !topicId && tab === "published";
  const quarterHome = !topicId && tab === "quarter";
  const calendar = useOverviewRead<{ plan: QuarterCalendarDisplay | null }>(quarterHome ? "/api/seo/growth?view=quarter-calendar" : null, 60_000);
  const quarterPlan = quarterHome ? calendar.data?.plan : null;
  const quarter = Boolean(topicId) || quarterHome && !quarterPlan && !calendar.loading && !calendar.error;
  const { scope: savedScope, change: changeScope, selectedTarget } = useGrowthScope();
  const scope = { ...savedScope, membership: "formal" as const };
  const query = new URLSearchParams({ view: "quarter", page: String(page), new: "1" });
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
  const loading = quarterHome && calendar.loading && !calendar.retrying || quarter && read.loading && !read.retrying;
  return <main className={workspace.shell}><PageHeader active="opportunities" marketControl={false} /><div className={styles.content} inert={loading} aria-busy={loading}>
    <div className={styles.heading}><div>{topicId ? <Link className={styles.back} href={growthLink(scope)}><ArrowLeft size={14} aria-hidden="true" />返回话题列表</Link> : null}<h1>{topicId ? topic?.name || "话题详情" : "关键词目标"}</h1><p>{topicId ? "同一话题下按国家、语言查看关键词、页面、任务与排名。" : "以 TopicMap 话题为主线，包含规划中、进行中与已完成目标。"}</p></div>{quarter && (data || read.error || read.retrying) ? <FeedbackButton className={styles.more} onClick={read.retry} pending={read.retrying} pendingLabel="正在刷新…"><RefreshCw size={14} aria-hidden="true" />刷新</FeedbackButton> : null}</div>
    {!topicId && !(tab === "hotspots" && hotspotTopic) ? <div className={styles.keywordTabs} role="group" aria-label="关键词分类">{keywordTabs.map(({ id, label, description }) => <button type="button" key={id} aria-pressed={tab === id} onClick={() => changeTab(id)}><strong>{label}</strong><span>{description}</span></button>)}</div> : null}
    {quarterPlan ? <><GrowthQuarterCalendarWorkspace plan={quarterPlan} /><GrowthQuarterReview /></>
      : quarterHome && calendar.error ? <p role="alert">{calendar.error} <button type="button" onClick={calendar.retry}>重新加载季度排期</button></p>
      : !topicId && tab === "hotspots" ? <GrowthHotspotWorkspace key={hotspotTopic ?? `topics-${hotspotPage}`} topicKey={hotspotTopic} listPage={hotspotPage} />
      : !topicId && tab === "keywords" ? <GrowthKeywordCatalog />
      : published ? <KeywordInventory scope={scope} change={change} page={page} setPage={setPage} /> : <>
    {read.error && !read.retrying ? <div className={styles.panel} role="alert">话题与关键词暂时无法读取：{read.error}</div> : !result || !data ? null : !result.frozen ? <section className={styles.panel}><p>季度词目标尚未冻结。</p><GrowthQuarterReview allowManualOpen /></section> : topicId && !topic ? <div className={styles.panel}>此站点下未找到对应话题。<Link href={growthLink({ ...scope, site: "all" })}>返回全部话题</Link></div> : <>
      <section className={styles.panel}>
        <GrowthFilters data={data} scope={effectiveScope} change={change} fixedSite={Boolean(topic)} />
        <p className={styles.note}>季度冻结清单 {count(result.frozenTotal ?? 0)} 词。当前筛选有 {count(result.stats.total)} 个待新增关键词。已关联上线原页的词可在 <Link href="/opportunities?tab=published" className={styles.textLink}>已有内容与排名</Link> 查看。</p>
        {result.selectedPublished ? <p className={styles.note}><Link className={styles.textLink} href={"/opportunities?" + new URLSearchParams({
          tab: "published", site: result.selectedPublished.site, q: result.selectedPublished.keyword,
          ...(result.selectedPublished.country ? { country: result.selectedPublished.country } : {}),
          ...(result.selectedPublished.language ? { language: result.selectedPublished.language } : {}),
        })}>在已有内容与排名中查看「{result.selectedPublished.keyword}」 →</Link></p> : null}
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
