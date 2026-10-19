"use client";
import { useEffect, useMemo, useState, type Key } from "react";
import { Table, Tooltip, Select, Tag } from "antd";
import type { ColumnsType } from "antd/es/table";
import { Search, RotateCcw } from "lucide-react";
import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { useKeywordOkr } from "@/components/useKeywordOkr";
import { SITES } from "@/components/useSeoSelection";
import { useDashboard } from "@/components/useDashboard";
import type { DashboardKeyword, RankingEvidence, RankingPageEvidence, RankSummary } from "@/lib/types";
import { REGIONS, REGION_CODES, type SearchRegionCode } from "@/lib/seo";
import { dashboardStore } from "@/lib/dashboard-client";
import { clientReadCache, ClientReadError } from "@/lib/client-read-cache";
import type { DashboardResponse } from "@/lib/types";
import { keywordEvidence } from "@/lib/keyword-evidence";
import { keywordRelevance, normalizeKeywordText } from "@/lib/keyword-relevance";
import type { KeywordPool } from "@/lib/keyword-okr";
import { keywordPageTag, keywordRankingTag, keywordRankingResultTag } from "@/lib/keyword-status-tags";
import { keywordRankingPages } from "@/lib/keyword-ranking-pages";
import { bestKeywordDetailRank, detailRegions, groupKeywordDetails, keywordDetailBestPosition, keywordDetailCountryRanks, validKeywordDetailRank,
  type KeywordCountryScope, type KeywordDetailGroup } from "@/lib/keyword-details-group";

