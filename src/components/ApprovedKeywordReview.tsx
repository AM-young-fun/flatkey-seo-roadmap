"use client";
import { FeedbackButton } from "./FeedbackButton";
import { useActionFeedback } from "./useActionFeedback";
import { useBusyIndicator } from "./useBusyIndicator";

import { useEffect, useMemo, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { keywordCaptureTime } from "@/lib/keyword-capture-time";
import { continueApprovedKeywordReview, type ApprovedKeywordReviewCommand, type ApprovedKeywordReviewView as ApprovedReview } from "@/lib/approved-keyword-review-client";
import { useSeoRead } from "./useSeoAnalytics";
import styles from "./ApprovedKeywordReview.module.css";
import { SeoAnchor } from "@/components/SeoAnchor";


const countries: Record<string, string> = { US: "美国", JP: "日本", ES: "西班牙", BR: "巴西" };
const count = (value: number) => value.toLocaleString("zh-CN");
const dollars = (micros: number | null) => micros === null ? "待费用回执" : new Intl.NumberFormat("en-US", {
  style: "currency", currency: "USD", minimumFractionDigits: 3, maximumFractionDigits: 6,
}).format(micros / 1e6);
const normalize = (value: string) => value.normalize("NFKC").trim().toLowerCase();
const pageSize = 25;
function sourcePageUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}
function runLabel(data: ApprovedReview) {
  if (!data.approved) return "待确认";
  if (!data.run) return "已批准，尚未开始";
  return ({ PLANNED: "本批已就绪", RUNNING: "采集中", COMPLETED: "本批采集完成", PARTIAL: "本批部分完成", FAILED: "本批执行异常", UNKNOWN: "提交结果待核对", PAUSED: "本批已暂停" } as Record<string, string>)[data.run.status] ?? "采集状态待核对";
}

async function requestView(command?: ApprovedKeywordReviewCommand): Promise<ApprovedReview> {
  const response = await fetch("/api/seo/approved-keyword-review", {
    method: command ? "POST" : "GET", cache: "no-store", credentials: "same-origin",
    ...(command ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(command) } : {}),
  });
  const value = await response.json();
  if (!response.ok) throw new Error(typeof value.message === "string" ? value.message : typeof value.error === "string" ? value.error : "本批请求未获确认");
  return value;
}

