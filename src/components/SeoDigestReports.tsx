"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { shiftDay } from "@/lib/seo-date-range";
import type { SeoDigest } from "@/lib/seo-digest";
import { numberText, shanghaiStamp, useSeoRead } from "./useSeoAnalytics";
import styles from "./SeoWorkWorkspace.module.css";
import reportStyles from "./SeoDigestReports.module.css";

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

const sectionTitles = /^(待审批页面|已上线优化|历史交付归档|往期优化变化|优化效果监控|SEO 技术质检|五站自然搜索|Google 点击 ·|自然搜索访问（会话） ·|GA4 行为与转化|GitHub 提示词渠道|Flatkey 四国分项|关键词实测|下周事项与关键词|明日优先关注|数据与执行情况|新增博客|交付|搜索表现|待处理|本期交付|今日交付|关键变化|优化监控|重点效果|下一步|下周重点)/;

function ReportSections({ text }: { text: string }) {
  const sections: { title: string; lines: string[] }[] = [];
  const intro = { title: "统计与交付口径", lines: [] as string[] };
  const source = { title: "数据基础", lines: [] as string[] };
  let current = intro;
  for (const block of text.trim().split(/\n[ \t]*\n/).slice(1)) {
    const [first, ...lines] = block.split("\n").map(line => line.trimEnd());
    if (!first) continue;
    const heading = first.replace(/^\*\*|\*\*$/g, "");
    if (/^\[数据基础\]/.test(first)) { source.lines.push(first, ...lines); continue; }
    if (/^(?:新增博客|交付|优化监控|重点效果|下一步|下周重点)\s*[· ]/.test(heading)) {
      current = { title: heading.split(/\s·\s/)[0].startsWith("新增博客") ? "内容交付" : heading.split(/\s·\s/)[0], lines: [first, ...lines] };
      sections.push(current);
    } else if (sectionTitles.test(heading)) {
      current = { title: heading, lines };
      sections.push(current);
    } else {
      current.lines.push(first, ...lines);
    }
  }
  const items = (lines: string[]) => {
    const rows: { type: "text" | "item"; lines: string[] }[] = [];
    for (const line of lines) {
      if (/^\s{2,}\S/.test(line) && rows.at(-1)?.type === "item") { rows.at(-1)!.lines.push(line.trim()); continue; }
      const bullet = /^\s*[•*-]\s+/.test(line);
      rows.push({ type: bullet ? "item" : "text", lines: [bullet ? line.replace(/^\s*[•*-]\s+/, "") : line] });
    }
    return rows.map((row, index) => <div key={index} className={row.type === "item" ? reportStyles.item : reportStyles.note}>
      {row.lines.map((line, i) => <p key={i}><ReportLine line={line} /></p>)}
    </div>);
  };
  const panels = [intro, ...sections, source].filter(section => section.lines.length || section !== intro && section !== source);
  if (!panels.length) return <div className={reportStyles.section}>{items(text.split("\n").slice(1))}</div>;
  return <div className={reportStyles.sections}>
    {panels.map((section, index) => <section className={reportStyles.section} key={index}>
      <h3>{section.title}</h3>{items(section.lines)}
    </section>)}
  </div>;
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
  const deliveryCount = (count: number, coverage: SeoDigest["coverage"]["publications"]) =>
    coverage === "verified" ? numberText(count) : count > 0 ? "至少 " + numberText(count) : "待核实";
  const route = (period: typeof kind, selected: string) => "/reports?" + new URLSearchParams({ period, date: period === "weekly" ? friday(selected) : selected });
  return <>
    <div className={styles.sectionHeading}><h1>日／周效果总结</h1><div className={styles.toolbarActions}><Link className={styles.secondary} href="/reports?view=published">上线效果</Link><button type="button" className={styles.secondary} onClick={result.retry}>刷新</button></div></div>
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
      ? <p className={styles.empty}>该期尚无已保存报告。</p> : <article className={reportStyles.report}>
        <header className={reportStyles.reportHeader}><div><h2>{report.title}</h2>
        <p>生成于 {shanghaiStamp(report.generatedAt)}（北京时间）</p></div>
        {report.preliminary ? <span className={reportStyles.badge}>预览</span> : null}</header>
        <dl className={reportStyles.metrics}>
          <div><dt>新增博客</dt><dd>{deliveryCount(report.counts.originals, report.coverage?.publications)}</dd></div>
          <div><dt>新增落地页</dt><dd>{deliveryCount(report.counts.landingPages, report.coverage?.publications)}</dd></div>
          <div><dt>已上线优化</dt><dd>{deliveryCount(report.counts.optimizedPages, report.coverage?.optimizations)}</dd></div>
          <div><dt>待审页面版本</dt><dd>{numberText(report.approvalQueue?.pages)}</dd></div>
        </dl>
        <ReportSections text={report.detailText || report.text} />
      </article>}
  </>;
}
