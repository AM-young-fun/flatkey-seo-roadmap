"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { CalendarDays, RefreshCw } from "lucide-react";
import { shiftDay } from "@/lib/seo-date-range";
import { parseReportComparisons } from "@/lib/seo-report-comparisons";
import type { SeoDigest } from "@/lib/seo-digest";
import { numberText, shanghaiStamp, useSeoRead } from "./useSeoAnalytics";
import { UiSelect } from "./UiSelect";
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

const sectionTitles = /^(统计与交付口径|内容交付|待审批页面|待补材料|已上线优化|历史交付归档|往期优化变化|优化效果监控|SEO 技术质检|五站自然搜索|Google 点击 ·|自然搜索访问（会话） ·|GA4 行为与转化|GitHub 提示词渠道|Flatkey 四国分项|关键词实测|下周事项与关键词|明日优先关注|数据与执行情况|新增博客|交付|搜索表现|待处理|本期交付|今日交付|关键变化|优化监控|重点效果|下一步|下周重点)/;
const countryLabels: Record<string, string> = { US: "美国", JP: "日本", BR: "巴西", ES: "西班牙" };

function ReportComparisons({ title, groups, rankings = [] }: {
  title: string;
  groups: NonNullable<ReturnType<typeof parseReportComparisons>>;
  rankings?: SeoDigest["pagePerformance"];
}) {
  const byCountry = title.startsWith("Flatkey 四国");
  const [expanded, setExpanded] = useState<string[]>([]);
  return <div className={reportStyles.tableScroll} role="region" aria-label={title} tabIndex={0}>
    <table className={reportStyles.comparison} aria-label={`${title}数据变化`}>
      <thead><tr><th scope="col">{byCountry ? "市场" : "站点 / 页面"}</th><th scope="col">指标</th><th scope="col">上期</th><th scope="col">本期</th><th scope="col">变化</th><th scope="col">比较日期</th></tr></thead>
      {groups.map(group => {
        const metrics = group.metrics.filter(metric => !metric.label.includes("注册"));
        const pages = rankings.flatMap(ranking => (ranking.modules ?? []).flatMap(module =>
          module.pages.filter(page => page.site === group.name).map(page => ({ ...page, module: module.label, source: ranking.source, date: ranking.date }))));
        const open = expanded.includes(group.name);
        return <tbody key={group.name}>
          {metrics.map((metric, index) => {
            const difference = metric.previous != null && metric.current != null ? metric.current - metric.previous : null;
            const [from, to] = metric.period.split(" → ");
            const [until, timezone] = (to ?? "").split("，");
            const zone = timezone === "America/Los_Angeles" ? "太平洋时间" : timezone === "Asia/Shanghai" ? "北京时间" : timezone;
            const absolute = difference == null ? "—" : `${difference > 0 ? "+" : ""}${numberText(difference)}`;
            const tone = difference == null || difference === 0 ? "neutral" : difference > 0 ? "increase" : "decrease";
            return <tr key={metric.label}>
              {!index ? <th scope="rowgroup" rowSpan={metrics.length}>{countryLabels[group.name] ?? group.name}
                {pages.length ? <button type="button" className={reportStyles.pageToggle} aria-expanded={open}
                  onClick={() => setExpanded(current => open ? current.filter(site => site !== group.name) : [...current, group.name])}>
                  {open ? "收起热门页面" : "查看热门页面"}
                </button> : null}
              </th> : null}
              <th scope="row">{metric.label === "自然会话" ? "自然搜索访问" : metric.label === "曝光" ? "Google 曝光" : metric.label}</th>
              <td>{numberText(metric.previous)}</td><td className={reportStyles.current}>{numberText(metric.current)}</td>
              <td><span className={reportStyles.delta} data-tone={tone}>{difference === 0 ? "持平" : metric.delta || absolute}</span>
                {metric.delta.endsWith("%") && difference !== 0 ? <small>{absolute}</small> : null}</td>
              <td className={reportStyles.comparisonDates}>
                {metric.period ? <><span>{from}</span><span>{until}</span><small>{zone}{metric.note.startsWith("最新日期未齐") ? " · 数据未齐" : ""}</small></> : null}
                {metric.note && !metric.note.startsWith("最新日期未齐") ? <small>{difference == null ? metric.note.replace("，保留为空", "") : metric.note}</small> : null}
                {!metric.period && !metric.note ? "—" : null}
              </td>
            </tr>;
          })}
          {open ? pages.map(page => <tr key={`${page.source}:${page.url}`} className={reportStyles.pageMetric}>
            <th scope="row"><a href={page.url} target="_blank" rel="noreferrer">{new URL(page.url).pathname + new URL(page.url).search}</a><small>{page.module}</small></th>
            <td>{page.source === "GSC" ? "Google 点击" : "自然搜索访问"}</td>
            <td>{numberText(page.previous)}</td><td className={reportStyles.current}>{numberText(page.value)}</td>
            <td>{page.difference == null ? "—" : page.difference === 0 ? "持平" : `${page.difference > 0 ? "+" : ""}${numberText(page.difference)}`}
              {page.percentage != null && page.percentage !== 0 ? <small>{page.percentage > 0 ? "+" : ""}{page.percentage.toFixed(1)}%</small> : null}</td>
            <td className={reportStyles.comparisonDates}><span>{page.previousDate ?? "—"}</span><span>{page.date}</span>
              <small>{page.timezone === "America/Los_Angeles" ? "太平洋时间" : page.timezone === "Asia/Shanghai" ? "北京时间" : page.timezone}</small></td>
          </tr>) : null}
        </tbody>;
      })}
    </table>
  </div>;
}

