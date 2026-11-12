"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { shiftDay } from "@/lib/seo-date-range";
import type { SeoDigest } from "@/lib/seo-digest";
import { numberText, shanghaiStamp, useSeoRead } from "./useSeoAnalytics";
import styles from "./SeoWorkWorkspace.module.css";

const friday = (date: string) => shiftDay(date, -((new Date(date + "T00:00:00Z").getUTCDay() + 2) % 7));
const inline = /\[([^\]\n]+)\]\((https:\/\/[^\s)]+)\)|\*\*([^*\n]+)\*\*/g;

function ReportLine({ line }: { line: string }) {
  const content = [];
  let position = 0;
  for (const match of line.matchAll(inline)) {
    content.push(line.slice(position, match.index));
    const [, label, url, emphasis] = match;
    content.push(url ? <a href={url} key={match.index} target="_blank" rel="noreferrer">{label}</a> : <strong key={match.index}>{emphasis}</strong>);
    position = match.index + match[0].length;
  }
  content.push(line.slice(position));
  return <>{content}</>;
}

export function SeoDigestReports() {
  const params = useSearchParams();
  const router = useRouter();
  const kind = params.get("period") === "weekly" ? "weekly" : "daily";
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(new Date());
  const fallback = kind === "weekly" ? friday(today) : today;
  const requestedDate = params.get("date") ?? "";
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(requestedDate) && Number.isFinite(Date.parse(requestedDate + "T00:00:00Z"));
  const date = valid ? kind === "weekly" ? friday(requestedDate) : requestedDate : fallback;
  const exact = params.get("reportId");
  const query = new URLSearchParams({ kind, date, saved: "1", ...(exact ? { reportId: exact } : {}) });
  const result = useSeoRead<{ report: SeoDigest | null }>("/api/seo/digest?" + query);
  const report = result.data?.report;
  const route = (period: typeof kind, selected: string) => "/reports?" + new URLSearchParams({ period, date: period === "weekly" ? friday(selected) : selected });
  return <>
    <div className={styles.sectionHeading}><h1>日／周效果总结</h1><button type="button" className={styles.secondary} onClick={result.retry}>刷新</button></div>
    <nav className={styles.workTabs} aria-label="报告周期">
      <Link href={route("daily", date)} aria-current={kind === "daily" ? "page" : undefined}>日报</Link>
      <Link href={route("weekly", date)} aria-current={kind === "weekly" ? "page" : undefined}>周报</Link>
    </nav>
    <div className={styles.toolbarActions}>
      <Link className={styles.secondary} href={route(kind, shiftDay(date, kind === "weekly" ? -7 : -1))}>上一期</Link>
      <label>报告日期 <input type="date" value={date} max={today} onChange={event => { if (event.target.value) router.push(route(kind, event.target.value)); }} /></label>
      {date < fallback ? <Link className={styles.secondary} href={route(kind, shiftDay(date, kind === "weekly" ? 7 : 1))}>下一期</Link> : null}
    </div>
    {result.error ? <p role="alert">{result.error}</p> : !result.data ? <p role="status">正在读取已保存报告…</p> : !report
      ? <p className={styles.empty}>该期尚无已保存报告。</p> : <article className={styles.listPanel}>
        <h2>{report.title}</h2>
        <p className={styles.muted}>{report.preliminary ? "预览 · " : ""}生成于 {shanghaiStamp(report.generatedAt)}（北京时间）</p>
        <dl className={styles.metadata}>
          <div><dt>新增博客</dt><dd>{numberText(report.counts.originals)}</dd></div>
          <div><dt>新增落地页</dt><dd>{numberText(report.counts.landingPages)}</dd></div>
          <div><dt>已上线优化</dt><dd>{numberText(report.counts.optimizedPages)}</dd></div>
          <div><dt>待审页面版本</dt><dd>{numberText(report.approvalQueue?.pages)}</dd></div>
        </dl>
        <div className={styles.reportDetail}>{(report.detailText || report.text).split("\n").slice(1).map((line, index) =>
          line.trim() ? <p key={index}><ReportLine line={line} /></p> : <div className={styles.reportSpace} key={index} />)}</div>
      </article>}
  </>;
}
