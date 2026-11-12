"use client";
import { UiSelect } from "./UiSelect";

import Link from "next/link";
import { Modal } from "antd";
import { useEffect, useMemo, useRef, useState } from "react";
import { PageHeader } from "./PageHeader";
import { KeywordResearchEvidence } from "./KeywordResearchEvidence";
import { useSeoCountry } from "./useSeoCountry";
import { useSeoRead, numberText, shanghaiStamp } from "./useSeoAnalytics";
import { hydrateOverviewPayload, type OverviewPayload } from "@/lib/overview-payload";
import type { DashboardResponse } from "@/lib/types";
import { buildKeywordOpportunities, combineKeywordMarkets, sortKeywordOpportunities, estimateMonthlyClicks, optimizationWindow, flatkeyPage, opportunityReason, planKey, rankText, type KeywordMapping, type KeywordOpportunity, type KeywordPlan, type OpportunityMarket, type OpportunitySort } from "@/lib/keyword-opportunities";
import { propertyToday, validRange } from "@/lib/seo-date-range";
import { REGIONS, REGION_CODES } from "@/lib/seo";
import workspace from "./SeoWorkspace.module.css";
import styles from "./KeywordOpportunities.module.css";

type Worklist = { sites: { domain: string; keywords: KeywordMapping[]; candidates?: KeywordMapping[] }[] };
const marketOptions = REGION_CODES.map(value => ({ value, label: REGIONS[value].label }));
type RemotePlan = Omit<KeywordPlan, "optimizedAt"> & { country: OpportunityMarket; keyword: string; pageUrl: string; optimizedAt: string | null };
const uiPlan = (value: RemotePlan): KeywordPlan => ({ role: value.role, targetRank: value.targetRank, ctr: value.ctr, notes: value.notes, updatedAt: value.updatedAt, optimizedAt: value.optimizedAt ?? "", changes: value.changes ?? "", baseline: value.baseline });
const blankPlan = (): KeywordPlan => ({ role: "primary", targetRank: "", ctr: "", notes: "", updatedAt: "", optimizedAt: "", changes: "" });

const rankRanges = [
  { label: "已进入前 100", min: 1, max: 100 },
  { label: "第 1–3 名", min: 1, max: 3 },
  { label: "第 4–10 名", min: 4, max: 10 },
  { label: "第 11–20 名", min: 11, max: 20 },
  { label: "第 21–50 名", min: 21, max: 50 },
  { label: "第 51–100 名", min: 51, max: 100 },
];
const sortOptions: { value: OpportunitySort; label: string }[] = [
  { value: "opportunity", label: "选题优先级" },
  { value: "rank-asc", label: "排名由高到低" },
  { value: "rank-desc", label: "排名由低到高" },
  { value: "volume", label: "搜索量由高到低" },
  { value: "volume-asc", label: "搜索量由低到高" },
];
type RankRange = typeof rankRanges[number];
const inRankRange = (row: KeywordOpportunity, range: RankRange) =>
  row.rank !== null && row.rank >= range.min && row.rank <= range.max;

