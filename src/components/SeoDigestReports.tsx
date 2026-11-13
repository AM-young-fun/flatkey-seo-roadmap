"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { CalendarDays, RefreshCw } from "lucide-react";
import { seoToday, shiftDay } from "@/lib/seo-date-range";
import { parseReportComparisons, type ReportMetric } from "@/lib/seo-report-comparisons";
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

const reportSites = [
  ["rackrate.org", "RackRate"], ["modelfit.cc", "ModelFit"],
  ["mochichatbot.com", "MochiChatbot"], ["jev-llm.com", "JEV LLM"],
] as const;
const reportModules = [["home", "首页"], ["blog", "博客"], ["models", "模型页"], ["gpu", "GPU"], ["prompts", "提示词"]] as const;

const sectionTitles = /^(统计与交付口径|已核实新增页面|内容交付|待审批页面|待补材料|已上线优化|历史交付归档|往期优化变化|优化效果监控|SEO 技术质检|五站自然搜索|Google 点击 ·|自然搜索访问（会话） ·|GA4 行为与转化|GitHub 提示词渠道|Flatkey 四国分项|关键词实测|下周事项与关键词|明日优先关注|数据与执行情况|新增博客|交付|搜索表现|待处理|本期交付|今日交付|关键变化|优化监控|重点效果|下一步|下周重点)/;

function TrafficCell({ metric }: { metric?: Pick<ReportMetric, "previous" | "current"> }) {
  const current = metric?.current ?? null, previous = metric?.previous ?? null;
  if (current === null) return <td className={reportStyles.trafficMissing}>待更新</td>;
  return <td>
    <strong>{numberText(current)}</strong>
    {previous !== null ? <span className={reportStyles.delta} title={`上期 ${numberText(previous)}`} aria-label={`上期 ${numberText(previous)}，变化 ${trafficChange(previous, current)}`}
      data-tone={current === previous ? "neutral" : current > previous ? "increase" : "decrease"}>{trafficChange(previous, current)}</span> : null}
  </td>;
}

function SearchTraffic({ groups, countries, rankings }: {
  groups: ReturnType<typeof parseReportComparisons>;
  countries: ReturnType<typeof parseReportComparisons>;
  rankings: SeoDigest["pagePerformance"];
}) {
  const ga4 = rankings.find(ranking => ranking.source === "GA4")?.flatkey;
  const gsc = rankings.find(ranking => ranking.source === "GSC")?.flatkey;
  const dataDay = (period: typeof ga4) => period?.date
    ? period.periodDays === 7 ? `${shiftDay(period.date, -6)}—${period.date}` : period.date : null;
  const coverage = [["GA4", dataDay(ga4)], ["GSC", dataDay(gsc)]]
    .filter(([, date]) => date).map(([source, date]) => `${source} ${date}`).join(" · ");
  const flatkeyTotals = groups?.find(group => group.name === "flatkey.ai");
  const metric = (group: typeof flatkeyTotals, label: string) => group?.metrics.find(row => row.label === label);

  return <section className={reportStyles.section}>
    <h3>自然搜索</h3>
    <div className={reportStyles.tableScroll}>
      <table className={reportStyles.comparison} aria-label="各模块与站点自然搜索">
        <thead><tr><th scope="col">站点 / 模块</th><th scope="col">自然访问 · GA4</th><th scope="col">Google 点击 · GSC</th><th scope="col">Google 曝光 · GSC</th></tr></thead>
        <tbody>
          <tr className={reportStyles.trafficGroup}><th scope="row">Flatkey 全站</th>
            <TrafficCell metric={metric(flatkeyTotals, "自然会话")} />
            <TrafficCell metric={metric(flatkeyTotals, "Google 点击")} />
            <TrafficCell metric={metric(flatkeyTotals, "曝光")} />
          </tr>
          {reportModules.map(([id, label]) => <tr key={id} className={reportStyles.trafficModule}>
            <th scope="row">{label}</th>
            <TrafficCell metric={ga4?.modules.find(module => module.id === id)} />
            <TrafficCell metric={gsc?.modules.find(module => module.id === id)} />
            <TrafficCell metric={gsc?.modules.find(module => module.id === id)?.impressions} />
          </tr>)}
        </tbody>
        <tbody>
          {reportSites.map(([site, name]) => {
            const group = groups?.find(row => row.name === site);
            return <tr key={site}>
              <th scope="row">{name}</th>
              <TrafficCell metric={metric(group, "自然会话")} />
              <TrafficCell metric={metric(group, "Google 点击")} />
              <TrafficCell metric={metric(group, "曝光")} />
            </tr>;
          })}
        </tbody>
      </table>
    </div>
    {coverage ? <p className={reportStyles.note}>Flatkey 模块数据日 {coverage}</p> : null}
    {countries ? <details className={reportStyles.reportDetail}><summary>Flatkey 四国占比</summary><ReportCountryShares groups={countries} /></details> : null}
    <ReportModuleTraffic rankings={rankings} />
  </section>;
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
  return <details className={reportStyles.reportDetail}>
    <summary>Flatkey 模块前 10 与博客选题</summary>
    {available.map(ranking => {
      const result = ranking.flatkey!;
      const metric = ranking.source === "GSC" ? "Google 点击" : "自然访问";
      const topics = rankBlogTopics(result.modules.find(module => module.id === "blog")?.pages ?? []);
      return <div key={ranking.source} className={reportStyles.moduleRows}>
        <h4>{ranking.source} · {metric}</h4>
        {result.rankingDates?.length ? <p className={reportStyles.note}>榜单覆盖 {result.rankingDates.join("、")}</p> : null}
        {result.modules.map(module => <details key={module.id}>
          <summary>{module.label} · {module.pages.length ? `前 ${module.pages.length} 名` : "暂无榜单"}</summary>
          {module.pages.length ? <ol className={reportStyles.issueList}>
            {module.pages.map(page => <li key={page.url}>
              <a href={page.url} target="_blank" rel="noreferrer">{new URL(page.url).pathname + new URL(page.url).search}</a>
              {" · "}{numberText(page.value)}{page.previous !== null ? ` · ${trafficChange(page.previous, page.value)}` : ""}
            </li>)}
          </ol> : null}
        </details>)}
        {topics.length ? <div className={reportStyles.moduleTopics}>
          <h4>博客选题</h4>
          <ul className={reportStyles.issueList}>{topics.map(topic => <li key={topic.label}>{topic.label} · {topic.pages} 页{topic.followUp ? `。建议${topic.followUp}` : ""}</li>)}</ul>
        </div> : null}
      </div>;
    })}
  </details>;
}

