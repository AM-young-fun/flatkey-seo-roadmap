"use client";

import { FeedbackButton } from "./FeedbackButton";
import { GrowthReportDirections } from "./GrowthGoalSummary";
import Link from "@/components/AppLink";
import { useEffect, useRef, useState } from "react";
import { useReportReadyTiming } from "./useReportReadyTiming";
import type { WeeklySupplementRead } from "@/lib/seo-weekly-supplement";
import { useSearchParams } from "next/navigation";
import { CalendarDays, ChevronDown, RefreshCw } from "lucide-react";
import { executionViewRoutes } from "@/lib/seo-workspace-routes";
import { shiftDay, weeklyReportDate, weeklyReportRange, WEEKLY_REPORT_SWITCH_DATE } from "@/lib/seo-date-range";
import { parseReportComparisons, type ReportMetric } from "@/lib/seo-report-comparisons";
import { ReportCountryShares } from "./ReportCountryShares";
import { ReportLoading } from "./ReportLoading";
import { SeoIndexing404 } from "./SeoIndexing404";
import { DailyReportSendButton } from "./DailyReportSendButton";
// Render with the report response, without another body-module download.
import { ReviewedReportBody } from "./ReviewedReportBody";
import { WeeklyReportSupplement } from "./WeeklyReportSupplement";
import { summarizeReportTechnical } from "@/lib/seo-report-technical-summary";
import { bestMonthlyOptimizations } from "@/lib/seo-digest-recent-pages";
import { blogPageCounts } from "@/lib/seo-blog-page-counts";
import type { SeoDigest } from "@/lib/seo-digest";
import type { GrowthReportSnapshot } from "@/lib/growth-strategy";
import { numberText, useSeoRead } from "./useSeoAnalytics";
import styles from "./SeoWorkWorkspace.module.css";
import reportStyles from "./SeoDigestReports.module.css";
import { SeoAnchor } from "@/components/SeoAnchor";


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
    content.push(url ? <SeoAnchor href={url} key={match.index} target="_blank" rel="noreferrer">{label}</SeoAnchor> : <strong key={match.index}>{emphasis}</strong>);
    position = match.index + match[0].length;
  }
  content.push(line.slice(position));
  return <>{content}</>;
}

const reportSites = [
  ["rackrate.org", "RackRate"], ["modelfit.cc", "ModelFit"],
  ["rougecue.org", "RougeCue"],
  ["mochichatbot.com", "MochiChatbot"], ["jev-llm.com", "JEV LLM"],
] as const;
const reportModules = [["home", "首页"], ["blog", "博客"], ["models", "模型页"], ["gpu", "GPU"], ["prompts", "提示词"]] as const;

const sectionTitles = /^(统计与交付口径|已核实新增页面|内容交付|待审批页面|待补材料|已上线优化|历史交付归档|往期优化变化|优化效果监控|SEO 技术质检|五站自然搜索|Google 点击 ·|自然搜索访问（会话） ·|GA4 行为与转化|GitHub 提示词渠道|Flatkey 四国分项|关键词实测|下周事项与关键词|明日优先关注|数据与执行情况|新增博客|交付|搜索表现|待处理|本期交付|今日交付|关键变化|优化监控|重点效果|下一步|下周重点)/;

function TrafficCell({ metric, coverage, canCompare = true, delta }: {
  metric?: Pick<ReportMetric, "previous" | "current"> & Partial<Pick<ReportMetric, "period" | "note">>;
  coverage?: string; canCompare?: boolean; delta?: string;
}) {
  const current = metric?.current ?? null, previous = metric?.previous ?? null;
  if (current === null) return <td className={reportStyles.trafficMissing} title={metric?.note || undefined}>—</td>;
  const change = delta ?? trafficChange(previous, current);
  return <td title={coverage || metric?.period || undefined}>
    <strong>{numberText(current)}</strong>
    {canCompare && previous !== null && change ? <span className={reportStyles.delta} title={`上期 ${numberText(previous)}`} aria-label={`上期 ${numberText(previous)}，变化 ${change}`}
      data-tone={current === previous ? "neutral" : current > previous ? "increase" : "decrease"}>{change}</span> : null}
  </td>;
}

