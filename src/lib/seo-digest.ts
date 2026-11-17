import type { DailySeoTrafficHistory } from "./daily-seo-traffic";
import { DAILY_SEO_PAGE_GROUPS, type DailySeoPageGroupsHistory } from "./daily-seo-page-groups";
import type { recentPublishedPages } from "./seo-digest-recent-pages";
import { seoToday } from "./seo-date-range";
import type { AccountRegistrationSummary } from "./seo-account-registrations";
import { flatkeyRegistrationCount, latestBusinessPeriod, organicRegistrationComparison, weeklyBusinessDigestLines, type BusinessAnalytics } from "./seo-business-analytics";
import { githubDigestLines, type GithubChannel } from "./seo-github-channel";
import { digestTopPages } from "./seo-digest-pages";
import { effectStatusLabel, formatCtr, formatDelta, type OptimizationReportRow } from "./seo-page-effects";
import { technicalQaSummary, type TechnicalQaReport } from "./seo-technical-qa-report";
import type { AnalyticsObservation } from "./seo-analytics";
import { createHash } from "node:crypto";
import { digestSnapshotId } from "./seo-digest-message.cjs";
import { z } from "zod";
import { approvalReviewReadiness, automaticTaskPolicy, approvalItemNeedsHuman, isExecutableWorkflowPlan, reviewPreviewUrl, workflowApprovalEffectiveItemStatus, workflowWeek, type WorkflowApproval, type WorkflowOptimization, type WorkflowSnapshot } from "./seo-workflow";
import { executionViewRoutes, workTaskHref } from "./seo-workspace-routes";

export const SEO_DATA_HUB = "https://alidocs.dingtalk.com/i/nodes/jb9Y4gmKWrQa6B4mHrdNPxke8GXn6lpz";
export const SEO_REPORT_GROUP = "cid7d5au0J8RAKDDxMR+VNh1w==";
export const SEO_REPORT_ROBOT = "dingoyxfe0koa0dme6fz";
export const SEO_REPORT_WEBHOOK_ROBOT = "tFmSJLB0+A1WmEX9zMnH2w==";
const SEO_PLATFORM = "https://flatkey-seo-roadmap.vercel.app";
const approvalsUrl = SEO_PLATFORM + executionViewRoutes.approvals;
export const SEO_SITES = ["flatkey.ai", "rackrate.org", "modelfit.cc", "mochichatbot.com", "jev-llm.com"] as const;
export const digestDateSchema = z.iso.date();
export const digestKindSchema = z.enum(["daily", "weekly"]);
export type DigestKind = z.infer<typeof digestKindSchema>;
const shift = (day: string, n: number) => new Date(Date.parse(day + "T00:00:00Z") + n * 86400000).toISOString().slice(0, 10);
export const beijingDay = seoToday;
export type DigestMetric = "sessions" | "registrations" | "clicks" | "impressions";
export type DigestObservation = {
  site: string; date: string; source: "GA4" | "GSC"; timezone: string; observedAt: string;
  complete: boolean; scope: "session-organic-search" | "google-web";
  registrationMetric?: "sign_up_success" | "sign_up_or_legacy_distinct_users";
  country?: "US" | "JP" | "BR" | "ES";
  sessions?: number | null; registrations?: number | null; clicks?: number | null; impressions?: number | null; position?: number | null;
};
export type DigestPublication = { id: string; url: string; title: string; kind: "source" | "translation" | "backfill_translation" | "landing" | "cluster" | "prompt"; verifiedAt: string; recordedAt: string; publishedAt: string };
export type DigestOptimization = { id: string; url: string; keyword: string; changes: string; verifiedAt: string; recordedAt: string; baselineId: string };
export type DigestWorkPlan = {
  weekStart: string;
  status: "draft" | "scheduled" | "reviewed" | "bootstrap";
  targets?: { blogs: number; landing: number; optimizedPages: number; clusterLanding: number };
  tasks: { id: string; kind: "blog" | "landing" | "optimization" | "cluster_work" | "cluster_landing" | "research"; title: string; pageUrl: string | null; keyword: string | null; country: string | null; language: string | null; owner?: string; dueAt: string; status: string; action: string }[];
};

export type DigestInput = {
  notificationCompact?: boolean;
  dailyAcquisition?: DailySeoTrafficHistory;
  pageGroups?: DailySeoPageGroupsHistory;
  resolvedIssues?: number | null;
  workPlan?: DigestWorkPlan;
  date: string; kind?: DigestKind; now?: Date; observations: DigestObservation[];
  pageObservations?: AnalyticsObservation[];
  recentPages?: ReturnType<typeof recentPublishedPages>;
  businessObservations?: BusinessAnalytics[];
  accountRegistrations?: AccountRegistrationSummary;
  githubObservations?: GithubChannel[];
  publications: DigestPublication[]; optimizations: DigestOptimization[];
  effects: { url: string; comparison: string; evidence: string; judgment: string }[];
  optimizationMonitoring?: OptimizationReportRow[];
  technicalQa?: TechnicalQaReport;
  priorities: { title: string; keyword?: string; country?: string; url?: string; reason: string; action: string }[];
  issues: string[]; runNotes: string[]; rankingNotes?: string[]; nextPlanUrl?: string; nextPlanStatus?: "draft" | "scheduled" | "reviewed" | "bootstrap";
  publicationCoverage: "verified" | "missing" | "partial";
  deliveryStates?: { blogs: boolean; landing: boolean; cluster: boolean; optimizations: boolean };
  optimizationCoverage: "verified" | "missing" | "partial";
  reviewWorkflow?: Pick<WorkflowSnapshot, "approvals" | "tasks" | "publications" | "historicalImports">;
  historicalImports?: { id: string; recordedAt: string; sourceRunId: string; originals: number; translations: number; liveVerified: number; artifactOnly: number; unknownFirstVerification: number; pendingEvidence: number; pendingRevisions: number }[];
};

export function digestWindow(date: string, kind: DigestKind = "daily") {
  digestDateSchema.parse(date);
  digestKindSchema.parse(kind);
  const weekly = kind === "weekly";
  if (weekly && new Date(date + "T00:00:00Z").getUTCDay() !== 5) throw new Error("周报日期必须是北京时间周五");
  return {
    kind,
    workStart: shift(date, weekly ? -7 : -1) + (weekly ? "T00:00:00+08:00" : "T18:00:00+08:00"),
    workEnd: date + (weekly ? "T00:00:00+08:00" : "T18:00:00+08:00"),
    readyAfter: date + (weekly ? "T10:00:00+08:00" : "T18:00:00+08:00"),
    trafficStart: shift(date, weekly ? -7 : -1),
    trafficEnd: shift(date, -1),
  };
}

function completeMetricDays(observations: DigestObservation[], site: string, metric: DigestMetric, country: "all" | "US" | "JP" | "BR" | "ES") {
  const source = metric === "clicks" || metric === "impressions" ? "GSC" : "GA4";
  const rows = observations.filter(row => row.site === site && (row.country ?? "all") === country && row.source === source && row.complete
    && row.scope === (source === "GA4" ? "session-organic-search" : "google-web") && row[metric] != null);
  const latest = new Map<string, DigestObservation>();
  for (const row of rows) {
    const previous = latest.get(row.date);
    if (!previous || row.observedAt > previous.observedAt) latest.set(row.date, row);
  }
  return latest;
}

/** Weekly additive metrics compare only matching weekdays with verified values on both sides. */
export function comparableMetric(observations: DigestObservation[], site: string, metric: DigestMetric, date: string, country: "all" | "US" | "JP" | "BR" | "ES" = "all", kind: DigestKind = "daily") {
  const window = digestWindow(date, kind);
  const latest = completeMetricDays(observations, site, metric, country);
  // A weekly distinct-user metric must be queried over the full interval, not summed from daily users.
  if (window.kind === "weekly" && metric === "registrations") return { current: null, previous: null, dates: [] as string[], previousDates: [] as string[], timezone: null, reason: "周注册需区间去重数据，未用每日人数相加" };
  const possible: string[] = [];
  if (window.kind === "daily") {
    // If yesterday is unavailable, report the nearest consecutive comparable pair explicitly.
    for (let i = 0; i < 14; i++) possible.push(shift(window.trafficEnd, -i));
  } else {
    for (let d = window.trafficStart; d <= window.trafficEnd; d = shift(d, 1)) possible.push(d);
  }
  const pairs = possible.flatMap(day => {
    const current = latest.get(day), previous = latest.get(shift(day, window.kind === "weekly" ? -7 : -1));
    return current && previous && current.timezone === previous.timezone ? [{ current, previous }] : [];
  }).slice(0, window.kind === "daily" ? 1 : 7);
  if (!pairs.length) return { current: null, previous: null, dates: [] as string[], previousDates: [] as string[], timezone: null, reason: "待更新／缺少同口径可比数据" };
  const timezones = new Set(pairs.map(pair => pair.current.timezone));
  if (timezones.size !== 1) return { current: null, previous: null, dates: [] as string[], previousDates: [] as string[], timezone: null, reason: "来源时区变更，需重新建立比较基线" };
  return {
    current: pairs.reduce((n, p) => n + p.current[metric]!, 0),
    previous: pairs.reduce((n, p) => n + p.previous[metric]!, 0),
    dates: pairs.map(p => p.current.date), previousDates: pairs.map(p => p.previous.date), timezone: pairs[0].current.timezone,
    reason: pairs.length < (window.kind === "weekly" ? 7 : 1) || pairs.at(-1)?.current.date !== window.trafficEnd ? "最新日期未齐，仅比较列出的日期" : null,
  };
}