function RecentPageTraffic({ pages, weekly }: { pages: SeoDigest["recentPages"]; weekly: boolean }) {
  if (!pages) return null;
  const best = pages.filter(page => page.latest || page.latestVisits).slice(0, 10);
  const visits = (point: NonNullable<SeoDigest["recentPages"]>[number]["latestVisits"]) =>
    point ? <>{numberText(point.visits)}<small>{point.date}</small></> : "—";
  return <details className={reportStyles.reportDetail}>
    <summary>新上线页面流量{pages.length ? ` · ${pages.length} 页` : ""}</summary>
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
  </details>;
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

function ReportSections({ text, rankings, recentPages, weekly, highlights }: { text: string; rankings: SeoDigest["pagePerformance"]; recentPages: SeoDigest["recentPages"]; weekly: boolean; highlights?: string[] }) {
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
  const sites = sections.find(section => section.title.startsWith("五站自然搜索"));
  return <div className={reportStyles.sections}>
    <SearchTraffic groups={sites ? parseReportComparisons(sites.lines) : null} countries={countries} rankings={rankings ?? []} />
    <section className={reportStyles.section}>
      <RecentPageTraffic pages={recentPages} weekly={weekly} />
      <details className={reportStyles.reportDetail}><summary>工作与其他数据</summary>
        <div className={reportStyles.detailSections}>
          {highlights?.length ? <section className={reportStyles.section}>
            <h3>本周工作</h3>
            <ul className={reportStyles.issueList}>{highlights.map(item => <li key={item}>{item}</li>)}</ul>
            <p><a href="https://flatkey.ai/zh/about" target="_blank" rel="noreferrer">查看 Flatkey About 页面 ↗</a></p>
          </section> : null}
          {sections.map((section, index) => {
            if (/^(五站自然搜索|Flatkey 四国分项)/.test(section.title) || weekly && section.title.startsWith("历史交付归档")) return null;
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
              <h3>{section.title}</h3>{items(lines)}
            </section>;
          })}</div>
      </details>
    </section>
  </div>;
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
        <dl className={reportStyles.metrics}>
          <div><dt>新增博客</dt><dd>{deliveryCount(report.counts.originals, report.coverage?.publications, report.deliveryStates?.blogs)}</dd></div>
          <div><dt>新增落地页</dt><dd>{deliveryCount(report.counts.landingPages, report.coverage?.publications, report.deliveryStates?.landing)}</dd></div>
          <div><dt>已上线优化</dt><dd>{deliveryCount(report.counts.optimizedPages, report.coverage?.optimizations, report.deliveryStates?.optimizations)}</dd></div>
          <div><dt>待审页面版本</dt><dd>{numberText(report.approvalQueue?.pages)}</dd></div>
          <div><dt>Flatkey 注册人数</dt><dd>{registrations?.users == null ? "待更新" : numberText(registrations.users)}</dd>
            <small>{registrations ? registrations.start === registrations.end ? registrations.start : `${registrations.start} — ${registrations.end}` : "全渠道 · 区间去重"}</small></div>
        </dl>
        <ReportSections text={report.detailText || report.text} rankings={report.pagePerformance} recentPages={report.recentPages} weekly={kind === "weekly"} highlights={report.weeklyHighlights} />
      </article>}
  </div>;
}