export function SearchTraffic({ groups, countries, rankings, organicRegistrations, completeWeekRequired = false, organicRegistrationCanCompare, registrationCoverageNote, dashboardTraffic }: {
  groups: ReturnType<typeof parseReportComparisons>;
  countries: ReturnType<typeof parseReportComparisons>;
  rankings: SeoDigest["pagePerformance"];
  organicRegistrations?: SeoDigest["organicRegistrations"];
  completeWeekRequired?: boolean;
  organicRegistrationCanCompare?: boolean;
  registrationCoverageNote?: string;
  dashboardTraffic?: NonNullable<SeoDigest["dashboard"]>["traffic"];
}) {
  const ga4 = rankings.find(ranking => ranking.source === "GA4")?.flatkey;
  const gsc = rankings.find(ranking => ranking.source === "GSC")?.flatkey;
  const coverage = (row: typeof ga4) => completeWeekRequired
    ? `同星期已核对 ${row?.comparisonDates?.length ?? 0}/7 天${row?.comparisonDates?.length ? `：${row.comparisonDates.join("、")}` : "；整周覆盖待核验"}`
    : row?.comparisonDates?.length && row.comparisonDates.length < (row.periodDays ?? 1)
      ? `同星期可比 ${row.comparisonDates.length}/${row.periodDays} 天：${row.comparisonDates.join("、")}` : undefined;
  const flatkeyTotals = groups?.find(group => group.name === "flatkey.ai");
  const metric = (group: typeof flatkeyTotals, label: string) => group?.metrics.find(row => row.label === label);
  const total = (group: typeof flatkeyTotals, label: string) => {
    const row = metric(group, label);
    return { metric: row, ...(completeWeekRequired ? {
      canCompare: Boolean(row?.delta) && !/阶段值|不计算周环比/.test(row?.note ?? ""),
      delta: row?.delta ?? "",
    } : {}) };
  };
  const moduleComparable = (row: typeof ga4) => !completeWeekRequired || row?.comparisonDates?.length === 7;

  return <section className={reportStyles.section}>
    <h3>自然搜索</h3>
    <div className={reportStyles.tableScroll}>
      <table className={reportStyles.comparison} aria-label="各模块与站点自然搜索">
        <thead><tr><th scope="col">站点 / 模块</th><th scope="col">自然访问 · GA4</th><th scope="col">Google 点击 · GSC</th><th scope="col">Google 曝光 · GSC</th><th scope="col">自然搜索注册 · GA4</th></tr></thead>
        <tbody>
          <tr className={reportStyles.trafficGroup}><th scope="row">Flatkey 全站</th>
            <TrafficCell {...total(flatkeyTotals, "自然会话")} />
            <TrafficCell {...total(flatkeyTotals, "Google 点击")} />
            <TrafficCell {...total(flatkeyTotals, "曝光")} />
            {organicRegistrations?.current == null
              ? <td className={reportStyles.trafficMissing}>未核实<small>GA4 未返回可核验的注册人数</small></td>
              : <TrafficCell metric={organicRegistrations} canCompare={!completeWeekRequired || organicRegistrationCanCompare === true}
                coverage={registrationCoverageNote} />}
          </tr>
          {reportModules.map(([id, label]) => <tr key={id} className={reportStyles.trafficModule}>
            <th scope="row">{label}</th>
            <TrafficCell metric={dashboardTraffic?.modules?.find(module => module.id === id)?.sessions ?? ga4?.modules.find(module => module.id === id)} coverage={dashboardTraffic?.modules ? undefined : coverage(ga4)} canCompare={dashboardTraffic?.modules ? true : moduleComparable(ga4)} />
            <TrafficCell metric={dashboardTraffic?.modules?.find(module => module.id === id)?.clicks ?? gsc?.modules.find(module => module.id === id)} coverage={dashboardTraffic?.modules ? undefined : coverage(gsc)} canCompare={dashboardTraffic?.modules ? dashboardTraffic.gscComparable : moduleComparable(gsc)} />
            <TrafficCell metric={dashboardTraffic?.modules?.find(module => module.id === id)?.impressions ?? gsc?.modules.find(module => module.id === id)?.impressions} coverage={dashboardTraffic?.modules ? undefined : coverage(gsc)} canCompare={dashboardTraffic?.modules ? dashboardTraffic.gscComparable : moduleComparable(gsc)} />
            <td className={reportStyles.trafficMissing}>—</td>
          </tr>)}
        </tbody>
        <tbody>
          {reportSites.map(([site, name]) => {
            const group = groups?.find(row => row.name === site);
            return <tr key={site}>
              <th scope="row">{name}</th>
              <TrafficCell {...total(group, "自然会话")} />
              <TrafficCell {...total(group, "Google 点击")} />
              <TrafficCell {...total(group, "曝光")} />
              <td className={reportStyles.trafficMissing}>—</td>
            </tr>;
          })}
        </tbody>
      </table>
    </div>
    {countries ? <ReportCountryShares groups={countries} /> : null}
  </section>;
}

