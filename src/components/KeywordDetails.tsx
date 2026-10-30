"use client";
import { useEffect, useMemo, useState, type Key } from "react";
import { Table, Tooltip, Select, Tag } from "antd";
import type { ColumnsType } from "antd/es/table";
import { Search, RotateCcw, Info, ChevronDown } from "lucide-react";
import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { CandidateKeywordReview } from "@/components/CandidateKeywordReview";
import { KeywordRankActions } from "@/components/KeywordRankActions";
import { useOptimizedPageCapture } from "@/components/useOptimizedPageCapture";
import { optimizedPageCaptureProcessing, optimizedPagesForKeyword, withOptimizedKeywordRanks } from "@/lib/optimized-keyword-details";
import { useKeywordPage } from "./useKeywordPage";
import { SerpQuerySnapshot } from "./SerpQuerySnapshot";
import { KEYWORD_BUSINESSES, type KeywordBusiness } from "@/lib/keyword-business";
import type { DashboardKeyword, RankingEvidence, RankingPageEvidence, RankSummary } from "@/lib/types";
import { REGIONS, REGION_CODES, type SearchRegionCode } from "@/lib/seo";
import { dashboardStore } from "@/lib/dashboard-client";
import { clientReadCache, ClientReadError } from "@/lib/client-read-cache";
import type { DashboardResponse } from "@/lib/types";
import { keywordEvidence } from "@/lib/keyword-evidence";
import { keywordRelevance, normalizeKeywordText } from "@/lib/keyword-relevance";
import type { KeywordPool, KeywordOkrItem } from "@/lib/keyword-okr";
import { keywordPageTag, keywordRankingTag, keywordRankingResultTag } from "@/lib/keyword-status-tags";
import { keywordMarketVolume } from "@/lib/keyword-market";
import { keywordRankingPages } from "@/lib/keyword-ranking-pages";
import { bestKeywordDetailRank, detailRegions, groupKeywordDetails, keywordDetailCountryRanks, validKeywordDetailRank,
  type KeywordCountryScope, type KeywordCountryRank, type KeywordDetailGroup } from "@/lib/keyword-details-group";

