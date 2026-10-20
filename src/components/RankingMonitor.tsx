"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Select, Table, Tooltip } from "antd";
import type { ColumnsType } from "antd/es/table";
import { CircleHelp, RefreshCw } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { REGIONS, REGION_CODES } from "@/lib/seo";
import type { OptimizedPageMonitorResponse, OptimizedPageRank } from "@/lib/optimized-page-monitor";
import type { SerpRegion } from "@/lib/serp-monitor-types";
import { pageRankingChange } from "@/lib/page-ranking-change";
import styles from "./RankingMonitor.module.css";

type Page = OptimizedPageMonitorResponse["pages"][number];
const endpoint = "/api/rankings/monitor";
const pending = (page: Page) => Boolean(page.run && ["PLANNED", "RUNNING"].includes(page.run.status));
const date = (value?: string | null) => value ? new Date(value).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }) : "—";
const key = (value: string) => value.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
function rankLabel(result?: OptimizedPageRank) {
  if (!result) return "待采集";
  if (result.status === "RANKED") return `#${result.rank}`;
  if (result.status === "OUTSIDE_TOP100") return "100外";
  if (["PLANNED", "SUBMITTING", "QUEUED", "RECEIVED"].includes(result.status)) return "采集中";
  if (result.status === "QUERY_CHANGED") return "搜索词被纠正";
  if (result.status === "NOT_FOUND_CAPTURE") return "本次未命中";
  if (["UNKNOWN", "FAILED"].includes(result.status)) return "采集异常";
  return "待核实";
}
function movement(current?: OptimizedPageRank, previous?: OptimizedPageRank) {
  const change = pageRankingChange(current, previous);
  const tip = change.comparable ? `上次 ${date(previous?.checkedAt)}：${rankLabel(previous)}` : change.label === "首次记录"
    ? "已有本次排名，下一次抓取后即可比较变化。" : "本次或上次未取得可比较的有效排名。";
  return { label: change.label, tone: change.direction === "up" ? styles.up : change.direction === "down" ? styles.down : "", tip };
}

