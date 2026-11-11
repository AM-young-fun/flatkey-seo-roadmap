import { digestTopPages } from "./seo-digest-pages";
import type { AnalyticsObservation } from "./seo-analytics";
import { createHash } from "node:crypto";
import { z } from "zod";
import { compareOrganicPeriods, type OrganicPeriod } from "./seo-organic-period";
import { workflowApprovalEffectiveItemStatus, type WorkflowApproval, type WorkflowOptimization } from "./seo-workflow";

export const SEO_DATA_HUB = "https://alidocs.dingtalk.com/i/nodes/jb9Y4gmKWrQa6B4mHrdNPxke8GXn6lpz";
export const SEO_REPORT_GROUP = "cid7d5au0J8RAKDDxMR+VNh1w==";
export const SEO_REPORT_ROBOT = "dingoyxfe0koa0dme6fz";
export const SEO_SITES = ["flatkey.ai", "rackrate.org", "modelfit.cc", "mochichatbot.com", "jev-llm.com"] as const;
export const digestDateSchema = z.iso.date();
const shift = (day: string, n: number) => new Date(Date.parse(day + "T00:00:00Z") + n * 86400000).toISOString().slice(0, 10);
export const beijingDay = (date = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(date);
export type DigestMetric = "sessions" | "registrations" | "clicks" | "impressions";
export type DigestObservation = {
  site: string; date: string; source: "GA4" | "GSC"; timezone: string; observedAt: string;
  complete: boolean; scope: "session-organic-search" | "google-web";
  country?: "US" | "JP" | "BR" | "ES";
  sessions?: number | null; registrations?: number | null; clicks?: number | null; impressions?: number | null;
};
export type DigestPublication = { id: string; url: string; title: string; kind: "source" | "translation" | "backfill_translation" | "landing" | "cluster"; verifiedAt: string; recordedAt: string; publishedAt: string };
export type DigestOptimization = { id: string; url: string; keyword: string; changes: string; verifiedAt: string; recordedAt: string; baselineId: string };
export type DigestInput = {
  date: string; now?: Date; observations: DigestObservation[];
  pageObservations?: AnalyticsObservation[];
  publications: DigestPublication[]; optimizations: DigestOptimization[];
  effects: { url: string; comparison: string; evidence: string; judgment: string }[];
  priorities: { title: string; keyword?: string; country?: string; url?: string; reason: string; action: string }[];
  issues: string[]; runNotes: string[]; rankingNotes?: string[]; nextPlanUrl?: string;
  publicationCoverage: "verified" | "missing" | "partial";
  optimizationCoverage: "verified" | "missing" | "partial";
  periods?: OrganicPeriod[];
  reviewPending?: number;
  approvals?: WorkflowApproval[];
  historicalImports?: { id: string; recordedAt: string; sourceRunId: string; originals: number; translations: number; liveVerified: number; artifactOnly: number; unknownFirstVerification: number; pendingEvidence: number; pendingRevisions: number }[];
};

export function digestWindow(date: string) {
  digestDateSchema.parse(date);
  const weekly = new Date(date + "T00:00:00Z").getUTCDay() === 5;
  return {
    kind: weekly ? "weekly" as const : "daily" as const,
    workStart: shift(date, weekly ? -7 : -1) + "T18:00:00+08:00",
    workEnd: date + "T18:00:00+08:00",
    trafficStart: shift(date, weekly ? -7 : -1),
    trafficEnd: shift(date, -1),
  };
}

/** Compare only matching source, metric and weekday; missing or provisional values never become zero. */
export function comparableMetric(observations: DigestObservation[], site: string, metric: DigestMetric, date: string, country: "all" | "US" | "JP" | "BR" | "ES" = "all") {
  const window = digestWindow(date), source = metric === "clicks" || metric === "impressions" ? "GSC" : "GA4";
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
function safeLink(url: string) {
  try { const parsed = new URL(url); return parsed.protocol === "https:" && !parsed.username && !parsed.password ? parsed.href.replace(/\(/g, "%28").replace(/\)/g, "%29") : null; }
  catch { return null; }
}
function link(title: string, url: string) { const safe = safeLink(url); return safe ? `[${escaped(title)}](${safe})` : escaped(title); }
function dateCoverage(dates: string[]) {
  const ordered = [...dates].sort();
  return ordered.length > 1 && ordered.every((day, index) => !index || day === shift(ordered[index - 1], 1)) ? `${ordered[0]}—${ordered.at(-1)}（${ordered.length}日）` : ordered.join(",");
}
function metricText(value: ReturnType<typeof comparableMetric>) {
  if (value.current === null || value.previous === null) return value.reason;
  const difference = value.current - value.previous;
  const percentage = value.previous === 0 ? (value.current === 0 ? "持平" : "上期为0，不计算百分比") : `${difference >= 0 ? "+" : ""}${(difference / value.previous * 100).toFixed(1)}%`;
  return `${value.previous}→${value.current}（${percentage}；${dateCoverage(value.previousDates)} → ${dateCoverage(value.dates)}，${value.timezone}${value.reason ? "；" + value.reason : ""}）`;
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

export function buildSeoDigest(input: DigestInput) {
  const window = digestWindow(input.date), now = input.now ?? new Date();
  const pagePerformance = window.kind === "daily" ? digestTopPages(input.pageObservations ?? [], input.date, now) : [];
  const start = Date.parse(window.workStart), end = Math.min(now.getTime(), Date.parse(window.workEnd));
  const publications = [...new Map(input.publications.filter(row => confirmedInWindow(row, start, end) && safeLink(row.url)
    && Date.parse(row.publishedAt) <= Date.parse(row.verifiedAt)).map(row => [row.url, row])).values()];
  const originals = publications.filter(row => row.kind === "source"), translations = publications.filter(row => row.kind === "translation");
  const backfills = publications.filter(row => row.kind === "backfill_translation"), landingPages = publications.filter(row => row.kind === "landing"), clusterPages = publications.filter(row => row.kind === "cluster");
  const optimizations = [...new Map(input.optimizations.filter(row => row.baselineId && confirmedInWindow(row, start, end) && safeLink(row.url)).map(row => [row.url, row])).values()];
  // Pending approvals are a live queue across days/weeks, not this report's delivery window.
  const approvals = (input.approvals ?? []).filter(row => row.submittedRecordedAt && Date.parse(row.submittedRecordedAt) <= now.getTime());
  const pending = approvals.flatMap(approval => approval.items.filter(item => workflowApprovalEffectiveItemStatus(approval, item.id, approvals) === "pending").map(item => ({ approval, item })))
    .sort((a, b) => (a.approval.submittedRecordedAt ?? "").localeCompare(b.approval.submittedRecordedAt ?? "") || a.item.id.localeCompare(b.item.id));
  const pendingApprovalCount = new Set(pending.map(row => row.approval.id)).size;
  const title = `Flatkey SEO ${window.kind === "weekly" ? "周报" : "日报"}｜${input.date}`;
  const lines = [title, "", `工作统计：${window.workStart.slice(0, 10)} 18:00 — ${input.date} 18:00（北京时间）；确认截止 ${now.toISOString()}。`, "",
    `新增博客 ${input.publicationCoverage === "missing" ? "待核实" : originals.length + " 篇"}；新内容上线语言页 ${input.publicationCoverage === "missing" ? "待核实" : `${originals.length + translations.length}（其中译文 ${translations.length}）`}；旧文补译 ${input.publicationCoverage === "missing" ? "待核实" : backfills.length}${input.publicationCoverage !== "verified" ? "（仅已核实回执，台账覆盖不全）" : ""}。`,
    `落地页/工具页 ${input.publicationCoverage === "missing" ? "待核实" : landingPages.length}，集群交付 ${input.publicationCoverage === "missing" ? "待核实" : clusterPages.length}（仅统计已上线验收）；待审核任务 ${input.reviewPending ?? "待核实"}。`,
    `${window.kind === "weekly" ? "本周" : "今日"}优化 ${input.optimizationCoverage === "missing" ? "待核实" : optimizations.length + " 个页面"}${input.optimizationCoverage === "partial" ? "（台账覆盖不全）" : ""}。`];
  lines.push("", "待审批页面（截至报告生成，含往期未处理）");
  if (!input.approvals) lines.push("• 审批台账读取失败或尚未接通，待核实；未按 0 处理。");
  else if (!pending.length) lines.push("• 当前没有待审批页面。");
  else {
    lines.push(`• ${pendingApprovalCount} 张审批单，${pending.length} 个页面版本待审批。`);
    for (const { approval, item } of pending.slice(0, 8)) {
      const approvalUrl = `https://flatkey-seo-roadmap.vercel.app/approvals?approvalId=${encodeURIComponent(approval.id)}`;
      lines.push(`• ${link(approval.title, approvalUrl)} · ${approval.siteDomain} · ${escaped(item.language)} · ${item.operation === "new" ? "新增" : "修改"}`);
      lines.push(`  ${link(item.pageUrl, item.pageUrl)} · 版本 ${escaped(item.contentVersion)} · ${escaped(item.changeSummary).slice(0, 180)}`);
    }
    if (pending.length > 8) lines.push(`其余 ${pending.length - 8} 个页面版本见${link("全部待审批", "https://flatkey-seo-roadmap.vercel.app/approvals")}。`);
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
  lines.push("", "往期优化变化");
  if (!input.effects.length) lines.push("• 暂无足够可比数据或明显变化，继续观察。");
  for (const row of input.effects.slice(0, 5)) lines.push(`• ${link(row.url, row.url)} · ${escaped(row.comparison)} · ${escaped(row.evidence)} · ${escaped(row.judgment)}`);
  lines.push("", "五站自然搜索");
  for (const site of SEO_SITES) {
    lines.push(`• ${site}：自然会话 ${metricText(comparableMetric(input.observations, site, "sessions", input.date))}`);
    lines.push(`  Google 点击 ${metricText(comparableMetric(input.observations, site, "clicks", input.date))}；曝光 ${metricText(comparableMetric(input.observations, site, "impressions", input.date))}`);
    const period = site === "flatkey.ai" && window.kind === "weekly" ? compareOrganicPeriods(input.periods ?? [], input.date) : null;
    const registrationText = period ? `${period.previous.registrations}→${period.current.registrations}（各区间独立去重；${period.previous.start}—${period.previous.end} → ${period.current.start}—${period.current.end}，${period.current.timezone}${period.current.end < window.trafficEnd ? "；周数据未齐，只比相同星期与天数" : ""}）` : metricText(comparableMetric(input.observations, site, "registrations", input.date));
    lines.push(`  注册 ${site === "flatkey.ai" ? registrationText : "事件未核实，保留为空"}`);
  }
  for (const ranking of pagePerformance) {
    const metric = ranking.source === "GSC" ? "Google 点击" : "自然搜索访问（会话）";
    lines.push("", `${metric} Top 5 · 已采集完整页面（${ranking.date ?? "日期待更新"}；覆盖 ${ranking.coveredSites.length}/5 站）`);
    lines.push(escaped(ranking.selectionReason) + "。");
    if (!ranking.date) lines.push("• 暂无完整的已结束日数据，未把缺失当作0。");
    else if (!ranking.pages.length) lines.push("• 该数据日已采集范围内没有大于0的页面记录。");
    for (const page of ranking.pages) {
      const change = page.previous === null ? `不可比：${page.comparisonReason}` : page.previous === 0 ? `较 ${page.previousDate} 新增 ${page.value}，基期为0不算百分比` : `较 ${page.previousDate} ${page.previous}→${page.value}（${page.percentage! >= 0 ? "+" : ""}${page.percentage!.toFixed(1)}%）`;
      lines.push(`• ${link(page.url, page.url)} · ${page.site} · ${metric} ${page.value} · ${escaped(change)} · ${page.timezone}`);
    }
    if (ranking.gaps.length) lines.push(`覆盖缺口：${ranking.gaps.map(escaped).join("；")}。`);
    lines.push("仅比较同来源、同站点、同日期口径；不同日期和未完成/截断数据未混排。");
  }
  lines.push("", "Flatkey 四国分项（四国合计不等于全站）");
  for (const country of ["US", "JP", "BR", "ES"] as const) {
    lines.push(`• ${country}：自然会话 ${metricText(comparableMetric(input.observations, "flatkey.ai", "sessions", input.date, country))}；Google 点击 ${metricText(comparableMetric(input.observations, "flatkey.ai", "clicks", input.date, country))}；曝光 ${metricText(comparableMetric(input.observations, "flatkey.ai", "impressions", input.date, country))}`);
  }
  if (input.rankingNotes?.length) lines.push("", "关键词实测（本期实际回执）", ...input.rankingNotes.map(note => "• " + escaped(note)));
  if (window.kind === "weekly") {
    const fridayStart = Date.parse(input.date + "T00:00:00+08:00");
    const fridayPages = [...originals, ...landingPages, ...clusterPages].filter(row => confirmedInWindow(row, fridayStart, end));
    const fridayOptimizations = optimizations.filter(row => confirmedInWindow(row, fridayStart, end));
    lines.push("", "周五今日上线与优化");
    for (const page of fridayPages.slice(0, 5)) lines.push(`• ${link(page.title, page.url)}`);
    for (const page of fridayOptimizations.slice(0, 3)) lines.push(`• ${link(page.url, page.url)} · ${escaped(page.changes)}`);
    if (!fridayPages.length && !fridayOptimizations.length) lines.push("• 当前没有取得周五已验收交付回执。");
  }
  lines.push("", window.kind === "weekly" ? "下周已定事项与关键词" : "明日优先关注");
  if (input.nextPlanUrl) lines.push(link("查看下周完整工作计划", input.nextPlanUrl));
  if (!input.priorities.length) lines.push("• 尚未取得已核对任务，需补齐关键词、国家、行动和验收条件。");
  for (const [i, row] of input.priorities.slice(0, window.kind === "weekly" ? 8 : 3).entries()) lines.push(`${i + 1}. ${row.url ? link(row.title, row.url) : escaped(row.title)}${row.keyword ? " · " + escaped(row.keyword) : ""}${row.country ? " · " + escaped(row.country) : ""} · ${escaped(row.reason)} · ${escaped(row.action)}`);
  if (input.issues.length || input.runNotes.length) lines.push("", "数据与执行情况", ...[...input.issues, ...input.runNotes].slice(0, 12).map(note => "• " + escaped(note)));
  lines.push("", `[数据基础](${SEO_DATA_HUB})`);
  const text = lines.join("\n");
  const hash = createHash("sha256").update(text).digest("hex");
  return { id: `seo-digest:${input.date}:${hash.slice(0, 16)}`, date: input.date, kind: window.kind, title, text, hash,
    generatedAt: now.toISOString(), readyAfter: window.workEnd, preliminary: now.getTime() < Date.parse(window.workEnd),
    workWindow: { start: window.workStart, end: window.workEnd }, counts: { originals: originals.length, translations: translations.length, backfillTranslations: backfills.length, landingPages: landingPages.length, clusterPages: clusterPages.length, optimizedPages: optimizations.length },
    pagePerformance,
    approvalQueue: input.approvals ? { tickets: pendingApprovalCount, pages: pending.length } : null,
    coverage: { publications: input.publicationCoverage, optimizations: input.optimizationCoverage, approvals: input.approvals ? "verified" : "missing" } };
}
export type SeoDigest = ReturnType<typeof buildSeoDigest>;

/** Transport ambiguity is terminal for automatic retries. A human must reconcile the provider receipt. */
export function digestClaimable(row: { status: string; leaseUntil: Date | null; attemptedAt: Date | null }, now = new Date()) {
  return row.status === "PREPARED" || row.status === "CLAIMED" && !row.attemptedAt && (!row.leaseUntil || row.leaseUntil <= now);
}