function GithubComparison({ lines }: { lines: string[] }) {
  const repositories: { label: string; href: string; details: string[] }[] = [];
  for (const line of lines) {
    const heading = /^• \[([^\]]+)\]\((https:\/\/github\.com\/[^)]+)\)/.exec(line);
    if (heading) repositories.push({ label: heading[1], href: heading[2], details: [] });
    else if (/^\s{2}/.test(line)) repositories.at(-1)?.details.push(line.trim());
  }
  if (!repositories.length) return <p className={reportStyles.note}>本期暂无 GitHub 渠道数据。</p>;
  const metrics = [
    { label: "Stars", get: (text: string) => /(?:^|\n)Stars (\d+(?:（[^）]+）)?)/.exec(text)?.[1] },
    { label: "Forks", get: (text: string) => /；Forks (\d+(?:（[^）]+）)?)/.exec(text)?.[1] },
    { label: "浏览次数", get: (text: string) => /^浏览次数 ([^；]+)/m.exec(text)?.[1] },
    { label: "克隆次数", get: (text: string) => /^克隆次数 ([^；]+)/m.exec(text)?.[1] },
    { label: "到站会话", get: (text: string) => /GitHub UTM→Flatkey 到站会话 (\d+)/.exec(text)?.[1] },
    { label: "到站访客", get: (text: string) => /去重访客 (\d+)；/.exec(text)?.[1] },
    { label: "README 链接覆盖", get: (text: string) => /链接UTM覆盖 (\d+\/\d+)/.exec(text)?.[1] },
  ];
  return <div className={reportStyles.tableScroll}>
    <table className={reportStyles.comparison} aria-label="GitHub 仓库对比">
      <thead><tr><th scope="col">指标</th>{repositories.map(repo => <th scope="col" key={repo.href}>
        <a href={repo.href} target="_blank" rel="noreferrer">{repo.label}</a>
      </th>)}</tr></thead>
      <tbody>{metrics.map(metric => <tr key={metric.label}><th scope="row">{metric.label}</th>
        {repositories.map(repo => {
          const value = metric.get(repo.details.join("\n"));
          const [main, note] = value?.split("（") ?? [];
          return <td key={repo.href}>{!main || main === "待更新→待更新" ? "待更新" : main.replace("→", " → ")}
            {note ? <small>{note.replace(/）$/, "")}</small> : null}</td>;
        })}
      </tr>)}</tbody>
    </table>
  </div>;
}