export function KeywordOpportunities() {
  const dashboard = useSeoRead<DashboardResponse | OverviewPayload>("/api/views?view=dashboard&site=flatkey.ai");
  const worklist = useSeoRead<Worklist>("/api/seo/worklist");
  const plans = useSeoRead<{ storage: "server"; plans: RemotePlan[] }>("/api/seo/optimization-plans");
  const [saving, setSaving] = useState(false);
  const [country] = useSeoCountry();
  const [query, setQuery] = useState(""), [targetUrl, setTargetUrl] = useState("");
  const urlQuery = useRef<string | null>(null);
  const [planCountry, setPlanCountry] = useState<OpportunityMarket>("US");
  const [sort, setSort] = useState<OpportunitySort>("opportunity");
  const [rankRange, setRankRange] = useState<RankRange | null>(null);
  const [page, setPage] = useState(1), [selected, setSelected] = useState<string | null>(null), [targetPage, setTargetPage] = useState("");
  const [plan, setPlan] = useState<KeywordPlan>(blankPlan), [saved, setSaved] = useState<Record<string, KeywordPlan>>({}), [message, setMessage] = useState("");
  useEffect(() => {
    const read = () => {
      const params = new URLSearchParams(location.search);
      const target = flatkeyPage(params.get("targetUrl") ?? "") ?? ""; setTargetUrl(target);
      const nextQuery = params.get("keyword") ?? params.get("q") ?? "";
      if (urlQuery.current !== nextQuery) { urlQuery.current = nextQuery; setQuery(nextQuery); }
      setSelected(null);
      setPage(1);
    };
    read(); addEventListener("popstate", read);
    return () => removeEventListener("popstate", read);
  }, []);
  useEffect(() => {
    if (plans.data) setSaved(Object.fromEntries(plans.data.plans.map(record => [planKey(record.country, record.keyword, record.pageUrl), uiPlan(record)])));
  }, [plans.data]);
  const rowsByMarket = useMemo(() => {
    const markets = new Map<OpportunityMarket, KeywordOpportunity[]>();
    if (!dashboard.data || dashboard.data.usingDemoData) return markets;
    const site = worklist.data?.sites.find(site => site.domain === "flatkey.ai");
    const keywords = hydrateOverviewPayload(dashboard.data).keywords;
    const mappings = [...(site?.keywords ?? []), ...(site?.candidates ?? [])];
    for (const market of REGION_CODES) {
      markets.set(market, buildKeywordOpportunities(keywords, mappings, market));
    }
    return markets;
  }, [dashboard.data, worklist.data]);
  const allRows = useMemo(() => combineKeywordMarkets(rowsByMarket), [rowsByMarket]);
  const rows = country === "all" ? allRows : rowsByMarket.get(country) ?? [];
  const scopedRows = useMemo(() => targetUrl ? rows.filter(row => row.urls.includes(targetUrl)) : rows, [rows, targetUrl]);
  const rankCounts = useMemo(() => rankRanges.map(range => scopedRows.filter(row => inRankRange(row, range)).length), [scopedRows]);
  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    return sortKeywordOpportunities(scopedRows.filter(row =>
      (!rankRange || inRankRange(row, rankRange)) &&
      (!term || [row.keyword, ...row.urls].some(value => value.toLowerCase().includes(term))),
    ), sort);
  }, [scopedRows, query, rankRange, sort]);
  const known = filtered.filter(row => row.volume != null), volume = known.reduce((sum, row) => sum + row.volume!, 0);
  const volumeLabel = country === "all" ? "四国已知月搜索量" : "月搜索量";
  const rankLabel = country === "all" ? "本站最佳排名" : "本站当前排名";
  const active = rowsByMarket.get(planCountry)?.find(row => row.key === selected);
  const pageCount = Math.max(1, Math.ceil(filtered.length / 25));
  const currentPage = Math.min(page, pageCount);
  const clicks = estimateMonthlyClicks(active?.volume ?? null, plan.ctr);
  function savedTarget(row: KeywordOpportunity) {
    for (const market of country === "all" ? REGION_CODES : [country]) {
      const url = (targetUrl ? [targetUrl] : row.urls).find(url => saved[planKey(market, row.keyword, url)]);
      if (url) return { market, url };
    }
    return null;
  }
  function loadPlan(row: KeywordOpportunity, url: string, market: OpportunityMarket) {
    setPlanCountry(market);
    setTargetPage(url);
    setPlan({ ...blankPlan(), ...saved[planKey(market, row.keyword, url)] });
    setMessage("");
  }
  function choose(row: KeywordOpportunity) {
    const existing = savedTarget(row);
    const market = existing?.market ?? (country === "all" ? row.bestMarkets?.[0] ?? REGION_CODES[0] : country);
    setSelected(row.key);
    loadPlan(row, existing?.url ?? (targetUrl || row.urls[0] || ""), market);
  }
  function filterRank(range: RankRange | null) {
    setRankRange(range);
    setPage(1);
    setSelected(null);
  }
  function sortBy(column: "rank" | "volume") {
    setSort(current => column === "rank"
      ? current === "rank-asc" ? "rank-desc" : "rank-asc"
      : current === "volume" ? "volume-asc" : "volume");
    setPage(1);
  }
  async function savePlan() {
    if (!active || !flatkeyPage(targetPage)) { setMessage("先选择或填写有效的 Flatkey 目标页面。"); return; }
    if (!plan.targetRank) { setMessage("请选择目标排名。"); return; }
    if (plan.ctr.trim() && estimateMonthlyClicks(1, plan.ctr) == null) { setMessage("点击率须为 0–100 之间的数字。"); return; }
    if (plan.optimizedAt && (!validRange({ start: plan.optimizedAt, end: plan.optimizedAt }) || plan.optimizedAt > propertyToday())) { setMessage("优化日期须为已发生的有效日期（GA4 属性时区）。"); return; }
    const now = new Date().toISOString();
    const snapshot = { ...plan, updatedAt: now, baseline: plan.baseline ?? { siteRank: active.rank, pageRank: null, rankUrl: null, volume: active.volume, snapshotGeneratedAt: dashboard.data?.displaySnapshot?.generatedAt ?? null, savedAt: now } };
    setSaving(true); setMessage("");
    try {
      const { updatedAt: _updatedAt, ...input } = snapshot;
      const response = await fetch("/api/seo/optimization-plans", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...input, optimizedAt: input.optimizedAt || null, changes: input.changes ?? "", country: planCountry, keyword: active.keyword, pageUrl: flatkeyPage(targetPage) }) });
      const result = await response.json() as { plan?: RemotePlan; message?: string };
      if (!response.ok || !result.plan) throw new Error(result.message ?? "保存失败，请重试");
      const stored = uiPlan(result.plan);
      setSaved(current => ({ ...current, [planKey(planCountry, active.keyword, targetPage)]: stored })); setPlan(stored); setMessage("已保存到项目归档，周报可读取。"); plans.retry();
    } catch (error) { setMessage(error instanceof Error ? error.message : "保存失败，请重试"); }
    finally { setSaving(false); }
  }
  const error = [
    ["关键词词库", dashboard.error],
    ["目标页关联", worklist.error],
    ["优化目标", plans.error],
  ].filter(([, message]) => message).map(([label, message]) => `${label} · ${message}`).join("；");
  const hasData = dashboard.data && !dashboard.data.usingDemoData;
  const snapshotAt = hasData ? dashboard.data?.displaySnapshot?.generatedAt : null;
  const marketLabel = country === "all" ? "全部国家" : REGIONS[country].label;
  return <main className={workspace.shell}>
    <PageHeader active="opportunities" />
    <div className={styles.heading}>
      <div>
        <h1>关键词选题</h1>
        <p>Flatkey · {marketLabel}</p>
      </div>
      <Link href="/opportunities">返回关键词列表</Link>
    </div>
    <section className={styles.results} aria-label="关键词选题列表">
      <div className={styles.toolbar}>
        {targetUrl ? <div className={styles.context}>
          <span>目标页面</span>
          <a href={targetUrl} target="_blank" rel="noreferrer">{targetUrl}</a>
          <Link href={country === "all" ? "/opportunities" : "/opportunities?country=" + country}>查看全部关键词</Link>
        </div> : null}
        <div className={styles.filters}>
          <label className={styles.search}>搜索
            <input aria-label="搜索关键词或页面" value={query} placeholder="关键词或页面" onChange={event => { setQuery(event.target.value); setPage(1); setSelected(null); }} />
          </label>
          <label>排名区间
            <UiSelect
              aria-label="排名区间"
              value={rankRange?.label ?? "all"}
              disabled={!hasData}
              onChange={value => filterRank(rankRanges.find(range => range.label === value) ?? null)}
              options={[
                { value: "all", label: "全部区间" },
                ...rankRanges.map((range, index) => ({ value: range.label, label: `${range.label}（${numberText(rankCounts[index])}）` })),
              ]}
            />
          </label>
          <label>排序
            <UiSelect
              aria-label="排序"
              value={sort}
              onChange={value => {
                const option = sortOptions.find(option => option.value === value);
                if (option) { setSort(option.value); setPage(1); }
              }}
              options={sortOptions}
            />
          </label>
        </div>
        {hasData ? <div className={styles.meta}>
          <p role="status"><strong>{numberText(filtered.length)}</strong> 个关键词 · {volumeLabel} {known.length ? numberText(volume) + " 次" : "—"}（{numberText(known.length)} 个词有数据）</p>
          {snapshotAt ? <span>词库快照 <time dateTime={snapshotAt}>{shanghaiStamp(snapshotAt)}</time>（北京时间）</span> : null}
        </div> : null}
        {hasData ? <details className={styles.rules}>
          <summary>排序与数据口径</summary>
          <p>优先展示已关联页面且排名在第 4–20 名的关键词，其次是第 21–50 名和第 1–3 名。每组按已知月搜索量从高到低排序。</p>
          <p>{country === "all" ? "全部国家按美国、日本、西班牙、巴西四国最佳排名计入区间，月搜索量合计已知记录。" : "排名区间按本站最近有效 Google 实测排名统计。"}未知搜索量显示「—」，已确认零次显示 0。</p>
        </details> : null}
      </div>
      {error ? <p role="alert" className={styles.status}>{error} <button type="button" className={styles.link} onClick={() => { dashboard.retry(); worklist.retry(); plans.retry(); }}>重试</button></p> : null}
      {dashboard.data?.usingDemoData ? <p role="status" className={styles.status}>当前来源为演示数据，等待真实关键词数据。</p> : null}
      {!dashboard.data && !dashboard.error ? <p role="status" className={styles.status}>读取关键词数据…</p> : null}
      {hasData ? <div className={styles.tableWrap}><table className={styles.table}>
        <thead><tr>
          <th scope="col">关键词</th>
          <th scope="col" className={styles.sortable} aria-sort={sort === "volume" ? "descending" : sort === "volume-asc" ? "ascending" : "none"}>
            <button type="button" onClick={() => sortBy("volume")}>{volumeLabel} <span aria-hidden="true">{sort === "volume" ? "↓" : sort === "volume-asc" ? "↑" : "↕"}</span></button>
          </th>
          <th scope="col" className={styles.sortable} aria-sort={sort === "rank-asc" ? "ascending" : sort === "rank-desc" ? "descending" : "none"}>
            <button type="button" onClick={() => sortBy("rank")}>{rankLabel} <span aria-hidden="true">{sort === "rank-asc" ? "↑" : sort === "rank-desc" ? "↓" : "↕"}</span></button>
          </th>
          <th scope="col">目标页面</th><th scope="col">优化目标</th>
        </tr></thead>
        <tbody>{filtered.slice((currentPage - 1) * 25, currentPage * 25).map(row => <tr key={row.key}>
          <td><button type="button" className={styles.keyword} onClick={() => choose(row)}>{row.keyword}</button></td>
          <td data-label={volumeLabel}>{numberText(row.volume)}</td>
          <td data-label={rankLabel}>
            {country === "all" && row.rank === null ? "—" : rankText(row)}
            {row.bestMarkets?.length ? <small>{row.bestMarkets.map(market => REGIONS[market].label).join("、")}</small> : null}
          </td>
          <td data-label="目标页面">{row.urls.length ? <><span title={row.urls[0]}>{new URL(row.urls[0]).pathname}</span>{row.urls.length > 1 ? <small>另 {row.urls.length - 1} 个页面</small> : null}</> : worklist.data ? "待关联" : "关联状态待核查"}</td>
          <td data-label="优化目标"><button type="button" className={styles.rowAction} onClick={() => choose(row)}>{savedTarget(row) ? "查看目标" : "设定目标"}</button></td>
        </tr>)}</tbody>
      </table></div> : null}
      {hasData && !filtered.length ? <p className={styles.status}>没有匹配的关键词。可调整国家、排名区间或搜索词。</p> : null}
      {hasData && filtered.length > 0 ? <nav className={styles.pagination} aria-label="关键词列表分页">
        <span>第 {currentPage} / {pageCount} 页</span>
        <button type="button" disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)}>上一页</button>
        <button type="button" disabled={currentPage >= pageCount} onClick={() => setPage(currentPage + 1)}>下一页</button>
      </nav> : null}
    </section>
    <KeywordResearchEvidence />
    <Modal open={Boolean(active)} title={active ? `设定目标 · ${active.keyword}` : "设定目标"}
      width={720} footer={null} centered mask={{ closable: false }} keyboard={!saving}
      closable={!saving} onCancel={() => { if (!saving) setSelected(null); }}>
    {active ? <section aria-label="优化目标">
      <p className={styles.note}>{REGIONS[planCountry].label}月搜索量 {numberText(active.volume)} · 本站当前排名 {rankText(active)} · {opportunityReason(active)}</p>
      <div className={styles.fields}>
        {country === "all" ? <label>目标国家<UiSelect className={styles.fieldSelect} aria-label="目标国家" value={planCountry} disabled={saving} onChange={value => loadPlan(active, targetPage, value as OpportunityMarket)} options={marketOptions} /></label> : null}
        <label className={styles.wide}>目标页面{active.urls.length ? <UiSelect className={styles.fieldSelect} aria-label="优化目标页面" value={targetPage} onChange={value => loadPlan(active, value, planCountry)} options={active.urls.map(value => ({ value, label: value }))} /> : <input aria-label="优化目标页面" value={targetPage} onChange={event => setTargetPage(event.target.value)} placeholder="https://flatkey.ai/…" />}</label>
        <label>关键词职责<UiSelect className={styles.fieldSelect} aria-label="关键词职责" value={plan.role} onChange={value => setPlan({ ...plan, role: value as KeywordPlan["role"] })} options={[{ value: "primary", label: "主攻词" }, { value: "supporting", label: "辅助词" }]} /></label>
        <label>目标排名<UiSelect className={styles.fieldSelect} aria-label="目标排名" value={plan.targetRank} onChange={value => setPlan({ ...plan, targetRank: value as KeywordPlan["targetRank"] })} options={[{ value: "", label: "选择目标" }, { value: "10", label: "进入前 10" }, { value: "5", label: "进入前 5" }, { value: "3", label: "进入前 3" }]} /></label>
        <label>假设目标点击率（%）<input aria-label="假设目标点击率" type="number" min="0" max="100" step="0.1" value={plan.ctr} onInput={event => setPlan({ ...plan, ctr: event.currentTarget.value })} onChange={event => setPlan({ ...plan, ctr: event.target.value })} placeholder="自行填写" /></label>
        <label className={styles.wide}>优化动作与判断依据<textarea rows={2} value={plan.notes} onChange={event => setPlan({ ...plan, notes: event.target.value })} placeholder="记录搜索意图、内容补齐、内链和竞争页面等依据" /></label>
      </div>
      <p className={styles.estimate}>假设达成后的月点击：<strong>{clicks == null ? "—" : clicks.toLocaleString("zh-CN", { maximumFractionDigits: 1 })}</strong>{clicks == null ? " · 填写点击率且有月搜索量后计算" : ` · ${numberText(active.volume)} × ${plan.ctr}%`}</p>
      <details className={styles.rules}><summary>点击估算口径</summary>
        <p>目标排名由你设定，是否可达仍需核查竞争。月点击为单个词的情景估算，使用人工填写的点击率。</p>
      </details>
      <details className={styles.tracking}>
        <summary>优化后的效果跟踪</summary>
        <div className={styles.fields}>
          <label>已完成优化日期<input aria-label="已完成优化日期" type="date" max={propertyToday()} value={plan.optimizedAt ?? ""} onInput={event => setPlan({ ...plan, optimizedAt: event.currentTarget.value })} onChange={event => setPlan({ ...plan, optimizedAt: event.target.value })} /></label>
          <label className={styles.wide}>已完成的具体改动<textarea rows={2} value={plan.changes ?? ""} onChange={event => setPlan({ ...plan, changes: event.target.value })} placeholder="例如修改标题、补充价格对比、增加 3 条相关内链" /></label>
        </div>
        {plan.baseline ? <p className={styles.note}>目标首次保存时：本站排名 {plan.baseline.siteRank == null ? "—" : `第 ${plan.baseline.siteRank} 名`}，月搜索量 {numberText(plan.baseline.volume)}；快照生成于 {plan.baseline.snapshotGeneratedAt ? new Date(plan.baseline.snapshotGeneratedAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" }) + " 北京时间" : "未知时间"}。目标页面的独立排名待核查，暂不计算页面排名变化。</p> : <p className={styles.note}>保存后保留当前站点排名和搜索量快照；目标页面的独立排名仍需核查。</p>}
        {plan.optimizedAt && flatkeyPage(targetPage) ? <div className={styles.trackingLinks}>{([7, 28, 56] as const).map(days => {
          const range = optimizationWindow(plan.optimizedAt!, days, propertyToday());
          return range ? <Link key={days} href={"/pages?" + new URLSearchParams({ pageUrl: targetPage, category: "all", country, start: range.start, end: range.end, compareStart: range.compareStart, compareEnd: range.compareEnd })}>查看优化后 {days} 天效果{range.days < days ? `（已结束 ${range.days} 天）` : ""}</Link> : <span key={days}>优化后 {days} 天：尚无完整日</span>;
        })}</div> : null}
        <p className={styles.note}>效果窗口从优化次日开始，只查看已结束日，并与优化前等长区间对比。页面效果可查看实际访问、注册和 GSC 点击；排名沿用既有采集记录，未开启额外付费抓取。</p>
      </details>
      <div className={styles.saveRow}><button className={styles.primary} disabled={saving} onClick={() => void savePlan()}>{saving ? "保存中…" : "保存优化目标"}</button><Link href={"/opportunities?" + new URLSearchParams({ view: "new", keyword: active.keyword, country: planCountry, ...(targetPage ? { targetUrl: targetPage } : {}) })}>加入工作任务 →</Link><span role="status">{message}</span></div>
    </section> : null}
    </Modal>
  </main>;
}