function trafficChange(previous: number | null, current: number | null) {
  if (previous === null || current === null) return "待更新";
  const delta = current - previous;
  if (!delta) return "持平";
  if (!previous) return `+${numberText(delta)}`;
  return `${delta > 0 ? "+" : ""}${(delta / previous * 100).toFixed(1)}%`;
}

function RecentPageTraffic({ pages, day }: { pages: SeoDigest["recentPages"]; day?: string }) {
  const best = bestMonthlyOptimizations(day ? pages?.filter(page => page.day >= shiftDay(day, -29) && page.day <= day && page.latest?.date === day && page.before?.date === shiftDay(day, -1)).map(page => ({ ...page,
    beforeVisits: page.beforeVisits?.date === shiftDay(day, -1) ? page.beforeVisits : null,
    latestVisits: page.latestVisits?.date === day ? page.latestVisits : null,
  })) : pages);
  const label = day ? "当日优化效果" : "近一个月优化效果";
  const changeCell = (before: number | null, current: number | null, points = false) => {
    if (current === null) return <>{before !== null ? <>{numberText(before)}{points ? "%" : ""} → </> : null}<span className={reportStyles.trafficMissing}>待出数</span></>;
    if (before === null) return <>{numberText(current)}{points ? "%" : ""}<small>暂无基线</small></>;
    const delta = current - before;
    return <>{numberText(before)}{points ? "%" : ""} → {numberText(current)}{points ? "%" : ""}
      <small className={reportStyles.delta} data-tone={delta > 0 ? "increase" : delta < 0 ? "decrease" : "neutral"}>
        {points && delta ? `${delta > 0 ? "+" : ""}${delta.toFixed(2)} 个百分点` : trafficChange(before, current)}
      </small></>;
  };
  return <section className={reportStyles.section}>
    <div className={reportStyles.sectionHeading}><h3>{`${label} · 前 10`}</h3><Link className={styles.secondary} href="/optimization-effects">查看全部优化效果 ↗</Link></div>
    <p className={reportStyles.note}>{day ? `${day}，与前一日对比。` : ""}按 Google 点击增量、曝光增量排序；仅展示有前后对比且取得提升的页面。</p>
    {!best.length ? <p className={reportStyles.note}>{!pages ? "优化效果数据待更新。" : `${day ? "当日" : "近一个月"}暂无有完整对比且取得提升的页面。`}</p> : <div className={reportStyles.tableScroll}>
      <table className={`${reportStyles.comparison} ${reportStyles.recentComparison}`} aria-label={label + "前十"}>
        <thead><tr><th scope="col">页面 / 上线</th><th scope="col">Google 点击</th><th scope="col">Google 曝光</th><th scope="col">点击率</th><th scope="col">自然访问</th></tr></thead>
        <tbody>
            {best.map(page => {
              const beforeCtr = page.before?.impressions ? page.before.clicks / page.before.impressions * 100 : null;
              const afterCtr = page.latest?.impressions ? page.latest.clicks / page.latest.impressions * 100 : null;
              return <tr key={page.url}>
                <th scope="row"><SeoAnchor href={page.url} target="_blank" rel="noreferrer">{page.title}</SeoAnchor>
                  <small>{page.day} · {page.change === "optimization" ? "优化" : "新增"}</small></th>
                <td>{changeCell(page.before?.clicks ?? null, page.latest?.clicks ?? null)}
                  {page.before || page.latest ? <small>{[page.before?.date, page.latest?.date].filter(Boolean).join(" → ")}</small> : null}</td>
                <td>{changeCell(page.before?.impressions ?? null, page.latest?.impressions ?? null)}</td>
                <td>{page.latest && afterCtr === null ? "—" : changeCell(beforeCtr === null ? null : Number(beforeCtr.toFixed(2)), afterCtr === null ? null : Number(afterCtr.toFixed(2)), true)}</td>
                <td>{changeCell(page.beforeVisits?.visits ?? null, page.latestVisits?.visits ?? null)}
                  {page.beforeVisits || page.latestVisits ? <small>{[page.beforeVisits?.date, page.latestVisits?.date].filter(Boolean).join(" → ")}</small> : null}</td>
              </tr>;
            })}
        </tbody>
      </table>
    </div>}
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
        <SeoAnchor href={repo.href} target="_blank" rel="noreferrer">{repo.label}</SeoAnchor>
      </th>)}</tr></thead>
      <tbody>{metrics.map(metric => <tr key={metric.label}><th scope="row">{metric.label}</th>
        {repositories.map(repo => {
          const periodNote = metric.label === "浏览次数" || metric.label === "克隆次数"
            ? repo.details.find(line => line.startsWith(metric.label))?.split("；")[1]
            : metric.label.startsWith("到站") ? repo.details.find(line => line.startsWith("GitHub UTM→Flatkey 到站会话 "))?.split("；")[1]
            : undefined;
          const details = repo.details.join("\n");
          const value = metric.get(details) ?? (metric.label.startsWith("到站") && details.includes("该仓库UTM条件暂无匹配数据") ? "暂无匹配数据" : undefined);
          const [main, note] = value?.split("（") ?? [];
          return <td key={repo.href}>{!main || main === "待更新→待更新" ? "待更新" : main.replace("→", " → ")}
            {note ? <small>{note.replace(/）$/, "")}</small> : periodNote
              ? <small>{periodNote.includes("可比 0/") ? "缺少完整日期的 Traffic 回执" : periodNote.replace(/。$/, "")}</small> : null}</td>;
        })}
      </tr>)}</tbody>
    </table>
  </div>;
}