function ReportLinks({ lines, approvals }: { lines: string[]; approvals: boolean }) {
  const links = new Map<string, string>();
  for (const line of lines) {
    for (const match of line.matchAll(inline)) {
      const [, label, href] = match;
      if (!href || !URL.canParse(href)) continue;
      const url = new URL(href);
      if (approvals) {
        if (url.origin !== "https://flatkey-seo-roadmap.vercel.app" || url.pathname !== "/approvals" && !url.pathname.startsWith("/work/")) continue;
        if (url.pathname === "/approvals" && !url.searchParams.has("approvalId")) continue;
        links.set(url.pathname + url.search, label);
      } else {
        links.set("/optimization-effects?" + new URLSearchParams({ page: href }), label);
        break;
      }
    }
  }
  return <>
    {links.size ? <div className={reportStyles.tableScroll}>
      <table className={reportStyles.comparison}>
        <thead><tr><th scope="col">{approvals ? "审批详情" : "页面链接"}</th></tr></thead>
        <tbody>{[...links].map(([href, label]) => <tr key={href}><td><Link href={href}>{label}</Link></td></tr>)}</tbody>
      </table>
    </div> : null}
    {approvals ? <Link className={reportStyles.allApprovals} href="/approvals">查看全部待审批</Link> : null}
  </>;
}

function TechnicalIssues({ lines }: { lines: string[] }) {
  const issues = lines.flatMap(line => {
    if (/^•\s+缺口\s*·/.test(line)) return line.replace(/^•\s+缺口\s*·\s*/, "").split("；").filter(Boolean);
    if (/^•\s+P[0-4]\s+/.test(line)) return [line.replace(/^•\s+/, "")];
    return [];
  });
  if (issues.length) return <ul className={reportStyles.issueList}>{issues.map((issue, index) => <li key={index}><ReportLine line={issue} /></li>)}</ul>;
  return <p className={reportStyles.note}>{lines.some(line => line.includes("尚未收到巡检回执")) ? "本期巡检结果待更新。" : "本期暂无已记录的巡检问题。"}</p>;
}

