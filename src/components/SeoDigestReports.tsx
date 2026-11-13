"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { CalendarDays, RefreshCw } from "lucide-react";
import { executionViewRoutes, workTaskHref } from "@/lib/seo-workspace-routes";
import { seoToday, shiftDay } from "@/lib/seo-date-range";
import { parseReportComparisons, type ReportMetric } from "@/lib/seo-report-comparisons";
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

function SearchTraffic({ groups, countries, rankings, organicRegistrations }: {
  groups: ReturnType<typeof parseReportComparisons>;
  countries: ReturnType<typeof parseReportComparisons>;
  rankings: SeoDigest["pagePerformance"];
  organicRegistrations?: SeoDigest["organicRegistrations"];
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
        <thead><tr><th scope="col">站点 / 模块</th><th scope="col">自然访问 · GA4</th><th scope="col">Google 点击 · GSC</th><th scope="col">Google 曝光 · GSC</th><th scope="col">自然搜索注册 · GA4</th></tr></thead>
        <tbody>
          <tr className={reportStyles.trafficGroup}><th scope="row">Flatkey 全站</th>
            <TrafficCell metric={metric(flatkeyTotals, "自然会话")} />
            <TrafficCell metric={metric(flatkeyTotals, "Google 点击")} />
            <TrafficCell metric={metric(flatkeyTotals, "曝光")} />
            {organicRegistrations?.current == null
              ? <td className={reportStyles.trafficMissing}>未核实<small>GA4 未返回可核验的注册人数</small></td>
              : <TrafficCell metric={organicRegistrations} />}
          </tr>
          {reportModules.map(([id, label]) => <tr key={id} className={reportStyles.trafficModule}>
            <th scope="row">{label}</th>
            <TrafficCell metric={ga4?.modules.find(module => module.id === id)} />
            <TrafficCell metric={gsc?.modules.find(module => module.id === id)} />
            <TrafficCell metric={gsc?.modules.find(module => module.id === id)?.impressions} />
            <td className={reportStyles.trafficMissing}>—</td>
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
              <td className={reportStyles.trafficMissing}>—</td>
            </tr>;
          })}
        </tbody>
      </table>
    </div>
    {coverage ? <p className={reportStyles.note}>Flatkey 模块数据日 {coverage}</p> : null}
    <p className={reportStyles.note}>自然搜索注册目前只统计 Flatkey 全站；模块和集群站未接入此口径（—）。</p>
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

function RecentPageTraffic({ pages, weekly }: { pages: SeoDigest["recentPages"]; weekly: boolean }) {
  const entries = pages ?? [];
  const comparable = entries.filter(page => page.latest || page.latestVisits);
  const best = [...comparable, ...entries.filter(page => !page.latest && !page.latestVisits)].slice(0, 10);
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
    <h3>近期新增与优化 · 前 10</h3>
    <p className={reportStyles.note}>{weekly ? "本周和上周。" : "近两周。"}比较上线前最后一个有效日与上线后最新完整日。优先展示数据日期最新、Google 点击和曝光较高的页面。</p>
    {!best.length ? <p className={reportStyles.note}>{!pages ? "近期发布台账待更新。" : "这两周暂无已核实的新增或优化页面。"}</p> : <div className={reportStyles.tableScroll}>
      <table className={`${reportStyles.comparison} ${reportStyles.recentComparison}`} aria-label="近期新增与优化页面前后对比">
        <thead><tr><th scope="col">页面 / 上线</th><th scope="col">Google 点击</th><th scope="col">Google 曝光</th><th scope="col">点击率</th><th scope="col">自然访问</th></tr></thead>
        {(["current", "previous"] as const).map(cohort => {
          const group = best.filter(page => page.cohort === cohort);
          return <tbody key={cohort}>
            <tr className={reportStyles.trafficGroup}><th colSpan={5} scope="rowgroup">{cohort === "current" ? "本周" : "上周"}</th></tr>
            {group.length ? group.map(page => {
              const beforeCtr = page.before?.impressions ? page.before.clicks / page.before.impressions * 100 : null;
              const afterCtr = page.latest?.impressions ? page.latest.clicks / page.latest.impressions * 100 : null;
              return <tr key={page.url}>
                <th scope="row"><a href={page.url} target="_blank" rel="noreferrer">{page.title}</a>
                  <small>{page.day} · {page.change === "optimization" ? "优化" : "新增"}</small></th>
                <td>{changeCell(page.before?.clicks ?? null, page.latest?.clicks ?? null)}
                  {page.before || page.latest ? <small>{[page.before?.date, page.latest?.date].filter(Boolean).join(" → ")}</small> : null}</td>
                <td>{changeCell(page.before?.impressions ?? null, page.latest?.impressions ?? null)}</td>
                <td>{afterCtr === null ? "—" : changeCell(beforeCtr === null ? null : Number(beforeCtr.toFixed(2)), Number(afterCtr.toFixed(2)), true)}</td>
                <td>{changeCell(page.beforeVisits?.visits ?? null, page.latestVisits?.visits ?? null)}
                  {page.beforeVisits || page.latestVisits ? <small>{[page.beforeVisits?.date, page.latestVisits?.date].filter(Boolean).join(" → ")}</small> : null}</td>
              </tr>;
            }) : <tr><td colSpan={5} className={reportStyles.trafficMissing}>暂无入榜页面</td></tr>}
          </tbody>;
        })}
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
        <a href={repo.href} target="_blank" rel="noreferrer">{repo.label}</a>
      </th>)}</tr></thead>
      <tbody>{metrics.map(metric => <tr key={metric.label}><th scope="row">{metric.label}</th>
        {repositories.map(repo => {
          const details = repo.details.join("\n");
          const value = metric.get(details) ?? (metric.label.startsWith("到站") && details.includes("该仓库UTM条件暂无匹配数据") ? "暂无匹配数据" : undefined);
          const [main, note] = value?.split("（") ?? [];
          return <td key={repo.href}>{!main || main === "待更新→待更新" ? "待更新" : main.replace("→", " → ")}
            {note ? <small>{note.replace(/）$/, "")}</small> : null}</td>;
        })}
      </tr>)}</tbody>
    </table>
  </div>;
}