/** Reading is passive; only the explicit approved-batch button can continue its exact ledger. */
export function ApprovedKeywordReview() {
  const { data: saved, error: readError } = useSeoRead<ApprovedReview>("/api/seo/approved-keyword-review");
  const [live, setLive] = useState<ApprovedReview | null>(null);
  const [notice, setNotice] = useState("");
  const [running, setRunning] = useState(false);
  const refreshing = useActionFeedback("正在读取本批采集回执…");
  useBusyIndicator(running, "正在处理本批采集回执…");
  const mounted = useRef(true), stopped = useRef(false), busy = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; stopped.current = true; }; }, []);
  const data = live ?? saved;
  const error = live ? null : readError;
  const refresh = async () => {
    if (!refreshing.start()) return;
    try { const value = await requestView(); if (mounted.current) { setLive(value); setNotice(""); } }
    catch (cause) { if (mounted.current) setNotice(cause instanceof Error ? cause.message : "本批记录暂时无法读取"); }
    finally { refreshing.finish(); }
  };
  const start = async () => {
    if (busy.current) return;
    busy.current = true; stopped.current = false; setRunning(true); setNotice("正在沿本次已批准清单采集；不会提交其他市场观察词。");
    try {
      const result = await continueApprovedKeywordReview({ read: () => requestView(), post: requestView,
        stopped: () => stopped.current || !mounted.current,
        progress: value => { if (mounted.current) setLive(value); } });
      if (mounted.current) setNotice(result === "finished" ? "本批采集已完成。" : result === "stopped" ? "已停止后续提交；已提交的查询保留在原批次，可刷新查看结果。" : "本批有需核对的回执，已停止后续提交，请查看原批次结果。");
    } catch (cause) { if (mounted.current) setNotice(cause instanceof Error ? cause.message : "后续提交已停止，请核对原批次。"); }
    finally { busy.current = false; if (mounted.current) setRunning(false); }
  };
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const rows = data?.otherCountries.rows;
  const filtered = useMemo(() => {
    const text = normalize(query);
    return (rows ?? []).filter(row => !text || normalize(`${row.keyword} ${row.keywordId} ${row.reason}`).includes(text));
  }, [rows, query]);
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, pages);
  const shown = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const completed = data ? data.countries.reduce((total, row) => total + row.completeCount, 0) : 0;
  return <section className={styles.root} aria-labelledby="approved-keyword-review-title">
    <div className={styles.heading}>
      <div><h4 id="approved-keyword-review-title">本次关键词复核</h4><p>按已确认的清单查看进度、费用和其他市场观察词。</p></div>
      <FeedbackButton className={styles.button} onClick={refresh} disabled={running} pending={refreshing.pending} pendingLabel="正在刷新回执…"><RefreshCw size={13} aria-hidden="true" />刷新本批结果</FeedbackButton>
    </div>
    {error ? <p className={styles.warning} role="alert">本批记录暂时无法读取：{error}。请刷新核对，当前不显示推算结果。</p>
      : !data ? <p className={styles.note} role="status">正在读取已批准清单与采集回执…</p>
      : <>
        <p className={styles.status} role="status">{runLabel(data)}</p>
        <div className={styles.controls}>
          <FeedbackButton className={styles.button} disabled={running || !data.approved || data.run?.status === "COMPLETED"} pending={running} pendingLabel="正在处理本批回执…" onClick={start}>执行已批准的1031词采集（上限$6.186）</FeedbackButton>
          {running ? <button className={styles.button} type="button" onClick={() => { stopped.current = true; setNotice("已请求停止后续提交，正在等待当前请求回执；不会重复提交。"); }}>停止后续提交</button> : null}
        </div>
        {notice ? <p className={styles.note} role="status" aria-live="polite">{notice}</p> : null}
        <div className={styles.metrics}>
          <div><span>本批查询</span><strong>{count(data.queryCount)}</strong><small>每词一个已确认国家</small></div>
          <div><span>已完成查询</span><strong>{count(completed)} <small>/ {count(data.queryCount)}</small></strong><small>有排名词数见下方结果</small></div>
          <div><span>实际费用</span><strong>{dollars(data.run?.actualCostMicros ?? null)}</strong><small>以本批费用回执为准</small></div>
          <div><span>本批费用上限</span><strong>{dollars(data.maxCostMicros)}</strong><small>其他市场观察词另列</small></div>
        </div>
        <label className={styles.progressLabel}>查询进度 <span>{count(completed)} / {count(data.queryCount)}</span>
          <progress value={completed} max={Math.max(1, data.queryCount)} aria-label="已批准关键词查询进度" />
        </label>
        {data.run?.startedAt ? <p className={styles.note}>开始于 {keywordCaptureTime(data.run.startedAt)}（洛杉矶时间）{data.run.completedAt ? ` · 完成于 ${keywordCaptureTime(data.run.completedAt)}（洛杉矶时间）` : ""}</p> : null}
        {data.run?.errorCode ? <p className={styles.warning}>本批有需要核对的采集记录，请保留原批次查看回执。</p> : null}
        <div className={styles.tableScroll}>
          <table className={styles.countryTable}>
            <caption>本批国家汇总</caption>
            <thead><tr><th scope="col">国家</th><th scope="col">已确认查询</th><th scope="col">已完成</th><th scope="col">已确认有排名</th><th scope="col">实际费用</th></tr></thead>
            <tbody>{data.countries.map(row => <tr key={row.country}><th scope="row">{countries[row.country] ?? row.country}</th><td>{count(row.queryCount)}</td><td>{count(row.completeCount)}</td><td>{row.rankedCount === null ? "待结果" : count(row.rankedCount)}</td><td>{dollars(row.actualCostMicros)}</td></tr>)}</tbody>
          </table>
        </div>
        <details className={styles.other}>
          <summary><span>{data.otherCountries.label}</span><strong>{count(data.otherCountries.count)}</strong><small>国家方案已确认 · 实际排名见下方其他国家补采</small></summary>
          <div className={styles.otherContent}>
            <p className={styles.note}>这些词的单次补采国家方案已确认，467词新增查询、1词复用已有结果。实际进度、费用与排名请看下方“其他国家关键词补采”。中性词的查询环境不代表原词本身是英语，原主国家保持不变。</p>
            <label className={styles.search}>筛选观察词<input type="search" value={query} onChange={event => { setQuery(event.target.value); setPage(1); }} placeholder="搜索关键词、编号或原因" aria-label="搜索其他国家待归属关键词" /></label>
            <p className={styles.note} aria-live="polite">筛选后 {count(filtered.length)} / {count(data.otherCountries.count)} 个关键词 · 每页 {pageSize} 个</p>
            <div className={styles.tableScroll}>
              <table className={styles.keywordTable}>
                <caption>其他国家／待归属关键词清单</caption>
                <thead><tr><th scope="col">原关键词</th><th scope="col">归类与市场候选</th><th scope="col">原暂缓原因</th><th scope="col">原页面</th></tr></thead>
                <tbody>{shown.length ? shown.map(row => <tr key={row.keywordId}>
                  <th scope="row"><strong>{row.keyword}</strong><small>{row.keywordId}</small></th>
                  <td>{row.classificationLabel}<small>{row.candidateMarkets.length ? row.candidateMarkets.map(market => `${market.countryLabel ?? market.countryCode}${market.language === "zh-CN" ? "／简体中文" : ""}`).join("、") : "国家待归属"}</small><small>{row.candidateMarkets.map(market => market.note).filter(Boolean).join("；")}</small></td>
                  <td>{row.reason}</td>
                  <td>{row.originalTargetUrls.length ? <ul>{row.originalTargetUrls.map(url => <li key={url}>{sourcePageUrl(url) ? <SeoAnchor href={sourcePageUrl(url)!} target="_blank" rel="noreferrer">{url}</SeoAnchor> : <span>{url}</span>}</li>)}</ul> : <span className={styles.note}>原记录未提供目标页面</span>}</td>
                </tr>) : <tr><td colSpan={4} className={styles.empty}>没有匹配的观察词。</td></tr>}</tbody>
              </table>
            </div>
            <nav className={styles.pagination} aria-label="其他国家观察词分页"><button className={styles.button} type="button" disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)}>上一页</button><span>第 {currentPage} / {pages} 页</span><button className={styles.button} type="button" disabled={currentPage >= pages} onClick={() => setPage(currentPage + 1)}>下一页</button></nav>
          </div>
        </details>
      </>}
  </section>;
}
