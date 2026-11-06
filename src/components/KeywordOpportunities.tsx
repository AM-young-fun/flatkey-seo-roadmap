"use client";
import { UiSelect } from "./UiSelect";

import Link from "next/link";
import { Modal } from "antd";
import { useEffect, useMemo, useState } from "react";
import { PageHeader } from "./PageHeader";
import { useSeoCountry } from "./useSeoCountry";
import { useSeoRead, numberText } from "./useSeoAnalytics";
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
const rankedRange = rankRanges[0];
const inRankRange = (row: KeywordOpportunity, range: typeof rankedRange) =>
  row.rank !== null && row.rank >= range.min && row.rank <= range.max;

export function KeywordOpportunities() {
  const dashboard = useSeoRead<DashboardResponse | OverviewPayload>("/api/views?view=dashboard&site=flatkey.ai");
  const worklist = useSeoRead<Worklist>("/api/seo/worklist");
  const plans = useSeoRead<{ storage: "server"; plans: RemotePlan[] }>("/api/seo/optimization-plans");
  const [saving, setSaving] = useState(false);
  const [country] = useSeoCountry();
  const [query, setQuery] = useState(""), [targetUrl, setTargetUrl] = useState("");
  const [planCountry, setPlanCountry] = useState<OpportunityMarket>("US");
  const [sort, setSort] = useState<Exclude<OpportunitySort, "opportunity">>("rank-asc");
  const [rankSelection, setRankSelection] = useState<typeof rankedRange | null>();
  const rankRange = rankSelection === undefined ? (targetUrl ? null : rankedRange) : rankSelection;
  const [page, setPage] = useState(1), [selected, setSelected] = useState<string | null>(null), [targetPage, setTargetPage] = useState("");
  const [plan, setPlan] = useState<KeywordPlan>(blankPlan), [saved, setSaved] = useState<Record<string, KeywordPlan>>({}), [message, setMessage] = useState("");
  useEffect(() => {
    const read = () => {
      const params = new URLSearchParams(location.search);
      const target = flatkeyPage(params.get("targetUrl") ?? "") ?? ""; setTargetUrl(target);
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
  function filterRank(range: typeof rankedRange | null) {
    setRankSelection(range);
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
  const error = dashboard.error || worklist.error || plans.error;
  return <main className={workspace.shell}>
    <PageHeader active="keywords" />
    <div className={workspace.titleRow}>
      <h1 className={workspace.title}>关键词机会</h1>
    </div>
    {targetUrl ? <p className={styles.context}>目标页面：<a href={targetUrl} target="_blank" rel="noreferrer">{targetUrl}</a> · <Link href={country === "all" ? "/opportunities" : "/opportunities?country=" + country}>查看全部关键词</Link></p> : null}
    {dashboard.data && !dashboard.data.usingDemoData ? <section className={styles.rankOverview} aria-labelledby="opportunity-rank-title">
      <div className={styles.rankHeading}>
        <div>
          <h2 id="opportunity-rank-title">{country === "all" ? "全部国家" : REGIONS[country].label}关键词排名</h2>
          <p className={styles.note}>{country === "all" ? "美国、日本、西班牙、巴西 · 每个词按四国最佳排名计入区间" : "本站最近有效 Google 实测排名"}</p>
        </div>
        <button className={styles.rankReset} aria-pressed={rankRange === null} onClick={() => filterRank(null)}>全部关键词</button>
      </div>
      <div className={styles.rankRanges} role="group" aria-label="按排名区间筛选关键词">
        {rankRanges.map((range, index) => <button key={range.label} aria-pressed={rankRange === range} onClick={() => filterRank(range)}>
          <span>{range.label}</span><strong>{numberText(rankCounts[index])}</strong>
        </button>)}
      </div>
    </section> : null}
    <div className={styles.filters}>
      <input aria-label="搜索关键词或页面" value={query} placeholder="搜索关键词或页面" onChange={event => { setQuery(event.target.value); setPage(1); setSelected(null); }} />
    </div>
    <p className={styles.coverage}>{rankRange ? rankRange.label + " · " : ""}{filtered.length.toLocaleString()} 个关键词 · {volumeLabel} {known.length ? volume.toLocaleString() : "—"} 次（{known.length.toLocaleString()} 个词有数据）</p>
    {error ? <p role="alert" className={styles.note}>{error} <button onClick={() => { dashboard.retry(); worklist.retry(); plans.retry(); }}>重试</button></p> : null}
    {dashboard.data?.usingDemoData ? <p role="alert">当前来源为演示数据，暂不展示机会判断。</p> : null}
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
      <p className={styles.note}>目标排名由你设定，是否可达仍需核查竞争；点击率为人工假设，不由目标排名自动推算。结果是单词情景估算，未计算新增流量。</p>
      <details className={styles.tracking}>
        <summary>优化后的效果跟踪</summary>
        <div className={styles.fields}>
          <label>已完成优化日期<input aria-label="已完成优化日期" type="date" max={propertyToday()} value={plan.optimizedAt ?? ""} onInput={event => setPlan({ ...plan, optimizedAt: event.currentTarget.value })} onChange={event => setPlan({ ...plan, optimizedAt: event.target.value })} /></label>
          <label className={styles.wide}>已完成的具体改动<textarea rows={2} value={plan.changes ?? ""} onChange={event => setPlan({ ...plan, changes: event.target.value })} placeholder="例如修改标题、补充价格对比、增加 3 条相关内链" /></label>
        </div>
        {plan.baseline ? <p className={styles.note}>目标首次保存时：本站排名 {plan.baseline.siteRank == null ? "—" : `第 ${plan.baseline.siteRank} 名`}，月搜索量 {numberText(plan.baseline.volume)}；快照生成于 {plan.baseline.snapshotGeneratedAt ? new Date(plan.baseline.snapshotGeneratedAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" }) + " 北京时间" : "未知时间"}。目标页面的独立排名待核查，暂不计算页面排名变化。</p> : <p className={styles.note}>保存后保留当前站点排名和搜索量快照；目标页面的独立排名仍需核查。</p>}
        {plan.optimizedAt && flatkeyPage(targetPage) ? <div className={styles.trackingLinks}>{([7, 14, 28] as const).map(days => {
          const range = optimizationWindow(plan.optimizedAt!, days, propertyToday());
          return range ? <Link key={days} href={"/pages?" + new URLSearchParams({ pageUrl: targetPage, category: "all", country, start: range.start, end: range.end, compareStart: range.compareStart, compareEnd: range.compareEnd })}>查看优化后 {days} 天效果{range.days < days ? `（已结束 ${range.days} 天）` : ""}</Link> : <span key={days}>优化后 {days} 天：尚无完整日</span>;
        })}</div> : null}
        <p className={styles.note}>效果窗口从优化次日开始，只查看已结束日，并与优化前等长区间对比。页面效果可查看实际访问、注册和 GSC 点击；排名沿用既有采集记录，未开启额外付费抓取。</p>
      </details>
      <div className={styles.saveRow}><button className={styles.primary} disabled={saving} onClick={() => void savePlan()}>{saving ? "保存中…" : "保存优化目标"}</button><span>项目归档 · 用于后续周报复盘</span><span role="status">{message}</span></div>
    </section> : null}
    </Modal>
    {!dashboard.data && !error ? <p className={styles.note}>读取关键词数据…</p> : <div className={styles.tableWrap}><table className={styles.table}>
      <thead><tr>
        <th scope="col">关键词</th>
        <th scope="col" className={styles.sortable} aria-sort={sort === "volume" ? "descending" : sort === "volume-asc" ? "ascending" : "none"}>
          <button onClick={() => sortBy("volume")}>{volumeLabel} <span aria-hidden="true">{sort === "volume" ? "↓" : sort === "volume-asc" ? "↑" : "↕"}</span></button>
        </th>
        <th scope="col" className={styles.sortable} aria-sort={sort === "rank-asc" ? "ascending" : sort === "rank-desc" ? "descending" : "none"}>
          <button onClick={() => sortBy("rank")}>{rankLabel} <span aria-hidden="true">{sort === "rank-asc" ? "↑" : sort === "rank-desc" ? "↓" : "↕"}</span></button>
        </th>
        <th scope="col">目标页面</th><th scope="col">优化目标</th>
      </tr></thead>
      <tbody>{filtered.slice((page - 1) * 25, page * 25).map(row => <tr key={row.key}>
        <td><button className={styles.link} onClick={() => choose(row)}>{row.keyword}</button></td>
        <td data-label={volumeLabel}>{numberText(row.volume)}</td>
        <td data-label={rankLabel}>
          {country === "all" && row.rank === null ? "—" : rankText(row)}
          {row.bestMarkets?.length ? <small>{row.bestMarkets.map(market => REGIONS[market].label).join("、")}</small> : null}
        </td>
        <td data-label="目标页面">{row.urls.length ? <><span title={row.urls[0]}>{new URL(row.urls[0]).pathname}</span>{row.urls.length > 1 ? <small>另 {row.urls.length - 1} 个页面</small> : null}</> : "待关联"}</td>
        <td data-label="优化目标"><button className={styles.link} onClick={() => choose(row)}>{savedTarget(row) ? "查看目标" : "设定目标"}</button></td>
      </tr>)}</tbody>
    </table>{!filtered.length && dashboard.data ? <p className={styles.note}>没有匹配的关键词。可切换市场、排名区间或搜索条件。</p> : null}</div>}
    <div className={styles.pagination}><span>第 {page} / {pageCount} 页</span><button disabled={page <= 1} onClick={() => setPage(page - 1)}>上一页</button><button disabled={page >= pageCount} onClick={() => setPage(page + 1)}>下一页</button></div>
  </main>;
}