function OptimizationLinks({ lines }: { lines: string[] }) {
  const links = new Map<string, string>();
  for (const line of lines) {
    const match = [...line.matchAll(inline)].find(([, , href]) => href && URL.canParse(href));
    if (match) links.set("/optimization-effects?" + new URLSearchParams({ page: match[2] }), match[1]);
  }
  return links.size ? <ul className={reportStyles.issueList}>{[...links].map(([href, label]) =>
    <li key={href}><Link href={href}>{label}</Link></li>)}</ul> : null;
}

function TechnicalIssues({ lines }: { lines: string[] }) {
  const issues = lines.flatMap(line => {
    if (/^•\s+缺口\s*·/.test(line)) return line.replace(/^•\s+缺口\s*·\s*/, "").split("；").filter(Boolean);
    if (/^•\s+复核\s*·/.test(line)) return [line.replace(/^•\s+复核\s*·\s*/, "")];
    if (/^•\s+P[0-4]\s+/.test(line)) return [line.replace(/^•\s+/, "")];
    return [];
  });
  if (issues.length) return <ul className={reportStyles.issueList}>{issues.map((issue, index) => <li key={index}><ReportLine line={issue} /></li>)}</ul>;
  return <p className={reportStyles.note}>{lines.some(line => line.includes("尚未收到巡检回执")) ? "本期巡检结果待更新。" : "本期暂无已记录的巡检问题。"}</p>;
}

const ga4Scopes = ["自然搜索归因", "全渠道业务"] as const;
const ga4ReasonLabels: Record<string, string> = {
  registration_invalid_response: "注册查询未返回可核验的数据",
  registration_empty_response_unverified: "注册查询未返回可核验的数据",
  no_matching_steps_in_selected_period: "本期无匹配步骤",
  "invalid_response:funnel_steps_incomplete": "漏斗步骤数据不完整",
  thresholding: "GA4 数据阈值限制",
  sampling: "GA4 数据采样",
};

