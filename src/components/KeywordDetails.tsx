"use client";
import { useEffect, useState, type Key } from "react";
import { Table, Tooltip, Select, Tag } from "antd";
import type { ColumnsType } from "antd/es/table";
import { Search } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { useKeywordOkr } from "@/components/useKeywordOkr";
import { KeywordOkrWorkspace } from "@/components/KeywordOkrWorkspace";
import { SITES, useSeoSelection } from "@/components/useSeoSelection";
import { useDashboard } from "@/components/useDashboard";
import type { DashboardKeyword, RankingEvidence, RankingPageEvidence } from "@/lib/types";
import { REGIONS } from "@/lib/seo";
import { dashboardStore } from "@/lib/dashboard-client";
import { keywordEvidence } from "@/lib/keyword-evidence";
import { keywordRelevance } from "@/lib/keyword-relevance";
import type { KeywordPool } from "@/lib/keyword-okr";
import { keywordPageTag, keywordRankingTag } from "@/lib/keyword-status-tags";
import { keywordRankingPages } from "@/lib/keyword-ranking-pages";
import { RankingDiscoveryTable } from "@/components/RankingDiscovery";

const POOLS: Record<KeywordPool, string> = { FORMAL: "业务目标", RESEARCH: "候选研究", ARCHIVED: "已归档", MERGED: "已归并" };
const PAGE_TAG_FILTERS = [{ value: "PAGE_BUILD", label: "候选·待建设" }, { value: "PAGE_EXPAND", label: "候选·需补内容" }, { value: "PAGE_MISMATCH", label: "候选·页面错配" }, { value: "PAGE_REVIEW", label: "候选·页面待核实" }];

const ORIGINS = [
  { value: "ALL", label: "全部来源" }, { value: "PLANNED", label: "页面目标词" },
  { value: "CLUSTER", label: "集群页面词" }, { value: "DISCOVERED", label: "搜索报告发现词" },
  { value: "RESEARCH", label: "研究词" },
];
const number = (value: number | null | undefined) => value == null ? "—" : value.toLocaleString("zh-CN");
const position = (value: number | null) => value == null ? "暂无数据" : Number(value.toFixed(2)).toString();
const period = (e: RankingEvidence) => e.periodStart && e.periodEnd ? `${e.periodStart} 至 ${e.periodEnd}` : e.dataDate ?? "来源日期未提供";
const localDate = (value: string | null | undefined) => value ? new Date(value).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" }) : "来源日期未提供";

