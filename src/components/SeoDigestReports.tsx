"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight, RefreshCw } from "lucide-react";
import { shiftDay } from "@/lib/seo-date-range";
import { parseReportComparisons } from "@/lib/seo-report-comparisons";
import type { SeoDigest } from "@/lib/seo-digest";
import { numberText, shanghaiStamp, useSeoRead } from "./useSeoAnalytics";
import styles from "./SeoWorkWorkspace.module.css";
import reportStyles from "./SeoDigestReports.module.css";

const friday = (date: string) => shiftDay(date, -((new Date(date + "T00:00:00Z").getUTCDay() + 2) % 7));
const reportDateLabel = (date: string) => new Intl.DateTimeFormat("zh-CN", {
  timeZone: "UTC", year: "numeric", month: "short", day: "numeric", weekday: "short",
}).format(new Date(date + "T00:00:00Z"));
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
const countryLabels: Record<string, string> = { US: "美国", JP: "日本", BR: "巴西", ES: "西班牙" };

function ReportComparisons({ title, groups }: { title: string; groups: NonNullable<ReturnType<typeof parseReportComparisons>> }) {
  const byCountry = title.startsWith("Flatkey 四国");
  return <div className={reportStyles.tableScroll} role="region" aria-label={title} tabIndex={0}>
    <table className={reportStyles.comparison} aria-label={`${title}数据变化`}>
      <thead><tr><th scope="col">{byCountry ? "市场" : "站点"}</th><th scope="col">指标</th><th scope="col">上期</th><th scope="col">本期</th><th scope="col">变化</th><th scope="col">比较日期</th></tr></thead>
      {groups.map(group => <tbody key={group.name}>{group.metrics.map((metric, index) => {
        const difference = metric.previous != null && metric.current != null ? metric.current - metric.previous : null;
        const [from, to] = metric.period.split(" → ");
        const [until, timezone] = (to ?? "").split("，");
        const zone = timezone === "America/Los_Angeles" ? "太平洋时间" : timezone === "Asia/Shanghai" ? "北京时间" : timezone;
        const missing = difference == null;
        const absolute = difference == null ? "—" : `${difference > 0 ? "+" : ""}${numberText(difference)}`;
        const tone = difference == null || difference === 0 ? "neutral" : difference > 0 ? "increase" : "decrease";
        return <tr key={metric.label}>
          {!index ? <th scope="rowgroup" rowSpan={group.metrics.length}>{countryLabels[group.name] ?? group.name}</th> : null}
          <th scope="row">{metric.label === "自然会话" ? "自然搜索访问" : metric.label === "曝光" ? "Google 曝光" : metric.label}</th>
          <td>{numberText(metric.previous)}</td><td className={reportStyles.current}>{numberText(metric.current)}</td>
          <td><span className={reportStyles.delta} data-tone={tone}>{difference === 0 ? "持平" : metric.delta || absolute}</span>
            {metric.delta.endsWith("%") && difference !== 0 ? <small>{absolute}</small> : null}</td>
          <td className={reportStyles.comparisonDates}>
            {metric.period ? <><span>{from}</span><span>{until}</span><small>{zone}{metric.note.startsWith("最新日期未齐") ? " · 数据未齐" : ""}</small></> : null}
            {metric.note && !metric.note.startsWith("最新日期未齐") ? <small>{missing ? metric.note.replace("，保留为空", "") : metric.note}</small> : null}
            {!metric.period && !metric.note ? "—" : null}
          </td>
        </tr>;
      })}</tbody>)}
    </table>
  </div>;
}

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
  return <div className={reportStyles.sections}>{panels.map((section, index) => {
    const changes = /^(五站自然搜索|Flatkey 四国分项)/.test(section.title) ? parseReportComparisons(section.lines) : null;
    return <section className={reportStyles.section} key={index}>
      <h3>{section.title}</h3>{changes ? <ReportComparisons title={section.title} groups={changes} /> : items(section.lines)}
    </section>;
  })}</div>;
}