function BusinessComparison({ lines }: { lines: string[] }) {
  const metrics = new Map<string, Map<string, string>>();
  let scope: string | null = null;
  for (const line of lines) {
    const heading = /^• (自然搜索归因|全渠道业务)：(.+)$/.exec(line);
    const metric = /^\s{2,}([^：]+)：(.+)$/.exec(line);
    const key = heading ? "数据范围" : metric?.[1];
    const raw = heading?.[2] ?? metric?.[2];
    if (heading) scope = heading[1];
    if (line.startsWith("• ") && !heading) scope = null;
    if (!scope || !key || !raw) continue;
    const values = metrics.get(key) ?? new Map<string, string>();
    const value = Object.entries(ga4ReasonLabels).reduce((current, [code, label]) => current.replaceAll(code, label), raw)
      .replace("America/Los_Angeles", "太平洋时间").replace(/未观测到，埋点上线及收数待核验/g, "未观测到");
    values.set(scope, value);
    metrics.set(key, values);
  }
  if (!metrics.size) return <p className={reportStyles.note}>本期暂无 GA4 转化回执。</p>;
  return <>
    <div className={reportStyles.tableScroll}>
      <table className={`${reportStyles.comparison} ${reportStyles.businessComparison}`} aria-label="GA4 自然搜索与全渠道对比">
        <thead><tr><th scope="col">指标</th>{ga4Scopes.map(label => <th key={label} scope="col">{label}</th>)}</tr></thead>
        <tbody>{[...metrics].map(([metric, values]) => <tr key={metric}>
          <th scope="row">{metric}</th>{ga4Scopes.map(label => {
            const value = values.get(label);
            const collected = metric === "数据范围" && value?.match(/ · 采集 (\S+)$/)?.[1];
            return <td key={label}>{collected ? <>{value!.replace(/ · 采集 \S+$/, "").replace(/(\d{4}-\d{2}-\d{2})—\1/, "$1")}<small>采集于 {shanghaiStamp(collected)}（北京时间）</small></> : value ?? "—"}</td>;
          })}
        </tr>)}</tbody>
      </table>
    </div>
    <p className={reportStyles.note}>事件人数按区间去重；漏斗按 GA4 同一用户的步骤顺序统计。</p>
  </>;
}

const planKinds = [["optimization", "页面优化"], ["blog", "博客关键词"], ["landing", "落地页关键词"]] as const;
const planStatuses: Record<string, string> = { planned: "待开始", researching: "研究中", ready: "待执行", drafting: "制作中",
  review_pending: "待审核", approved: "待发布", published: "已上线 · 待验收", verified: "已验收", observing: "已上线 · 监控中", blocked: "有阻塞", failed: "需处理" };
function ReportWorkPlan({ plan, weekly }: { plan?: SeoDigest["workPlan"]; weekly: boolean }) {
  return <section className={reportStyles.section}>
    <h3>{weekly ? "下周工作计划" : "本周计划进度"}</h3>
    {!plan ? <p className={reportStyles.note}>工作台暂无{weekly ? "下周" : "本周"}计划记录。</p> : <>
      <p className={reportStyles.note}>{plan.weekStart} — {shiftDay(plan.weekStart, 6)} · {plan.status === "reviewed" ? "已确认" : "待确认"} · <Link href={`/work?week=${plan.weekStart}`}>查看工作任务</Link></p>
      {planKinds.map(([kind, label]) => {
        const tasks = plan.tasks.filter(task => task.kind === kind);
        const completed = tasks.filter(task => ["verified", "observing"].includes(task.status)).length;
        return <div className={reportStyles.planGroup} key={kind}>
          <h4>{label} <small>{weekly ? `${tasks.length} 项` : `已验收 ${completed} / ${tasks.length}`}</small></h4>
          {tasks.length ? <div className={reportStyles.tableScroll}>
            <table className={`${reportStyles.comparison} ${reportStyles.businessComparison}`} aria-label={label}>
              <thead><tr><th scope="col">{kind === "optimization" ? "页面" : "关键词"}</th><th scope="col">{kind === "optimization" ? "目标关键词" : "内容任务"}</th><th scope="col">市场 / 语言</th><th scope="col">{weekly ? "安排" : "进度"}</th></tr></thead>
              <tbody>{tasks.map(task => <tr key={task.id}>
                <th scope="row"><Link href={workTaskHref({ id: task.id, weekStart: plan.weekStart })}>{kind === "optimization" ? task.title : task.keyword ?? "关键词待确认"}</Link>
                  {kind === "optimization" && task.pageUrl ? <small><a href={task.pageUrl} target="_blank" rel="noreferrer">{new URL(task.pageUrl).pathname}</a></small> : null}</th>
                <td>{kind === "optimization" ? task.keyword ?? "—" : task.title}</td>
                <td>{[task.country, task.language].filter(Boolean).join(" / ") || "—"}</td>
                <td>{planStatuses[task.status] ?? "待确认"}<small>{shanghaiStamp(task.dueAt).split(" ")[0]}</small>{weekly && task.action ? <small>{task.action}</small> : null}</td>
              </tr>)}</tbody>
            </table>
          </div> : <p className={reportStyles.note}>暂无安排</p>}
        </div>;
      })}
    </>}
  </section>;
}