export function RankingMonitor() {
  const [data, setData] = useState<OptimizedPageMonitorResponse | null>(null), [region, setRegion] = useState<SerpRegion>("US");
  const [busy, setBusy] = useState<string | null>(null), [loading, setLoading] = useState(true), [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const actionLock = useRef(false), pollLock = useRef(false);
  const read = useCallback(async () => {
    const response = await fetch(endpoint, { cache: "no-store" });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message ?? "排名读取失败");
    setData(result); return result as OptimizedPageMonitorResponse;
  }, []);
  const refresh = useCallback(async () => {
    try { await read(); setError(null); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "排名读取失败"); }
    finally { setLoading(false); }
  }, [read]);
  useEffect(() => { void refresh(); }, [refresh]);
  const activeRunId = data?.activeRunId;
  useEffect(() => {
    if (!activeRunId) return;
    const collect = async () => {
      if (pollLock.current || actionLock.current) return;
      pollLock.current = true;
      try {
        const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "poll", runId: activeRunId }) });
        const result = await response.json();
        if (!response.ok) throw new Error(result.message ?? "结果读取失败");
        await read(); setError(null);
      } catch (failure) { setError(failure instanceof Error ? failure.message : "结果读取失败"); }
      finally { pollLock.current = false; }
    };
    const timer = window.setInterval(() => void collect(), 30_000);
    return () => window.clearInterval(timer);
  }, [activeRunId, read]);
  // Refresh the server's daily allowance when a tab stays open across midnight.
  useEffect(() => {
    const refreshVisible = () => { if (document.visibilityState === "visible") void refresh(); };
    document.addEventListener("visibilitychange", refreshVisible);
    const timer = window.setInterval(() => void refresh(), 60_000);
    return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", refreshVisible); };
  }, [refresh]);
  async function start(page: Page) {
    if (!data || actionLock.current) return;
    actionLock.current = true; setBusy(page.id); setError(null);
    try {
      const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "start", pageId: page.id, expectedHash: page.hash, day: data.day }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message ?? "抓取结果暂时无法确认");
      await read();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "抓取结果暂时无法确认");
      // A lost HTTP response must still reveal the committed daily claim.
      try { await read(); } catch { /* Keep the original error visible. */ }
    } finally { actionLock.current = false; setBusy(null); }
  }
  const results = (page: Page, word: string) => ({ current: page.results.find(item => item.region === region && key(item.keyword) === key(word)),
    previous: page.previousResults.find(item => item.region === region && key(item.keyword) === key(word)) });
  const keywords = (page: Page, render: (word: string) => React.ReactNode) => page.keywords.length
    ? <div className={styles.stack}>{page.keywords.map(word => <div className={styles.word} key={word}>{render(word)}</div>)}</div> : <span className={styles.muted}>尚无关联关键词</span>;
  const columns: ColumnsType<Page> = [
    { title: "优化页面", key: "page", width: 290, render: (_, page) => <div className={styles.page}><a href={page.url} target="_blank" rel="noreferrer">{page.title || new URL(page.url).pathname}</a><small>{new URL(page.url).pathname}</small></div> },
    { title: "关键词", key: "keywords", width: 240, render: (_, page) => keywords(page, word => <Tooltip title={word}><span className={styles.keyword}>{word}</span></Tooltip>) },
    { title: "当前排名", key: "rank", width: 140, render: (_, page) => keywords(page, word => {
      const { current } = results(page, word);
      const tip = current?.otherPages.length ? `本站其他页面：${current.otherPages.map(item => `#${item.rank} ${item.url}`).join("；")}。此处只显示当前优化页的名次。`
        : current?.status === "NOT_FOUND_CAPTURE" ? "本次返回的自然结果未命中优化页，覆盖不足100名，不能认定跌出。" : "该关键词下当前优化页面的 Google 自然排名。";
      return <Tooltip title={tip}><strong className={current?.rank != null ? styles.ranked : styles.muted}>{rankLabel(current)}</strong></Tooltip>;
    }) },
    { title: "较上次", key: "change", width: 130, render: (_, page) => keywords(page, word => {
      const { current, previous } = results(page, word), change = movement(current, previous);
      return <Tooltip title={change.tip}><span className={change.tone || styles.muted}>{change.label}</span></Tooltip>;
    }) },
    { title: "采集时间", key: "time", width: 140, render: (_, page) => keywords(page, word => <span className={styles.muted}>{date(results(page, word).current?.checkedAt)}</span>) },
    { title: "操作", key: "action", width: 150, fixed: "right", render: (_, page) => {
      const disabled = Boolean(busy || data?.activeRunId || page.usedToday || !page.queryCount || page.queryCount > 100 || !data?.connectionConfigured || !data.externalEnabled);
      const tip = page.run?.status === "UNKNOWN" ? "供应商接收结果或费用暂时无法确认，请先核对原记录；不能重复提交。" : page.usedToday ? "今日已抓取，北京时间明日零点后可再次抓取。"
        : data?.activeRunId ? "请等待当前页面采集结束后再操作。" : !data?.connectionConfigured ? "请先在数据管理保存 DataForSEO 连接。"
        : !data.externalEnabled ? "外部请求已暂停。" : !page.queryCount ? "先同步优化表，并核对正式关键词与已发布页面的关联。"
        : `抓取该页 ${page.targets.length} 个关键词的四国排名，费用上限 $${(page.maxCostMicros / 1_000_000).toFixed(3)}。每页每天一次。`;
      return <Tooltip title={tip}><span><Button type={page.usedToday ? "default" : "primary"} disabled={disabled} loading={busy === page.id || pending(page)} onClick={() => void start(page)}>{pending(page) ? "采集中" : page.run?.status === "UNKNOWN" ? "需核对" : page.usedToday ? "今日已抓取" : "抓取排名"}</Button></span></Tooltip>;
    } },
  ];
  const pages = (data?.pages ?? []).filter(page => !search.trim() || `${page.title} ${page.url} ${page.keywords.join(" ")}`.toLowerCase().includes(search.trim().toLowerCase()));
  return <main className="appShell"><PageHeader active="monitor" />
    <div className={styles.heading}><div><h1>排名监控</h1><span className={styles.muted}>已优化页面 · {data?.pages.length ?? "—"} 页</span></div><Tooltip title="逐页手动抓取主词与辅助词的四国排名；每页每天一次，北京时间零点重置。上升、下降与上次该页面同词同国的有效排名比较。结果由 DataForSEO 队列返回，采集时间以实际完成时间为准。"><CircleHelp size={18} aria-label="排名监控说明" tabIndex={0} /></Tooltip></div>
    <div className={styles.toolbar}><input aria-label="搜索页面或关键词" placeholder="搜索页面或关键词" value={search} onChange={event => setSearch(event.target.value)} /><Select aria-label="排名国家" value={region} onChange={setRegion} options={REGION_CODES.map(value => ({ value, label: REGIONS[value].label }))} /><Tooltip title="只读取已保存结果，不发起新的付费抓取。"><Button icon={<RefreshCw size={15} />} onClick={() => void refresh()} aria-label="刷新排名结果" /></Tooltip></div>
    {error ? <div className="loadError" role="alert">{error}</div> : null}
    <section className="tablePanel"><Table<Page> columns={columns} dataSource={pages} rowKey="id" loading={loading} pagination={{ defaultPageSize: 10, showSizeChanger: true, showTotal: total => `共 ${total} 页` }} scroll={{ x: 1150 }} locale={{ emptyText: "暂无已同步的已完成优化页面" }} /></section>
  </main>;
}