function TechnicalIssues({ text }: { text?: string | string[] }) {
  const summary = summarizeReportTechnical(text);
  if (summary.issues.length) return <ul className={reportStyles.issueList}>{summary.issues.map((issue, index) => <li key={index}><ReportLine line={issue} /></li>)}</ul>;
  return <p className={reportStyles.note}>{summary.message}</p>;
}

const planKinds = [["optimization", "页面优化"], ["content_refresh", "内容刷新"], ["blog", "博客关键词"], ["landing", "Flatkey 落地页关键词"], ["cluster_landing", "集群新增落地页"], ["research", "关键词研究"], ["cluster_work", "集群站其他任务"], ["other_work", "其他任务"]] as const;

function planNumbers(plan: SeoDigest["workPlan"], day?: string) {
  if (!plan) return null;
  const tasks = plan.tasks.filter(task => !day || new Date(task.dueAt).toLocaleDateString("en-CA", { timeZone: "Asia/Shanghai" }) === day);
  const groups = planKinds.map(([kind, label]) => {
    const rows = tasks.filter(task => kind === "content_refresh" ? task.kind === "optimization" && task.workClass === "content_refresh" : task.kind === kind && (kind !== "optimization" || task.workClass !== "content_refresh"));
    const scheduled = rows.filter(task => task.scheduled !== false);
    return { kind, label, scheduled: scheduled.length, completed: scheduled.filter(task => ["verified", "observing"].includes(task.status)).length,
      candidates: rows.length - scheduled.length };
  });
  const scheduled = groups.reduce((total, row) => total + row.scheduled, 0);
  const completed = groups.reduce((total, row) => total + row.completed, 0);
  const filters = new URLSearchParams({ range: "custom", rangeStart: day ?? plan.periodStart ?? plan.weekStart, rangeEnd: day ?? plan.periodEnd ?? shiftDay(plan.weekStart, 6) });
  return { completed, scheduled, groups, href: "/work?" + filters };
}

