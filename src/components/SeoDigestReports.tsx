"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { CalendarDays, RefreshCw } from "lucide-react";
import { seoToday, shiftDay } from "@/lib/seo-date-range";
import { parseReportComparisons } from "@/lib/seo-report-comparisons";
import { rankBlogTopics } from "@/lib/seo-digest-blog-topics";
import { ReportCountryShares } from "./ReportCountryShares";
import { ReportLoading } from "./ReportLoading";
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

const sectionTitles = /^(统计与交付口径|已核实新增页面|内容交付|待审批页面|待补材料|已上线优化|历史交付归档|往期优化变化|优化效果监控|SEO 技术质检|五站自然搜索|Google 点击 ·|自然搜索访问（会话） ·|GA4 行为与转化|GitHub 提示词渠道|Flatkey 四国分项|关键词实测|下周事项与关键词|明日优先关注|数据与执行情况|新增博客|交付|搜索表现|待处理|本期交付|今日交付|关键变化|优化监控|重点效果|下一步|下周重点)/;

function ReportComparisons({ title, groups, rankings = [] }: {
  title: string;
  groups: NonNullable<ReturnType<typeof parseReportComparisons>>;
  rankings?: SeoDigest["pagePerformance"];
}) {
  const [expanded, setExpanded] = useState<string[]>([]);
  return <div className={reportStyles.tableScroll} role="region" aria-label={title} tabIndex={0}>
    <table className={reportStyles.comparison} aria-label={`${title}数据变化`}>
      <thead><tr><th scope="col">站点 / 页面</th><th scope="col">指标</th><th scope="col">上期</th><th scope="col">本期</th><th scope="col">变化</th></tr></thead>
      {groups.map(group => {
        const metrics = group.metrics.filter(metric => !metric.label.includes("注册"));
        const pages = rankings.flatMap(ranking => (ranking.modules ?? []).flatMap(module =>
          module.pages.filter(page => page.site === group.name).map(page => ({ ...page, module: module.label, source: ranking.source, date: ranking.date }))));
        const open = expanded.includes(group.name);
        return <tbody key={group.name}>
          {metrics.map((metric, index) => {
            const difference = metric.previous != null && metric.current != null ? metric.current - metric.previous : null;
            const absolute = difference == null ? "—" : `${difference > 0 ? "+" : ""}${numberText(difference)}`;
            const tone = difference == null || difference === 0 ? "neutral" : difference > 0 ? "increase" : "decrease";
            return <tr key={metric.label}>
              {!index ? <th scope="rowgroup" rowSpan={metrics.length}>{group.name}
                {pages.length ? <button type="button" className={reportStyles.pageToggle} aria-expanded={open}
                  onClick={() => setExpanded(current => open ? current.filter(site => site !== group.name) : [...current, group.name])}>
                  {open ? "收起热门页面" : "查看热门页面"}
                </button> : null}
              </th> : null}
              <th scope="row">{metric.label === "自然会话" ? "自然搜索访问" : metric.label === "曝光" ? "Google 曝光" : metric.label}</th>
              <td>{numberText(metric.previous)}</td><td className={reportStyles.current}>{numberText(metric.current)}</td>
              <td><span className={reportStyles.delta} data-tone={tone}>{difference === 0 ? "持平" : metric.delta || absolute}</span>
                {metric.delta.endsWith("%") && difference !== 0 ? <small>{absolute}</small> : null}</td>

            </tr>;
          })}
          {open ? pages.map(page => <tr key={`${page.source}:${page.url}`} className={reportStyles.pageMetric}>
            <th scope="row"><a href={page.url} target="_blank" rel="noreferrer">{new URL(page.url).pathname + new URL(page.url).search}</a><small>{page.module}</small></th>
            <td>{page.source === "GSC" ? "Google 点击" : "自然搜索访问"}</td>
            <td>{numberText(page.previous)}</td><td className={reportStyles.current}>{numberText(page.value)}</td>
            <td>{page.difference == null ? "—" : page.difference === 0 ? "持平" : `${page.difference > 0 ? "+" : ""}${numberText(page.difference)}`}
              {page.percentage != null && page.percentage !== 0 ? <small>{page.percentage > 0 ? "+" : ""}{page.percentage.toFixed(1)}%</small> : null}</td>

          </tr>) : null}
        </tbody>;
      })}
    </table>
  </div>;
}