const POOLS = { FORMAL: "业务目标", RESEARCH: "候选研究" };
const PAGE_FILTERS = [{ value: "PAGE_BUILD", label: "待建设" }, { value: "PAGE_EXPAND", label: "待优化" }];
const number = (value: number | null | undefined) => value == null ? "—" : value.toLocaleString("zh-CN");
const position = (value: number | null) => value == null ? "—" : Number(value.toFixed(2)).toString();
const localDate = (value: string | null | undefined) => value ? new Date(value).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" }) : "来源日期未提供";
const siteName = (member: DashboardKeyword) => member.siteName ?? member.siteDomain ?? "Flatkey";
const rankFor = (member: DashboardKeyword, region: SearchRegionCode) => member.latestRanks[region]?.source === "dataforseo_serp" ? member.latestRanks[region] : null;
function rankMovement(rank: RankSummary | null) {
  const labels = { UP: `↑ 上升 ${rank?.rankDelta ?? ""} 位`, DOWN: `↓ 下降 ${Math.abs(rank?.rankDelta ?? 0)} 位`, UNCHANGED: "持平", NEW_IN_TOP100: "新进前100", DROPPED_OUT: "跌出前100", FIRST_CHECK: "首次实测", NOT_COMPARABLE: "暂无可比结果" };
  return rank?.movement ? labels[rank.movement] : "—";
}
function TargetPages({ urls }: { urls: string[] }) {
  const link = (url: string) => <a className="observedUrl" href={url} title={url} target="_blank" rel="noreferrer" key={url}>{url.replace(/^https?:\/\//, "")}</a>;
  return <>{urls.slice(0, 2).map(link)}{urls.length > 2 ? <details className="simpleExplanation" style={{ margin: 0 }}><summary>展开其余 {urls.length - 2} 个目标页面</summary><div className="evidenceSummary">{urls.slice(2).map(link)}</div></details> : null}</>;
}
type DetailPage = RankingPageEvidence & { region: SearchRegionCode; siteName: string; memberId: string };
function ObservedPages({ pages, compact = false }: { pages: DetailPage[]; compact?: boolean }) {
  const visible = compact ? pages.slice(0, 1) : pages;
  return <div className="rankingPageList">{visible.map(page => <div className="rankingPageRecord" key={`${page.memberId}:${page.region}:${page.url}`}>
    <a className="observedUrl" href={page.url} title={page.url} target="_blank" rel="noreferrer">{page.url.replace(/^https?:\/\//, "")}</a>
    <strong>{REGIONS[page.region].label} · {page.siteName} · #{position(page.rank)}</strong><small>{localDate(page.checkedAt)}</small>
  </div>)}{compact && pages.length > 1 ? <details className="simpleExplanation" style={{ margin: 0 }}><summary>其余 {pages.length - 1} 条页面排名</summary><ObservedPages pages={pages.slice(1)} /></details> : null}</div>;
}
function coverage(rank: RankSummary) {
  return rank.rankStatus === "query_changed" ? `Google改搜：${rank.correctedKeyword ?? "未提供"}` : rank.rankStatus === "not_found_capture"
    ? `${rank.coveredThroughRank ? `已检查前${rank.coveredThroughRank}个自然名次` : `本次返回${rank.organicCount ?? 0}条自然结果`}，未命中本站`
    : rank.depthIncomplete ? `已核实名次，本次返回${rank.organicCount ?? "部分"}条自然结果` : "";
}
function HistoryEvidence({ evidence, region }: { evidence: RankingEvidence; region: SearchRegionCode }) {
  return <section><strong>{REGIONS[region].label} · {evidence.source === "gsc" ? "GSC历史记录" : evidence.source === "dataforseo_labs" ? "Labs历史记录" : "Ahrefs历史记录"}</strong>
    <p>{evidence.periodStart && evidence.periodEnd ? `${evidence.periodStart} 至 ${evidence.periodEnd}` : evidence.dataDate ?? "来源日期未提供"} · 采集于 {localDate(evidence.checkedAt)}</p>
    {evidence.pages.length ? <ul>{evidence.pages.map(page => <li key={page.url}><a href={page.url} target="_blank" rel="noreferrer">{page.url}</a> · {evidence.source === "gsc" ? "平均位置" : "历史名次"} {position(page.rank)} · {localDate(page.checkedAt)}{evidence.source === "gsc" ? ` · 曝光 ${number(page.impressions)} · 点击 ${number(page.clicks)}` : ""}</li>)}</ul> : <p>{evidence.url ? <>来源页面：<a href={evidence.url} target="_blank" rel="noreferrer">{evidence.url}</a></> : "来源未提供独立页面记录"}</p>}
    {evidence.daily?.length ? <table className="dailyEvidenceTable"><thead><tr><th>日期</th><th>曝光</th><th>点击</th><th>当日平均位置</th><th>页面</th></tr></thead><tbody>{evidence.daily.map(day => <tr key={`${day.date}:${day.url ?? "query"}`}><td>{day.date}</td><td>{number(day.impressions)}</td><td>{number(day.clicks)}</td><td>{position(day.rank)}</td><td>{day.pages.map(page => <div key={page.url}><a href={page.url} target="_blank" rel="noreferrer">{page.url}</a> · 均值 {position(page.rank)}</div>)}{!day.pages.length && day.url ? <a href={day.url} target="_blank" rel="noreferrer">{day.url}</a> : null}</td></tr>)}</tbody></table> : null}
  </section>;
}

function KeywordHistory({ member, region }: { member: DashboardKeyword; region: SearchRegionCode }) {
  const [history, setHistory] = useState<RankingEvidence[] | null>(null), [error, setError] = useState<string | null>(null), [busy, setBusy] = useState(false);
  const read = async () => {
    if (busy || history) return;
    setBusy(true); setError(null);
    try {
      const site = member.siteDomain ?? "flatkey.ai", id = member.id.startsWith(`${site}:`) ? member.id.slice(site.length + 1) : member.id;
      const data = await clientReadCache.read<DashboardResponse>(`/api/dashboard?${new URLSearchParams({site, source:"dataforseo_serp", includeResearch:"1", keywordId:id})}`);
      setHistory(data.keywords.find(row => row.id === id)?.rankingEvidence?.[region]?.filter(item => item.source !== "dataforseo_serp") ?? []);
    } catch (failure) {
      if (failure instanceof ClientReadError && failure.status === 401) { clientReadCache.clear(); window.location.assign("/login"); return; }
      setError("历史参考暂时无法读取");
    } finally { setBusy(false); }
  };
  return <details className="historicalEvidence" onToggle={event => { if (event.currentTarget.open) void read(); }}><summary>历史参考{history ? `（${history.length} 条）` : ""}</summary>
    {error ? <div className="loadError"><span>{error}</span><button onClick={() => void read()}>重试</button></div> : busy ? <p className="chartNote">正在读取该词的历史参考…</p> : history?.length ? <><p className="chartNote">历史来源不参与主表排名与区间筛选。</p>{history.map((evidence,index) => <HistoryEvidence evidence={evidence} region={region} key={`${evidence.source}:${index}`} />)}</> : <p className="chartNote">暂无历史参考。</p>}
  </details>;
}

export function KeywordDetails() {
  const [view, setView] = useState("FORMAL"), [pool, setPool] = useState<KeywordPool>("FORMAL"), [mapping, setMapping] = useState("ALL");
  const { data, error, loading, refreshing, refresh } = useDashboard("all", "dataforseo_serp", pool === "RESEARCH");
  const okr = useKeywordOkr({ pool: pool === "RESEARCH" ? "RESEARCH" : "FORMAL" });
  const [country, setCountry] = useState<KeywordCountryScope>("all");
  const [search, setSearch] = useState(""), [site, setSite] = useState("all");
  useEffect(() => { const query = new URLSearchParams(window.location.search).get("q"); if (query) setSearch(query); }, []);
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState(""), [selected, setSelected] = useState<Key[]>([]);
  const okrItems = useMemo(() => new Map((okr.data?.keywords ?? []).map(item => [item.id, item])), [okr.data]);
  const isFlatkey = (member: DashboardKeyword) => (member.siteDomain ?? "flatkey.ai") === "flatkey.ai";
  const originalId = (id: string) => id.startsWith("flatkey.ai:") ? id.slice("flatkey.ai:".length) : id;
  const okrFor = (member: DashboardKeyword) => isFlatkey(member) ? okrItems.get(originalId(member.id)) : undefined;
  const loaded = (data?.keywords ?? []).filter(member => !data?.usingDemoData || !isFlatkey(member));
  const loadedIds = new Set(loaded.filter(isFlatkey).map(member => originalId(member.id)));
  const targetOnly: DashboardKeyword[] = okr.data?.initialized ? [...okrItems.values()].filter(item => !loadedIds.has(item.id)).map(item => ({
    id: item.id, text: item.text, type: "MAIN", topicId: null, topicText: null, siteDomain: item.siteDomain, siteName: "Flatkey", targetUrls: item.targetUrls,
    parentId: null, parentIds: [], active: item.active, lastSyncedAt: null, volume: 0, marketVolumes: { US: null, JP: null, ES: null, BR: null }, latestRanks: { US: null, JP: null, ES: null, BR: null },
  })) : [];
  const paused = (member: DashboardKeyword) => member.monitoringEligible === false || Boolean(isFlatkey(member) && okrFor(member) && okrFor(member)?.pool !== "FORMAL");
  const holdReason = (member: DashboardKeyword) => member.monitoringHoldReason ?? (isFlatkey(member) && okrFor(member)?.pool !== "FORMAL" ? "研究候选或已归档词不参与付费监控" : "页面尚未就绪，暂不监控");
  const pageFor = (member: DashboardKeyword) => {
    const target = okrFor(member), review = member.monitoringHoldCode === "NO_VERIFIED_PAGE" || member.monitoringHoldCode === "PAGE_REVIEW_REQUIRED";
    return keywordPageTag({ siteDomain: member.siteDomain ?? "flatkey.ai", mappingStatus: target?.mappingStatus ?? (member.monitoringEligible === true ? "READY" : undefined), targetUrls: target?.targetUrls ?? member.targetUrls,
      candidateUrls: target?.candidateUrls, latestPageAuditVerdict: member.monitoringHoldCode === "PAGE_NOT_BUILT" ? "NO_MATCH" : review ? "REVIEW" : target?.latestPageAuditVerdict });
  };
  const targetUrls = (member: DashboardKeyword) => {
    const target = okrFor(member), urls = target?.targetUrls ?? member.targetUrls ?? [];
    return urls.length ? urls : target?.workPlan?.action === "EXPAND" ? target.workPlan.pageUrls : [];
  };
  const pagesFor = (group: KeywordDetailGroup): DetailPage[] => group.members.flatMap(member => detailRegions(country).flatMap(region =>
    validKeywordDetailRank(rankFor(member, region)) ? keywordRankingPages(rankFor(member, region), keywordEvidence(member, region), member.siteDomain ?? "flatkey.ai").map(page => ({ ...page, region, siteName: siteName(member), memberId: member.id })) : []
  )).sort((a, b) => (a.rank ?? Infinity) - (b.rank ?? Infinity));
  const tagFor = (group: KeywordDetailGroup, scope = country) => keywordRankingResultTag(bestKeywordDetailRank(group, scope)?.rank);
  const members = [...loaded, ...targetOnly].filter(member => isFlatkey(member) ? okr.data?.initialized && okrFor(member)?.pool === pool : pool === "FORMAL" && keywordRelevance(member.siteDomain ?? "flatkey.ai", member.text).status !== "unrelated");
  const groups = groupKeywordDetails(members, site);
  const rows = groups.filter(group => mapping === "ALL" || group.members.some(member => mapping === "MONITORABLE" ? pageFor(member).key === "MATCHED" : mapping === "CANDIDATE" ? pageFor(member).key !== "MATCHED" : pageFor(member).key === mapping.replace(/^PAGE_/, "")))
    .filter(group => view === "FORMAL" || (view === "EVIDENCE" ? validKeywordDetailRank(bestKeywordDetailRank(group, country)?.rank) : tagFor(group).key === view))
    .filter(group => normalizeKeywordText(group.members.map(member => `${member.text} ${member.topicText ?? ""} ${okrFor(member)?.reason ?? ""}`).join(" ")).includes(normalizeKeywordText(search)));
  async function excludeKeywords() {
    setBusy(true); setNotice("");
    try {
      const bySite = new Map<string, string[]>();
      for (const member of groups.filter(group => selected.includes(group.id)).flatMap(group => group.members).filter(member => !isFlatkey(member))) {
        const domain = member.siteDomain!; bySite.set(domain, [...(bySite.get(domain) ?? []), member.text]);
      }
      let changed = 0;
      for (const [siteDomain, keywords] of bySite) {
        const response = await fetch("/api/keywords/review", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ siteDomain, action: "exclude", keywords }) });
        const result = await response.json(); if (!response.ok) throw new Error(result.message ?? "移除失败，请重试"); changed += result.changed;
      }
      setNotice(`已移除 ${changed} 条网站词记录；原始采集证据保留。`); setSelected([]);
    } catch (failure) { setNotice(failure instanceof Error ? failure.message : "移除失败，请重试"); }
    finally { dashboardStore.clear(); refresh(); setBusy(false); }
  }
  const columns: ColumnsType<KeywordDetailGroup> = [
    { title: "关键词 / 状态", key: "keyword", width: 270, sorter: (a, b) => a.text.localeCompare(b.text), render: (_, group) => {
      const tag = tagFor(group), pageTags = new Map(group.members.map(member => [`${member.siteDomain}:${pageFor(member).key}`, { member, tag: pageFor(member) }]));
      return <div className="evidenceSummary"><strong>{group.text}</strong><div className="keywordStatusTags">{[...pageTags.values()].map(({ member, tag: page }) => <Tooltip key={`${member.siteDomain}:${page.key}`} title={pool === "RESEARCH" ? "候选研究词，尚未确定正式目标页面，不参与付费监控；已有来源证据保留。" : page.tooltip}><Tag color={pool === "RESEARCH" ? "default" : page.color}>{group.members.length > 1 ? `${siteName(member)} · ` : ""}{pool === "RESEARCH" ? "候选词" : page.key === "BUILD" ? "待建设" : page.key === "EXPAND" ? "待优化" : page.label.replace(/^候选·/, "")}</Tag></Tooltip>)}<Tooltip title={tag.tooltip}><Tag color={tag.color}>{tag.label}</Tag></Tooltip></div><small>{[...new Set(group.members.map(siteName))].join(" / ")}</small></div>;
    } },
    { title: "目标页面", key: "targets", width: 290, render: (_, group) => { const urls = [...new Set(group.members.flatMap(targetUrls))]; return <div className="evidenceSummary">{urls.length ? <TargetPages urls={urls} /> : <span className="muted">{pool === "RESEARCH" ? "尚未确定目标页面" : group.members.every(member => pageFor(member).key === "BUILD") ? "待建设" : "暂无合适页面"}</span>}</div>; } },
    { title: country === "all" ? "四国实际名次" : `${REGIONS[country].label}实际名次`, key: "rank", width: 235, sorter: (a, b) => (keywordDetailBestPosition(a, country) ?? Infinity) - (keywordDetailBestPosition(b, country) ?? Infinity), render: (_, group) => {
      const best = bestKeywordDetailRank(group, country);
      return <div className="evidenceSummary">{validKeywordDetailRank(best?.rank) ? <strong>#{best.rank.rank} · {REGIONS[best.region].label}{group.members.length > 1 ? ` · ${siteName(best.member)}` : ""}</strong> : <strong>{tagFor(group).label}</strong>}{country === "all" && keywordDetailCountryRanks(group, country).some(value => value.rank !== null) ? keywordDetailCountryRanks(group, country).map(value => <small key={value.region}>{REGIONS[value.region].label}：{validKeywordDetailRank(value.rank) ? `#${value.rank.rank}${group.members.length > 1 ? ` · ${siteName(value.member)}` : ""}` : tagFor(group, value.region).label}</small>) : best?.rank?.checkedAt ? <small>{localDate(best.rank.checkedAt)}</small> : null}{best?.rank && country !== "all" && coverage(best.rank) ? <small>{coverage(best.rank)}</small> : null}</div>;
    } },
    { title: country === "all" ? "对应国家排名变化" : "较上次有效实测", key: "movement", width: 190, render: (_, group) => { const best = bestKeywordDetailRank(group, country); return <div className="evidenceSummary"><strong>{rankMovement(best?.rank ?? null)}</strong>{best?.rank ? <small>{REGIONS[best.region].label} · {siteName(best.member)}{best.rank.previousPeriodLabel ? ` · 对比${best.rank.previousPeriodLabel}` : ""}</small> : null}</div>; } },
    { title: "实际排名页面", key: "pages", width: 330, render: (_, group) => { const pages = pagesFor(group); return pages.length ? <ObservedPages pages={pages} compact /> : <span className="muted">—</span>; } },
  ];
  return <main className="appShell"><PageHeader active="keywords" />
    <div className="pageIntro"><h1>关键词明细</h1><p>{data?.serpOverview?.currentPeriod.label ? `${data.serpOverview.currentPeriod.label} · ` : ""}关键词去重展示，展开查看各国排名与关联页面。</p></div>
    {data?.usingDemoData ? <p className="loadError" role="alert">当前为演示数据，不能用于判断实际排名。</p> : null}
    {refreshing ? <p className="cacheNotice" role="status">正在获取最新词库与证据…</p> : null}
    {error ? <div className="loadError" role="alert"><span>{error}</span><button onClick={() => void refresh()}>重新加载</button></div> : null}
    {okr.error ? <div className="loadError" role="alert"><span>目标库读取失败：{okr.error}</span><button onClick={okr.refresh}>重新加载</button></div> : null}
    {okr.data && !okr.data.initialized ? <p className="okrUninitialized">目标库尚未初始化。<Link href="/manage#keyword-audit">前往数据管理</Link></p> : null}
    <section className="keywordFilterPanel" aria-label="关键词筛选">
      <div className="keywordSearchRow"><label className="searchField"><Search size={18} /><input aria-label="搜索关键词或话题" placeholder="搜索关键词或话题" value={search} onChange={event => setSearch(event.target.value)} /></label><button className="keywordFilterReset" onClick={() => { setCountry("all"); setSite("all"); setView("FORMAL"); setPool("FORMAL"); setMapping("ALL"); setSearch(""); setSelected([]); }}><RotateCcw size={14} />重置筛选</button></div>
    <div className="keywordFilterGrid">
      <label className="originSelectField"><span>国家</span><Select aria-label="国家筛选" className="originSelect" value={country} onChange={setCountry} options={[{ value: "all", label: "全部国家" }, ...REGION_CODES.map(region => ({ value: region, label: REGIONS[region].label }))]} /></label>
      <label className="originSelectField"><span>网站</span><Select aria-label="所属网站" className="originSelect" value={site} onChange={value => { setSite(value); setPool("FORMAL"); setMapping("ALL"); setSelected([]); }} options={[{ value: "all", label: "全部网站" }, ...SITES.map(item => ({ value: item.domain, label: item.name }))]} /></label>
      <label className="originSelectField"><span>排名状态</span><Select aria-label="DataForSEO 排名区间筛选" className="originSelect" value={view} onChange={setView} options={[{ value: "FORMAL", label: "全部排名" }, { value: "EVIDENCE", label: "有排名（1–100）" }, { value: "TOP_10", label: "前10名" }, { value: "TOP_30", label: "11–30名" }, { value: "TOP_50", label: "31–50名" }, { value: "TOP_100", label: "51–100名" }, { value: "UNRANKED", label: "100之外" }]} /></label>
      <label className="originSelectField"><span>页面状态</span><Select aria-label="页面关联状态" disabled={pool === "RESEARCH"} className="originSelect" value={mapping} onChange={setMapping} options={[{ value: "ALL", label: "全部页面状态" }, { value: "MONITORABLE", label: "已匹配页面" }, ...PAGE_FILTERS]} /></label>
      <label className="originSelectField"><span>词库分类</span><Select aria-label="业务词池" className="originSelect" value={pool} onChange={value => { setPool(value); setView("FORMAL"); setMapping("ALL"); setSelected([]); }} disabled={site !== "all" && site !== "flatkey.ai"} options={Object.entries(POOLS).map(([value, label]) => ({ value, label }))} /></label>
    </div>
    </section>
    <div className="reviewToolbar keywordResultBar"><p>{loading || okr.loading ? "正在加载…" : <>共 <strong>{rows.length.toLocaleString()}</strong> 个关键词</>}<span>{country === "all" ? "四国综合 · 已去重" : `${REGIONS[country].label} · 已去重`}</span></p><div>{selected.length && site !== "flatkey.ai" ? <button disabled={busy || data?.usingDemoData} onClick={() => void excludeKeywords()}>{busy ? "正在移除…" : `移除 ${selected.length} 个无关词`}</button> : null}</div></div>
    {notice ? <p className="cacheNotice" role="status">{notice}</p> : null}
    <section className="tablePanel"><Table className="keywordTable" columns={columns} dataSource={loading || okr.loading ? [] : rows} rowKey="id" loading={loading || okr.loading}
      rowSelection={site === "all" || site === "flatkey.ai" ? undefined : { selectedRowKeys: selected, onChange: keys => setSelected(keys.slice(0, 500)), getCheckboxProps: group => ({ disabled: group.members.some(isFlatkey) }) }}
      expandable={{ expandedRowRender: group => <div className="keywordEvidenceDetails">{group.members.map(member => <section key={`${member.siteDomain}:${member.id}`}><h3>{siteName(member)} · {member.text}</h3><p>{okrFor(member)?.latestPageAuditReason ?? okrFor(member)?.reason ?? "页面与排名分别核对"}</p>{paused(member) ? <p>{holdReason(member)}；已存排名与页面证据保留。</p> : null}<TargetPages urls={[...new Set(targetUrls(member))]} />{okrFor(member)?.candidateUrls.length ? <details><summary>尚未确认关联的候选页面</summary><TargetPages urls={okrFor(member)!.candidateUrls} /></details> : null}{okrFor(member)?.actualPages.length ? <details><summary>审计保留的历史来源页面</summary><ul>{okrFor(member)!.actualPages.map((page, index) => <li key={`${page.url}:${index}`}><a href={page.url} target="_blank" rel="noreferrer">{page.url}</a> · {page.source} · {page.region} · {page.periodStart ?? "来源区间未提供"}{page.periodEnd ? ` 至${page.periodEnd}` : ""}</li>)}</ul></details> : null}
        <p>月搜索量：{detailRegions(country).map(region => `${REGIONS[region].label} ${number(member.marketVolumes[region])}`).join(" · ")} · {member.volumeReviewLabel ?? member.volumeReview?.label ?? "历史不足，保留观察"}</p>
        {detailRegions(country).map(region => { const rank = rankFor(member, region), pages = keywordRankingPages(rank, keywordEvidence(member, region), member.siteDomain ?? "flatkey.ai").map(page => ({ ...page, region, siteName: siteName(member), memberId: member.id })); return <section key={region}><strong>{REGIONS[region].label} · {tagFor({ id: member.id, text: member.text, members: [member] }, region).label}</strong>{rank ? <><p>采集记录：{keywordRankingTag(rank).label} · 采集于 {localDate(rank.checkedAt)} · {rank.periodLabel ?? "未记录期次"} · {coverage(rank)}</p>{pages.length ? <ObservedPages pages={pages} compact /> : <p>本次未取得独立页面排名。</p>}</> : <p>{paused(member) ? holdReason(member) : "尚未采集"}</p>}<KeywordHistory member={member} region={region} /><a href={`https://www.google.com/search?${new URLSearchParams({ q: member.text, gl: REGIONS[region].gl, hl: REGIONS[region].hl, pws: "0" })}`} target="_blank" rel="noreferrer">在Google复核{REGIONS[region].label}结果 ↗</a></section>; })}
      </section>)}</div> }} pagination={{ defaultPageSize: 10, showSizeChanger: true, pageSizeOptions: [10, 20, 50, 100], showTotal: total => `共 ${total} 个关键词（已去重）` }} scroll={{ x: 1300 }} size="middle" /></section>
  </main>;
}
