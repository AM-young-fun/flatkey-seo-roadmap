"use client";
import { useEffect, useState, type Key } from "react";
import { Table, Tooltip, Select } from "antd";
import type { ColumnsType } from "antd/es/table";
import { Search } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { useKeywordOkr } from "@/components/useKeywordOkr";
import { KeywordOkrWorkspace } from "@/components/KeywordOkrWorkspace";
import { SITES, useSeoSelection } from "@/components/useSeoSelection";
import { useDashboard } from "@/components/useDashboard";
import type { DashboardKeyword, RankingEvidence } from "@/lib/types";
import { REGIONS } from "@/lib/seo";
import { dashboardStore } from "@/lib/dashboard-client";
import { hasRankingEvidence, keywordEvidence } from "@/lib/keyword-evidence";
import { keywordRelevance } from "@/lib/keyword-relevance";
import type { KeywordPool } from "@/lib/keyword-okr";
import { canMonitorKeyword } from "@/lib/keyword-monitoring";

const POOLS: Record<KeywordPool, string> = { FORMAL: "业务目标", RESEARCH: "候选研究", ARCHIVED: "已归档", MERGED: "已归并" };
const MAPPING_LABELS: Record<string, string> = { READY: "已有匹配页", MODEL_PROTECTED: "模型目标 · 保留观察", RECORDED: "已记录 · 待核实", UNMAPPED: "未关联页面", NEEDS_BUILD: "待建设", NEEDS_EXPANSION: "需补强", NEEDS_REMAP: "错配待处理", MULTIPLE_CANDIDATES: "多个候选 · 待确认" };

const ORIGINS = [
  { value: "ALL", label: "全部来源" }, { value: "PLANNED", label: "页面目标词" },
  { value: "CLUSTER", label: "集群页面词" }, { value: "DISCOVERED", label: "搜索报告发现词" },
  { value: "RESEARCH", label: "研究词" },
];
const number = (value: number | null | undefined) => value == null ? "—" : value.toLocaleString("zh-CN");
const position = (value: number | null) => value == null ? "暂无数据" : Number(value.toFixed(2)).toString();
const period = (e: RankingEvidence) => e.periodStart && e.periodEnd ? `${e.periodStart} 至 ${e.periodEnd}` : e.dataDate;

