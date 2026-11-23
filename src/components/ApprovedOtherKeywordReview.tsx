"use client";
import { FeedbackButton } from "./FeedbackButton";
import { useActionFeedback } from "./useActionFeedback";
import { useBusyIndicator } from "./useBusyIndicator";

import { useEffect, useMemo, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { keywordCaptureTime } from "@/lib/keyword-capture-time";
import { continueApprovedOtherKeywordReview, type ApprovedOtherKeywordReviewCommand, type ApprovedOtherKeywordReviewView as Review } from "@/lib/approved-other-keyword-review-client";
import { useSeoRead } from "./useSeoAnalytics";
import styles from "./ApprovedOtherKeywordReview.module.css";

const endpoint = "/api/seo/approved-other-keyword-review";
const countries: Record<string, string> = { US: "美国", JP: "日本", ES: "西班牙", BR: "巴西", CN: "中国" };
const count = (value: number) => value.toLocaleString("zh-CN");
const dollars = (micros: number | null) => micros === null ? "待费用回执" : new Intl.NumberFormat("en-US", {
  style: "currency", currency: "USD", minimumFractionDigits: 3, maximumFractionDigits: 6,
}).format(micros / 1e6);
const normalize = (value: string) => value.normalize("NFKC").trim().toLowerCase();
const pageSize = 25;
function safeUrl(value: string) {
  try { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password ? url.href : null; }
  catch { return null; }
}
function runLabel(data: Review) {
  if (!data.run) return data.gate.firstRunComplete ? "补采已批准，尚未开始" : "补采已批准，等待首批完成";
  return ({ PLANNED: "补采已就绪", RUNNING: "补采进行中", COMPLETED: "本批补采完成", PARTIAL: "本批部分完成", FAILED: "本批执行异常", UNKNOWN: "提交结果待核对", PAUSED: "本批已暂停" } as Record<string, string>)[data.run.status] ?? "本批回执待核对";
}
function rankLabel(row: Review["items"][number]) {
  if (row.ranked === true && row.rank !== null) return `第 ${row.rank} 名`;
  if (row.ranked === false) return "前100名未见本站结果";
  if (row.state === "NOT_STARTED" || row.state === "PLANNED") return "尚未采集";
  if (row.state === "SUBMITTED" || row.state === "SUBMITTING") return "等待查询结果";
  return "结果待完整性核对";
}
async function requestView(command?: ApprovedOtherKeywordReviewCommand): Promise<Review> {
  const response = await fetch(endpoint, { method: command ? "POST" : "GET", cache: "no-store", credentials: "same-origin",
    ...(command ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(command) } : {}) });
  const value = await response.json();
  if (!response.ok) throw new Error(typeof value.message === "string" ? value.message : typeof value.error === "string" ? value.error : "本批请求未获确认");
  return value;
}