export function ReportWorkPlan({ plan: sourcePlan, weekly, day }: { plan?: SeoDigest["workPlan"]; weekly: boolean; day?: string }) {
  const plan = planNumbers(sourcePlan, day);
  if (!plan) return null;
  return <div>
    <dt><Link href={plan.href}>{day ? "当日任务" : weekly ? "下周工作计划" : "本周计划进度"}</Link></dt>
    <dd>{weekly ? numberText(plan.scheduled) : `${numberText(plan.completed)} / ${numberText(plan.scheduled)}`}
      <small>{weekly ? "已排任务" : "已验收 / 已排"}</small>
      <div className={reportStyles.planItems}>{plan.groups.filter(row => row.scheduled || row.candidates).map(row => <small key={row.kind}>{`${row.label} ${weekly ? row.scheduled : `${row.completed} / ${row.scheduled}`}${row.candidates ? ` · 候选 ${row.candidates}` : ""}`}</small>)}</div>
    </dd>
  </div>;
}

const attributionTitle = "流量上涨与下跌原因";

function ReportAttribution({ text, weekly, snapshot, period }: {
  text?: string;
  weekly: boolean;
  snapshot?: GrowthReportSnapshot;
  period?: SeoDigest["reportPeriod"];
}) {
  const archivedAttribution = text?.trim();
  if (archivedAttribution) {
    const content = weekly ? archivedAttribution
      .replace(/^[ \t]*[-•][ \t]+\*\*([^*\n]+)\*\*[：:][ \t]*/gm, "\n\n##### $1\n\n- ")
      .replace(/([。；])(?=\s*\[[^\]\n]+\]\(https:\/\/)/gu, "$1\n- ") : archivedAttribution;
    return <ReviewedReportBody text={`#### ${attributionTitle}\n\n${content}`} label={attributionTitle} />;
  }
  if (!weekly) return null;

  const directions = period ? snapshot?.directions.flatMap(direction => {
    const drivers = direction.drivers.filter(({ window }) => window.start === period.start && window.end === period.end && window.timezone === period.timezone);
    return drivers.length ? [{ ...direction, drivers, taskIds: [...new Set(drivers.flatMap(driver => driver.taskIds))] }] : [];
  }) : undefined;
  return <section className={reportStyles.section} aria-label={attributionTitle}>
    {directions?.length ? <GrowthReportDirections directions={directions} title={attributionTitle} />
      : <><h4>{attributionTitle}</h4><p className={reportStyles.note}>本周暂无可核验的流量涨跌原因。</p></>}
  </section>;
}