function ReportSections({ text, rankings, recentPages, weekly, highlights, organicRegistrations, workPlan }: { text: string; rankings: SeoDigest["pagePerformance"]; recentPages: SeoDigest["recentPages"]; weekly: boolean; highlights?: string[]; organicRegistrations?: SeoDigest["organicRegistrations"]; workPlan?: SeoDigest["workPlan"] }) {
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
  const github = sections.find(section => section.title.startsWith("GitHub 提示词渠道"));
  const business = sections.find(section => section.title.startsWith("GA4 行为与转化"));
  const technical = sections.find(section => section.title === "SEO 技术质检");
  const next = sections.find(section => section.title.startsWith(weekly ? "下周事项与关键词" : "明日优先关注"));
  return <div className={reportStyles.sections}>
    <SearchTraffic groups={sites ? parseReportComparisons(sites.lines) : null} countries={countries} rankings={rankings ?? []} organicRegistrations={organicRegistrations} />
    {github ? <section className={reportStyles.section}>
      <h3>GitHub 提示词渠道</h3><GithubComparison lines={github.lines} />
    </section> : null}
    {technical || !weekly ? <section className={reportStyles.section}>
      <h3>SEO 技术质检</h3>
      {technical?.lines[0] && !technical.lines[0].startsWith("•") ? <p className={reportStyles.note}>{technical.lines[0]}</p> : null}
      <TechnicalIssues lines={technical?.lines ?? ["尚未收到巡检回执"]} />
    </section> : null}
    <RecentPageTraffic pages={recentPages} weekly={weekly} />
    <section className={reportStyles.section}>
      <details className={reportStyles.reportDetail}><summary>工作与其他数据</summary>
        <div className={reportStyles.detailSections}>
          {highlights?.length ? <section className={reportStyles.section}>
            <h3>本周工作</h3>
            <ul className={reportStyles.issueList}>{highlights.map(item => <li key={item}>{item}</li>)}</ul>
            <p><a href="https://flatkey.ai/zh/about" target="_blank" rel="noreferrer">查看 Flatkey About 页面 ↗</a></p>
          </section> : null}
          {sections.map((section, index) => {
            if (/^(五站自然搜索|Flatkey 四国分项|GitHub 提示词渠道|SEO 技术质检|待审批页面|待补材料|明日优先关注|下周事项与关键词|GA4 行为与转化)/.test(section.title) || weekly && section.title.startsWith("历史交付归档")) return null;
            if (/^(统计与交付口径|已核实新增页面|内容交付|交付$|本期交付|今日交付|优化效果监控|优化监控|数据与执行情况|数据基础|Google 点击 ·|自然搜索访问（会话） ·)/.test(section.title)) return null;
            if (section.title.startsWith("已上线优化")) return <section className={reportStyles.section} key={index}>
              <h3>已上线优化</h3><OptimizationLinks lines={section.lines} />
            </section>;
            return <section className={reportStyles.section} key={index}>
              <h3>{section.title}</h3>{items(section.lines)}
            </section>;
          })}</div>
      </details>
    </section>
    {business ? <section className={reportStyles.section}><h3>GA4 行为与转化</h3><BusinessComparison lines={business.lines} /></section> : null}
    <ReportWorkPlan plan={workPlan} weekly={weekly} />
    <section className={reportStyles.section}>
      <h3>{weekly ? "下周优先关注" : "明日优先关注"}</h3>
      {next?.lines.length ? items(next.lines) : <p className={reportStyles.note}>待生成</p>}
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
          <div><dt>待审页面版本</dt><dd><Link className={reportStyles.approvalButton} href={executionViewRoutes.approvals}
            aria-label={`查看待审批页面版本：${numberText(report.approvalQueue?.pages)}`}>{numberText(report.approvalQueue?.pages)} <span aria-hidden="true">↗</span></Link></dd></div>
          <div><dt>Flatkey 注册人数</dt><dd>{registrations?.users == null ? "待更新" : numberText(registrations.users)}</dd>
            <small>{registrations ? registrations.start === registrations.end ? registrations.start : `${registrations.start} — ${registrations.end}` : "全渠道 · 区间去重"}</small></div>
        </dl>
        <ReportSections text={report.detailText || report.text} rankings={report.pagePerformance} recentPages={report.recentPages} weekly={kind === "weekly"} highlights={report.weeklyHighlights} organicRegistrations={report.organicRegistrations} workPlan={report.workPlan} />
      </article>}
  </div>;
}