function trafficChange(previous: number | null, current: number | null) {
  if (previous === null || current === null) return "待更新";
  const delta = current - previous;
  if (!delta) return "持平";
  if (!previous) return `+${numberText(delta)}`;
  return `${delta > 0 ? "+" : ""}${(delta / previous * 100).toFixed(1)}%`;
}

function ReportModuleTraffic({ rankings }: { rankings: SeoDigest["pagePerformance"] }) {
  const available = rankings.filter(ranking => ranking.flatkey);
  if (!available.length) return null;
  return <section className={reportStyles.section}>
    <h3>Flatkey 页面流量与前 10 名</h3>
    <div className={reportStyles.moduleRows}>{available.map(ranking => {
      const result = ranking.flatkey!;
      const range = (day: string) => (result.periodDays ?? 1) === 7 ? `${shiftDay(day, -6)}—${day}` : day;
      const metric = ranking.source === "GSC" ? "Google 点击" : "自然搜索访问";
      const topics = rankBlogTopics(result.modules.find(module => module.id === "blog")?.pages ?? []);
      return <div key={ranking.source} className={reportStyles.moduleRows}>
        <h4>{ranking.source} · {metric}</h4>
        <p className={reportStyles.note}>{result.date ? `数据日 ${range(result.date)}${result.previousDate ? `，对比 ${range(result.previousDate)}` : "，前一日待更新"}` : "逐页数据待更新"}</p>
        <div className={reportStyles.tableScroll}><table className={reportStyles.comparison}>
          <thead><tr><th scope="col">模块</th><th scope="col">上期</th><th scope="col">本期</th><th scope="col">变化</th></tr></thead>
          <tbody>{result.modules.map(module => <tr key={module.id}>
            <th scope="row">{module.label}</th><td>{numberText(module.previous)}</td><td className={reportStyles.current}>{numberText(module.current)}</td><td>{trafficChange(module.previous, module.current)}</td>
          </tr>)}</tbody>
        </table></div>
        {result.rankingDates?.length ? <p className={reportStyles.note}>前 10 名按本周已出数的 {result.rankingDates.length} 天统计（{result.rankingDates.join("、")}）。完整周变化待更新。</p> : null}
        {result.modules.map(module => <details key={module.id}>
          <summary>{module.label}前 {module.pages.length || 10} 名</summary>
          {module.pages.length ? <div className={reportStyles.tableScroll}><table className={reportStyles.comparison}>
            <thead><tr><th scope="col">页面</th><th scope="col">上期</th><th scope="col">本期</th><th scope="col">变化</th></tr></thead>
            <tbody>{module.pages.map((page, i) => <tr key={page.url}><th scope="row">
              {i + 1}. <a href={page.url} target="_blank" rel="noreferrer">{new URL(page.url).pathname + new URL(page.url).search}</a>
            </th><td>{numberText(page.previous)}</td><td className={reportStyles.current}>{numberText(page.value)}</td><td>{trafficChange(page.previous, page.value)}</td></tr>)}</tbody>
          </table></div> : <p className={reportStyles.note}>暂无有流量的已归档页面。</p>}
        </details>)}
        {topics.length ? <div className={reportStyles.moduleTopics}>
          <h4>博客榜单主题与后续选题</h4>
          <ul className={reportStyles.issueList}>{topics.map(topic => <li key={topic.label}>{topic.label} · {topic.pages} 页 · {numberText(topic.value)} {metric}{topic.followUp ? `。建议${topic.followUp}` : ""}</li>)}</ul>
        </div> : null}
      </div>;
    })}</div>
  </section>;
}