function ReportSections({ text, rankings, recentPages, weekly, organicRegistrations, githubSection, completeWeekRequired, organicRegistrationCanCompare, registrationCoverageNote, reportPeriod, dashboard, rankingNotes, reportTemplateVersion, growthSnapshot }: { text: string; rankings: SeoDigest["pagePerformance"]; recentPages: SeoDigest["recentPages"]; weekly: boolean; organicRegistrations?: SeoDigest["organicRegistrations"]; githubSection?: string[]; completeWeekRequired?: boolean; organicRegistrationCanCompare?: boolean; registrationCoverageNote?: string; reportPeriod?: SeoDigest["reportPeriod"]; dashboard?: SeoDigest["dashboard"]; rankingNotes?: string[]; reportTemplateVersion?: number; growthSnapshot?: GrowthReportSnapshot }) {
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
  const countrySection = sections.find(section => section.title.startsWith("Flatkey 四国分项"));
  const countries = dashboard?.traffic?.countries ?? (countrySection ? parseReportComparisons(countrySection.lines) : null);
  const sites = sections.find(section => section.title.startsWith("五站自然搜索"));
  const github = weekly || (reportTemplateVersion !== undefined && reportTemplateVersion >= 9) ? undefined
    : githubSection?.slice(1) ?? sections.find(section => section.title.startsWith("GitHub 提示词渠道"))?.lines;
  const technical = sections.find(section => section.title === "SEO 技术质检");
  return <div className={reportStyles.sections}>
    <SearchTraffic groups={dashboard?.traffic?.sites ?? (sites ? parseReportComparisons(sites.lines) : null)} countries={countries} rankings={rankings ?? []} organicRegistrations={organicRegistrations}
      completeWeekRequired={completeWeekRequired} organicRegistrationCanCompare={organicRegistrationCanCompare} registrationCoverageNote={dashboard ? undefined : registrationCoverageNote} dashboardTraffic={dashboard?.traffic} />
    <ReportAttribution text={dashboard?.attributionText} weekly={weekly} snapshot={growthSnapshot} period={reportPeriod} />
    <RecentPageTraffic pages={recentPages} day={weekly ? undefined : reportPeriod?.start} />
    {rankingNotes?.length ? <section className={reportStyles.section}>
      <h3>关键词排名明细</h3>
      <ul className={reportStyles.issueList}>{rankingNotes.map((line, index) => <li key={index}><ReportLine line={line} /></li>)}</ul>
    </section> : null}
    {dashboard?.technicalText || technical || !weekly ? <section className={reportStyles.section}>
      <h3>SEO 技术质检</h3>
      <TechnicalIssues text={dashboard?.technicalText || technical?.lines} />
    </section> : null}
    <SeoIndexing404 />
    {github ? <section className={reportStyles.section}>
      <h3>GitHub 提示词渠道</h3><GithubComparison lines={github} />
    </section> : null}
  </div>;
}