function escaped(value: string) { return value.replace(/[\r\n]+/g, " ").replace(/[[\]`*_<>]/g, ""); }
function safeLink(url: string | null | undefined) {
  try { const parsed = new URL(url ?? ""); return parsed.protocol === "https:" && !parsed.username && !parsed.password ? parsed.href.replace(/\(/g, "%28").replace(/\)/g, "%29") : null; }
  catch { return null; }
}
function link(title: string, url: string) { const safe = safeLink(url); return safe ? `[${escaped(title)}](${safe})` : escaped(title); }
function dateCoverage(dates: string[]) {
  const ordered = [...dates].sort();
  return ordered.length > 1 && ordered.every((day, index) => !index || day === shift(ordered[index - 1], 1)) ? `${ordered[0]}—${ordered.at(-1)}（${ordered.length}日）` : ordered.join(",");
}

export function weeklyTrafficPeriod(start: string, end: string): string {
  return `${shift(start, -7)}—${shift(end, -7)}（7日） → ${start}—${end}（7日）`;
}

const november13Highlights = [
  "完善 SEO 闭环，把数据采集、关键词与页面任务、测试预览与审批、发布记录和上线效果串起来，日周报汇总结果。",
  "制作并上线 Flatkey About 页面，介绍团队、GPU 基础设施和模型 API，并接入官网多语言导航。",
  "交付管理员权限管理和操作日志。根管理员可在用户管理页授予或撤销权限，撤权同时收回当前会话的管理权限。日志记录操作者、时间及权限和后台配置的变更。",
];

function weeklyTrafficRows(input: DigestInput, window: ReturnType<typeof digestWindow>) {
  const count = (value: number | null) => value?.toLocaleString("en-US") ?? "待更新";
  const dates = weeklyTrafficPeriod(window.trafficStart, window.trafficEnd);
  const change = (before: number | null, after: number | null) => before == null || after == null ? "—"
    : before === after ? "持平" : before === 0 ? `+${count(after)}` : `${formatDelta(Math.round((after - before) / before * 1000) / 10)}%`;
  const period = (start: string, metric: "sessions" | "clicks" | "impressions" | "position") => {
    const source = metric === "sessions" ? "GA4" : "GSC";
    const days = new Map<string, DigestObservation>();
    const end = shift(start, 6);
    for (const row of input.observations) {
      if (row.site !== "flatkey.ai" || row.country || row.source !== source || !row.complete ||
          row.scope !== (source === "GA4" ? "session-organic-search" : "google-web") ||
          row.date < start || row.date > end || row[metric === "position" ? "impressions" : metric] == null) continue;
      const prior = days.get(row.date);
      if (!prior || row.observedAt > prior.observedAt) days.set(row.date, row);
    }
    const rows = [...days.values()];
    if (rows.length !== 7 || new Set(rows.map(row => row.timezone)).size !== 1) return null;
    const timezone = rows[0].timezone;
    if (metric !== "position") return { timezone, value: rows.reduce((total, row) => total + row[metric]!, 0) };
    if (rows.some(row => row.impressions! > 0 && row.position == null)) return null;
    const weight = rows.reduce((total, row) => total + row.impressions!, 0);
    return { timezone, value: weight ? rows.reduce((total, row) => total + (row.position ?? 0) * row.impressions!, 0) / weight : null };
  };
  const previousStart = shift(window.trafficStart, -7);
  const pair = (metric: Parameters<typeof period>[1]) => ({
    previous: period(previousStart, metric), current: period(window.trafficStart, metric),
  });
  const row = (label: string, value: ReturnType<typeof pair>, metric: "sessions" | "clicks" | "impressions") => {
    if (!value.current || !value.previous) {
      const matched = comparableMetric(input.observations, "flatkey.ai", metric, input.date, "all", "weekly");
      if (matched.current !== null && matched.previous !== null) return { label, previous: count(matched.previous), current: count(matched.current),
        change: change(matched.previous, matched.current), dates: `${dateCoverage(matched.previousDates)} → ${dateCoverage(matched.dates)} · 同星期 ${matched.dates.length}/7 天` };
    }
    return ({
    label, previous: count(value.previous?.value ?? null), current: count(value.current?.value ?? null),
    change: value.previous?.timezone === value.current?.timezone
      ? change(value.previous?.value ?? null, value.current?.value ?? null) : "—", dates,
    });
  };
  const clicks = pair("clicks"), impressions = pair("impressions"), positions = pair("position");
  const registration = (start: string, end: string) => latestBusinessPeriod(input.businessObservations ?? [], start, end, "all", "session-organic-search");
  const previousRegistration = registration(shift(window.trafficStart, -7), shift(window.trafficEnd, -7));
  const currentRegistration = registration(window.trafficStart, window.trafficEnd);
  const users = (period: typeof currentRegistration) => period?.complete ? period.rows.find(item => item.event === "sign_up")?.users ?? null : null;
  const previousUsers = users(previousRegistration), currentUsers = users(currentRegistration);
  const ctr = (side: "previous" | "current") => {
    const numerator = clicks[side], denominator = impressions[side];
    if (!numerator || !denominator || numerator.timezone !== denominator.timezone) return null;
    return { timezone: numerator.timezone, value: denominator.value ? numerator.value! / denominator.value : null };
  };
  const previousCtr = ctr("previous"), currentCtr = ctr("current");
  const previousPosition = positions.previous?.value, currentPosition = positions.current?.value;
  return [row("自然搜索会话", pair("sessions"), "sessions"),
    { label: "自然搜索去重注册用户", previous: count(previousUsers), current: count(currentUsers), change: previousRegistration?.timezone === currentRegistration?.timezone ? change(previousUsers, currentUsers) : "—",
      dates },
    row("Google 自然搜索点击", clicks, "clicks"), row("Google 自然搜索曝光", impressions, "impressions"),
    { label: "Google 自然搜索点击率", previous: previousCtr ? formatCtr(previousCtr.value) : "待更新", current: currentCtr ? formatCtr(currentCtr.value) : "待更新",
      change: previousCtr?.value == null || currentCtr?.value == null || previousCtr.timezone !== currentCtr.timezone
        ? "—" : `${formatDelta((currentCtr.value - previousCtr.value) * 100)} 个百分点`, dates },
    { label: "Google 自然搜索平均排名", previous: positions.previous ? previousPosition?.toFixed(1) ?? "—" : "待更新",
      current: positions.current ? currentPosition?.toFixed(1) ?? "—" : "待更新",
      change: previousPosition == null || currentPosition == null || positions.previous?.timezone !== positions.current?.timezone
        ? "—" : Math.abs(currentPosition - previousPosition) < 0.05 ? "持平" : `${currentPosition < previousPosition ? "提升" : "下降"} ${Math.abs(currentPosition - previousPosition).toFixed(1)} 位`, dates },
  ];
}
function metricText(value: ReturnType<typeof comparableMetric>) {
  if (value.current === null || value.previous === null) return value.reason;
  const difference = value.current - value.previous;
  const percentage = value.previous === 0 ? (value.current === 0 ? "持平" : "上期为0，不计算百分比") : `${difference >= 0 ? "+" : ""}${(difference / value.previous * 100).toFixed(1)}%`;
  return `${value.previous}→${value.current}（${percentage}；${dateCoverage(value.previousDates)} → ${dateCoverage(value.dates)}，${value.timezone}${value.reason ? "；" + value.reason : ""}）`;
}
const cardNumber = (value: number | null) => value === null ? "待更新" : value.toLocaleString("en-US");
const shortCardText = (value: string, length = 96) => {
  const plain = escaped(value.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1"));
  return plain.length > length ? plain.slice(0, length - 1) + "…" : plain;
};
function cardComparison(previous: number | null, current: number | null) {
  if (previous === null && current === null) return "待更新";
  const values = `${cardNumber(previous)} → **${cardNumber(current)}**`;
  if (previous === null || current === null) return values;
  if (previous === current) return values + "（持平）";
  const delta = current - previous;
  return values + `（${delta > 0 ? "+" : ""}${cardNumber(delta)}${previous ? " / " + (delta > 0 ? "+" : "") + (100 * delta / previous).toFixed(1) + "%" : ""}）`;
}

function cardTraffic(input: DigestInput, window: ReturnType<typeof digestWindow>, metric: "sessions" | "clicks" | "impressions") {
  const paired = comparableMetric(input.observations, "flatkey.ai", metric, input.date, "all", window.kind);
  const archive = completeMetricDays(input.observations, "flatkey.ai", metric, "all");
  const offset = window.kind === "weekly" ? 7 : 1;
  const slice = (start: string, end: string) => [...archive.values()].filter(row => row.date >= start && row.date <= end)
    .sort((a, b) => a.date.localeCompare(b.date));
  const currentRows = slice(window.trafficStart, window.trafficEnd);
  const previousRows = slice(shift(window.trafficStart, -offset), shift(window.trafficEnd, -offset));
  const latest = [...archive.keys()].filter(day => day <= window.trafficEnd).sort().at(-1);
  if (paired.current !== null && paired.dates.at(-1) === (currentRows.at(-1)?.date ?? latest)) return {
    ...paired, latest, currentTimezone: paired.timezone, previousTimezone: paired.timezone,
    label: cardComparison(paired.previous, paired.current),
  };
  const period = (rows: DigestObservation[]) => {
    const timezone = new Set(rows.map(row => row.timezone)).size === 1 ? rows[0].timezone : null;
    return { timezone, total: timezone ? rows.reduce((total, row) => total + (row[metric] ?? 0), 0) : null };
  };
  const { total: current, timezone: currentTimezone } = period(currentRows);
  const { total: previous, timezone: previousTimezone } = period(previousRows);
  return { current, previous, latest, dates: currentRows.map(row => row.date), previousDates: previousRows.map(row => row.date),
    timezone: null, currentTimezone, previousTimezone, label: previous === null && current === null ? "待更新" : `${cardNumber(previous)} → **${cardNumber(current)}**` };
}

function cardCoverage(metric: ReturnType<typeof cardTraffic>) {
  return `${dateCoverage(metric.previousDates) || "待更新"} → ${dateCoverage(metric.dates) || "待更新"}`;
}

function cardPageGroups(input: DigestInput, window: ReturnType<typeof digestWindow>) {
  const groups = input.pageGroups?.groups ?? [];
  if (window.kind === "daily") {
    return DAILY_SEO_PAGE_GROUPS.map(({ key, name }) => {
      const points = groups.find(group => group.key === key)?.points;
      const current = points?.find(point => point.date === window.trafficEnd);
      const previous = points?.find(point => point.date === shift(window.trafficEnd, -1));
      if (!current?.collectedAt && !previous?.collectedAt) return `${name} · 待补采`;
      const delta = (before: number | null = null, after: number | null = null) => {
        if (before === null || after === null) return cardNumber(after);
        return `${cardNumber(after)}（${after === before ? "持平" : formatDelta(after - before)}）`;
      };
      return `${name} · 访客 ${delta(previous?.totalUsers, current?.totalUsers)} · 浏览 ${delta(previous?.pageViews, current?.pageViews)} · 同日注册 ${delta(previous?.funnel?.registrations, current?.funnel?.registrations)}`;
    });
  }
  return groups.flatMap(group => {
    const pairs = group.points.flatMap(point => {
      if (point.date < window.trafficStart || point.date > window.trafficEnd || !point.funnel) return [];
      const prior = group.points.find(other => other.date === shift(point.date, -7))?.funnel;
      return prior ? [{ current: point.funnel, previous: prior }] : [];
    });
    if (!pairs.length) return [];
    const rate = (side: "current" | "previous") => {
      const entrants = pairs.reduce((total, pair) => total + pair[side].entrants, 0);
      return entrants ? pairs.reduce((total, pair) => total + pair[side].registrations, 0) / entrants : null;
    };
    return [`${group.name} · 同日漏斗完成率 ${formatCtr(rate("previous"))} → ${formatCtr(rate("current"))}（同星期 ${pairs.length}/7 日）`];
  });
}

function dailyWorkEffectLines(recent: DigestInput["recentPages"], date: string) {
  const start = shift(date, -7), end = shift(date, -1);
  const pages = (recent ?? []).filter(row => row.day >= start && row.day <= end);
  const evidence = pages.filter(page => page.latest || page.latestVisits)
    .sort((a, b) => a.day.localeCompare(b.day) || a.url.localeCompare(b.url));
  const lines = [`过去 7 天上线（北京时间 ${start}—${end}） · 已核实 ${pages.length} 个页面 · ${evidence.length} 个已有上线后数据`];
  for (const page of evidence.slice(0, 4)) {
    const path = shortCardText(new URL(page.url).pathname, 64);
    const search = !page.latest ? "" : page.before
      ? ` · Google 点击 ${cardComparison(page.before.clicks, page.latest.clicks)}（${page.before.date} → ${page.latest.date}）`
      : ` · ${page.latest.date} Google 点击 ${cardNumber(page.latest.clicks)}`;
    const ga4 = !page.latestVisits ? "" : page.beforeVisits
      ? ` · 自然搜索会话 ${cardComparison(page.beforeVisits.visits, page.latestVisits.visits)}（${page.beforeVisits.date} → ${page.latestVisits.date}）`
      : ` · ${page.latestVisits.date} 自然搜索会话 ${cardNumber(page.latestVisits.visits)}`;
    lines.push(`• ${page.day} ${page.change === "new" ? "新上线" : "优化"} ${path}${search}${ga4}`);
  }
  if (!evidence.length) lines.push("• 暂无可核实的上线后日数据。");
  return lines;
}

function dailyTechnicalLines(qa: DigestInput["technicalQa"]) {
  if (!qa) return ["• 尚未收到当天的技术巡检结果。"];
  const lines = [`• 已检查 ${qa.completed}/${qa.checked} 项${qa.status === "completed" ? "，巡检完成。" : "，以下项目仍有缺口。"}`];
  const performance = /PSI|429/.test([qa.failure, ...qa.issues.map(issue => issue.title)].join(" "));
  if (performance) lines.push("• GPU 页面移动端速度还没有测出。Google 的测速请求达到限额，无法判断这些页面当前的加载速度。");
  for (const issue of qa.issues.filter(issue => issue.status !== "resolved" && !/PSI|429/.test(issue.title)).slice(0, performance ? 1 : 2)) {
    const description = /Googlebot|robots\.txt|\/api\//i.test(issue.title + " " + (issue.impact ?? ""))
      ? `${shortCardText(issue.title.split(/[:：]|GET 200/)[0].trim(), 55)}可以打开，但 Google 抓取规则挡住了它，可能影响搜索收录。`
      : [shortCardText(issue.title, 65), issue.impact && shortCardText(issue.impact, 96)].filter(Boolean).join("。");
    lines.push("• " + description);
  }
  const inspection = qa.diagnostics?.find(note => note.startsWith("GSC 收录抽查"))?.match(/(\d+)\/(\d+)/);
  if (inspection) lines.push(`• Google 收录抽查已返回 ${inspection[1]}/${inspection[2]} 个页面的检查结果。`);
  return lines;
}

function detailedNotification(title: string, input: DigestInput, window: ReturnType<typeof digestWindow>, now: Date, {
  pagePerformance, completed, optimizations, registrations, focus,
}: {
  pagePerformance: ReturnType<typeof digestTopPages>;
  completed: { blogs: number; optimized: number; newPages: number; fixed: number | null };
  optimizations: DigestOptimization[];
  registrations: ReturnType<typeof organicRegistrationComparison>;
  focus: string[];
}) {
  const weekly = window.kind === "weekly";
  const offset = weekly ? 7 : 1;
  const previousEnd = shift(window.trafficEnd, -offset);
  const dateLabel = window.trafficStart === window.trafficEnd ? window.trafficEnd : `${window.trafficStart}—${window.trafficEnd}`;
  const previousLabel = weekly ? `${shift(window.trafficStart, -7)}—${previousEnd}` : previousEnd;
  const sessions = cardTraffic(input, window, "sessions");
  const clicks = cardTraffic(input, window, "clicks");
  const impressions = cardTraffic(input, window, "impressions");
  const scope = "首次来源为自然搜索";
  const currentAcquisition = input.dailyAcquisition?.points.find(point => point.date === window.trafficEnd);
  const previousAcquisition = input.dailyAcquisition?.points.find(point => point.date === previousEnd);
  const acquisition = weekly ? null : currentAcquisition?.newUsers ?? null;
  const ctr = (side: "current" | "previous") => {
    const dates = side === "current" ? "dates" : "previousDates";
    const timezone = side === "current" ? "currentTimezone" : "previousTimezone";
    if (!clicks[timezone] || clicks[timezone] !== impressions[timezone] || clicks[dates].join() !== impressions[dates].join()) return null;
    const numerator = clicks[side], denominator = impressions[side];
    return numerator !== null && denominator ? numerator / denominator : null;
  };
  const previousCtr = ctr("previous"), currentCtr = ctr("current");
  const ctrDelta = previousCtr !== null && currentCtr !== null && clicks.timezone && clicks.timezone === impressions.timezone
    ? `（${formatDelta((currentCtr - previousCtr) * 100)} 个百分点）` : "";
  const heading = acquisition === null ? `自然搜索会话 ${sessions.label}` : `自然搜索新用户 ${cardComparison(previousAcquisition?.newUsers ?? null, acquisition)}`;
  const headlineRegistration = weekly || currentAcquisition?.newRegistrations == null
    ? cardComparison(registrations.previous, registrations.current)
    : cardComparison(previousAcquisition?.newRegistrations ?? null, currentAcquisition.newRegistrations);
  const bestPage = pagePerformance.find(ranking => ranking.source === "GSC")?.flatkey;
  const pageChanges = bestPage?.modules.flatMap(module => module.pages).filter(page => page.difference !== null)
    .sort((a, b) => Math.abs(b.difference!) - Math.abs(a.difference!)).slice(0, 3) ?? [];
  const pageSummary = weekly ? pageChanges[0] : undefined;
  const pagePath = (url: string) => shortCardText(new URL(url).pathname, 58);
  const lines = [`**${title}**`, "",
    `**${weekly ? "本周" : "今日"}结论** ${heading} · GA4 自然搜索去重注册 ${headlineRegistration}`,
    ...(pageSummary ? [`重点页面 ${pagePath(pageSummary.url)} · Google 点击 ${cardComparison(pageSummary.previous, pageSummary.value)}`] : []),
    `**统计期** ${dateLabel}（洛杉矶）｜对比 ${previousLabel}`,
    `**生成** ${new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", dateStyle: "short", timeStyle: "short" }).format(now)}（北京时间）`,
    "", `**1. ${weekly ? "业务结果与搜索表现" : "全站自然搜索"}**`];
  if (!weekly) {
    lines.push(`• GA4 新用户（${scope}） ${cardComparison(previousAcquisition?.newUsers ?? null, acquisition)}`,
      `• GA4 去重注册（${scope}） ${cardComparison(previousAcquisition?.newRegistrations ?? null, currentAcquisition?.newRegistrations ?? null)}`);
  }
  lines.push(`• GA4 自然搜索会话 ${sessions.label} · ${cardCoverage(sessions)}`,
    ...(weekly || registrations.previous !== null || registrations.current !== null
      ? [`• GA4 自然搜索会话归因去重注册 ${cardComparison(registrations.previous, registrations.current)}`] : []),
    `• Google 全站点击 ${clicks.label} · ${cardCoverage(clicks)}`,
    `• Google 全站曝光 ${impressions.label}${cardCoverage(clicks) === cardCoverage(impressions) ? "" : " · " + cardCoverage(impressions)}`,
    `• Google CTR ${previousCtr === null ? "待更新" : formatCtr(previousCtr)} → ${currentCtr === null ? "待更新" : formatCtr(currentCtr)}${ctrDelta}`);
  if (input.accountRegistrations) lines.push(`• Flatkey 账户注册 ${cardNumber(input.accountRegistrations.users)}${input.accountRegistrations.users === null ? "" : " 人"} · UTC`);

  lines.push("", weekly ? "**2. 重点页面**" : "**页面组表现**");
  const groups = cardPageGroups(input, window);
  if (groups.length) lines.push(...groups.map(row => "• " + row));
  else lines.push("• 页面组同日注册漏斗的可比数据待更新");
  if (weekly && pageChanges.length) {
    const dates = bestPage?.comparisonDates?.length ? bestPage.comparisonDates : bestPage?.date ? [bestPage.date] : [];
    lines.push(`Google 页面点击（本期 ${dateCoverage(dates)}）`,
      ...pageChanges.map(page => `• ${pagePath(page.url)} · ${cardComparison(page.previous, page.value)}`));
  }

  const rankingNotes = input.rankingNotes ?? [];
  if (!weekly) {
    lines.push("", "**2. 过去 7 天的工作效果**", ...dailyWorkEffectLines(input.recentPages, input.date));
    lines.push("", "**3. 关键词实测排名**", ...(rankingNotes.length ? rankingNotes.map(note => "• " + shortCardText(note, 120))
      : ["• 在已归档的 Google 搜索结果中还没有找到可核实的排名。"]));
    lines.push("", "**技术异常**", ...dailyTechnicalLines(input.technicalQa));
    lines.push("", "**4. 今日完成**", `• 已核实上线 **${completed.blogs} 篇文章**，优化 **${completed.optimized} 个页面**，制作并上线 **${completed.newPages} 个页面**，${completed.fixed === null ? "问题修复数待核验" : `修复 **${completed.fixed} 个问题**`}。`);
    const groups = input.pageGroups?.groups.filter(group => group.points.some(point => point.date === window.trafficEnd && point.funnel)).length ?? 0;
    lines.push("", `**数据状态** GA4 会话截至 ${sessions.latest ?? "待更新"} · GSC 点击截至 ${clicks.latest ?? "待更新"} · 当日注册漏斗 ${groups}/4 组`);
    return lines.join("  \n");
  }

  lines.push("", "**3. 关键词与技术异常**");
  if (!rankingNotes.length) lines.push("• 本期暂无新的关键词实测回执");
  else {
    lines.push("• " + shortCardText(rankingNotes[0], 125));
    if (weekly) {
      const comparison = rankingNotes.find(note => note.startsWith("同词、同站、同国家可比子集"));
      if (comparison && rankingNotes.at(-1) !== comparison) lines.push("• " + shortCardText(comparison, 88));
    }
    const last = rankingNotes.at(-1)!;
    if (rankingNotes.length > 1) lines.push("• " + shortCardText(last, 125));
  }
  const qa = input.technicalQa;
  const openIssue = qa?.issues.find(issue => issue.status !== "resolved");
  lines.push(`• 技术巡检 ${technicalQaSummary(qa ?? null)}`);
  if (openIssue) lines.push(`• ${openIssue.priority} ${shortCardText(openIssue.title, 44)} · ${shortCardText(openIssue.nextAction, 60)}`);
  const indexNote = qa?.diagnostics?.find(note => note.startsWith("GSC 收录抽查"));
  lines.push("• " + (indexNote ? shortCardText(indexNote) : "GSC 收录抽查回执待更新"));

  if (weekly) {
    lines.push("", "**4. 上期动作复盘**");
    const monitored = input.optimizationMonitoring?.filter(row => row.before && row.latest).slice(0, 2) ?? [];
    if (monitored.length) lines.push(...monitored.map(row => `• ${pagePath(row.url)} · ${shortCardText(row.change, 42)} · 点击 ${cardComparison(row.before!.clicks, row.latest!.clicks)}（${row.before!.date} → ${row.latest!.date}）`));
    else if (optimizations.length) lines.push(...optimizations.slice(0, 2).map(row => `• ${pagePath(row.url)} · 已上线 ${shortCardText(row.changes, 45)} · 效果待更新`));
    else lines.push("• 暂无已核实且可复盘的优化效果");
    lines.push("", "**5. 下周优先事项**");
    const workPlan = input.workPlan;
    if (workPlan && isExecutableWorkflowPlan(workPlan.status) && workPlan.tasks.length) {
      for (const [index, task] of workPlan.tasks.slice(0, 3).entries()) {
        const keyword = task.keyword ? ` · ${shortCardText(task.keyword, 32)}${task.country ? " " + task.country : ""}` : "";
        const date = beijingDay(new Date(task.dueAt));
        const action = task.action ? ` · ${shortCardText(task.action, 52)}` : "";
        const owner = task.owner ? ` · 负责人 ${shortCardText(task.owner, 20)}` : "";
        lines.push(`${index + 1}. ${shortCardText(task.title, 40)}${keyword}${action}${owner} · 截止 ${date}`);
      }
    } else {
      lines.push("• 下周正式排期待确认");
      for (const row of focus.slice(0, 2)) lines.push("• 待核对 " + shortCardText(row));
    }
  }
  lines.push("", `**数据状态** GA4 会话截至 ${sessions.latest ?? "待更新"} · GSC 点击截至 ${clicks.latest ?? "待更新"} · GA4 会话本期覆盖 ${sessions.dates.length}/7 日 · GSC 点击本期覆盖 ${clicks.dates.length}/7 日`);
  return lines.join("  \n");
}
function confirmedInWindow(row: { verifiedAt: string; recordedAt: string }, start: number, end: number) {
  const stamp = Math.max(Date.parse(row.verifiedAt), Date.parse(row.recordedAt));
  return Number.isFinite(stamp) && stamp >= start && stamp < end;
}

export function digestOptimizationEffect(row: WorkflowOptimization, observation: WorkflowOptimization["observations"][number]) {
  const comparison = observation.comparison;
  const judgment = { observing: "观察中", improved: "有改善，未证明单次改动因果", needs_investigation: "需排查", insufficient_data: "数据不足" }[observation.status];
  if (!comparison) return { url: row.pageUrl, comparison: `${observation.windowDays} 天窗口，${observation.comparableDays} 个可比日；未接入结构化前后数值`, evidence: observation.note, judgment };
  const before = comparison.before.metrics, after = comparison.after.metrics;
  const pair = (a: number | null, b: number | null) => a === null || b === null ? "待核实" : `${a}→${b}`;
  const ctr = before.ctr === null || after.ctr === null ? "待核实" : `${(before.ctr * 100).toFixed(2)}%→${(after.ctr * 100).toFixed(2)}%（${((after.ctr - before.ctr) * 100).toFixed(2)} 个百分点）`;
  const metrics = comparison.source === "GSC" ? `点击 ${pair(before.clicks, after.clicks)}，曝光 ${pair(before.impressions, after.impressions)}，CTR ${ctr}，目标词「${comparison.targetKeyword}」平均位置 ${pair(before.targetKeywordAveragePosition, after.targetKeywordAveragePosition)}` : `自然会话 ${pair(before.organicVisits, after.organicVisits)}，注册 ${pair(before.registrations, after.registrations)}；激活/付款仅按已核实事件口径记录`;
  return { url: row.pageUrl, comparison: `${comparison.source} · ${comparison.before.periodStart}—${comparison.before.periodEnd} → ${comparison.after.periodStart}—${comparison.after.periodEnd} · ${comparison.country}/${comparison.device} · ${comparison.timezone}`,
    evidence: `${metrics}；${comparison.status === "comparable" ? "完整可比窗口" : comparison.reason ?? "不可比"}；${observation.note}`, judgment: comparison.status === "comparable" ? judgment : "数据不足，观察中" };
}

const pageApprovalKinds = new Set(["blog", "landing", "optimization", "cluster", "technical"]);
const approvalUrl = (id: string) => `${approvalsUrl}?approvalId=${encodeURIComponent(id)}`;
const approvalPageKey = (page: { pageUrl: string; language: string }) => JSON.stringify([page.pageUrl, page.language]);
type PendingPage = {
  approval: WorkflowApproval;
  item: WorkflowApproval["items"][number];
  preview: string | null;
  screenshot: string | null;
  summary: string;
  missing: string[];
};

function reviewScreenshot(evidence: WorkflowApproval["evidence"] | undefined) {
  for (const item of evidence ?? []) {
    const url = safeLink(item.url);
    if (url && (/截图|截屏|screenshot|screen capture/i.test(item.label) || /\.(?:png|jpe?g|webp|gif|avif|bmp|heic)$/i.test(new URL(url).pathname))) return url;
  }
  return null;
}

function digestReviewQueue(workflow: NonNullable<DigestInput["reviewWorkflow"]>, now: Date) {
  const tasks = new Map(workflow.tasks.map(task => [task.id, task]));
  const allApprovals = [...new Map(workflow.approvals.map(approval => [approval.id, approval])).values()]
    .filter(approval => !approval.recordedAt || Date.parse(approval.recordedAt) <= now.getTime());
  const approvals = allApprovals
    .filter(approval => approval.submittedRecordedAt && Date.parse(approval.submittedRecordedAt) <= now.getTime());
  const livePages = [
    ...workflow.publications.filter(page => page.status === "published" || page.status === "verified"),
    ...workflow.historicalImports.flatMap(archive => archive.publications),
  ];
  const baselines = new Map<string, { publishedAt: string; contentVersion: string }>();
  for (const page of livePages) {
    const key = approvalPageKey(page);
    const previous = baselines.get(key);
    if (!previous || page.publishedAt > previous.publishedAt) baselines.set(key, page);
  }
  const pages: PendingPage[] = [];
  const pendingTasks = new Set<string>();
  const tasksMissingMaterials = new Set<string>();
  const missingPages: PendingPage[] = [];
  const decidedTasks = new Set<string>();
  const revisions = new Map<string, string>();
  const draftTasks = new Set<string>(), draftTickets = new Set<string>(), draftMaterials = new Set<string>();
  let draftPages = 0;

  for (const approval of approvals) {
    for (const item of approval.items) {
      const task = tasks.get(item.taskId);
      if (!task || task.siteDomain !== approval.siteDomain || (!item.postPublicationId && approval.siteDomain !== "flatkey.ai" && approval.channel !== "github") || !pageApprovalKinds.has(task.kind) || !approvalItemNeedsHuman(item, workflow.tasks)) continue;
      // Blog translations have independent content versions from their source task.
      const translation = task.kind === "blog" && item.language !== task.language;
      if (!translation && (item.contentVersion !== task.contentVersion
        || task.language && item.language !== task.language || task.pageUrl && item.pageUrl !== task.pageUrl)) continue;
      const status = workflowApprovalEffectiveItemStatus(approval, item.id, approvals);
      if (status === "pending") {
        if (["blocked", "failed"].includes(task.status) || task.kind !== "technical" && ["planned", "researching"].includes(task.status)) continue;
        const baseline = baselines.get(approvalPageKey(item));
        if (!item.postPublicationId && baseline && (item.operation !== "update" || item.baseContentVersion !== baseline.contentVersion)) continue;
        const preview = item.postPublicationId ? item.pageUrl : item.previewContentVersion === item.contentVersion ? reviewPreviewUrl(item.previewUrl, item.pageUrl) : null;
        // A ticket-level screenshot only identifies a page when the ticket has one item.
        const screenshot = reviewScreenshot(item.evidence) ?? (approval.items.length === 1 ? reviewScreenshot(approval.evidence) : null);
        const summary = escaped(item.changeSummary ?? "").trim();
        const missing = [...approvalReviewReadiness(item).missing, ...(summary ? [] : ["改动简介"])];
        if (missing.length) {
          tasksMissingMaterials.add(task.id);
          missingPages.push({ approval, item, preview, screenshot, summary, missing });
        } else {
          pages.push({ approval, item, preview, screenshot, summary, missing });
          pendingTasks.add(task.id);
        }
      } else if (status === "changes_requested") {
        revisions.set(task.id, approval.id);
      } else if (!translation && ["approved", "rejected", "withdrawn", "superseded"].includes(status)) {
        decidedTasks.add(task.id);
      }
    }
  }

  // Unsubmitted drafts are work in progress, separate from the submitted review queue.
  // Count each associated task once even when a shared code change covers hundreds of URLs.
  for (const approval of allApprovals.filter(row => row.status === "draft")) {
    for (const item of approval.items) {
      const task = tasks.get(item.taskId);
      if (!task || task.siteDomain !== approval.siteDomain || (!item.postPublicationId && approval.siteDomain !== "flatkey.ai" && approval.channel !== "github") || !pageApprovalKinds.has(task.kind) || !approvalItemNeedsHuman(item, workflow.tasks)) continue;
      const translation = task.kind === "blog" && item.language !== task.language;
      if (!translation && item.contentVersion !== task.contentVersion) continue;
      draftTasks.add(task.id); draftTickets.add(approval.id); draftPages++;
      if (!approvalReviewReadiness(item).ready || !item.changeSummary?.trim()) {
        draftMaterials.add(task.id); tasksMissingMaterials.add(task.id);
      }
    }
  }

  const standalone = [];
  const materials = [];
  for (const task of tasks.values()) {
    if (task.status !== "review_pending" || task.kind === "research" || task.siteDomain !== "flatkey.ai" || automaticTaskPolicy(task)) continue;
    const taskUrl = SEO_PLATFORM + workTaskHref(task);
    if (pageApprovalKinds.has(task.kind)) {
      const revision = revisions.get(task.id);
      if (revision) materials.push({ id: task.id, title: task.title, url: approvalUrl(revision), reason: "需按审批意见修改或补充材料" });
      else if (!pendingTasks.has(task.id) && !decidedTasks.has(task.id) && !draftTasks.has(task.id) && !tasksMissingMaterials.has(task.id)) materials.push({
        id: task.id, title: task.title, url: taskUrl, reason: "当前版本尚未送审，等待测试材料和执行器回填",
      });
    } else if (task.evidence.length) {
      standalone.push({ id: task.id, title: task.title, url: taskUrl });
    } else {
      materials.push({ id: task.id, title: task.title, url: taskUrl, reason: "缺少审核依据" });
    }
  }

  pages.sort((a, b) => (a.approval.submittedRecordedAt ?? "").localeCompare(b.approval.submittedRecordedAt ?? "") || a.item.id.localeCompare(b.item.id));
  const tickets = new Set(pages.map(row => row.approval.id)).size;
  for (const task of materials) tasksMissingMaterials.add(task.id);
  const unfinished = new Set([...pendingTasks, ...standalone.map(task => task.id), ...tasksMissingMaterials, ...draftTasks]);
  return { pages, missingPages, tickets, unfinished, tasks: pendingTasks.size + standalone.length, standalone, materials, materialCount: tasksMissingMaterials.size,
    draftTickets: draftTickets.size, draftTasks: draftTasks.size, draftPages, draftMaterialCount: draftMaterials.size };
}

function optimizationMetrics(row: OptimizationReportRow, withDelta: boolean) {
  const dates = `${row.before?.date ?? "待数据"} → ${row.latest?.date ?? "待数据"}`;
  const pair = (key: "clicks" | "impressions" | "ctr") => {
    const before = row.before?.[key], after = row.latest?.[key];
    const value = (value: number | null | undefined) => key === "ctr" ? formatCtr(value) : value ?? "待数据";
    const delta = !withDelta || before == null || after == null ? "" : `（${formatDelta((after - before) * (key === "ctr" ? 100 : 1))}${key === "ctr" ? " 个百分点" : ""}）`;
    return `${value(before)} → ${value(after)}${delta}`;
  };
  return `${dates} · 点击 ${pair("clicks")} · 曝光 ${pair("impressions")} · CTR ${pair("ctr")}`;
}

function optimizationMonitorSummary(rows: OptimizationReportRow[]) {
  const waiting = rows.filter(row => row.status === "waiting").length;
  const observing = rows.filter(row => row.status === "observing").length;
  const review = rows.filter(row => row.status === "updated" && row.latest!.clicks < row.before!.clicks && row.latest!.impressions < row.before!.impressions).length;
  return `跟踪 ${rows.length} 页 · 两点齐全 ${rows.length - waiting} 页 · 待数据 ${waiting} 页 · 观察中 ${observing} 页 · 需复查 ${review} 页`;
}

const optimizationPlotUrl = (row: OptimizationReportRow) => SEO_PLATFORM + "/optimization-effects?" + new URLSearchParams({ publication: row.id, ...(row.country === "all" ? {} : { country: row.country }) });

export function buildSeoDigest(input: DigestInput) {
  const window = digestWindow(input.date, input.kind), now = input.now ?? new Date();
  const thisWeek = window.kind === "weekly" && input.date === "2026-11-13";
  const weeklyHighlights = thisWeek ? november13Highlights : undefined;
  const weeklyTraffic = window.kind === "weekly" ? weeklyTrafficRows(input, window) : undefined;
  const pagePerformance = digestTopPages(input.pageObservations ?? [], input.date, now,
    window.kind === "weekly" ? { start: window.trafficStart, end: window.trafficEnd } : undefined);
  const start = Date.parse(window.workStart), end = Math.min(now.getTime(), Date.parse(window.workEnd));
  const publications = [...new Map(input.publications.filter(row => confirmedInWindow(row, start, end) && safeLink(row.url)
    && Date.parse(row.publishedAt) <= Date.parse(row.verifiedAt)).map(row => [row.url, row])).values()];
  const originals = publications.filter(row => row.kind === "source"), translations = publications.filter(row => row.kind === "translation");
  const backfills = publications.filter(row => row.kind === "backfill_translation"), landingPages = publications.filter(row => row.kind === "landing"), clusterPages = publications.filter(row => row.kind === "cluster");
  const optimizations = [...new Map(input.optimizations.filter(row => row.baselineId && confirmedInWindow(row, start, end) && safeLink(row.url)).map(row => [row.url, row])).values()];
  const amount = (value: number, coverage: DigestInput["publicationCoverage"], unit = "", recorded = false) => {
    const count = `${value}${unit ? " " + unit : ""}`;
    return coverage === "verified" ? count : value > 0 || recorded ? `已核实 ${count}` : "暂无上线回执";
  };
  const review = input.reviewWorkflow ? digestReviewQueue(input.reviewWorkflow, now) : null;
  const approvalWeek = workflowWeek(new Date(input.date + "T12:00:00+08:00"));
  const unfinishedApprovals = [...new Map((input.reviewWorkflow?.tasks ?? []).filter(task => review?.unfinished.has(task.id))
    .map(task => [task.id, task])).values()];
  const approvalDue = unfinishedApprovals.filter(task => task.weekStart === approvalWeek).length;
  const approvalOverdue = unfinishedApprovals.filter(task => task.weekStart < approvalWeek).length;
  const friday = new Date(input.date + "T00:00:00Z").getUTCDay() === 5;
  const approvalReminder = [
    ...(approvalOverdue ? [`审批逾期 ${approvalOverdue} 项`] : []),
    ...(friday && approvalDue ? [`本周仍有 ${approvalDue} 项待处理，含未齐测试材料`] : []),
  ];
  const title = window.kind === "weekly"
    ? `Flatkey SEO 周报｜${window.trafficStart}—${window.trafficEnd}`
    : `Flatkey SEO 日报｜${window.trafficEnd}`;
  const lines = [title, "", `工作统计：${window.workStart.slice(0, 16).replace("T", " ")} — ${window.workEnd.slice(0, 16).replace("T", " ")}（北京时间，结束时刻不含）；确认截止 ${now.toISOString()}。`, "",
    `${review ? `待审核 ${review.tasks} 项（${review.tickets} 张审批单，${review.pages.length} 个页面版本） · 待补材料 ${review.materialCount} 项` : "待审核 待更新 · 待补材料 待更新"} · ${link("SEO 平台审批", approvalsUrl)}`, "",
    ...(review?.draftTickets ? [`另有未提交草稿 ${review.draftTickets} 张，关联 ${review.draftTasks} 项任务 / ${review.draftPages} 个页面版本，其中 ${review.draftMaterialCount} 项任务待补材料；不计入已提交待审。`, ""] : []),
    `新增博客 ${amount(originals.length, input.publicationCoverage, "篇", input.deliveryStates?.blogs)}；新内容上线语言页 ${amount(originals.length + translations.length, input.publicationCoverage)}（其中译文 ${amount(translations.length, input.publicationCoverage)}）；旧文补译 ${amount(backfills.length, input.publicationCoverage)}${input.publicationCoverage !== "verified" ? "（仅已核实回执，台账覆盖不全）" : ""}。`,
    `落地页/工具页 ${amount(landingPages.length, input.publicationCoverage, "", input.deliveryStates?.landing)}，集群交付 ${amount(clusterPages.length, input.publicationCoverage, "", input.deliveryStates?.cluster)}（仅统计已上线验收）。`,
    `${window.kind === "weekly" ? "本周" : "今日"}优化 ${amount(optimizations.length, input.optimizationCoverage, "个页面", input.deliveryStates?.optimizations)}${input.optimizationCoverage !== "verified" ? "，台账覆盖待补" : ""}。`];
  lines.push("", "待审批页面（截至报告生成，含往期未处理）");
  if (!review) lines.push("• 审批台账读取失败或尚未接通，待更新。");
  else if (!review.pages.length) lines.push("• 当前没有待审批页面。");
  else {
    for (const { approval, item, preview, screenshot, summary, missing } of review.pages.slice(0, 3)) {
      lines.push(`• ${link(approval.title, approvalUrl(approval.id))} · ${approval.siteDomain} · ${escaped(item.language)} · ${item.operation === "new" ? "新增" : "修改"}`);
      const details = [link(item.pageUrl, item.pageUrl), `版本 ${escaped(item.contentVersion)}`];
      if (summary) details.push(summary.slice(0, 180));
      if (preview) details.push(link(item.postPublicationId ? "正式页面" : "测试链接", preview));
      if (screenshot) details.push(link("截图", screenshot));
      if (missing.length) details.push(`缺少${missing.join("、")}`);
      lines.push(`  ${details.join(" · ")}`);
    }
    if (review.pages.length > 3) lines.push(`其余 ${review.pages.length - 3} 个页面版本见${link("全部待审批", approvalsUrl)}。`);
  }
  if (approvalReminder.length) lines.push(`• ${approvalReminder.join(" · ")} · ${link("去审核", approvalsUrl)}`);
  if (review?.standalone.length) {
    lines.push(`• ${review.standalone.length} 项独立任务待审核：${review.standalone.slice(0, 3).map(task => link(task.title, task.url)).join("、")}。`);
  }
  if (review?.materials.length || review?.missingPages.length) {
    lines.push("", "待补材料");
    for (const { approval, item, missing } of review.missingPages.slice(0, 3)) lines.push(`• ${link(approval.title, approvalUrl(approval.id))} · ${escaped(item.language)} · 缺少${missing.join("、")}。`);
    for (const task of review.materials.slice(0, 3)) lines.push(`• ${link(task.title, task.url)} · ${task.reason}。`);
  }
  const verifiedDeliveries = [...originals, ...landingPages, ...clusterPages].slice(0, 10);
  if (window.kind === "daily" && verifiedDeliveries.length) lines.push("", "已核实新增页面", ...verifiedDeliveries.map(page => `• ${link(page.title, page.url)}`));
  if (originals.length > 10 && window.kind === "daily") lines.push(`其余 ${originals.length - 10} 篇见工作台交付记录。`);
  if (optimizations.length) {
    lines.push("", "已上线优化");
    for (const page of optimizations.slice(0, 5)) lines.push(`• ${link(page.url, page.url)} · ${escaped(page.changes)} · 目标词：${escaped(page.keyword)}；优化前基线已保存。`);
  }
  const archives = (input.historicalImports ?? []).filter(row => Date.parse(row.recordedAt) >= start && Date.parse(row.recordedAt) < end);
  if (window.kind === "daily" && archives.length) {
    lines.push("", "历史交付归档（不计入当期新增）");
    for (const archive of archives.slice(0, 3)) lines.push(`• ${escaped(archive.sourceRunId)}：${archive.originals} 篇源文、${archive.translations} 个译文页；${archive.liveVerified} 页有线上复核时间，${archive.artifactOnly} 页仅有留档核对。${archive.unknownFirstVerification} 页首次验收时刻未知；保留 ${archive.pendingEvidence} 项待补证据、${archive.pendingRevisions} 份待审旧稿。`);
  }
  if (input.optimizationMonitoring) {
    lines.push("", "优化效果监控（GSC 网页搜索、全设备，日期按太平洋时间）", optimizationMonitorSummary(input.optimizationMonitoring));
    if (!input.optimizationMonitoring.length) lines.push("• 暂无已核验的优化版本可跟踪。");
    for (const row of input.optimizationMonitoring) {
      const review = row.status === "updated" && row.latest!.clicks < row.before!.clicks && row.latest!.impressions < row.before!.impressions;
      lines.push(`• ${link(row.title, row.url)} · ${row.country} · ${escaped(row.change)} · 上线 ${row.launchDay}`,
        `  ${optimizationMetrics(row, true)} · ${review ? "需复查：点击和曝光均较基线下降，核查折线与排名" : effectStatusLabel[row.status] + " · " + row.reason} · ${link("查看折线", optimizationPlotUrl(row))}`);
    }
  } else {
    lines.push("", "往期优化变化");
    if (!input.effects.length) lines.push("• 暂无足够可比数据或明显变化，继续观察。");
    for (const row of input.effects.slice(0, 5)) lines.push(`• ${link(row.url, row.url)} · ${escaped(row.comparison)} · ${escaped(row.evidence)} · ${escaped(row.judgment)}`);
  }
  if (window.kind === "daily" && input.technicalQa !== undefined) {
    const qa = input.technicalQa;
    lines.push("", "SEO 技术质检", technicalQaSummary(qa));
    if (qa) {
      lines.push(`• 巡检时间 ${qa.scheduledFor} · 覆盖 ${{ full: "完整", partial: "部分", unknown: "未核实" }[qa.coverage]}`);
      if (qa.failure) lines.push("• 缺口 · " + escaped(qa.failure));
      for (const diagnostic of qa.diagnostics ?? []) lines.push("• 复核 · " + escaped(diagnostic));
      for (const issue of qa.issues) {
        const issueUrl = SEO_PLATFORM + executionViewRoutes.issues + "?week=" + issue.issueWeek + "#issue-" + encodeURIComponent(issue.id);
        const task = issue.taskId && issue.taskWeek
          ? link("查看工作任务", SEO_PLATFORM + workTaskHref({ id: issue.taskId, weekStart: issue.taskWeek }))
          : issue.taskId ? "已关联工作任务" : "尚未建工作任务";
        lines.push(`• ${issue.priority} ${link(issue.title, issueUrl)} · ${task} · ${escaped(issue.nextAction)}`);
      }
      for (const approval of qa.approvals) lines.push(`• ${link(approval.title, SEO_PLATFORM + "/approvals?approvalId=" + encodeURIComponent(approval.id))} · ${approval.status}`);
      if (Object.keys(qa.sourceDates).length) lines.push("• 来源日期 · " + Object.entries(qa.sourceDates).map(([key, value]) => `${escaped(key)} ${value ?? "待更新"}`).join(" · "));
      if (qa.nextAction) lines.push("• 下一步 · " + escaped(qa.nextAction));
    }
  }
  lines.push("", "五站自然搜索");
  for (const site of SEO_SITES) {
    lines.push(`• ${site}：自然会话 ${metricText(comparableMetric(input.observations, site, "sessions", input.date, "all", window.kind))}`);
    lines.push(`  Google 点击 ${metricText(comparableMetric(input.observations, site, "clicks", input.date, "all", window.kind))}；曝光 ${metricText(comparableMetric(input.observations, site, "impressions", input.date, "all", window.kind))}`);
  }
  for (const ranking of window.kind === "daily" ? pagePerformance : []) {
    const metric = ranking.source === "GSC" ? "Google 点击" : "自然搜索访问（会话）";
    lines.push("", `${metric} · 分模块 Top 3（${ranking.date ?? "日期待更新"}；覆盖 ${ranking.coveredSites.length}/5 站）`);
    lines.push(escaped(ranking.selectionReason) + "。");
    if (!ranking.date) lines.push("• 暂无完整的已结束日数据，未把缺失当作0。");
    else if (!ranking.pages.length) lines.push("• 该数据日已采集范围内没有大于0的页面记录。");
    for (const module of ranking.modules) {
      if (module.id === "unknown" && !module.pages.length) continue;
      lines.push(`• ${module.label}`);
      if (!module.pages.length) lines.push("  当前已采集范围暂无可展示页面；不代表全模块流量为0。");
      for (const page of module.pages) {
        const change = page.previous === null ? `不可比：${page.comparisonReason}` : page.previous === 0 ? `较 ${page.previousDate} 新增 ${page.value}，基期为0不算百分比` : `较 ${page.previousDate} ${page.previous}→${page.value}（${page.percentage! >= 0 ? "+" : ""}${page.percentage!.toFixed(1)}%）`;
        const url = new URL(page.url);
        lines.push(`  ${link(url.hostname + url.pathname + url.search, page.url)} · ${metric} ${page.value} · ${escaped(change)} · ${page.timezone}`);
      }
    }
    if (ranking.gaps.length) lines.push(`覆盖缺口：${ranking.gaps.map(escaped).join("；")}。`);
    lines.push("仅比较同来源、同站点、同日期口径；不同日期和未完成/截断数据未混排。");
  }
  const flatkeyRegistrations = flatkeyRegistrationCount(input.businessObservations ?? [], window.trafficStart, window.trafficEnd);
  const registrationOffset = window.kind === "weekly" ? -7 : -1;
  const organicRegistrations = organicRegistrationComparison(input.businessObservations ?? [], window.trafficStart, window.trafficEnd,
    shift(window.trafficStart, registrationOffset), shift(window.trafficEnd, registrationOffset));
  const accountRegistrations = input.accountRegistrations;
  if (accountRegistrations) {
    const { start, end, users, missing } = accountRegistrations;
    lines.push("", `Flatkey 注册人数 ${users === null ? "待更新" : users + " 人"}（账户系统 · ${start === end ? start : start + "—" + end} UTC · 全部分组）`);
    if (missing.length) lines.push(`账户报表待补 UTC 日 ${missing.join("、")}。`);
  } else {
    lines.push("", `Flatkey 注册人数 ${flatkeyRegistrations.users == null ? "待更新" : flatkeyRegistrations.users + " 人"}（GA4 全渠道区间去重）`);
  }
  if (window.kind === "weekly") lines.push("", ...weeklyBusinessDigestLines(input.businessObservations ?? [], window.trafficStart, window.trafficEnd));
  lines.push("", ...githubDigestLines(input.githubObservations ?? [], window.trafficStart, window.trafficEnd, window.kind === "weekly", now));
  lines.push("", "Flatkey 四国分项（四国合计不等于全站）");
  for (const country of ["US", "JP", "BR", "ES"] as const) {
    lines.push(`• ${country}：自然会话 ${metricText(comparableMetric(input.observations, "flatkey.ai", "sessions", input.date, country, window.kind))}；Google 点击 ${metricText(comparableMetric(input.observations, "flatkey.ai", "clicks", input.date, country, window.kind))}；曝光 ${metricText(comparableMetric(input.observations, "flatkey.ai", "impressions", input.date, country, window.kind))}`);
  }
  if (!thisWeek && input.rankingNotes?.length) lines.push("", window.kind === "weekly" ? "关键词实测（本期实际回执）" : "关键词实测（核对各条采集日期）", ...input.rankingNotes.map(note => "• " + escaped(note)));
  const nextPlanScheduled = isExecutableWorkflowPlan(input.nextPlanStatus ?? (input.workPlan?.tasks.length ? input.workPlan.status : undefined));
  lines.push("", window.kind === "weekly" ? `下周事项与关键词（${nextPlanScheduled ? "已排期" : "尚未排期"}）` : "明日优先关注");
  if (input.nextPlanUrl) lines.push(link("查看下周完整工作计划", input.nextPlanUrl));
  const dailyFocus: string[] = [];
  if (window.kind === "daily") {
    const qa = input.technicalQa;
    const technical = qa?.issues.filter(row => row.status !== "resolved" && ["P0", "P1"].includes(row.priority))
      .sort((a, b) => a.priority.localeCompare(b.priority))[0];
    if (technical) dailyFocus.push(`${technical.priority} ${link(technical.title, technical.url ?? SEO_PLATFORM + executionViewRoutes.tasks)}：${escaped(technical.nextAction)}`);
    if (approvalOverdue || approvalDue || review?.tasks) dailyFocus.push(`处理${approvalOverdue ? `逾期审批 ${approvalOverdue} 项` : `本周待完成审批 ${approvalDue || review?.tasks} 项`}；先补齐 Flatkey 测试材料，审核集群站已核验的正式页面。 ${link("去审核", approvalsUrl)}`);
    const mainClicks = comparableMetric(input.observations, "flatkey.ai", "clicks", input.date);
    const mainImpressions = comparableMetric(input.observations, "flatkey.ai", "impressions", input.date);
    const performance = (input.optimizationMonitoring ?? []).find(row => row.status === "updated" && row.latest!.clicks < row.before!.clicks && row.latest!.impressions < row.before!.impressions);
    if (performance) dailyFocus.push(`复查 ${link(performance.title, optimizationPlotUrl(performance))}：优化后点击和曝光均下降；按目标词检查排名与收录。`);
    else if (mainClicks.current !== null && mainClicks.previous !== null && mainClicks.previous >= 20 && mainClicks.current <= mainClicks.previous * 0.8 &&
        mainClicks.dates.join() === mainImpressions.dates.join() && mainImpressions.current !== null && mainImpressions.previous !== null) {
      dailyFocus.push(`排查 Flatkey Google 点击下降（${mainClicks.dates.join("、")}，${mainClicks.previous} → ${mainClicks.current}）：按页面和国家拆分，${mainImpressions.current >= mainImpressions.previous ? "优先看点击率和搜索摘要" : "优先看曝光、排名及索引变化"}。`);
    }
    if (qa === null) dailyFocus.push("补录本期技术质检回执：重跑未出结果的检查，并记录通过项和阻塞项。");
    if (qa?.status === "partial" || qa?.status === "blocked" || qa?.status === "failed") dailyFocus.push(`补齐技术质检：${escaped(qa.nextAction || qa.failure || "重跑未完成项，记录证据与复查结果。").slice(0, 220)}`);
    const waiting = input.recentPages?.find(row => !row.latest && !row.latestVisits);
    if (waiting) dailyFocus.push(`复查近期上线页 ${link(waiting.title, waiting.url)}：核对生产 URL 和索引，等首个完整数据日再评估变化。`);
    if (mainClicks.current === null) dailyFocus.push("复核 GSC 采集回执并补齐最新完整日数据，再判断点击变化。");
  }
  const plannedFocus = input.priorities.map(row => `${row.url ? link(row.title, row.url) : escaped(row.title)}${row.keyword ? " · " + escaped(row.keyword) : ""}${row.country ? " · " + escaped(row.country) : ""} · ${escaped(row.reason)} · ${escaped(row.action)}`);
  const nextFocus = (window.kind === "weekly" ? plannedFocus : [...dailyFocus, ...plannedFocus]).slice(0, window.kind === "weekly" ? 8 : 3);
  if (nextFocus.length) nextFocus.forEach((row, i) => lines.push(`${i + 1}. ${row}`));
  else lines.push(window.kind === "weekly" ? "• 下周任务尚未排期，等待关键词研究和页面任务入库。" : "• 复核最新完整日的点击与曝光；有明显异常时再建立优化任务。");
  if (input.issues.length || input.runNotes.length) lines.push("", "数据与执行情况", ...[...input.issues, ...input.runNotes].slice(0, 12).map(note => "• " + escaped(note)));
  lines.push("", `[数据基础](${SEO_DATA_HUB})`);
  const detailText = lines.join("\n");
  const text = input.notificationCompact ? detailedNotification(title, input, window, now, {
    pagePerformance, completed: {
      blogs: originals.filter(row => beijingDay(new Date(row.publishedAt)) === input.date).length,
      optimized: optimizations.filter(row => beijingDay(new Date(row.verifiedAt)) === input.date).length,
      newPages: [...landingPages, ...clusterPages].filter(row => beijingDay(new Date(row.publishedAt)) === input.date).length,
      fixed: input.resolvedIssues ?? null,
    }, optimizations, registrations: organicRegistrations, focus: nextFocus,
  }) : detailText;
  const hash = createHash("sha256").update(text).digest("hex");
  return { id: digestSnapshotId({ date: input.date, text, detailText, pagePerformance, recentPages: input.recentPages, deliveryStates: input.deliveryStates, organicRegistrations, workPlan: input.workPlan }), date: input.date, kind: window.kind, title, text, detailText, hash,
    deliveryProtocol: 2, generatedAt: now.toISOString(), readyAfter: window.readyAfter, preliminary: now.getTime() < Date.parse(window.readyAfter),
    workWindow: { start: window.workStart, end: window.workEnd }, counts: { originals: originals.length, translations: translations.length, backfillTranslations: backfills.length, landingPages: landingPages.length, clusterPages: clusterPages.length, optimizedPages: optimizations.length },
    pagePerformance,
    recentPages: input.recentPages,
    deliveryStates: input.deliveryStates,
    weeklyHighlights, weeklyTraffic, workPlan: input.workPlan,
    approvalQueue: review ? { tickets: review.tickets, pages: review.pages.length } : null,
    flatkeyRegistrations, accountRegistrations, organicRegistrations,
    coverage: { publications: input.publicationCoverage, optimizations: input.optimizationCoverage, approvals: review ? "verified" : "missing" } };
}
export type SeoDigest = ReturnType<typeof buildSeoDigest>;

/** Transport ambiguity is terminal for automatic retries. A human must reconcile the provider receipt. */
export function digestClaimable(row: { status: string; leaseUntil: Date | null; attemptedAt: Date | null }, now = new Date()) {
  return row.status === "PREPARED" || row.status === "REJECTED_CONFIRMED" && !row.attemptedAt || row.status === "CLAIMED" && !row.attemptedAt && (!row.leaseUntil || row.leaseUntil <= now);
}