function RecentPageTraffic({ pages, weekly }: { pages: SeoDigest["recentPages"]; weekly: boolean }) {
  if (!pages) return null;
  const best = pages.filter(page => page.latest || page.latestVisits).slice(0, 10);
  const visits = (point: NonNullable<SeoDigest["recentPages"]>[number]["latestVisits"]) =>
    point ? <>{numberText(point.visits)}<small>{point.date}</small></> : "—";
  return <section className={reportStyles.section}>
    <h3>上周及本周新上线页面 · 流量前 10</h3>
    <p className={reportStyles.note}>按最近完整日的 Google 点击排序，同点击量按曝光排序。上线前和上线后的数据分别注明日期。</p>
    {!best.length ? <p className={reportStyles.note}>{pages.length ? "已核验上线，完整日流量待更新。" : "该范围暂无已核验的新页面上线记录。"}</p> : <div className={reportStyles.tableScroll}>
      <table className={reportStyles.comparison}>
        <thead><tr><th scope="col">页面</th><th scope="col">上线</th><th scope="col">上线前点击 / 曝光</th><th scope="col">最近点击 / 曝光</th><th scope="col">点击变化</th><th scope="col">上线前 GA4</th><th scope="col">最近 GA4</th></tr></thead>
        <tbody>{best.map(page => <tr key={page.url}>
          <th scope="row"><a href={page.url} target="_blank" rel="noreferrer">{page.title}</a></th>
          <td>{page.day}<small>{page.cohort === "current" ? weekly ? "报告本周" : "本周" : "上周"}</small></td>
          <td>{page.before ? `${numberText(page.before.clicks)} / ${numberText(page.before.impressions)}` : "暂无基线"}
            {page.before ? <small>{page.before.date}</small> : null}</td>
          <td>{page.latest ? `${numberText(page.latest.clicks)} / ${numberText(page.latest.impressions)}` : "待出数"}
            {page.latest ? <small>{page.latest.date}</small> : null}</td>
          <td>{trafficChange(page.before?.clicks ?? null, page.latest?.clicks ?? null)}</td><td>{visits(page.beforeVisits)}</td><td>{visits(page.latestVisits)}</td>
        </tr>)}</tbody>
      </table>
    </div>}
    {pages.length > best.length ? <details className={reportStyles.moduleRows}>
      <summary>查看本周及上周全部 {pages.length} 个上线页面</summary>
      <ul className={reportStyles.issueList}>{pages.map(page => <li key={page.url}>
        <a href={page.url} target="_blank" rel="noreferrer">{page.title}</a> · {page.day}
        {page.latest ? ` · 点击 ${numberText(page.before?.clicks)} → ${numberText(page.latest.clicks)}，曝光 ${numberText(page.before?.impressions)} → ${numberText(page.latest.impressions)}` : " · GSC 待出数"}
        {page.latestVisits ? ` · 自然访问 ${numberText(page.beforeVisits?.visits)} → ${numberText(page.latestVisits.visits)}` : ""}
      </li>)}</ul>
    </details> : null}
  </section>;
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
    { label: "到站会话", get: (text: string) => /周到站会话 (\d+→\d+)/.exec(text)?.[1] ?? /GitHub UTM→Flatkey 到站会话 (\d+)/.exec(text)?.[1] },
    { label: "到站访客", get: (text: string) => /周去重访客 (\d+→\d+)/.exec(text)?.[1] ?? /去重访客 (\d+)；/.exec(text)?.[1] },
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

function ReportSections({ text, rankings, hideHistorical }: { text: string; rankings: SeoDigest["pagePerformance"]; hideHistorical: boolean }) {
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
  const countrySection = sections.find(section => section.title.startsWith("Flatkey 四国分项"));
  const countries = countrySection ? parseReportComparisons(countrySection.lines) : null;
  return <div className={reportStyles.sections}>{sections.map((section, index) => {
    if (section.title.startsWith("Flatkey 四国分项") || hideHistorical && section.title.startsWith("历史交付归档")) return null;
    const siteTraffic = section.title.startsWith("五站自然搜索");
    const changes = siteTraffic ? parseReportComparisons(section.lines) : null;
    if (/^(统计与交付口径|已核实新增页面|内容交付|交付$|本期交付|今日交付|优化效果监控|优化监控|数据与执行情况|数据基础|Google 点击 ·|自然搜索访问（会话） ·)/.test(section.title)) return null;
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
      <h3>{section.title}</h3>{changes ? <ReportComparisons title={section.title} groups={changes} rankings={rankings} /> : items(lines)}
      {siteTraffic && countries ? <ReportCountryShares groups={countries} /> : null}
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
  const selectedDate = date ?? exact?.split(":")[1] ?? (kind === "daily" ? seoToday() : null);
  const query = new URLSearchParams({ kind, saved: "1", archive: "1", ...(selectedDate ? { date: selectedDate } : {}), ...(exact ? { reportId: exact } : {}) });
  if (kind === "daily" && selectedDate === seoToday() && !exact) query.set("currentPreview", "1");
  const result = useSeoRead<{ report: SeoDigest | null; dates?: string[] }>("/api/seo/digest?" + query);
  const report = result.data?.report;
  const dates = result.data?.dates ?? [];
  const registrations = report?.flatkeyRegistrations;
  const selected = report?.date ?? selectedDate ?? dates[0] ?? "";
  const dateLabel = kind === "weekly" ? "报告周次" : "报告日期";
  const availableDates = selected && !dates.includes(selected) ? [selected, ...dates] : dates;
  const deliveryCount = (count: number, coverage: SeoDigest["coverage"]["publications"], recorded?: boolean) =>
    coverage === "verified" ? numberText(count) : count > 0 ? "至少 " + numberText(count) : recorded ? "已核实 0" : "暂无上线回执";
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
      : !result.data ? <ReportLoading label={`正在读取${kindLabel}`} /> : !report
      ? <div className={reportStyles.feedback}>
        <p>{selected ? `${formatPeriod(selected)}没有已保存的${kindLabel}。` : `暂无已保存的${kindLabel}。`}</p>
        {dates.length ? <Link className={styles.secondary} href={route(kind, dates[0])}>查看最近一份{kindLabel}</Link> : null}
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
        <dl className={reportStyles.metrics}>
          <div><dt>新增博客</dt><dd>{deliveryCount(report.counts.originals, report.coverage?.publications, report.deliveryStates?.blogs)}</dd></div>
          <div><dt>新增落地页</dt><dd>{deliveryCount(report.counts.landingPages, report.coverage?.publications, report.deliveryStates?.landing)}</dd></div>
          <div><dt>已上线优化</dt><dd>{deliveryCount(report.counts.optimizedPages, report.coverage?.optimizations, report.deliveryStates?.optimizations)}</dd></div>
          <div><dt>待审页面版本</dt><dd>{numberText(report.approvalQueue?.pages)}</dd></div>
          <div><dt>Flatkey 注册人数</dt><dd>{registrations?.users == null ? "待更新" : numberText(registrations.users)}</dd>
            <small>{registrations ? registrations.start === registrations.end ? registrations.start : `${registrations.start} — ${registrations.end}` : "全渠道 · 区间去重"}</small></div>
        </dl>
        <ReportModuleTraffic rankings={report.pagePerformance ?? []} />
        <RecentPageTraffic pages={report.recentPages} weekly={kind === "weekly"} />
        <ReportSections text={report.detailText || report.text} rankings={report.pagePerformance} hideHistorical={kind === "weekly"} />
      </article>}
  </div>;
}