function ReportSections({ text, rankings }: { text: string; rankings: SeoDigest["pagePerformance"] }) {
  const sections: { title: string; lines: string[] }[] = [];
  let current: (typeof sections)[number] | undefined;
  for (const block of text.trim().split(/\n[ \t]*\n/).slice(1)) {
    const [first, ...lines] = block.split("\n").map(line => line.trimEnd());
    if (!first) continue;
    const heading = first.replace(/^\*\*|\*\*$/g, "");
    if (/^\[数据基础\]/.test(first)) { current = undefined; continue; }
    if (/^(?:新增博客|交付|优化监控|重点效果|下一步|下周重点)\s*[· ]/.test(heading)) {
      current = { title: heading.split(/\s·\s/)[0].startsWith("新增博客") ? "内容交付" : heading.split(/\s·\s/)[0], lines: [first, ...lines] };
      sections.push(current);
    } else if (sectionTitles.test(heading)) {
      current = { title: heading, lines };
      sections.push(current);
    } else if (current) {
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
  return <div className={reportStyles.sections}>{sections.map((section, index) => {
    const changes = /^(五站自然搜索|Flatkey 四国分项)/.test(section.title) ? parseReportComparisons(section.lines) : null;
    if (/^(统计与交付口径|内容交付|交付$|本期交付|今日交付|优化效果监控|优化监控|数据与执行情况|数据基础|Google 点击 ·|自然搜索访问（会话） ·)/.test(section.title)) return null;
    if (/^(待审批页面|已上线优化)/.test(section.title)) {
      const approvals = section.title.startsWith("待审批页面");
      return <section className={reportStyles.section} key={index}>
        <h3>{approvals ? "待审批页面" : "已上线优化"}</h3>
        <ReportLinks lines={section.lines} approvals={approvals} />
      </section>;
    }
    if (section.title === "SEO 技术质检") return <section className={reportStyles.section} key={index}>
      <h3>SEO 技术质检</h3>
      {section.lines[0] && !section.lines[0].startsWith("•") ? <p className={reportStyles.note}>{section.lines[0]}</p> : null}
      <TechnicalIssues lines={section.lines} />
    </section>;
    if (section.title.startsWith("GitHub 提示词渠道")) return <section className={reportStyles.section} key={index}>
      <h3>GitHub 提示词渠道</h3><GithubComparison lines={section.lines} />
    </section>;
    const business = section.title.startsWith("GA4 行为与转化");
    const lines = section.lines.filter(line => !line.startsWith("可归属注册") &&
      !(business && /^\s*(注册成功[：:]|• Flatkey 注册人数)/.test(line)));
    if (business && !lines.some(line => /\d+\s*(次|人|秒)/.test(line))) return null;
    return <section className={reportStyles.section} key={index}>
      <h3>{section.title}</h3>{changes ? <ReportComparisons title={section.title} groups={changes} rankings={section.title.startsWith("五站") ? rankings : undefined} /> : items(lines)}
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
  const registrations = report?.flatkeyRegistrations;
  const selected = report?.date ?? date ?? dates[0] ?? "";
  const dateLabel = kind === "weekly" ? "报告周次" : "报告日期";
  const availableDates = selected && !dates.includes(selected) ? [selected, ...dates] : dates;
  const weeklyDates = report && kind === "weekly"
    ? [`${shiftDay(report.date, -14)}—${shiftDay(report.date, -8)}`, `${shiftDay(report.date, -7)}—${shiftDay(report.date, -1)}`] : [];
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
        <label htmlFor="report-date"><CalendarDays size={16} aria-hidden="true" />{dateLabel}</label>
        <UiSelect id="report-date" aria-label={dateLabel} className={reportStyles.dateSelect} value={selected} disabled={!dates.length}
          onChange={day => { if (day) router.push(route(kind, day)); }}
          options={availableDates.length ? availableDates.map(day => ({ value: day, label: formatPeriod(day) }))
            : [{ value: "", label: result.data ? "暂无归档" : "正在读取…" }]} />
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
        {report.weeklyHighlights ? <section className={reportStyles.section}>
          <h3>本周工作</h3>
          <ul className={reportStyles.issueList}>
            {report.weeklyHighlights.map(item => <li key={item}>{item}</li>)}
          </ul>
          <p><a href="https://flatkey.ai/zh/about" target="_blank" rel="noreferrer">查看 Flatkey About 页面 ↗</a></p>
        </section> : null}
        {report.weeklyTraffic ? <section className={reportStyles.section}>
          <h3>Flatkey 流量对比</h3>
          <div className={reportStyles.tableScroll}>
            <table className={reportStyles.comparison}>
              <thead><tr><th scope="col">指标</th><th scope="col">上周</th><th scope="col">本周</th><th scope="col">变化</th><th scope="col">对比日期</th></tr></thead>
              <tbody>{report.weeklyTraffic.map(row => {
                const savedDates = row.dates.split(" → ").map(date => date.replace(/（7日）$/, ""));
                const complete = weeklyDates.every((date, index) => date === savedDates[index]);
                return <tr key={row.label}>
                  <th scope="row">{row.label}</th><td>{complete && row.previous !== "—" ? row.previous : "待更新"}</td>
                  <td className={reportStyles.current}>{complete && row.current !== "—" ? row.current : "待更新"}</td>
                  <td>{complete ? row.change : "—"}</td>
                  <td className={reportStyles.comparisonDates}>{weeklyDates.map(date => <span key={date}>{date}（7日）</span>)}</td>
                </tr>;
              })}</tbody>
            </table>
          </div>
        </section> : null}
        <dl className={reportStyles.metrics}>
          <div><dt>新增博客</dt><dd>{deliveryCount(report.counts.originals, report.coverage?.publications)}</dd></div>
          <div><dt>新增落地页</dt><dd>{deliveryCount(report.counts.landingPages, report.coverage?.publications)}</dd></div>
          <div><dt>已上线优化</dt><dd>{deliveryCount(report.counts.optimizedPages, report.coverage?.optimizations)}</dd></div>
          <div><dt>待审页面版本</dt><dd>{numberText(report.approvalQueue?.pages)}</dd></div>
          <div><dt>Flatkey 注册人数</dt><dd>{registrations?.users == null ? "待更新" : numberText(registrations.users)}</dd>
            <small>{registrations ? registrations.start === registrations.end ? registrations.start : `${registrations.start} — ${registrations.end}` : "全渠道 · 区间去重"}</small></div>
        </dl>
        <ReportSections text={report.detailText || report.text} rankings={report.pagePerformance} />
      </article>}
  </div>;
}