/** Passive saved-results view; the approved 467-query batch starts only on an explicit click. */
export function ApprovedOtherKeywordReview() {
  const { data: saved, error: readError } = useSeoRead<Review>(endpoint);
  const [live, setLive] = useState<Review | null>(null);
  const [notice, setNotice] = useState("");
  const [running, setRunning] = useState(false);
  const refreshing = useActionFeedback("正在读取本批采集回执…");
  useBusyIndicator(running, "正在处理本批采集回执…");
  const [query, setQuery] = useState(""), [country, setCountry] = useState("all"), [filter, setFilter] = useState("all");
  const [page, setPage] = useState(1);
  const mounted = useRef(true), stopped = useRef(false), busy = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; stopped.current = true; }; }, []);
  const data = live ?? saved, error = live ? null : readError;
  const rows = data?.items;
  const filtered = useMemo(() => {
    const text = normalize(query);
    return (rows ?? []).filter(row => (!text || normalize(`${row.keyword} ${row.keywordId} ${row.gap ?? ""} ${row.originalTargetUrls.join(" ")}`).includes(text)) &&
      (country === "all" || row.country === country) &&
      (filter === "all" || (filter === "ranked" && row.ranked === true) || (filter === "outside" && row.ranked === false) ||
        (filter === "pending" && row.ranked === null) || (filter === "reused" && row.reused)));
  }, [rows, query, country, filter]);
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, pages), shown = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const completed = data?.countries.reduce((total, row) => total + row.completeCount, 0) ?? 0;
  const reused = data?.items.filter(row => row.reused) ?? [];
  const canContinue = data?.approved && data.run?.status !== "COMPLETED" &&
    (data.gate.firstRunComplete || (data.run && (data.run.taskCounts.PLANNED ?? 0) === 0));
  const refresh = async () => {
    if (!refreshing.start()) return;
    try { const value = await requestView(); if (mounted.current) { setLive(value); setNotice(""); } }
    catch (cause) { if (mounted.current) setNotice(cause instanceof Error ? cause.message : "本批记录暂时无法读取"); }
    finally { refreshing.finish(); }
  };
  const start = async () => {
    if (busy.current) return;
    busy.current = true; stopped.current = false; setRunning(true); setNotice("正在沿已确认的467词补采清单执行；复用词不会重复付费。");
    try {
      const result = await continueApprovedOtherKeywordReview({ read: () => requestView(), post: requestView,
        stopped: () => stopped.current || !mounted.current, progress: value => { if (mounted.current) setLive(value); } });
      if (mounted.current) setNotice(result === "finished" ? "本批467词补采已完成，另1词沿用明确标记的原采集结果。" : result === "stopped" ? "已停止后续提交；已提交查询保留在原批次，可刷新查看结果。" : "本批有需核对的回执，已停止后续提交，请查看原批次结果。");
    } catch (cause) { if (mounted.current) setNotice(cause instanceof Error ? cause.message : "后续提交已停止，请核对原批次。"); }
    finally { busy.current = false; if (mounted.current) setRunning(false); }
  };

  return <section className={styles.root} aria-labelledby="approved-other-keyword-review-title">
    <div className={styles.heading}>
      <div><h4 id="approved-other-keyword-review-title">其他国家补采</h4><p>已确认国家与语言：新查467词，复用1词；保留原词、编号与页面。</p></div>
      <FeedbackButton className={styles.button} disabled={running} onClick={refresh} pending={refreshing.pending} pendingLabel="正在刷新回执…"><RefreshCw size={13} aria-hidden="true" />刷新补采结果</FeedbackButton>
    </div>
    {error ? <p className={styles.warning} role="alert">补采记录暂时无法读取：{error}。请刷新核对，当前不显示推算结果。</p> : !data ? <p className={styles.note} role="status">正在读取补采清单与原批次回执…</p> : <>
      <p className={styles.status} role="status">{runLabel(data)}</p>
      {!data.gate.firstRunComplete ? <p className={styles.warning}>{data.gate.reason || "请等待首批1031词采集完成后，再执行本批补采。"}</p> : null}
      <div className={styles.controls}>
        <FeedbackButton className={styles.button} disabled={running || !canContinue} pending={running} pendingLabel="正在处理本批回执…" onClick={start}>执行已批准的467词补采（上限$2.802）</FeedbackButton>
        {running ? <button className={styles.button} type="button" onClick={() => { stopped.current = true; setNotice("已请求停止后续提交，正在等待当前请求回执；不会重复提交。"); }}>停止后续补采提交</button> : null}
      </div>
      {notice ? <p className={styles.note} role="status" aria-live="polite">{notice}</p> : null}
      <div className={styles.metrics}>
        <div><span>本批展示关键词</span><strong>{count(data.totalKeywordCount)}</strong><small>新查 {count(data.queryCount)} · 复用 {count(data.reuseCount)}</small></div>
        <div><span>已完成新查</span><strong>{count(completed)} <small>/ {count(data.queryCount)}</small></strong><small>复用结果另列，不占新查名额</small></div>
        <div><span>本批实际新增费用</span><strong>{dollars(data.run?.actualCostMicros ?? null)}</strong><small>复用词本次新增费用为0</small></div>
        <div><span>本批费用上限</span><strong>{dollars(data.maxCostMicros)}</strong><small>两批合计上限 {dollars(data.combinedMaxCostMicros)}</small></div>
      </div>
      <label className={styles.progressLabel}>467词新查进度 <span>{count(completed)} / {count(data.queryCount)}</span><progress value={completed} max={Math.max(1, data.queryCount)} aria-label="补采新查进度" /></label>
      {data.run?.startedAt ? <p className={styles.note}>补采开始于 {keywordCaptureTime(data.run.startedAt)}（洛杉矶时间）{data.run.completedAt ? ` · 完成于 ${keywordCaptureTime(data.run.completedAt)}（洛杉矶时间）` : ""}</p> : null}
      {data.run?.errorCode ? <p className={styles.warning}>本批有需要核对的回执，后续提交已停止，请保留原批次查看结果。</p> : null}
      {reused.map(row => <p className={styles.reuse} key={row.keywordId}>复用原结果：<strong>{row.keyword}</strong> · {countries[row.country] ?? row.country} · {rankLabel(row)}{row.checkedAt ? ` · ${keywordCaptureTime(row.checkedAt)}（洛杉矶时间）` : ""}。本次不重复付费；该结果保留原采样时间。</p>)}
      <div className={styles.tableScroll}><table className={styles.countryTable}>
        <caption>补采国家汇总</caption><thead><tr><th scope="col">国家</th><th scope="col">新查</th><th scope="col">已完成新查</th><th scope="col">复用</th><th scope="col">已确认有排名</th><th scope="col">本批新增费用</th></tr></thead>
        <tbody>{data.countries.map(row => <tr key={row.country}><th scope="row">{countries[row.country] ?? row.country}</th><td>{count(row.queryCount)}</td><td>{count(row.completeCount)}</td><td>{count(row.reuseCount)}</td><td>{row.rankedCount === null ? "待结果" : count(row.rankedCount)}</td><td>{dollars(row.actualCostMicros)}</td></tr>)}</tbody>
      </table></div>
      <p className={styles.note}>有排名词数包含明确标记的1个复用词，各原词只计一次。中性词按本次已确认的查询环境采集，不改原主国家，也不把旧数据库国家证据当成实时最高排名。</p>
      <div className={styles.filters}>
        <label className={styles.search}>筛选关键词<input type="search" value={query} onChange={event => { setQuery(event.target.value); setPage(1); }} placeholder="搜索原词、编号、页面或缺口" /></label>
        <label>国家<select value={country} onChange={event => { setCountry(event.target.value); setPage(1); }}><option value="all">全部国家</option>{Object.entries(countries).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
        <label>结果<select value={filter} onChange={event => { setFilter(event.target.value); setPage(1); }}><option value="all">全部结果</option><option value="ranked">已确认有排名</option><option value="outside">前100名未见本站</option><option value="pending">待结果／待完整性核对</option><option value="reused">复用原结果</option></select></label>
      </div>
      <p className={styles.note} aria-live="polite">筛选后 {count(filtered.length)} / {count(data.totalKeywordCount)} 个关键词 · 每页 {pageSize} 个</p>
      <div className={styles.tableScroll}><table className={styles.keywordTable}>
        <caption>全部468个补采与复用关键词</caption><thead><tr><th scope="col">原关键词</th><th scope="col">查询国家</th><th scope="col">排名与缺口</th><th scope="col">实际排名页面</th><th scope="col">原目标页面</th></tr></thead>
        <tbody>{shown.length ? shown.map(row => <tr key={row.keywordId}>
          <th scope="row"><strong>{row.keyword}</strong><small>{row.keywordId}</small></th>
          <td>{countries[row.country] ?? row.country}<small>{row.language}{row.reused ? " · 复用原采样" : ""}</small></td>
          <td>{rankLabel(row)}{row.gap ? <small>{row.gap}</small> : null}{row.checkedAt ? <small>{keywordCaptureTime(row.checkedAt)}（洛杉矶时间）</small> : null}</td>
          <td>{row.pages.length ? <ul>{row.pages.map(item => <li key={item.url}>{safeUrl(item.url) ? <a href={safeUrl(item.url)!} target="_blank" rel="noreferrer">第{item.rank}名 · {item.url}</a> : <span>{item.url}</span>}</li>)}</ul> : <span className={styles.note}>{row.ranked === false ? "本次完整结果中未见本站页面" : "尚无可核验的排名页面"}</span>}</td>
          <td>{row.originalTargetUrls.length ? <ul>{row.originalTargetUrls.map(url => <li key={url}>{safeUrl(url) ? <a href={safeUrl(url)!} target="_blank" rel="noreferrer">{url}</a> : <span>{url}</span>}</li>)}</ul> : <span className={styles.note}>原记录未提供目标页面</span>}</td>
        </tr>) : <tr><td className={styles.empty} colSpan={5}>没有匹配的关键词。</td></tr>}</tbody>
      </table></div>
      <nav className={styles.pagination} aria-label="补采关键词分页"><button className={styles.button} type="button" disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)}>上一页</button><span>第 {currentPage} / {pages} 页</span><button className={styles.button} type="button" disabled={currentPage >= pages} onClick={() => setPage(currentPage + 1)}>下一页</button></nav>
    </>}
  </section>;
}