export function KeywordDetails() {
  const selection = useSeoSelection();
  const { region } = selection;
  const { data, error, loading, refreshing, refresh } = useDashboard(selection.site, selection.source);
  const okr = useKeywordOkr();
  const [search, setSearch] = useState("");
  const [origin, setOrigin] = useState("ALL");
  const [site, setSite] = useState("flatkey.ai");
  const [view, setView] = useState("FORMAL");
  const [section, setSection] = useState<"keywords" | "tasks" | "audit">("keywords");
  const [pool, setPool] = useState<KeywordPool>("FORMAL");
  const [mapping, setMapping] = useState("ALL");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [selected, setSelected] = useState<Key[]>([]);
  const okrItems = new Map((okr.data?.keywords ?? []).map(k => [k.id, k]));
  const isFlatkey = (keyword: DashboardKeyword) => (keyword.siteDomain ?? "flatkey.ai") === "flatkey.ai";
  const flatkeyKeywordId = (id: string) => id.startsWith("flatkey.ai:") ? id.slice("flatkey.ai:".length) : id;
  const okrFor = (keyword: DashboardKeyword) => isFlatkey(keyword) ? okrItems.get(flatkeyKeywordId(keyword.id)) : undefined;
  const monitorable = (keyword: DashboardKeyword) => {
    const target = okrFor(keyword);
    return canMonitorKeyword({ siteDomain: keyword.siteDomain ?? "flatkey.ai", pool: target?.pool,
      mappingStatus: target?.mappingStatus, targetUrls: target?.targetUrls ?? keyword.targetUrls,
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
  const rows = [...loadedKeywords, ...targetOnlyKeywords].filter(k => site === "all" || k.siteDomain === site)
    .filter(k => isFlatkey(k) ? okr.data?.initialized && okrFor(k)?.pool === pool : pool === "FORMAL" && keywordRelevance(k.siteDomain ?? "flatkey.ai", k.text).status === "relevant")
    .filter(k => mapping === "ALL" || (mapping === "MONITORABLE" ? monitorable(k) : mapping === "CANDIDATE" ? !monitorable(k) : okrFor(k)?.mappingStatus === mapping))
    .filter(k => origin === "ALL" || k.origin === origin)
    .filter(k => view === "FORMAL" || evidenceFor(k).some(e => hasRankingEvidence(e, view === "TOP10" ? 10 : view === "REPORTED" ? Infinity : 100)))
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
  const sourceColumn = (source: "gsc" | "ahrefs"): ColumnsType<DashboardKeyword>[number] => ({
    title: source === "gsc" ? "GSC 本周曝光 / 点击" : "Ahrefs 本周检测名次", key: source, width: 210,
    sorter: (a, b) => (evidenceFor(a).find(e => e.source === source)?.rank ?? Infinity) - (evidenceFor(b).find(e => e.source === source)?.rank ?? Infinity),
    render: (_, k) => {
      const records = evidenceFor(k).filter(e => e.source === source);
      const e = records.find(e => e.scope === "query") ?? records[0];
      if (!e) return <span className="muted">暂无本周来源记录</span>;
      return <div className="evidenceSummary"><strong>{e.scope === "pages" ? "仅页面记录" : e.scope === "daily" ? "单日曝光记录" : source === "gsc" ? `${number(e.impressions)} / ${number(e.clicks)}` : e.rankStatus === "outside_top100" && e.rank == null ? "确认前 100 外" : position(e.rank)}</strong>
        <small>{period(e)}</small>
        {source === "gsc" && e.scope === "query" ? <small>{e.rankStatus === "outside_top100" && e.rank == null ? "确认前 100 外" : `周平均位置 ${position(e.rank)}（参考值）`}</small> : null}
        {records.some(record => record.daily?.length) ? <small>展开查看逐日记录</small> : null}
        <small>当前 Google 搜索尚未核验</small></div>;
    },
  });
  const columns: ColumnsType<DashboardKeyword> = [
    { title: "关键词", dataIndex: "text", key: "keyword", width: 230, sorter: (a, b) => a.text.localeCompare(b.text), render: (text: string, k) => { const item = okrFor(k); const review = keywordRelevance(k.siteDomain ?? "flatkey.ai", text); return <div className="evidenceSummary"><strong>{text}</strong>{item ? <><small>{POOLS[item.pool]}{item.protected ? " · 模型保护" : ""}</small>{["FORMAL", "RESEARCH"].includes(item.pool) ? <small>{monitorable(k) ? "已有对应页面 · 可监控" : "候选 · 待建设或核实页面"}</small> : null}</> : review.status === "review" ? <Tooltip title={review.reason}><small>业务相关性待复核</small></Tooltip> : null}</div>; } },
    { title: "所属网站", key: "site", width: 110, render: (_, k) => k.siteName ?? "Flatkey" },
    { title: "目标页面 / 建设状态", key: "targets", width: 290, render: (_, k) => {
      const target = okrFor(k);
      const urls = target?.targetUrls ?? k.targetUrls ?? [];
      return <div className="evidenceSummary">{urls.length ? urls.map(url => <a className="observedUrl" href={url} target="_blank" rel="noreferrer" key={url}>{url.replace(/^https?:\/\//, "")}</a>) : <span className="muted">未关联目标页面</span>}{target ? <Tooltip title={target.latestPageAuditReason ?? target.reason}><small>{target.latestPageAuditVerdict === "REVIEW" ? "本轮待核实 · 保留候选" : MAPPING_LABELS[target.mappingStatus]}</small></Tooltip> : null}{target?.latestPageAuditCheckedAt ? <small>页面核验于 {new Date(target.latestPageAuditCheckedAt).toLocaleDateString("zh-CN", { timeZone: "Asia/Shanghai" })}</small> : null}<small>目标关联不代表已获得排名</small></div>;
    } },
    sourceColumn("gsc"), sourceColumn("ahrefs"),
    { title: "实际展示 / 检测页面", key: "pages", width: 330, render: (_, k) => {
      const urls = [...new Set(evidenceFor(k).flatMap(e => [e.url, ...e.pages.map(p => p.url), ...(e.daily ?? []).flatMap(day => [day.url, ...day.pages.map(p => p.url)])]).filter((url): url is string => Boolean(url)))];
      return urls.length ? <div className="evidenceSummary">{urls.map(url => <a className="observedUrl" href={url} target="_blank" rel="noreferrer" key={url}>{url.replace(/^https?:\/\//, "")}</a>)}<small>展开查看页面自己的排名与日期</small></div> : <span className="muted">暂无本周页面证据{okrFor(k)?.actualPages.length ? `；展开查看 ${okrFor(k)?.actualPages.length} 条历史记录` : ""}</span>;
    } },
    { title: `月搜索量 · ${REGIONS[region].label}`, key: "volume", width: 140, sorter: (a, b) => (a.marketVolumes[region] ?? -1) - (b.marketVolumes[region] ?? -1), render: (_, k) => number(k.marketVolumes[region]) },
    { title: "声量分析", key: "volumeReview", width: 170, render: (_, k) => <Tooltip title={k.volumeReview?.reasons.join("；")}><span className="muted">{k.volumeReview?.label ?? "历史不足，保留观察"}</span></Tooltip> },
    { title: "话题 / 词库来源", key: "topic", width: 180, render: (_, k) => <div className="evidenceSummary"><span>{k.topicText ?? "—"}</span><small>{ORIGINS.find(e => e.value === k.origin)?.label ?? "—"}</small></div> },
    { title: "筛检 / 关联理由", key: "auditReason", width: 320, render: (_, k) => <span className="okrReason">{okrFor(k)?.reason ?? "—"}</span> },
  ];
  return <main className="appShell">
    <PageHeader active="keywords" selection={selection} />
    <div className="pageIntro"><p className="eyebrow">BUSINESS TARGETS & WEEKLY EVIDENCE</p><h1>业务目标词与最近一周表现</h1><p>{data?.reportingPeriod ? `${data.reportingPeriod.start} 至 ${data.reportingPeriod.end} · ` : "最近 7 个完整自然日 · "}业务目标与候选持续保留。已核实对应页面的词进入监控；缺页面的词保留为候选／待建设。</p></div>
    <div className="okrCaptureState"><strong>排名抓取已关闭</strong><span>GSC 为历史曝光记录；目标页面与实际来源页面分别展示。</span>{okr.data?.initialized ? <span>正式目标 {okr.data.summary.formal} 词 · 模型保护 {okr.data.summary.protectedModels} 词 · 页面任务 {okr.data.tasks.length} 个</span> : null}</div>
    <p className="chartNote sourceExplanation">GSC 显示本周实际曝光、点击及页面；Ahrefs 显示本周来源检测名次。周均值仅供参考，当前 Google 搜索未核验。缺少本周采集时留空，不用旧区间填充。</p>
    {data?.usingDemoData ? <p className="loadError" role="alert">当前为演示数据，不能用于判断实际 Google 排名。</p> : null}
    {refreshing ? <p className="cacheNotice" role="status">正在获取最新词库与证据…</p> : null}
    {error ? <div className="loadError" role="alert"><span>{error}</span><button type="button" onClick={() => void refresh()}>重新加载</button></div> : null}
    {(site === "flatkey.ai" || site === "all") && okr.error ? <div className="loadError" role="alert"><span>正式目标读取失败：{okr.error}。未用原始词库替代正式目标。</span><button type="button" onClick={okr.refresh}>重新加载正式目标</button></div> : null}
    {(site === "flatkey.ai" || site === "all") && okr.data && !okr.data.initialized && section !== "audit" ? <div className="okrUninitialized" role="status">清洁审计尚未应用到数据库，Flatkey 正式目标暂不展示。 <button type="button" onClick={() => setSection("audit")}>预览并应用清理</button></div> : null}
    <div className="keywordViewTabs" role="tablist" aria-label="关键词明细查看范围"><button type="button" role="tab" aria-selected={section === "keywords"} className={section === "keywords" ? "selected" : ""} onClick={() => setSection("keywords")}>关键词明细</button><button type="button" role="tab" aria-selected={section === "tasks"} className={section === "tasks" ? "selected" : ""} onClick={() => setSection("tasks")}>页面任务{okr.data?.initialized ? `（${okr.data.tasks.length}）` : ""}</button><button type="button" role="tab" aria-selected={section === "audit"} className={section === "audit" ? "selected" : ""} onClick={() => setSection("audit")}>审计与应用</button></div>
    {section === "keywords" ? <>
    <div className="detailToolbar"><div className="detailFilters">
      <label className="originSelectField"><span>查看范围</span><Select aria-label="排名证据筛选" className="originSelect" value={view} onChange={setView} options={[{ value: "FORMAL", label: "当前分类全部词（含暂无证据）" }, { value: "EVIDENCE", label: "有前 100 排名及页面证据" }, { value: "TOP10", label: "有前 10 排名及页面证据" }, { value: "REPORTED", label: "全部有排名及页面记录" }]} /></label>
      <label className="originSelectField"><span>网站</span><Select aria-label="所属网站" className="originSelect" value={site} onChange={value => { setSite(value); setPool("FORMAL"); setMapping("ALL"); }} options={[{ value: "all", label: "全部网站" }, ...SITES.map(e => ({ value: e.domain, label: e.name }))]} /></label>
      {site === "flatkey.ai" || site === "all" ? <label className="originSelectField"><span>Flatkey 词池</span><Select aria-label="业务词池" className="originSelect" value={pool} onChange={value => { setPool(value); setView("FORMAL"); setMapping("ALL"); }} options={(Object.entries(POOLS) as Array<[KeywordPool, string]>).map(([value, label]) => ({ value, label: `${label}${okr.data?.initialized ? `（${okr.data.keywords.filter(item => item.pool === value).length}）` : ""}` }))} /></label> : null}
      {site === "flatkey.ai" || site === "all" ? <label className="originSelectField"><span>页面状态</span><Select aria-label="页面关联状态" className="originSelect" value={mapping} onChange={setMapping} options={[{ value: "ALL", label: "全部页面状态" }, { value: "MONITORABLE", label: "已有对应页面 · 可监控" }, { value: "CANDIDATE", label: "候选 · 待建设或核实" }, ...Object.entries(MAPPING_LABELS).map(([value, label]) => ({ value, label }))]} /></label> : null}
      <label className="originSelectField"><span>词库来源</span><Select aria-label="词库来源" className="originSelect" value={origin} onChange={setOrigin} options={ORIGINS} /></label>
    </div><label className="searchField"><Search size={17} /><input aria-label="搜索关键词或话题" placeholder="搜索关键词或话题…" value={search} onChange={event => setSearch(event.target.value)} /></label></div>
    <div className="reviewToolbar"><p className="chartNote">{REGIONS[region].label} · 当前 {rows.length} 条{site === "flatkey.ai" && okr.data?.initialized ? ` ${POOLS[pool]}` : ""}；展开可核对来源报告、页面与原始指标。</p>{site === "flatkey.ai" ? <button type="button" className="okrRefresh" onClick={() => setSection("audit")}>筛检与恢复记录</button> : <Tooltip title="仅从对应网站词库和统计中移除，保留原始采集记录，可恢复。Flatkey 词池请查看本页审计记录。"><button type="button" disabled={!selected.length || busy || data?.usingDemoData} onClick={() => void excludeKeywords()}>{busy ? "正在移除…" : `移除无关词${selected.length ? `（${selected.length}）` : ""}`}</button></Tooltip>}</div>
    {notice ? <p className="cacheNotice" role="status">{notice}</p> : null}
    <section className="tablePanel"><Table className="keywordTable" columns={columns} dataSource={rows} rowKey="id" loading={loading || okr.loading}
      rowSelection={site === "flatkey.ai" ? undefined : { selectedRowKeys: selected, onChange: keys => setSelected(keys.slice(0, 500)), preserveSelectedRowKeys: true, getCheckboxProps: k => ({ disabled: isFlatkey(k) }) }}
      expandable={{ expandedRowRender: k => <div className="keywordEvidenceDetails">{okrFor(k) ? <section><strong>筛检与页面关联结论</strong><p>{okrFor(k)?.latestPageAuditReason ?? okrFor(k)?.reason ?? "暂无说明"}</p>{okrFor(k)?.candidateUrls.length ? <><p>候选页面（尚未确认关联，不作为已完成覆盖）：</p><ul>{okrFor(k)?.candidateUrls.map(url => <li key={url}><a href={url} target="_blank" rel="noreferrer">{url}</a></li>)}</ul></> : null}{okrFor(k)?.actualPages.length ? <><p>审计保留的历史来源页面（与本周指标分别记录）：</p><ul>{okrFor(k)?.actualPages.map((page, index) => <li key={`${page.url}:${index}`}><a href={page.url} target="_blank" rel="noreferrer">{page.url}</a> · {page.source.toUpperCase()} · {page.region} · {page.periodStart && page.periodEnd ? `${page.periodStart} 至 ${page.periodEnd}` : "未记录统计区间"}</li>)}</ul></> : null}<p className="chartNote">审计批次：{okrFor(k)?.auditId ?? "—"}；历史来源页面不代表当前 Google 排名。</p></section> : null}{evidenceFor(k).length ? evidenceFor(k).map(e => {
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
      }) : <p>尚无排名证据；目标页面和研究词不代表已获得排名。</p>}<a href={`https://www.google.com/search?${new URLSearchParams({ q: k.text, gl: REGIONS[region].gl, hl: REGIONS[region].hl, pws: "0" })}`} target="_blank" rel="noreferrer">在 Google 搜索此词 ↗</a><p className="chartNote">来源未记录设备和搜索类型；搜索链接传入国家与语言偏好，实际位置、设备和时间仍会影响结果。当前未进行实时 SERP 核验。</p></div> }}
      pagination={{ defaultPageSize: 50, showSizeChanger: true, showTotal: total => `共 ${total} 条记录` }} scroll={{ x: 2100 }} size="middle" /></section>
    </> : <KeywordOkrWorkspace okr={okr} section={section} />}
  </main>;
}