const POOLS = { FORMAL: "业务目标", RESEARCH: "候选词" };
const PAGE_FILTERS = [{ value: "PAGE_BUILD", label: "待建设" }, { value: "PAGE_EXPAND", label: "待优化" }, { value: "PAGE_OPTIMIZED", label: "已优化" }];
const number = (value: number | null | undefined) => value == null ? "—" : value.toLocaleString("zh-CN");
const position = (value: number | null) => value == null ? "—" : Number(value.toFixed(2)).toString();
const localDate = (value: string | null | undefined) => value ? new Date(value).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" }) : "来源日期未提供";
const siteName = (member: DashboardKeyword) => member.siteName ?? member.siteDomain ?? "Flatkey";
const rankFor = (member: DashboardKeyword, region: SearchRegionCode) => member.latestRanks[region]?.source === "dataforseo_serp" ? member.latestRanks[region] : null;
function rankMovement(rank: RankSummary | null) {
  const labels = { UP: `↑ 上升 ${rank?.rankDelta ?? ""} 位`, DOWN: `↓ 下降 ${Math.abs(rank?.rankDelta ?? 0)} 位`, UNCHANGED: "持平", NEW_IN_TOP100: "新进前100", DROPPED_OUT: "跌出前100", FIRST_CHECK: "仅一次有效实测", NOT_COMPARABLE: "暂无可比结果" };
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
    <strong>{REGIONS[page.region].label} · {page.siteName} · #{position(page.rank)}</strong><small>排名采集：{localDate(page.checkedAt)}</small>
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

function KeywordExpandedMember({member,country,audit,urls,pageLabel,pageColor,hold}:{member:DashboardKeyword;country:KeywordCountryScope;audit?:KeywordOkrItem;urls:string[];pageLabel:string;pageColor:string;hold:string|null}){
  const regions=detailRegions(country),advice=audit?.latestPageAuditReason??audit?.reason;
  return <section className="keywordExpandedMember" aria-label={`${member.text}各国详情`}>
    <div className="keywordExpandedHeading"><strong>{siteName(member)}</strong><Tag color={pageColor}>{pageLabel}</Tag>{advice?<Tooltip title={advice}><button type="button" className="keywordAdvice" aria-label="页面建议"><Info size={14}/><span>页面建议</span></button></Tooltip>:null}</div>
    <div className="keywordExpandedTargets"><span>关联页面</span><div>{urls.length?<TargetPages urls={[...new Set(urls)]}/>:<span className="muted">—</span>}</div>{hold?<Tooltip title={hold}><span className="keywordMonitoringNote">暂不监控</span></Tooltip>:null}</div>
    <div className="keywordCountryTableWrap"><table className="keywordCountryTable"><thead><tr><th>国家</th><th>实际排名</th><th>月搜索量</th><th>实际排名页面</th><th>排名采集时间</th></tr></thead><tbody>{regions.map(region=>{
      const rank=rankFor(member,region),tag=keywordRankingResultTag(rank),valid=validKeywordDetailRank(rank);
      const pages=valid?keywordRankingPages(rank,keywordEvidence(member,region),member.siteDomain??"flatkey.ai"):[];
      return <tr key={region}><th><span className="keywordCountryFlag">{{US:"🇺🇸",JP:"🇯🇵",ES:"🇪🇸",BR:"🇧🇷"}[region]}</span>{REGIONS[region].label}</th><td><Tooltip title={tag.tooltip}><span className={`keywordCountryRank ${valid?"isRanked":""}`}>{valid?`#${rank.rank}`:tag.key==="UNRANKED"?"100之外":"—"}</span></Tooltip></td><td>{number(member.marketVolumes[region])}</td><td>{pages.length?<><a className="keywordCountryUrl" href={pages[0].url} title={pages[0].url} target="_blank" rel="noreferrer">{pages[0].url.replace(/^https?:\/\//,"")}</a>{pages.length>1?<details className="keywordMorePages"><summary>另 {pages.length-1} 个页面</summary>{pages.slice(1).map(page=><div key={page.url}><span>#{page.rank}</span><a href={page.url} target="_blank" rel="noreferrer">{page.url.replace(/^https?:\/\//,"")}</a></div>)}</details>:null}</>:<span className="muted">—</span>}</td><td className="keywordCountryTime">{rank?.checkedAt?localDate(rank.checkedAt):"—"}</td></tr>;
    })}</tbody></table></div>
    <details className="keywordSecondaryDetails"><summary><span>采集记录与历史</span><ChevronDown size={14}/></summary><div className="keywordArchiveGrid">{regions.map(region=>{
      const rank=rankFor(member,region);
      return <div className="keywordArchiveCountry" key={region}><div className="keywordArchiveHeading"><strong>{REGIONS[region].label}</strong><a href={`https://www.google.com/search?${new URLSearchParams({q:member.text,gl:REGIONS[region].gl,hl:REGIONS[region].hl,pws:"0"})}`} target="_blank" rel="noreferrer">Google 搜索 ↗</a></div>{rank?<p className="chartNote">{keywordRankingTag(rank).label}{coverage(rank)?` · ${coverage(rank)}`:""}</p>:null}{rank?.checkedAt?<SerpQuerySnapshot keyword={member.text} region={region}/>:null}<KeywordHistory member={member} region={region}/></div>;
    })}</div>{audit?.candidateUrls.length?<details className="keywordPageReferences"><summary>候选页面 · {audit.candidateUrls.length}</summary><TargetPages urls={audit.candidateUrls}/></details>:null}{audit?.actualPages.length?<details className="keywordPageReferences"><summary>历史页面 · {audit.actualPages.length}</summary>{audit.actualPages.map((page,index)=><a key={`${page.url}:${index}`} href={page.url} target="_blank" rel="noreferrer">{page.url.replace(/^https?:\/\//,"")}</a>)}</details>:null}</details>
  </section>;
}

export function KeywordDetails({ initiallyOptimized = false, initialCountry = "all", initialSearch = "", initialBusiness = "FLATKEY_API", initialCrossLanguage = false }: { initiallyOptimized?: boolean; initialCountry?: KeywordCountryScope; initialSearch?: string; initialBusiness?: KeywordBusiness; initialCrossLanguage?: boolean }) {
  const [view, setView] = useState("FORMAL"), [pool, setPool] = useState<KeywordPool>("FORMAL"), [mapping, setMapping] = useState(initiallyOptimized ? "PAGE_OPTIMIZED" : "ALL");
  const capture = useOptimizedPageCapture();
  const optimizedPages = capture.data?.pages ?? [];
  const [country, setCountry] = useState<KeywordCountryScope>(initialCountry);
  const [includeCrossLanguage, setIncludeCrossLanguage] = useState(initialCrossLanguage);
  const [search, setSearch] = useState(initialSearch), [business, setBusiness] = useState<KeywordBusiness>(initialBusiness);
  const businessLabel = KEYWORD_BUSINESSES.find(item => item.value === business)!.label;
  const { data, error, loading, refresh, page, setPage } = useKeywordPage({pool,country,site:"all",business,rank:view,pageStatus:mapping,q:search,crossLanguage:includeCrossLanguage?"1":"0"});
  const okr = {data:data?.okr,error:null,loading,refresh};
  useEffect(() => { const query = new URLSearchParams(window.location.search).get("q"); if (query) setSearch(query); }, []);
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState(""), [selected, setSelected] = useState<Key[]>([]);
  const okrItems = useMemo(() => new Map((okr.data?.keywords ?? []).map(item => [item.id, item])), [okr.data]);
  const isFlatkey = (member: DashboardKeyword) => (member.siteDomain ?? "flatkey.ai") === "flatkey.ai";
  const originalId = (id: string) => id.startsWith("flatkey.ai:") ? id.slice("flatkey.ai:".length) : id;
  const okrFor = (member: DashboardKeyword) => isFlatkey(member) ? okrItems.get(originalId(member.id)) : undefined;
  const loaded = (data?.keywords ?? []).filter(member => !data?.usingDemoData || !isFlatkey(member));
  const loadedIds = new Set(loaded.filter(isFlatkey).map(member => originalId(member.id)));
  const targetOnly: DashboardKeyword[] = okr.data?.initialized ? [...okrItems.values()].filter(item => !loadedIds.has(item.id)).map(item => ({
    id: item.id, text: item.text, type: "MAIN", topicId: null, topicText: null, siteDomain: item.siteDomain, siteName: "Flatkey", targetUrls: item.targetUrls, businessCategory: item.businessCategory,
    parentId: null, parentIds: [], active: item.active, lastSyncedAt: null, volume: 0, marketVolumes: { US: null, JP: null, ES: null, BR: null }, latestRanks: { US: null, JP: null, ES: null, BR: null },
  })) : [];
  const paused = (member: DashboardKeyword) => member.monitoringEligible === false || Boolean(isFlatkey(member) && okrFor(member) && okrFor(member)?.pool !== "FORMAL");
  const holdReason = (member: DashboardKeyword) => member.monitoringHoldReason ?? (isFlatkey(member) && okrFor(member)?.pool !== "FORMAL" ? "研究候选或已归档词不参与付费监控" : "页面尚未就绪，暂不监控");
  const pageFor = (member: DashboardKeyword, includeOptimized = true) => {
    const target = okrFor(member), review = member.monitoringHoldCode === "NO_VERIFIED_PAGE" || member.monitoringHoldCode === "PAGE_REVIEW_REQUIRED";
    return keywordPageTag({ siteDomain: member.siteDomain ?? "flatkey.ai", optimized: includeOptimized && optimizedPagesForKeyword(member, optimizedPages).length > 0, mappingStatus: target?.mappingStatus ?? (member.monitoringEligible === true ? "READY" : undefined), targetUrls: target?.targetUrls ?? member.targetUrls,
      candidateUrls: target?.candidateUrls, latestPageAuditVerdict: member.monitoringHoldCode === "PAGE_NOT_BUILT" ? "NO_MATCH" : review ? "REVIEW" : target?.latestPageAuditVerdict });
  };
  const targetUrls = (member: DashboardKeyword) => {
    const target = okrFor(member), urls = target?.targetUrls ?? member.targetUrls ?? [];
    const planned = urls.length ? urls : target?.workPlan?.action === "EXPAND" ? target.workPlan.pageUrls : [];
    return [...new Set([...planned, ...optimizedPagesForKeyword(member, optimizedPages).map(page => page.url)])];
  };
  const pagesFor = (group: KeywordDetailGroup): DetailPage[] => group.members.flatMap(member => detailRegions(country).flatMap(region =>
    validKeywordDetailRank(rankFor(member, region)) ? keywordRankingPages(rankFor(member, region), keywordEvidence(member, region), member.siteDomain ?? "flatkey.ai").map(page => ({ ...page, region, siteName: siteName(member), memberId: member.id })) : []
  )).sort((a, b) => (country === "all" ? Date.parse(b.checkedAt ?? "") - Date.parse(a.checkedAt ?? "") : 0) || (a.rank ?? Infinity) - (b.rank ?? Infinity));
  const capturePagesFor = (group: KeywordDetailGroup) => [...new Map(group.members.flatMap(member => optimizedPagesForKeyword(member, optimizedPages)).map(page => [page.id, page])).values()];
  const attemptFor = (value: KeywordCountryRank) => optimizedPagesForKeyword(value.member, optimizedPages)
    .flatMap(page => page.attemptResults ?? []).filter(result => result.region === value.region && normalizeKeywordText(result.keyword) === normalizeKeywordText(value.member.text))
    .sort((a, b) => Date.parse(b.checkedAt ?? "") - Date.parse(a.checkedAt ?? ""))[0];
  const missingAttemptFor = (value: KeywordCountryRank) => {
    const attempt = attemptFor(value);
    return attempt?.status === "NOT_FOUND_CAPTURE" && !attempt.otherPages.length && attempt.checkedAt &&
      (!value.rank?.checkedAt || Date.parse(attempt.checkedAt) > Date.parse(value.rank.checkedAt)) ? attempt : null;
  };
  const processingFor = (group: KeywordDetailGroup) => pool === "FORMAL" && capturePagesFor(group).some(page => optimizedPageCaptureProcessing(page, capture.busy));
  const tagFor = (group: KeywordDetailGroup, scope = country) => keywordRankingResultTag(bestKeywordDetailRank(group, scope)?.rank);
  const members = [...loaded, ...targetOnly].filter(member => isFlatkey(member) ? okr.data?.initialized && okrFor(member)?.pool === pool : pool === "FORMAL" && keywordRelevance(member.siteDomain ?? "flatkey.ai", member.text).status !== "unrelated");
  const groups = groupKeywordDetails(members.map(member => withOptimizedKeywordRanks({ ...member, businessCategory: okrFor(member)?.businessCategory ?? member.businessCategory }, optimizedPages)), "all", business);
  const rows = groups.filter(group => mapping === "ALL" || group.members.some(member => mapping === "MONITORABLE" ? pageFor(member, false).key === "MATCHED" : mapping === "CANDIDATE" ? pageFor(member, false).key !== "MATCHED" : pageFor(member).key === mapping.replace(/^PAGE_/, "")))
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
      setNotice(`已移除 ${changed} 条关键词记录；原始采集证据保留。`); setSelected([]);
    } catch (failure) { setNotice(failure instanceof Error ? failure.message : "移除失败，请重试"); }
    finally { dashboardStore.clear(); refresh(); setBusy(false); }
  }
  const columns: ColumnsType<KeywordDetailGroup> = [
    { title: "关键词 / 状态", key: "keyword", width: 270, render: (_, group) => {
      const tag = tagFor(group), pageTags = new Map(group.members.map(member => [`${member.siteDomain}:${pageFor(member).key}`, { member, tag: pageFor(member) }]));
      return <div className="evidenceSummary"><strong>{group.text}</strong><div className="keywordStatusTags">{[...pageTags.values()].map(({ member, tag: page }) => <Tooltip key={`${member.siteDomain}:${page.key}`} title={pool === "RESEARCH" ? "候选研究词，尚未确定正式目标页面，不参与付费监控；已有来源证据保留。" : page.tooltip}><Tag color={pool === "RESEARCH" ? "default" : page.color}>{group.members.length > 1 ? `${siteName(member)} · ` : ""}{pool === "RESEARCH" ? "候选词" : page.key === "BUILD" ? "待建设" : page.key === "EXPAND" ? "待优化" : page.label.replace(/^候选·/, "")}</Tag></Tooltip>)}<Tooltip title={tag.tooltip}><Tag color={tag.color}>{tag.label}</Tag></Tooltip></div><small>{[...new Set(group.members.map(siteName))].join(" / ")}</small></div>;
    } },
    { title: "目标页面", key: "targets", width: 290, render: (_, group) => { const urls = [...new Set(group.members.flatMap(targetUrls))]; return <div className="evidenceSummary">{urls.length ? <TargetPages urls={urls} /> : <span className="muted">{pool === "RESEARCH" ? "尚未确定目标页面" : group.members.every(member => pageFor(member).key === "BUILD") ? "待建设" : "暂无合适页面"}</span>}</div>; } },
    { title: "优化完成时间", key: "optimizedAt", width: 190, render: (_, group) => {
      const pages = [...new Map(group.members.flatMap(member => optimizedPagesForKeyword(member, optimizedPages)).map(page => [page.id, page])).values()];
      return pages.length ? <div className="evidenceSummary">{pages.map(page => <div key={page.id} title={page.optimizationNote ?? undefined}>
        {pages.length > 1 ? <a className="observedUrl" href={page.url} target="_blank" rel="noreferrer">{page.url.replace(/^https?:\/\//, "")}</a> : null}
        {page.optimizedAt ? <time dateTime={page.optimizedAt}>{/^\d{4}-\d{2}-\d{2}$/.test(page.optimizedAt) ? `${page.optimizedAt}（日期）` : `${localDate(page.optimizedAt)}（北京时间）`}</time> : <span className="muted">来源未记录优化时间</span>}
      </div>)}</div> : <span className="muted">—</span>;
    } },
    ...(country !== "all" ? [{ title: `${REGIONS[country].label}月搜索量`, key: "volume", width: 145,
      render: (_: unknown, group: KeywordDetailGroup) => number(keywordMarketVolume(group.members, country)),
    }] : []),
    { title: country === "all" ? "四国实际名次" : `${REGIONS[country].label}实际名次`, key: "rank", width: 235, render: (_, group) => {
      const best = bestKeywordDetailRank(group, country);
      return <div className="evidenceSummary">{processingFor(group) ? <small>{best?.rank?.checkedAt ? "上次有效排名 · 本次处理中" : "本次排名处理中"}</small> : null}{validKeywordDetailRank(best?.rank) ? <strong>{country === "all" ? "四国最佳：" : ""}#{best.rank.rank} · {REGIONS[best.region].label}{group.members.length > 1 ? ` · ${siteName(best.member)}` : ""}</strong> : <strong>{tagFor(group).label}</strong>}
        {country === "all" ? keywordDetailCountryRanks(group, country).map(value => {
          const missing = missingAttemptFor(value);
          return <div className="evidenceSummary" key={value.region}>
            <small>{REGIONS[value.region].label}：{validKeywordDetailRank(value.rank) ? `#${value.rank.rank}${group.members.length > 1 ? ` · ${siteName(value.member)}` : ""}` : tagFor(group, value.region).label}</small>
            {value.rank?.checkedAt ? <small>有效采集：{localDate(value.rank.checkedAt)}</small> : null}
            {missing ? <small>本次未取得有效名次{value.rank?.checkedAt ? "，保留历史排名" : ""} · {localDate(missing.checkedAt)}</small> : null}
          </div>;
        }) : best?.rank?.checkedAt ? <small>{localDate(best.rank.checkedAt)}</small> : null}{best?.rank && country !== "all" && coverage(best.rank) ? <small>{coverage(best.rank)}</small> : null}
      </div>;

    } },
    { title: country === "all" ? "对应国家排名变化" : "较上次有效实测", key: "movement", width: 190, render: (_, group) => {
      const best = bestKeywordDetailRank(group, country), processing = processingFor(group);
      return <div className="evidenceSummary">{processing ? <><strong>处理中</strong><small>本次完成后更新排名变化</small></> : null}
        {country === "all" ? keywordDetailCountryRanks(group, country).map(value => <div className="evidenceSummary" key={value.region}>
          <strong>{REGIONS[value.region].label} · {missingAttemptFor(value) ? "本次暂无可比结果" : rankMovement(value.rank)}</strong>
          {value.rank?.previousRank != null && value.rank.rank != null ? <small>#{value.rank.previousRank} → #{value.rank.rank}{group.members.length > 1 ? ` · ${siteName(value.member)}` : ""}</small> : null}
          {value.rank?.previousCheckedAt ? <small>对比：{localDate(value.rank.previousCheckedAt)}</small> : null}
          {processing && value.rank ? <small>上次记录：{rankMovement(value.rank)}</small> : null}
        </div>) : <>{!processing ? <strong>{rankMovement(best?.rank ?? null)}</strong> : null}
          {best?.rank ? <small>{processing ? `上次记录：${rankMovement(best.rank)} · ` : ""}{REGIONS[best.region].label} · {siteName(best.member)}{best.rank.previousPeriodLabel ? ` · 对比${best.rank.previousPeriodLabel}` : ""}</small> : null}</>}
      </div>;

    } },
    { title: "实际排名页面", key: "pages", width: 330, render: (_, group) => { const pages = pagesFor(group); return pages.length ? <ObservedPages pages={pages} compact /> : <span className="muted">—</span>; } },
    { title: "操作", key: "capture", width: 145, fixed: "right", render: (_, group) => {
      const pages = capturePagesFor(group);
      return pool === "FORMAL" ? <KeywordRankActions pages={pages} capture={capture} /> : <span className="muted">—</span>;
    } },
  ];
  return <main className="appShell"><PageHeader active="keywords" />
    <div className="pageIntro"><h1>关键词明细</h1><p>关键词去重展示，展开查看各国排名与关联页面。优化完成时间取自优化表，排名页面下的时间为实测采集时间。</p></div>
    {data?.usingDemoData ? <p className="loadError" role="alert">当前为演示数据，不能用于判断实际排名。</p> : null}
    {error ? <div className="loadError" role="alert"><span>{error}</span><button onClick={() => void refresh()}>重新加载</button></div> : null}
    {okr.error ? <div className="loadError" role="alert"><span>目标库读取失败：{okr.error}</span><button onClick={okr.refresh}>重新加载</button></div> : null}
    {capture.error ? <div className="loadError" role="alert"><span>{capture.error}</span><button onClick={() => void capture.refresh()}>重新加载优化页面</button></div> : null}
    {okr.data && !okr.data.initialized ? <p className="okrUninitialized">目标库尚未初始化。<Link href="/manage#keyword-audit">前往数据管理</Link></p> : null}
    <section className="keywordFilterPanel" aria-label="关键词筛选">
      <div className="keywordSearchRow"><label className="searchField"><Search size={18} /><input aria-label="搜索关键词或话题" placeholder="搜索关键词或话题" value={search} onChange={event => setSearch(event.target.value)} /></label><button className="keywordFilterReset" onClick={() => { setCountry("all"); setIncludeCrossLanguage(false); setBusiness("FLATKEY_API"); setView("FORMAL"); setPool("FORMAL"); setMapping("ALL"); setSearch(""); setSelected([]); }}><RotateCcw size={14} />重置筛选</button></div>
    <div className="keywordFilterGrid">
      <label className="originSelectField"><span>目标市场</span><Select aria-label="国家筛选" className="originSelect" value={country} onChange={value => { setCountry(value); setSelected([]); }} options={[{ value: "all", label: "全部国家" }, ...REGION_CODES.map(region => ({ value: region, label: REGIONS[region].label }))]} /></label>
      <label className="originSelectField"><span>业务分类</span><Select aria-label="业务分类" className="originSelect" value={business} onChange={value => { setBusiness(value); setPool("FORMAL"); setView("FORMAL"); setMapping("ALL"); setNotice(""); setSelected([]); }} options={[...KEYWORD_BUSINESSES]} /></label>
      <label className="originSelectField"><span>排名状态</span><Select aria-label="DataForSEO 排名区间筛选" className="originSelect" value={view} onChange={setView} options={[{ value: "FORMAL", label: "全部排名" }, { value: "EVIDENCE", label: "有排名（1–100）" }, { value: "TOP_10", label: "前10名" }, { value: "TOP_30", label: "11–30名" }, { value: "TOP_50", label: "31–50名" }, { value: "TOP_100", label: "51–100名" }, { value: "UNRANKED", label: "100之外" }]} /></label>
      <label className="originSelectField"><span>页面状态</span><Select aria-label="页面关联状态" disabled={pool === "RESEARCH"} className="originSelect" value={mapping} onChange={setMapping} options={[{ value: "ALL", label: "全部页面状态" }, { value: "MONITORABLE", label: "已匹配页面" }, ...PAGE_FILTERS]} /></label>
      <label className="originSelectField"><span>词库分类</span><Select aria-label="业务词池" className="originSelect" value={pool} onChange={value => { setPool(value); setView("FORMAL"); setMapping("ALL"); setSelected([]); }} options={Object.entries(POOLS).map(([value, label]) => ({ value, label }))} /></label>
    </div>
    {country !== "all" ? <p className="chartNote">按来源语种匹配目标市场；未标语种的词参考该国已有数据。<label><input type="checkbox" checked={includeCrossLanguage} onChange={event => { setIncludeCrossLanguage(event.target.checked); setSelected([]); }} /> 包含在该国有数据的跨语种词</label></p> : null}
    </section>
    {pool === "RESEARCH" ? <CandidateKeywordReview key={business} businessCategory={business} businessLabel={businessLabel} onChanged={() => { refresh(); okr.refresh(); }} /> : null}
    <div className="reviewToolbar keywordResultBar"><p>{loading || okr.loading ? "正在加载…" : <>共 <strong>{(data?.total ?? 0).toLocaleString()}</strong> 个关键词</>}<span>{country === "all" ? "四国综合 · 已去重" : `${REGIONS[country].label} · 已去重`}</span></p><div>{selected.length && business === "CLOUD_GPU" ? <button disabled={busy || data?.usingDemoData} onClick={() => void excludeKeywords()}>{busy ? "正在移除…" : `移除 ${selected.length} 个无关词`}</button> : null}</div></div>
    {notice ? <p className="cacheNotice" role="status">{notice}</p> : null}
    <section className="tablePanel"><Table className="keywordTable" columns={columns} dataSource={loading || okr.loading ? [] : rows} rowKey="id" loading={loading || okr.loading}
      rowSelection={business === "CLOUD_GPU" && pool === "FORMAL" ? { selectedRowKeys: selected, onChange: keys => setSelected(keys.slice(0, 500)), getCheckboxProps: group => ({ disabled: group.members.some(isFlatkey) }) } : undefined}
      expandable={{ expandedRowRender: group => <div className="keywordExpandedDetails">{group.members.map(member=>{const page=pageFor(member);return <KeywordExpandedMember key={`${member.siteDomain}:${member.id}`} member={member} country={country} audit={okrFor(member)} urls={targetUrls(member)} pageLabel={page.key==="EXPAND"?"待优化":page.key==="BUILD"?"待建设":page.label.replace(/^候选·/,"")} pageColor={page.color} hold={paused(member)?holdReason(member):null}/>;})}</div> }} pagination={{ current:page, pageSize:10, total:data?.total ?? 0, onChange:value=>{setPage(value);setSelected([]);}, showSizeChanger:false, showTotal: total => `共 ${total} 个关键词（已去重）` }} scroll={{ x: country === "all" ? 1640 : 1785 }} size="middle" /></section>
  </main>;
}