export function SeoDigestReports() {
  const params = useSearchParams();
  const router = useRouter();
  const kind = params.get("period") === "weekly" ? "weekly" : "daily";
  const kindLabel = kind === "weekly" ? "周报" : "日报";
  const requestedDate = params.get("date") ?? "";
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(requestedDate) && Number.isFinite(Date.parse(requestedDate + "T00:00:00Z"))
    && new Date(requestedDate + "T00:00:00Z").toISOString().slice(0, 10) === requestedDate;
  const date = valid ? kind === "weekly" ? friday(requestedDate) : requestedDate : null;
  const formatPeriod = (day: string) => kind === "weekly" ? `${shiftDay(day, -7)} — ${shiftDay(day, -1)}` : reportDateLabel(day);
  const exact = params.get("reportId");
  const query = new URLSearchParams({ kind, saved: "1", archive: "1", ...(date ? { date } : {}), ...(exact ? { reportId: exact } : {}) });
  const result = useSeoRead<{ report: SeoDigest | null; dates?: string[] }>("/api/seo/digest?" + query);
  const report = result.data?.report;
  const dates = result.data?.dates ?? [];
  const selected = report?.date ?? date ?? dates[0] ?? "";
  const selectedIndex = dates.indexOf(selected);
  const older = selectedIndex >= 0 ? dates[selectedIndex + 1] : undefined;
  const newer = selectedIndex > 0 ? dates[selectedIndex - 1] : undefined;
  const deliveryCount = (count: number, coverage: SeoDigest["coverage"]["publications"]) =>
    coverage === "verified" ? numberText(count) : count > 0 ? "至少 " + numberText(count) : "待核实";
  const route = (period: typeof kind, selectedDate?: string) => "/reports?" + new URLSearchParams({ period, ...(selectedDate ? { date: selectedDate } : {}) });
  return <div className={reportStyles.workspace}>
    <header className={reportStyles.pageHeader}>
      <h1>日周效果</h1>
      <div className={styles.toolbarActions}>
        <button type="button" className={styles.secondary} onClick={result.retry}><RefreshCw size={14} aria-hidden="true" />刷新</button>
      </div>
    </header>
    <nav className={reportStyles.periods} aria-label="报告周期">
      <Link href={route("daily")} aria-current={kind === "daily" ? "page" : undefined}>日报</Link>
      <Link href={route("weekly")} aria-current={kind === "weekly" ? "page" : undefined}>周报</Link>
    </nav>
    <section className={reportStyles.controls} aria-label="报告筛选">
      <div className={reportStyles.archive}>
        <label htmlFor="report-date">{kind === "weekly" ? "报告周次" : "报告日期"}</label>
        <div className={reportStyles.archiveControls}>
          <select id="report-date" value={selected} disabled={!dates.length}
            onChange={event => { if (event.target.value) router.push(route(kind, event.target.value)); }}>
            {!selected ? <option value="">{result.data ? "暂无归档" : "正在读取…"}</option> : null}
            {selected && !dates.includes(selected) ? <option value={selected}>{formatPeriod(selected)}</option> : null}
            {dates.map(day => <option key={day} value={day}>{formatPeriod(day)}</option>)}
          </select>
          {older ? <Link className={styles.secondary} href={route(kind, older)} aria-label="上一份报告"><ChevronLeft size={16} aria-hidden="true" /></Link>
            : <button type="button" className={styles.secondary} aria-label="上一份报告" disabled><ChevronLeft size={16} aria-hidden="true" /></button>}
          {newer ? <Link className={styles.secondary} href={route(kind, newer)} aria-label="下一份报告"><ChevronRight size={16} aria-hidden="true" /></Link>
            : <button type="button" className={styles.secondary} aria-label="下一份报告" disabled><ChevronRight size={16} aria-hidden="true" /></button>}
        </div>
      </div>
    </section>
    {result.error ? <div className={reportStyles.feedback} role="alert"><p>{result.error}</p><button type="button" className={styles.secondary} onClick={result.retry}>重新读取</button></div>
      : !result.data ? <p className={reportStyles.feedback} role="status">正在读取{kindLabel}…</p> : !report
      ? <div className={reportStyles.feedback}>
        <p>{selected ? `${formatPeriod(selected)}没有已保存的${kindLabel}。` : `暂无已保存的${kindLabel}。`}</p>
        {dates.length ? <Link className={styles.secondary} href={route(kind)}>查看最近一份{kindLabel}</Link> : null}
      </div> : <article className={reportStyles.report}>
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
  </div>;
}
