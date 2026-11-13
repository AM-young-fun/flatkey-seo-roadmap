import { businessDigestLines, flatkeyRegistrationCount, latestBusinessPeriod, type BusinessAnalytics } from "./seo-business-analytics";
import { githubComparable, githubDigestLines, PROMPT_REPOSITORIES, type GithubChannel } from "./seo-github-channel";
import { digestTopPages } from "./seo-digest-pages";
import { effectStatusLabel, formatCtr, formatDelta, type OptimizationReportRow } from "./seo-page-effects";
import { technicalQaSummary, type TechnicalQaReport } from "./seo-technical-qa-report";
import type { AnalyticsObservation } from "./seo-analytics";
import { createHash } from "node:crypto";
import { z } from "zod";
import { approvalReviewReadiness, automaticTaskPolicy, approvalItemNeedsHuman, reviewPreviewUrl, workflowApprovalEffectiveItemStatus, type WorkflowApproval, type WorkflowOptimization, type WorkflowSnapshot } from "./seo-workflow";
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
export const beijingDay = (date = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(date);
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
export type DigestInput = {
  notificationCompact?: boolean;
  date: string; kind?: DigestKind; now?: Date; observations: DigestObservation[];
  pageObservations?: AnalyticsObservation[];
  businessObservations?: BusinessAnalytics[];
  githubObservations?: GithubChannel[];
  publications: DigestPublication[]; optimizations: DigestOptimization[];
  effects: { url: string; comparison: string; evidence: string; judgment: string }[];
  optimizationMonitoring?: OptimizationReportRow[];
  technicalQa?: TechnicalQaReport;
  priorities: { title: string; keyword?: string; country?: string; url?: string; reason: string; action: string }[];
  issues: string[]; runNotes: string[]; rankingNotes?: string[]; nextPlanUrl?: string; nextPlanStatus?: "draft" | "reviewed" | "bootstrap";
  publicationCoverage: "verified" | "missing" | "partial";
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

/** Weekly comparisons require two complete Friday–Thursday periods. */
export function comparableMetric(observations: DigestObservation[], site: string, metric: DigestMetric, date: string, country: "all" | "US" | "JP" | "BR" | "ES" = "all", kind: DigestKind = "daily") {
  const window = digestWindow(date, kind), source = metric === "clicks" || metric === "impressions" ? "GSC" : "GA4";
  const rows = observations.filter(row => row.site === site && (row.country ?? "all") === country && row.source === source && row.complete
    && row.scope === (source === "GA4" ? "session-organic-search" : "google-web") && row[metric] != null);
  const latest = new Map<string, DigestObservation>();
  for (const row of rows) {
    const previous = latest.get(row.date);
    if (!previous || row.observedAt > previous.observedAt) latest.set(row.date, row);
  }
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
  if (window.kind === "weekly" && pairs.length !== 7) {
    return { current: null, previous: null, dates: [], previousDates: [], timezone: null,
      reason: `待更新／两周均需完整 7 天，目前有 ${pairs.length} 个同口径可比日` };
  }
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
  const row = (label: string, value: ReturnType<typeof pair>) => ({
    label, previous: count(value.previous?.value ?? null), current: count(value.current?.value ?? null),
    change: value.previous?.timezone === value.current?.timezone
      ? change(value.previous?.value ?? null, value.current?.value ?? null) : "—", dates,
  });
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
  return [row("自然搜索会话", pair("sessions")),
    { label: "自然搜索去重注册用户", previous: count(previousUsers), current: count(currentUsers), change: previousRegistration?.timezone === currentRegistration?.timezone ? change(previousUsers, currentUsers) : "—",
      dates },
    row("Google 自然搜索点击", clicks), row("Google 自然搜索曝光", impressions),
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
function shortMetric(value: ReturnType<typeof comparableMetric>) {
  if (value.current === null || value.previous === null) return "待更新";
  const difference = value.current - value.previous;
  return `${value.previous}→${value.current}${value.previous ? `（${difference >= 0 ? "+" : ""}${(difference / value.previous * 100).toFixed(1)}%）` : "（基期0）"}`;
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
  const decidedTasks = new Set<string>();
  const revisions = new Map<string, string>();
  const draftTasks = new Set<string>(), draftTickets = new Set<string>(), draftMaterials = new Set<string>();
  let draftPages = 0;

  for (const approval of approvals) {
    for (const item of approval.items) {
      const task = tasks.get(item.taskId);
      if (!task || task.siteDomain !== approval.siteDomain || !pageApprovalKinds.has(task.kind) || !approvalItemNeedsHuman(item, workflow.tasks)) continue;
      // Blog translations have independent content versions from their source task.
      const translation = task.kind === "blog" && item.language !== task.language;
      if (!translation && (item.contentVersion !== task.contentVersion
        || task.language && item.language !== task.language || task.pageUrl && item.pageUrl !== task.pageUrl)) continue;
      const status = workflowApprovalEffectiveItemStatus(approval, item.id, approvals);
      if (status === "pending") {
        if (["blocked", "failed"].includes(task.status) || task.kind !== "technical" && ["planned", "researching"].includes(task.status)) continue;
        const baseline = baselines.get(approvalPageKey(item));
        if (baseline && (item.operation !== "update" || item.baseContentVersion !== baseline.contentVersion)) continue;
        const preview = item.previewContentVersion === item.contentVersion ? reviewPreviewUrl(item.previewUrl, item.pageUrl) : null;
        // A ticket-level screenshot only identifies a page when the ticket has one item.
        const screenshot = reviewScreenshot(item.evidence) ?? (approval.items.length === 1 ? reviewScreenshot(approval.evidence) : null);
        const summary = escaped(item.changeSummary ?? "").trim();
        const missing = [...approvalReviewReadiness(item).missing, ...(summary ? [] : ["改动简介"])];
        pages.push({ approval, item, preview, screenshot, summary, missing });
        pendingTasks.add(task.id);
        if (missing.length) tasksMissingMaterials.add(task.id);
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
      if (!task || task.siteDomain !== approval.siteDomain || !pageApprovalKinds.has(task.kind) || !approvalItemNeedsHuman(item, workflow.tasks)) continue;
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
    if (task.status !== "review_pending" || automaticTaskPolicy(task)) continue;
    const taskUrl = SEO_PLATFORM + workTaskHref(task);
    if (pageApprovalKinds.has(task.kind)) {
      const revision = revisions.get(task.id);
      if (revision) materials.push({ id: task.id, title: task.title, url: approvalUrl(revision), reason: "需按审批意见修改或补充材料" });
      else if (!pendingTasks.has(task.id) && !decidedTasks.has(task.id) && !draftTasks.has(task.id)) materials.push({
        id: task.id, title: task.title, url: `${approvalsUrl}?newApproval=1&taskId=${encodeURIComponent(task.id)}`, reason: "缺少当前版本的有效审批单",
      });
    } else if (task.evidence.length) {
      standalone.push({ title: task.title, url: taskUrl });
    } else {
      materials.push({ id: task.id, title: task.title, url: taskUrl, reason: "缺少审核依据" });
    }
  }

  pages.sort((a, b) => (a.approval.submittedRecordedAt ?? "").localeCompare(b.approval.submittedRecordedAt ?? "") || a.item.id.localeCompare(b.item.id));
  const tickets = new Set(pages.map(row => row.approval.id)).size;
  for (const task of materials) tasksMissingMaterials.add(task.id);
  return { pages, tickets, tasks: pendingTasks.size + standalone.length, standalone, materials, materialCount: tasksMissingMaterials.size,
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
  const pagePerformance = window.kind === "daily" ? digestTopPages(input.pageObservations ?? [], input.date, now) : [];
  const start = Date.parse(window.workStart), end = Math.min(now.getTime(), Date.parse(window.workEnd));
  const publications = [...new Map(input.publications.filter(row => confirmedInWindow(row, start, end) && safeLink(row.url)
    && Date.parse(row.publishedAt) <= Date.parse(row.verifiedAt)).map(row => [row.url, row])).values()];
  const originals = publications.filter(row => row.kind === "source"), translations = publications.filter(row => row.kind === "translation");
  const backfills = publications.filter(row => row.kind === "backfill_translation"), landingPages = publications.filter(row => row.kind === "landing"), clusterPages = publications.filter(row => row.kind === "cluster");
  const optimizations = [...new Map(input.optimizations.filter(row => row.baselineId && confirmedInWindow(row, start, end) && safeLink(row.url)).map(row => [row.url, row])).values()];
  const amount = (value: number, coverage: DigestInput["publicationCoverage"], unit = "") => {
    const count = `${value}${unit ? " " + unit : ""}`;
    return coverage === "verified" ? count : value > 0 ? `至少 ${count}（已核实）` : "待核实";
  };
  const review = input.reviewWorkflow ? digestReviewQueue(input.reviewWorkflow, now) : null;
  const title = window.kind === "weekly"
    ? `Flatkey SEO 周报｜${window.trafficStart}—${window.trafficEnd}`
    : `Flatkey SEO 日报｜${input.date}`;
  const lines = [title, "", `工作统计：${window.workStart.slice(0, 16).replace("T", " ")} — ${window.workEnd.slice(0, 16).replace("T", " ")}（北京时间，结束时刻不含）；确认截止 ${now.toISOString()}。`, "",
    `${review ? `待审核 ${review.tasks} 项（${review.tickets} 张审批单，${review.pages.length} 个页面版本） · 待补材料 ${review.materialCount} 项` : "待审核 待更新 · 待补材料 待更新"} · ${link("SEO 平台审批", approvalsUrl)}`, "",
    ...(review?.draftTickets ? [`另有未提交草稿 ${review.draftTickets} 张，关联 ${review.draftTasks} 项任务 / ${review.draftPages} 个页面版本，其中 ${review.draftMaterialCount} 项任务待补材料；不计入已提交待审。`, ""] : []),
    `新增博客 ${amount(originals.length, input.publicationCoverage, "篇")}；新内容上线语言页 ${amount(originals.length + translations.length, input.publicationCoverage)}（其中译文 ${amount(translations.length, input.publicationCoverage)}）；旧文补译 ${amount(backfills.length, input.publicationCoverage)}${input.publicationCoverage !== "verified" ? "（仅已核实回执，台账覆盖不全）" : ""}。`,
    `落地页/工具页 ${amount(landingPages.length, input.publicationCoverage)}，集群交付 ${amount(clusterPages.length, input.publicationCoverage)}（仅统计已上线验收）。`,
    `${window.kind === "weekly" ? "本周" : "今日"}优化 ${amount(optimizations.length, input.optimizationCoverage, "个页面")}${input.optimizationCoverage !== "verified" ? "，台账覆盖待补" : ""}。`];
  const notification: string[] = [];
  lines.push("", "待审批页面（截至报告生成，含往期未处理）");
  if (!review) lines.push("• 审批台账读取失败或尚未接通，待更新。");
  else if (!review.pages.length) lines.push("• 当前没有待审批页面。");
  else {
    for (const { approval, item, preview, screenshot, summary, missing } of review.pages.slice(0, 3)) {
      lines.push(`• ${link(approval.title, approvalUrl(approval.id))} · ${approval.siteDomain} · ${escaped(item.language)} · ${item.operation === "new" ? "新增" : "修改"}`);
      const details = [link(item.pageUrl, item.pageUrl), `版本 ${escaped(item.contentVersion)}`];
      if (summary) details.push(summary.slice(0, 180));
      if (preview) details.push(link("测试链接", preview));
      if (screenshot) details.push(link("截图", screenshot));
      if (missing.length) details.push(`缺少${missing.join("、")}`);
      lines.push(`  ${details.join(" · ")}`);
    }
    if (review.pages.length > 3) lines.push(`其余 ${review.pages.length - 3} 个页面版本见${link("全部待审批", approvalsUrl)}。`);
  }
  if (review?.standalone.length) {
    lines.push(`• ${review.standalone.length} 项独立任务待审核：${review.standalone.slice(0, 3).map(task => link(task.title, task.url)).join("、")}。`);
  }
  if (review?.materials.length) {
    lines.push("", "待补材料");
    for (const task of review.materials.slice(0, 3)) lines.push(`• ${link(task.title, task.url)} · ${task.reason}。`);
  }
  if (window.kind === "daily") for (const page of [...originals, ...landingPages, ...clusterPages].slice(0, 10)) lines.push(`• ${link(page.title, page.url)}`);
  if (originals.length > 10 && window.kind === "daily") lines.push(`其余 ${originals.length - 10} 篇见工作台交付记录。`);
  if (optimizations.length) {
    lines.push("", "已上线优化");
    for (const page of optimizations.slice(0, 5)) lines.push(`• ${link(page.url, page.url)} · ${escaped(page.changes)} · 目标词：${escaped(page.keyword)}；优化前基线已保存。`);
  }
  const archives = (input.historicalImports ?? []).filter(row => Date.parse(row.recordedAt) >= start && Date.parse(row.recordedAt) < end);
  if (archives.length) {
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
      for (const issue of qa.issues) lines.push(`• ${issue.priority} ${link(issue.title, issue.url ?? SEO_PLATFORM + "/work")} · ${escaped(issue.nextAction)}`);
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
  for (const ranking of pagePerformance) {
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
  const [businessHeading, ...businessLines] = businessDigestLines(input.businessObservations ?? [], window.trafficStart, window.trafficEnd, false);
  lines.push("", businessHeading, `• Flatkey 注册人数 ${flatkeyRegistrations.users == null ? "待更新" : flatkeyRegistrations.users + " 人"}（全渠道区间去重）`, ...businessLines);
  lines.push("", ...githubDigestLines(input.githubObservations ?? [], window.trafficStart, window.trafficEnd, window.kind === "weekly", now));
  lines.push("", "Flatkey 四国分项（四国合计不等于全站）");
  for (const country of ["US", "JP", "BR", "ES"] as const) {
    lines.push(`• ${country}：自然会话 ${metricText(comparableMetric(input.observations, "flatkey.ai", "sessions", input.date, country, window.kind))}；Google 点击 ${metricText(comparableMetric(input.observations, "flatkey.ai", "clicks", input.date, country, window.kind))}；曝光 ${metricText(comparableMetric(input.observations, "flatkey.ai", "impressions", input.date, country, window.kind))}`);
  }
  if (!thisWeek && input.rankingNotes?.length) lines.push("", "关键词实测（本期实际回执）", ...input.rankingNotes.map(note => "• " + escaped(note)));
  lines.push("", window.kind === "weekly" ? `下周事项与关键词（${input.nextPlanStatus === "reviewed" ? "已确认" : "待确认"}）` : "明日优先关注");
  if (input.nextPlanUrl) lines.push(link("查看下周完整工作计划", input.nextPlanUrl));
  if (!input.priorities.length) lines.push("• 尚未取得已核对任务，需补齐关键词、国家、行动和验收条件。");
  for (const [i, row] of input.priorities.slice(0, window.kind === "weekly" ? 8 : 3).entries()) lines.push(`${i + 1}. ${row.url ? link(row.title, row.url) : escaped(row.title)}${row.keyword ? " · " + escaped(row.keyword) : ""}${row.country ? " · " + escaped(row.country) : ""} · ${escaped(row.reason)} · ${escaped(row.action)}`);
  if (input.issues.length || input.runNotes.length) lines.push("", "数据与执行情况", ...[...input.issues, ...input.runNotes].slice(0, 12).map(note => "• " + escaped(note)));
  lines.push("", `[数据基础](${SEO_DATA_HUB})`);
  const detailText = lines.join("\n");
  if (input.notificationCompact) {
    const weekly = window.kind === "weekly";
    notification.push(title, ...(weekly ? [`${window.trafficStart}—${window.trafficEnd}`] : []), "",
      `**${weekly ? "本周" : "今日"}上线**`,
      `${link("博客", SEO_PLATFORM + executionViewRoutes.deliveries)} ${amount(originals.length, input.publicationCoverage, "篇")} · 落地页 ${amount(landingPages.length, input.publicationCoverage, "页")} · 集群 ${amount(clusterPages.length, input.publicationCoverage, "页")} · 优化 ${amount(optimizations.length, input.optimizationCoverage, "页")}`,
      ...(translations.length || backfills.length ? [`译文 ${translations.length} 页 · 旧文补译 ${backfills.length} 页`] : []),
      "", "**关键变化**");
    // Two evidence-backed highlights plus the independently measured GitHub channel.
    // Raw counters from different metrics are not ranked against one another.
    const highlights: string[] = [];
    const dates = new Map<string, Set<string>>();
    const recordDates = (source: string, values: string[]) => {
      const own = dates.get(source) ?? new Set<string>(); values.forEach(day => own.add(day)); dates.set(source, own);
    };
    for (const source of ["GSC", "GA4"] as const) {
      for (const site of SEO_SITES) recordDates(source, comparableMetric(input.observations, site, source === "GSC" ? "clicks" : "sessions", input.date, "all", window.kind).dates);
    }
    const clicks = SEO_SITES.map(site => ({site, value: comparableMetric(input.observations, site, "clicks", input.date, "all", window.kind)}))
      .filter(row => row.value.current !== null && row.value.previous !== null)
      .sort((a,b) => Math.abs(b.value.current! - b.value.previous!) - Math.abs(a.value.current! - a.value.previous!));
    if (clicks[0]) {
      const best = clicks[0];
      highlights.push(`${link(best.site + " · Google 点击", SEO_PLATFORM + "/pages")} ${shortMetric(best.value)}`);
      recordDates("GSC", best.value.dates);
    }
    const business = latestBusinessPeriod(input.businessObservations ?? [], window.trafficStart, window.trafficEnd, "all", "session-organic-search");
    const rentals = business?.complete ? business.rows.find(row => row.event === "gpu_rental_success" && row.events > 0) : undefined;
    if (rentals && business) {
      highlights.push(`${link("GPU · 自然搜索租赁成功事件", SEO_PLATFORM + "/pages")} ${rentals.events} 次 / ${rentals.users} 人`);
      recordDates("GA4", [business.start, business.end]);
    } else {
      // Prefer Google clicks, then sessions. Select within one source by absolute
      // change when a comparable baseline exists, otherwise by current volume.
      const ranking = pagePerformance.find(row => row.source === "GSC" && row.pages.length) ?? pagePerformance.find(row => row.pages.length);
      const candidates = ranking?.modules.flatMap(module => module.pages.map(page => ({module: module.label, page}))) ?? [];
      candidates.sort((a,b) => Number(b.page.difference !== null) - Number(a.page.difference !== null)
        || Math.abs(b.page.difference ?? b.page.value) - Math.abs(a.page.difference ?? a.page.value));
      const winner = candidates[0];
      if (winner && ranking) {
        const name = new URL(winner.page.url).pathname;
        const change = winner.page.previous === null ? `${winner.page.value}（基线待补）` : `${winner.page.previous}→${winner.page.value}`;
        const comparisonDates = winner.page.previousDate && winner.page.previous !== null
          ? `${winner.page.previousDate}→${ranking.date}` : ranking.date ?? "日期待更新";
        highlights.push(`${link(winner.module + " · " + name.slice(0, 64), winner.page.url)} ${ranking.source === "GSC" ? "点击" : "自然会话"} ${change} · ${comparisonDates}`);
        if (ranking.date) recordDates(ranking.source, [ranking.date]);
      } else if (input.effects[0]) {
        const effect = input.effects[0];
        highlights.push(`${link("优化跟踪", effect.url)} ${escaped(effect.judgment).slice(0, 50)}；${escaped(effect.evidence).slice(0, 80)}`);
      } else if (input.rankingNotes?.[0]) {
        highlights.push(`${link("关键词", SEO_PLATFORM + "/keywords")} ${escaped(input.rankingNotes[0]).slice(0, 100)}`);
      }
    }
    if (!highlights.length) highlights.push(`${link("页面效果", SEO_PLATFORM + "/pages")} 可比数据待更新`);
    const repositories = PROMPT_REPOSITORIES.map(repository => {
      const own = (input.githubObservations ?? []).filter(row => row.repository === repository && Date.parse(row.observedAt) <= now.getTime()).sort((a,b) => b.observedAt.localeCompare(a.observedAt));
      return { own, latest: own[0], views: githubComparable(own, "views", window.trafficStart, window.trafficEnd, weekly), clones: githubComparable(own, "clones", window.trafficStart, window.trafficEnd, weekly) };
    });
    const total = (key: "stars" | "forks") => repositories.every(row => row.latest?.metadataStatus === "ok" && row.latest[key] !== null)
      ? repositories.reduce((sum,row) => sum + row.latest![key]!, 0) : "待更新";
    const traffic = (key: "views" | "clones") => {
      const pairs = repositories.map(row => row[key]);
      if (pairs.some(row => row.current === null) || pairs.some(row => JSON.stringify(row.dates) !== JSON.stringify(pairs[0].dates))) return "待更新";
      recordDates("GitHub", pairs[0].dates);
      return `${pairs.reduce((sum,row) => sum + row.previous!,0)}→${pairs.reduce((sum,row) => sum + row.current!,0)}`;
    };
    const referrals = repositories.map(({own}) => own.flatMap(row => row.referrals).filter(row => row.start === window.trafficStart && row.end === window.trafficEnd)
      .sort((a,b) => b.observedAt.localeCompare(a.observedAt))[0]);
    const arrivals = referrals.every(row => row?.status === "ok") ? `${referrals.reduce((sum,row) => sum + row!.sessions!,0)} 会话` : "待更新";
    highlights.push(`GitHub 两库（${PROMPT_REPOSITORIES.map(repo => link(repo.split("/")[1].replace("awesome-", ""), "https://github.com/" + repo)).join(" / ")}）：Stars ${total("stars")} / Forks ${total("forks")}；浏览 ${traffic("views")}，克隆 ${traffic("clones")}；到站 ${arrivals}`);
    notification.push(...highlights.slice(0, 3).map(value => "• " + value), "", "**待处理**",
      `${review ? `待审批 ${review.tasks} 项 · 材料未齐 ${review.materialCount} 项` : "待审批 / 材料未齐：待更新"} · ${link("去审核", approvalsUrl)}`,
      "", `**${weekly ? `下周计划 · ${input.nextPlanStatus === "reviewed" ? "已确认" : "待确认"}` : "明日重点"}**`);
    if (!input.priorities.length) notification.push(`• ${link(weekly ? input.nextPlanStatus === "reviewed" ? "查看下周关键词与页面任务" : "确认下周关键词与页面任务" : "查看工作任务", input.nextPlanUrl ?? SEO_PLATFORM + executionViewRoutes.tasks)}`);
    for (const row of input.priorities.slice(0, 2)) notification.push(`• ${link(escaped(row.title).slice(0, 48), row.url ?? input.nextPlanUrl ?? SEO_PLATFORM + executionViewRoutes.tasks)}${row.keyword ? " · " + escaped(row.keyword).slice(0, 45) : ""}${row.country ? "（" + row.country + "）" : ""}：${escaped(row.action).slice(0, 70)}`);
    if (weekly && input.priorities.length) notification.push(link(input.nextPlanStatus === "reviewed" ? "查看完整周计划" : "确认完整周计划", input.nextPlanUrl ?? SEO_PLATFORM + executionViewRoutes.tasks));
    const hasGaps = !review || input.publicationCoverage !== "verified" || input.optimizationCoverage !== "verified" || input.issues.length > 0 || input.runNotes.some(note => /partial|blocked|failed|失败|未测|429/i.test(note)) || pagePerformance.some(row => row.gaps.length) || referrals.some(row => row?.status !== "ok");
    const coverage = ["GSC", "GA4", "GitHub"].map(source => `${source} ${dates.get(source)?.size ? dateCoverage([...dates.get(source)!]) : "待更新"}`).join("；");
    notification.push("", `数据：${coverage}${hasGaps ? `；${link("缺数/异常见平台", SEO_PLATFORM + executionViewRoutes.issues)}` : ""}。`, "", `[数据基础](${SEO_DATA_HUB})`);
  }
  if (input.notificationCompact && input.optimizationMonitoring) {
    const rows = input.optimizationMonitoring;
    const focus = rows.filter(row => row.before && row.latest)
      .sort((a, b) => Math.abs(b.latest!.clicks - b.before!.clicks) - Math.abs(a.latest!.clicks - a.before!.clicks))[0] ?? rows[0];
    const priority = input.priorities[0];
    const heading = `**${title}**`;
    const mainClicks = comparableMetric(input.observations, "flatkey.ai", "clicks", input.date, "all", window.kind);
    notification.splice(0, notification.length, heading, "", "**交付与审批**",
      `新增 ${amount(originals.length + landingPages.length + clusterPages.length + translations.length + backfills.length, input.publicationCoverage, "页")} · 优化 ${amount(optimizations.length, input.optimizationCoverage, "页")} · 待审批 ${review ? review.tasks + " 项" : "待更新"}`,
      "", "**自然搜索**", "Flatkey Google 点击 " + shortMetric(mainClicks),
      "", "**优化效果**", optimizationMonitorSummary(rows),
      focus ? `重点效果 · ${link(focus.title, optimizationPlotUrl(focus))} · ${focus.country} · ${optimizationMetrics(focus, false)} · ${effectStatusLabel[focus.status]}`
        : "重点效果 · 暂无已核验的优化版本可跟踪。",
      ...(window.kind === "daily" && input.technicalQa !== undefined ? ["", "**SEO 技术质检**", technicalQaSummary(input.technicalQa)] : []),
      "", `**${window.kind === "weekly" ? "下周重点" : "下一步"}**`, `${priority ? escaped(priority.title) + " · " + escaped(priority.action) : focus?.status === "waiting" ? "补齐上线后 GSC 完整数据" : "继续观察页面趋势"}`,
      "", link("数据基础", SEO_DATA_HUB));
  }
  if (weeklyTraffic && input.notificationCompact) {
    const summary = weeklyTraffic.filter(row => row.previous !== "待更新" || row.current !== "待更新")
      .map(row => `${row.label} ${row.previous} → ${row.current}${row.change === "—" ? "" : `（${row.change}）`}`);
    notification.splice(1, 0, ...(weeklyHighlights ? ["", "**本周工作**", ...weeklyHighlights.map(item => `• ${item}`)] : []),
      "", "**Flatkey 流量对比**", weeklyTraffic[0].dates,
      ...(summary.length ? summary.map(item => `• ${item}`) : ["• 完整周数据待更新"]),
      link("查看周报", SEO_PLATFORM + "/reports?period=weekly&date=" + input.date));
  }
  const text = input.notificationCompact ? notification.join("  \n") : detailText;
  const hash = createHash("sha256").update(text).digest("hex");
  return { id: `seo-digest:${input.date}:${hash.slice(0, 16)}`, date: input.date, kind: window.kind, title, text, detailText, hash,
    deliveryProtocol: 2, generatedAt: now.toISOString(), readyAfter: window.readyAfter, preliminary: now.getTime() < Date.parse(window.readyAfter),
    workWindow: { start: window.workStart, end: window.workEnd }, counts: { originals: originals.length, translations: translations.length, backfillTranslations: backfills.length, landingPages: landingPages.length, clusterPages: clusterPages.length, optimizedPages: optimizations.length },
    pagePerformance,
    weeklyHighlights, weeklyTraffic,
    approvalQueue: review ? { tickets: review.tickets, pages: review.pages.length } : null,
    flatkeyRegistrations,
    coverage: { publications: input.publicationCoverage, optimizations: input.optimizationCoverage, approvals: review ? "verified" : "missing" } };
}
export type SeoDigest = ReturnType<typeof buildSeoDigest>;

/** Transport ambiguity is terminal for automatic retries. A human must reconcile the provider receipt. */
export function digestClaimable(row: { status: string; leaseUntil: Date | null; attemptedAt: Date | null }, now = new Date()) {
  return row.status === "PREPARED" || row.status === "REJECTED_CONFIRMED" && !row.attemptedAt || row.status === "CLAIMED" && !row.attemptedAt && (!row.leaseUntil || row.leaseUntil <= now);
}