export function SeoDigestReports() {
  const params = useSearchParams();
  const archiveMenu = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const closeOutside = (event: PointerEvent) => {
      const menu = archiveMenu.current;
      if (menu?.open && event.target instanceof Node && !menu.contains(event.target)) menu.open = false;
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      const menu = archiveMenu.current;
      if (event.key !== "Escape" || !menu?.open) return;
      menu.open = false;
      menu.querySelector("summary")?.focus();
    };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, []);
  const kind = params.get("period") === "weekly" ? "weekly" : "daily";
  const kindLabel = kind === "weekly" ? "周报" : "日报";
  const requestedDate = params.get("date") ?? "";
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(requestedDate) && Number.isFinite(Date.parse(requestedDate + "T00:00:00Z"))
    && new Date(requestedDate + "T00:00:00Z").toISOString().slice(0, 10) === requestedDate;
  const date = valid ? kind === "weekly" ? weeklyReportDate(requestedDate) : requestedDate : null;
  const formatPeriod = (day: string) => {
    if (kind !== "weekly") return reportDateLabel(day >= "2026-11-24" ? day : shiftDay(day, -1));
    const range = weeklyReportRange(day);
    return `${range.start} — ${range.end}${day >= WEEKLY_REPORT_SWITCH_DATE ? " · 洛杉矶" : ""}`;
  };
  const exact = params.get("reportId");
  const selectedDate = date ?? exact?.split(":")[1] ?? null;
  const requestedArchivePage = Number(params.get("archivePage") ?? "1");
  const archivePage = Number.isSafeInteger(requestedArchivePage) && requestedArchivePage > 0 ? requestedArchivePage : 1;
  const query = new URLSearchParams({ kind, saved: "1", archive: "1", archivePage: String(archivePage), ...(selectedDate ? { date: selectedDate } : {}), ...(exact ? { reportId: exact } : {}) });
  if (kind === "weekly") query.set("supplement", "1");
  const result = useSeoRead<{ report: (SeoDigest & { githubSection?: string[]; businessSection?: string[] }) | null; dates?: string[]; archiveHasNext?: boolean; pendingArchiveDate?: string; weeklySupplement?: WeeklySupplementRead }>("/api/seo/digest?" + query);
  const report = result.data?.report;
  const [supplementReadyFor, setSupplementReadyFor] = useState<string | null>(null);
  const needsSupplement = kind === "weekly";
  useReportReadyTiming(Boolean(report) && (!needsSupplement || supplementReadyFor === report?.id), `${query}:${report?.id ?? ""}`);
  const dates = result.data?.dates ?? [];
  const selected = report?.date ?? selectedDate ?? dates[0] ?? "";
  const dateLabel = kind === "weekly" ? "报告周次" : "报告日期";
  const deliveryCount = (count: number, coverage: SeoDigest["coverage"]["publications"]) =>
    coverage === "verified" || count > 0 ? numberText(count) : "—";
  const route = (period: typeof kind, day?: string, page = 1, reportId?: string) => "/reports?" + new URLSearchParams({ period, ...(day ? { date: day } : {}), ...(page > 1 ? { archivePage: String(page) } : {}), ...(reportId ? { reportId } : {}) });
  const showArchivedBody = Boolean(report && (kind === "weekly" && exact || report.reviewedBody && (exact || !report.dashboard)));
  const showArchivePagination = archivePage > 1 || result.data?.archiveHasNext;
  const canSelectForSend = kind === "daily" && report && report.businessDate === new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(new Date());
  return <div className={reportStyles.workspace}>
    <header className={reportStyles.pageHeader}>
      <h1>日周效果</h1>
      <div className={reportStyles.headerActions}>
        <details className={reportStyles.archivePicker} ref={archiveMenu} key={kind}>
          <summary className={styles.secondary} aria-label={selected ? `${dateLabel} ${formatPeriod(selected)}` : dateLabel}>
            <CalendarDays size={16} aria-hidden="true" />
            <span>{selected ? formatPeriod(selected) : dateLabel}</span>
            <ChevronDown size={14} aria-hidden="true" />
          </summary>
          <div className={reportStyles.archiveMenu} aria-label={dateLabel}>
            {dates.length ? <ul className={reportStyles.archiveOptions}>{dates.map(day => <li key={day}>
              <Link href={route(kind, day, archivePage)} aria-current={day === selected ? "date" : undefined} onClick={event => {
                if (event.metaKey || event.altKey || event.ctrlKey || event.shiftKey || !archiveMenu.current) return;
                archiveMenu.current.open = false;
                archiveMenu.current.querySelector("summary")?.focus();
              }}>{formatPeriod(day)}{day === result.data?.pendingArchiveDate ? <small>预览</small> : null}</Link>
            </li>)}</ul> : <p className={reportStyles.archiveEmpty}>{result.data ? "暂无归档" : "正在读取…"}</p>}
            {showArchivePagination ? <nav className={reportStyles.archivePages} aria-label="报告归档分页">
              {archivePage > 1 ? <Link href={route(kind, selectedDate ?? undefined, archivePage - 1, exact ?? undefined)}>上一页</Link> : <span />}
              <span>第 {archivePage} 页</span>
              {result.data?.archiveHasNext ? <Link href={route(kind, selectedDate ?? undefined, archivePage + 1, exact ?? undefined)}>下一页</Link> : <span />}
            </nav> : null}
          </div>
        </details>
        {result.data || result.error ? <FeedbackButton type="button" className={styles.secondary} onClick={result.retry} pending={result.retrying} pendingLabel="正在刷新…"><RefreshCw size={14} aria-hidden="true" />刷新</FeedbackButton> : null}
        {canSelectForSend && <DailyReportSendButton key={report.id} reportId={report.id} reportHash={report.hash} />}
      </div>
    </header>
    <nav className={reportStyles.periods} aria-label="报告周期">
      <Link href={route("daily")} aria-current={kind === "daily" ? "page" : undefined}>日报</Link>
      <Link href={route("weekly")} aria-current={kind === "weekly" ? "page" : undefined}>周报</Link>
    </nav>
    {result.error ? <div className={reportStyles.feedback} role="alert"><p>{result.error}</p><FeedbackButton type="button" className={styles.secondary} onClick={result.retry} pending={result.pending} pendingLabel="正在读取…">重新读取</FeedbackButton></div>
      : !result.data ? <ReportLoading label={`正在读取${kindLabel}`} /> : !report
      ? <div className={reportStyles.feedback}>
        <p>{selected ? `${formatPeriod(selected)}没有已保存的${kindLabel}。` : `暂无已保存的${kindLabel}。`}</p>
        {dates.length ? <Link className={styles.secondary} href={route(kind, dates[0])}>查看最近一份{kindLabel}</Link> : null}
      </div> : <article className={reportStyles.report}>
        {exact || !showArchivedBody && (kind === "weekly" || report.reviewedBody) ? <div className={reportStyles.archiveActions}>
          {exact ? <Link className={styles.secondary} href={route(kind, report.date, archivePage)}>查看最新详情</Link>
            : <Link className={styles.secondary} href={route(kind, report.date, archivePage, report.id)}>查看已保存原文</Link>}
        </div> : null}
        {showArchivedBody ? <ReviewedReportBody text={report.text} label={report.draftBody ? "待审周报完整正文" : report.reviewedBody ? undefined : "已保存周报原文"} /> : <>
        <dl className={reportStyles.metrics}>
          <div><dt>SEO 注册人数 · GA4</dt><dd>{report.organicRegistrations?.current == null ? "待更新" : numberText(report.organicRegistrations.current)}</dd>
            <small>首次自然获客 · 区间去重</small></div>
          <div><dt>新增博客页面</dt><dd>{deliveryCount(blogPageCounts(report.counts).total, report.coverage?.publications)}
            <small>源文 {numberText(report.counts.originals)} · 译文 {numberText(report.counts.translations ?? 0)} · 旧文补译 {numberText(report.counts.backfillTranslations ?? 0)}</small></dd></div>
          <div><dt>新增落地页</dt><dd>{deliveryCount(report.counts.landingPages, report.coverage?.publications)}</dd></div>
          <div><dt>已上线优化</dt><dd>{deliveryCount(report.counts.optimizedPages, report.coverage?.optimizations)}</dd>{report.counts.refreshedPages === undefined ? null : <small>内容刷新 {deliveryCount(report.counts.refreshedPages, report.coverage?.optimizations)}</small>}</div>
          <div><dt>待审页面版本</dt><dd><Link className={reportStyles.approvalButton} href={executionViewRoutes.approvals}
            aria-label={`查看待审批页面版本：${numberText(report.approvalQueue?.pages)}`}>{numberText(report.approvalQueue?.pages)} <span aria-hidden="true">↗</span></Link></dd></div>
        </dl>
        <ReportSections text={report.dashboard?.detailText || report.detailText || report.text} rankings={report.pagePerformance} recentPages={report.recentPages} weekly={kind === "weekly"} organicRegistrations={report.organicRegistrations} githubSection={report.githubSection} reportTemplateVersion={report.reportTemplateVersion} growthSnapshot={report.growthSnapshot}
          completeWeekRequired={kind === "weekly" && report.date >= WEEKLY_REPORT_SWITCH_DATE} organicRegistrationCanCompare={report.organicRegistrationCanCompare} registrationCoverageNote={report.registrationCoverageNote} reportPeriod={report.reportPeriod ?? (kind === "weekly" ? { ...weeklyReportRange(report.date), timezone: "America/Los_Angeles" } : { start: shiftDay(report.date, -1), end: shiftDay(report.date, -1), timezone: "America/Los_Angeles" })} dashboard={report.dashboard} rankingNotes={report.rankingNotes} />
        {(report.workPlan || (kind === "weekly" && report.currentWorkPlan)) ? <section className={reportStyles.section}>
          <h3>任务安排</h3>
          {kind === "weekly" ? <dl className={`${reportStyles.metrics} ${reportStyles.planMetrics}`} aria-label="本周进度与下周计划">
            <ReportWorkPlan plan={report.currentWorkPlan} weekly={false} />
            <ReportWorkPlan plan={report.workPlan} weekly />
          </dl> : <dl className={`${reportStyles.metrics} ${reportStyles.planMetrics}`}>
            <ReportWorkPlan plan={report.workPlan} weekly={false} day={report.businessDate ?? report.reportPeriod?.start} />
          </dl>}
        </section> : null}
        </>}
        {kind === "weekly" ? <WeeklyReportSupplement key={report.id} reportId={report.id} initial={result.data.weeklySupplement} onReady={setSupplementReadyFor} /> : null}
      </article>}
    {showArchivedBody || !report && (result.data || result.error) ? <aside className={reportStyles.report}><SeoIndexing404 /></aside> : null}
  </div>;
}