function ObservedPages({ pages }: { pages: RankingPageEvidence[] }) {
  return <div className="rankingPageList">{pages.map(page => <div className="rankingPageRecord" key={page.url}>
    <a className="observedUrl" href={page.url} target="_blank" rel="noreferrer">{page.url.replace(/^https?:\/\//, "")}</a>
    <strong>页面名次 #{position(page.rank)}</strong>
    <small>SERP 更新：{localDate(page.dataUpdatedAt ?? page.dataDate)}</small>
    <small>本次采集：{localDate(page.checkedAt)}</small>
  </div>)}</div>;
}

export function KeywordDetails() {
  const selection = useSeoSelection();
  const { region } = selection;
  const { data, error, loading, refreshing, refresh } = useDashboard(selection.site, selection.source, true);
  const okr = useKeywordOkr();
  const [search, setSearch] = useState("");
  const [origin, setOrigin] = useState("ALL");
  const [site, setSite] = useState("flatkey.ai");
  const [view, setView] = useState("FORMAL");
  const [section, setSection] = useState<"keywords" | "discovery" | "tasks" | "audit">("keywords");
  useEffect(() => { if (new URLSearchParams(window.location.search).get("view") === "discovery") setSection("discovery"); }, []);
  const [pool, setPool] = useState<KeywordPool>("FORMAL");
  const [mapping, setMapping] = useState("ALL");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [selected, setSelected] = useState<Key[]>([]);
  const okrItems = new Map((okr.data?.keywords ?? []).map(k => [k.id, k]));
  const isFlatkey = (keyword: DashboardKeyword) => (keyword.siteDomain ?? "flatkey.ai") === "flatkey.ai";
  const flatkeyKeywordId = (id: string) => id.startsWith("flatkey.ai:") ? id.slice("flatkey.ai:".length) : id;
  const okrFor = (keyword: DashboardKeyword) => isFlatkey(keyword) ? okrItems.get(flatkeyKeywordId(keyword.id)) : undefined;
  const pageFor = (keyword: DashboardKeyword) => {
    const target = okrFor(keyword);
    return keywordPageTag({ siteDomain: keyword.siteDomain ?? "flatkey.ai",
      mappingStatus: target?.mappingStatus, targetUrls: target?.targetUrls ?? keyword.targetUrls,
      candidateUrls: target?.candidateUrls,
      latestPageAuditVerdict: target?.latestPageAuditVerdict });
  };
  const appliedAt = okr.data?.initialized ? okr.data.audits.find(audit => audit.status === "APPLIED")?.appliedAt : null;
  useEffect(() => { if (appliedAt) refresh(); }, [appliedAt, refresh]);
  const loadedKeywords = (data?.keywords ?? []).filter(keyword => !data?.usingDemoData || !isFlatkey(keyword));
  const loadedFlatkeyIds = new Set(loadedKeywords.filter(isFlatkey).map(keyword => flatkeyKeywordId(keyword.id)));
  // A persisted target without a dashboard report still belongs in the OKR pool.
  // Its empty metrics describe unavailable evidence; no rank is inferred.
  const targetOnlyKeywords: DashboardKeyword[] = okr.data?.initialized ? [...okrItems.values()].filter(keyword => !loadedFlatkeyIds.has(keyword.id)).map(keyword => ({
    id: keyword.id, text: keyword.text, type: "MAIN", topicId: null, topicText: null,
    siteDomain: keyword.siteDomain, siteName: "Flatkey", targetUrls: keyword.targetUrls,
    parentId: null, parentIds: [], active: keyword.active, lastSyncedAt: null, volume: 0,
    marketVolumes: { US: null, JP: null, ES: null, BR: null }, latestRanks: { US: null, JP: null, ES: null, BR: null },
  })) : [];
  const evidenceFor = (keyword: DashboardKeyword) => keywordEvidence(keyword, region);
  const rankFor = (keyword: DashboardKeyword) => {
    const rank = keyword.latestRanks[region];
    return rank && String(rank.source) === "dataforseo_labs" ? rank : null;
  };
  const historicalEvidenceFor = (keyword: DashboardKeyword) => evidenceFor(keyword).filter(e => e.source === "gsc" || e.source === "ahrefs");
  const rankedPagesFor = (keyword: DashboardKeyword) => keywordRankingPages(rankFor(keyword), evidenceFor(keyword), keyword.siteDomain ?? "flatkey.ai");
  const rankingFor = (keyword: DashboardKeyword) => keywordRankingTag(rankFor(keyword));
  const rows = [...loadedKeywords, ...targetOnlyKeywords].filter(k => site === "all" || k.siteDomain === site)
    .filter(k => isFlatkey(k) ? okr.data?.initialized && okrFor(k)?.pool === pool : pool === "FORMAL" && keywordRelevance(k.siteDomain ?? "flatkey.ai", k.text).status === "relevant")
    .filter(k => mapping === "ALL" || (mapping === "MONITORABLE" ? pageFor(k).key === "MATCHED" : mapping === "CANDIDATE" ? pageFor(k).key !== "MATCHED" : pageFor(k).key === mapping.replace(/^PAGE_/, "")))
    .filter(k => origin === "ALL" || k.origin === origin)
    .filter(k => {
      if (view === "FORMAL") return true;
      const tag = rankingFor(k);
      return view === "EVIDENCE" ? tag.key !== "UNRANKED" : tag.key === view;
    })
    .filter(k => `${k.text} ${k.topicText ?? ""} ${okrFor(k)?.reason ?? ""}`.toLowerCase().includes(search.trim().toLowerCase()));
  async function excludeKeywords() {
    setBusy(true); setNotice("");
    try {
      const groups = new Map<string, string[]>();
      for (const k of (data?.keywords ?? []).filter(k => selected.includes(k.id))) {
        const domain = k.siteDomain ?? "flatkey.ai";
        groups.set(domain, [...(groups.get(domain) ?? []), k.text]);
      }
      let changed = 0;
      for (const [siteDomain, keywords] of groups) {
        const response = await fetch("/api/keywords/review", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ siteDomain, action: "exclude", keywords }) });
        const result = await response.json();
        if (!response.ok) throw new Error(result.message ?? "移除失败，请重试");
        changed += result.changed;
      }
      dashboardStore.clear(); setSelected([]); refresh();
      setNotice(`已从业务词库移除 ${changed} 条记录；后续导入不会自动恢复。`);
    } catch (failure) {
      dashboardStore.clear(); refresh();
      setNotice(failure instanceof Error ? failure.message : "移除失败，请重试");
    } finally { setBusy(false); }
  }
  const columns: ColumnsType<DashboardKeyword> = [
    { title: "关键词 / 页面与排名标签", dataIndex: "text", key: "keyword", width: 270, sorter: (a, b) => a.text.localeCompare(b.text), render: (text: string, k) => {
      const item = okrFor(k), review = keywordRelevance(k.siteDomain ?? "flatkey.ai", text), page = pageFor(k), ranking = rankingFor(k);
      return <div className="evidenceSummary"><strong>{text}</strong><div className="keywordStatusTags"><Tooltip title={page.tooltip}><Tag color={page.color}>{page.label}</Tag></Tooltip><Tooltip title={`${REGIONS[region].label} · ${ranking.tooltip}`}><Tag color={ranking.color}>{ranking.label}</Tag></Tooltip></div>{item ? <small>{POOLS[item.pool]}{item.protected ? " · 模型保护" : ""}</small> : review.status === "review" ? <Tooltip title={review.reason}><small>业务相关性待复核</small></Tooltip> : null}</div>;
    } },
    { title: "所属网站", key: "site", width: 110, render: (_, k) => k.siteName ?? "Flatkey" },
    { title: "目标页面 / 建设状态", key: "targets", width: 290, render: (_, k) => {
      const target = okrFor(k);
      const matched = [...new Set(target?.targetUrls ?? k.targetUrls ?? [])];
      const expansion = !matched.length && target?.workPlan?.action === "EXPAND";
      const urls = expansion ? target.workPlan!.pageUrls : matched;
      return <div className="evidenceSummary">{urls.length ? urls.map(url => <a className="observedUrl" href={url} target="_blank" rel="noreferrer" key={url}>{url.replace(/^https?:\/\//, "")}</a>) : <span className="muted">{target?.workPlan?.action === "BUILD" ? "暂无合适页面，待建设" : "未关联目标页面"}</span>}{expansion ? <small>已指定补充页面，内容待验收</small> : null}{target?.latestPageAuditCheckedAt ? <small>页面核验于 {new Date(target.latestPageAuditCheckedAt).toLocaleDateString("zh-CN", { timeZone: "Asia/Shanghai" })}</small> : null}<small>页面关联不代表已获得排名</small></div>;
    } },
    { title: "DataForSEO 数据库名次", key: "rank", width: 180, sorter: (a, b) => (rankFor(a)?.rank ?? Infinity) - (rankFor(b)?.rank ?? Infinity), render: (_, k) => {
      const rank = rankFor(k);
      return <div className="evidenceSummary"><Tooltip title="关键词按最新来源日期组内的最佳名次归入一个区间；多页面保留各自名次，不平均，也不重复计词。"><strong>{rank?.rank != null ? `#${position(rank.rank)}` : "暂无数据库记录"}</strong></Tooltip><small>{rank ? "Google 自然结果 · DataForSEO Labs" : "未返回不等于确认未排名"}</small></div>;
    } },
    { title: "真实来源日期 / 采集时间", key: "sourceDate", width: 210, render: (_, k) => {
      const rank = rankFor(k);
      return rank ? <div className="evidenceSummary"><span>SERP 更新：{localDate(rank.dataUpdatedAt ?? rank.dataDate)}</span><small>本次采集：{rank.checkedAt ? localDate(rank.checkedAt) : "未记录"}</small></div> : <span className="muted">暂无 DataForSEO 记录</span>;
    } },
    { title: "实际排名页面", key: "pages", width: 330, render: (_, k) => {
      const pages = rankedPagesFor(k);
      return pages.length ? <ObservedPages pages={pages} /> : <span className="muted">暂无 DataForSEO 排名页面{historicalEvidenceFor(k).length ? "；展开可查看历史证据" : ""}</span>;
    } },
    { title: `月搜索量 · ${REGIONS[region].label}`, key: "volume", width: 140, sorter: (a, b) => (a.marketVolumes[region] ?? -1) - (b.marketVolumes[region] ?? -1), render: (_, k) => number(k.marketVolumes[region]) },
    { title: "声量分析", key: "volumeReview", width: 170, render: (_, k) => <Tooltip title={k.volumeReview?.reasons.join("；")}><span className="muted">{k.volumeReview?.label ?? "历史不足，保留观察"}</span></Tooltip> },
    { title: "话题 / 词库来源", key: "topic", width: 180, render: (_, k) => <div className="evidenceSummary"><span>{k.topicText ?? "—"}</span><small>{ORIGINS.find(e => e.value === k.origin)?.label ?? "—"}</small></div> },
    { title: "筛检 / 关联理由", key: "auditReason", width: 320, render: (_, k) => <span className="okrReason">{okrFor(k)?.reason ?? "—"}</span> },
  ];
  return <main className="appShell">
    <PageHeader active="keywords" selection={selection} />
    <div className="pageIntro"><p className="eyebrow">BUSINESS TARGETS & RANKED KEYWORDS</p><h1>业务目标词与数据库排名</h1><p>业务目标与候选持续保留。已核实对应页面的词进入监控；缺页面的词保留为候选／待建设。</p></div>
    <div className="okrCaptureState"><strong>DataForSEO 数据库排名</strong><span>在数据管理中手动更新；自动付费更新尚未启用。</span>{okr.data?.initialized ? <span>正式目标 {okr.data.summary.formal} 词 · 模型保护 {okr.data.summary.protectedModels} 词 · 页面任务 {okr.data.tasks.length} 个</span> : null}</div>
    <p className="chartNote sourceExplanation">一个关键词可以对应多个目标页面；实际排名页面逐页显示各自名次、来源更新与采集时间，关键词只计一次。GSC、Ahrefs 保留在历史证据中。DataForSEO 数据库未返回某词，不能据此判断 Google 前 100 外。</p>
    {data?.usingDemoData ? <p className="loadError" role="alert">当前为演示数据，不能用于判断实际 Google 排名。</p> : null}
    {refreshing ? <p className="cacheNotice" role="status">正在获取最新词库与证据…</p> : null}
    {error ? <div className="loadError" role="alert"><span>{error}</span><button type="button" onClick={() => void refresh()}>重新加载</button></div> : null}
    {(site === "flatkey.ai" || site === "all") && okr.error ? <div className="loadError" role="alert"><span>正式目标读取失败：{okr.error}。未用原始词库替代正式目标。</span><button type="button" onClick={okr.refresh}>重新加载正式目标</button></div> : null}
    {(site === "flatkey.ai" || site === "all") && okr.data && !okr.data.initialized && section !== "audit" ? <div className="okrUninitialized" role="status">清洁审计尚未应用到数据库，Flatkey 正式目标暂不展示。 <button type="button" onClick={() => setSection("audit")}>预览并应用清理</button></div> : null}
    <div className="keywordViewTabs" role="tablist" aria-label="关键词明细查看范围"><button type="button" role="tab" aria-selected={section === "keywords"} className={section === "keywords" ? "selected" : ""} onClick={() => setSection("keywords")}>关键词明细</button><button type="button" role="tab" aria-selected={section === "discovery"} className={section === "discovery" ? "selected" : ""} onClick={() => setSection("discovery")}>数据库发现</button><button type="button" role="tab" aria-selected={section === "tasks"} className={section === "tasks" ? "selected" : ""} onClick={() => setSection("tasks")}>页面任务{okr.data?.initialized ? `（${okr.data.tasks.length}）` : ""}</button><button type="button" role="tab" aria-selected={section === "audit"} className={section === "audit" ? "selected" : ""} onClick={() => setSection("audit")}>审计与应用</button></div>
    {section === "keywords" ? <>
    <div className="detailToolbar"><div className="detailFilters">
      <label className="originSelectField"><span>排名区间</span><Select aria-label="DataForSEO 排名区间筛选" className="originSelect" value={view} onChange={setView} options={[{ value: "FORMAL", label: "当前分类全部词（含待核验）" }, { value: "EVIDENCE", label: "有排名（1–100）" }, { value: "TOP_10", label: "前10（1–10）" }, { value: "TOP_30", label: "前30（11–30）" }, { value: "TOP_50", label: "前50（31–50）" }, { value: "TOP_100", label: "前100（51–100）" }, { value: "UNRANKED", label: "暂无数据库记录 · 待核验" }]} /></label>
      <label className="originSelectField"><span>网站</span><Select aria-label="所属网站" className="originSelect" value={site} onChange={value => { setSite(value); setPool("FORMAL"); setMapping("ALL"); }} options={[{ value: "all", label: "全部网站" }, ...SITES.map(e => ({ value: e.domain, label: e.name }))]} /></label>
      {site === "flatkey.ai" || site === "all" ? <label className="originSelectField"><span>Flatkey 词池</span><Select aria-label="业务词池" className="originSelect" value={pool} onChange={value => { setPool(value); setView("FORMAL"); setMapping("ALL"); }} options={(Object.entries(POOLS) as Array<[KeywordPool, string]>).map(([value, label]) => ({ value, label: `${label}${okr.data?.initialized ? `（${okr.data.keywords.filter(item => item.pool === value).length}）` : ""}` }))} /></label> : null}
      {site === "flatkey.ai" || site === "all" ? <label className="originSelectField"><span>页面状态</span><Select aria-label="页面关联状态" className="originSelect" value={mapping} onChange={setMapping} options={[{ value: "ALL", label: "全部页面状态" }, { value: "MONITORABLE", label: "已匹配页面" }, { value: "CANDIDATE", label: "候选（全部）" }, ...PAGE_TAG_FILTERS]} /></label> : null}
      <label className="originSelectField"><span>词库来源</span><Select aria-label="词库来源" className="originSelect" value={origin} onChange={setOrigin} options={ORIGINS} /></label>
    </div><label className="searchField"><Search size={17} /><input aria-label="搜索关键词或话题" placeholder="搜索关键词或话题…" value={search} onChange={event => setSearch(event.target.value)} /></label></div>
    <div className="reviewToolbar"><p className="chartNote">{REGIONS[region].label} · 当前 {rows.length} 条{site === "flatkey.ai" && okr.data?.initialized ? ` ${POOLS[pool]}` : ""}；展开可核对来源报告、页面与原始指标。</p>{site === "flatkey.ai" ? <button type="button" className="okrRefresh" onClick={() => setSection("audit")}>筛检与恢复记录</button> : <Tooltip title="仅从对应网站词库和统计中移除，保留原始采集记录，可恢复。Flatkey 词池请查看本页审计记录。"><button type="button" disabled={!selected.length || busy || data?.usingDemoData} onClick={() => void excludeKeywords()}>{busy ? "正在移除…" : `移除无关词${selected.length ? `（${selected.length}）` : ""}`}</button></Tooltip>}</div>
    {notice ? <p className="cacheNotice" role="status">{notice}</p> : null}
    <section className="tablePanel"><Table className="keywordTable" columns={columns} dataSource={rows} rowKey="id" loading={loading || okr.loading}
      rowSelection={site === "flatkey.ai" ? undefined : { selectedRowKeys: selected, onChange: keys => setSelected(keys.slice(0, 500)), preserveSelectedRowKeys: true, getCheckboxProps: k => ({ disabled: isFlatkey(k) }) }}
      expandable={{ expandedRowRender: k => <div className="keywordEvidenceDetails">{okrFor(k) ? <section><strong>筛检与页面关联结论</strong><p>{okrFor(k)?.latestPageAuditReason ?? okrFor(k)?.reason ?? "暂无说明"}</p>{okrFor(k)?.candidateUrls.length ? <><p>候选页面（尚未确认关联，不作为已完成覆盖）：</p><ul>{okrFor(k)?.candidateUrls.map(url => <li key={url}><a href={url} target="_blank" rel="noreferrer">{url}</a></li>)}</ul></> : null}{okrFor(k)?.actualPages.length ? <><p>审计保留的历史来源页面（不参与默认排名）：</p><ul>{okrFor(k)?.actualPages.map((page, index) => <li key={`${page.url}:${index}`}><a href={page.url} target="_blank" rel="noreferrer">{page.url}</a> · {page.source.toUpperCase()} · {page.region} · {page.periodStart && page.periodEnd ? `${page.periodStart} 至 ${page.periodEnd}` : "未记录统计区间"}</li>)}</ul></> : null}<p className="chartNote">审计批次：{okrFor(k)?.auditId ?? "—"}；历史来源页面不代表当前 Google 排名。</p></section> : null}<section><strong>DataForSEO 已存排名</strong>{rankFor(k) ? <><p>Google 自然结果名次：{position(rankFor(k)!.rank)} · {REGIONS[region].label}</p><p>来源 SERP 更新：{localDate(rankFor(k)!.dataUpdatedAt ?? rankFor(k)!.dataDate)} · 本次采集：{rankFor(k)!.checkedAt ? localDate(rankFor(k)!.checkedAt) : "未记录"}</p>{rankedPagesFor(k).length ? <ObservedPages pages={rankedPagesFor(k)} /> : <p className="muted">本批次未取得独立页面排名。</p>}<p className="chartNote">每个页面保留各自名次与来源时间。关键词采用最新来源日期组内的最佳名次归入一个区间，不平均页面名次，不重复计词。</p></> : <p>该地区暂无 DataForSEO 数据库记录；未返回不等于确认没有排名。</p>}</section><details className="historicalEvidence"><summary>历史原始证据 · GSC / Ahrefs（{historicalEvidenceFor(k).length} 条）</summary><p className="chartNote">历史曝光、均位和页面报告仅供复查，不参与主表排名与前 10／100 筛选。</p>{historicalEvidenceFor(k).length ? historicalEvidenceFor(k).map(e => {
        const domain = k.siteDomain ?? "flatkey.ai";
        const resource = domain === "flatkey.ai" ? `sc-domain:${domain}` : `https://${domain}/`;
        const params = new URLSearchParams({ resource_id: resource, metrics: "CLICKS,IMPRESSIONS,CTR,POSITION", breakdown: "page", country: { US: "usa", JP: "jpn", ES: "esp", BR: "bra" }[region], query: `!${k.text}` });
        if (e.periodStart) params.set("start_date", e.periodStart.replaceAll("-", ""));
        if (e.periodEnd) params.set("end_date", e.periodEnd.replaceAll("-", ""));
        return <section key={`${e.source}:${e.scope}:${e.periodStart}:${e.periodEnd}:${e.dataDate}`}><strong>{e.source === "gsc" ? "GSC 历史曝光记录" : "Ahrefs 来源检测"}</strong><p>{REGIONS[region].label} · {period(e)} · 采集于 {e.checkedAt ? new Date(e.checkedAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" }) : "未知"}</p>
          {e.source === "gsc" ? <a href={`https://search.google.com/search-console/performance/search-analytics?${params}`} target="_blank" rel="noreferrer">打开该关键词的 GSC 页面报告 ↗</a> : <a href={`https://app.ahrefs.com/site-explorer/organic-keywords?target=${encodeURIComponent(domain)}&country=${REGIONS[region].gl}`} target="_blank" rel="noreferrer">打开 Ahrefs 来源报告 ↗</a>}
          {e.pages.length ? <ul>{e.pages.map(p => <li key={p.url}><a href={p.url} target="_blank" rel="noreferrer">{p.url}</a> · 页面{e.source === "gsc" ? "平均排名" : "名次"} {position(p.rank)}{e.source === "gsc" ? ` · 曝光 ${number(p.impressions)} · 点击 ${number(p.clicks)}` : ""}</li>)}</ul> : <p className="muted">{e.url ? `来源附带页面：${e.url}；未取得独立页面指标，查询均值不视作该页面名次。` : "尚未取得独立页面记录。"}</p>}
          {e.daily?.length ? <table className="dailyEvidenceTable"><thead><tr><th>日期</th><th>曝光</th><th>点击</th><th>当日平均位置</th><th>实际页面</th></tr></thead><tbody>{e.daily.map(day => <tr key={`${day.date}:${day.url ?? "query"}`}><td>{day.date}</td><td>{number(day.impressions)}</td><td>{number(day.clicks)}</td><td>{position(day.rank)}</td><td>{day.pages.length ? day.pages.map(page => <div key={page.url}><a href={page.url} target="_blank" rel="noreferrer">{page.url}</a> · 页面均值 {position(page.rank)}</div>) : day.url ? <a href={day.url} target="_blank" rel="noreferrer">{day.url}</a> : "来源未提供页面"}</td></tr>)}</tbody></table> : e.source === "gsc" ? <p className="muted">尚未采集逐日明细；周报告不拆算成每日名次。</p> : null}
        </section>;
      }) : <p>尚无 GSC / Ahrefs 历史原始证据。</p>}</details><a href={`https://www.google.com/search?${new URLSearchParams({ q: k.text, gl: REGIONS[region].gl, hl: REGIONS[region].hl, pws: "0" })}`} target="_blank" rel="noreferrer">在 Google 搜索此词 ↗</a><p className="chartNote">搜索链接传入国家与语言偏好；实际位置、设备和时间会影响结果。DataForSEO 数据库记录不代表此刻的实时搜索结果。</p></div> }}
      pagination={{ defaultPageSize: 50, showSizeChanger: true, showTotal: total => `共 ${total} 条记录` }} scroll={{ x: 2100 }} size="middle" /></section>
    </> : section === "discovery" ? <RankingDiscoveryTable site={site} region={region} /> : <KeywordOkrWorkspace okr={okr} section={section} />}
  </main>;
}
