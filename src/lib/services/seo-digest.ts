import { loadRegistrationPeriods } from "./seo-registration-period";
import { DAILY_SEO_TRAFFIC_DEFAULTS, dailySeoPropertyDate } from "../daily-seo-traffic";
import { DAILY_SEO_PAGE_GROUP_RULE_VERSION } from "../daily-seo-page-groups";
import { loadDailySeoTrafficHistory } from "./daily-seo-traffic";
import { loadDailySeoPageGroupsHistory } from "./daily-seo-page-groups";
import { recentPublishedPages } from "../seo-digest-recent-pages";
import { actionCardPayload, messageHash } from "../seo-digest-message.cjs";
import { GA4_HOST_SCOPE, GA4_HOST_UNVERIFIED } from "../ga4-host-scope";
import { loadBusinessAnalytics } from "./seo-business-analytics";
import { accountRegistrationSummary } from "../seo-account-registrations";
import { loadAccountRegistrationSummary } from "./seo-account-registrations";
import { loadGithubChannels } from "./seo-github-channel";
import { getSeoReportingControl } from "./seo-reporting-control";
import { webhookReceiptSchema, type WebhookReceipt } from "../seo-webhook-receipt";
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { reportDay, buildSeoDigest, digestClaimable, digestWindow, digestOptimizationEffect, SEO_REPORT_GROUP, type DigestKind, type DigestInput, type DigestObservation, type DigestWorkPlan, type SeoDigest } from "@/lib/seo-digest";
import { dailyReportArchiveOnly } from "@/lib/seo-report-time.cjs";
import { gscDate, gscPeriodEnd, OPTIMIZATION_BASELINE_DAYS, OPTIMIZATION_HISTORY_DAYS, optimizationReportRows, verifiedPagePublications } from "../seo-page-effects";
import { technicalQaReport } from "../seo-technical-qa-report";
import { analyticsObservationSchema, analyticsStorageKind, scopedAnalytics, type AnalyticsObservation } from "@/lib/seo-analytics";
import { CLUSTER_SITES, clusterDomainForProperty } from "@/lib/seo-cluster-sites";
import { loadWorkflowSnapshot } from "./seo-workflow";
import { approvalReviewReadiness, automaticTaskPolicy, isExecutableWorkflowPlan, shiftWorkflowDay, workflowApprovalEffectiveItemStatus, workflowWeek } from "@/lib/seo-workflow";
import { workflowSnapshot } from "@/lib/seo-workflow-state";
import { digestDailyRankingNotes, digestRankingNotes } from "@/lib/seo-digest-rankings";
import { workPlanTaskFilters } from "../seo-workspace-routes";
import { loadSerpTasks } from "./serp-results";

const json = (value: unknown) => value as Prisma.InputJsonValue;
export class DigestError extends Error { constructor(message: string, public status = 409) { super(message); } }
async function requireReportingEnabled(transport: "application-bot" | "signed-webhook" = "application-bot") {
  const control = await getSeoReportingControl();
  if (!control.enabled || control.protocolVersion !== 2 || control.destination !== SEO_REPORT_GROUP || (control.transport ?? "application-bot") !== transport) throw new DigestError("统一通知渠道尚未切换", 503);
  return control;
}

const pageArchiveKinds = (["ga4-pages", "gsc-pages"] as const)
  .flatMap(kind => [kind, ...CLUSTER_SITES.map(site => analyticsStorageKind(kind, "all", site.domain))]);

export async function loadRecentDigestPages(date: string, kind: DigestKind, now = new Date()) {
  const { trafficStart, trafficEnd } = digestWindow(date, kind);
  const [workflow, archive] = await Promise.all([
    loadWorkflowSnapshot({ allHistory: true }),
    prisma.seoAnalyticsDay.findMany({ where: { date: { gte: shiftWorkflowDay(trafficStart, -15), lte: trafficEnd },
      kind: { in: pageArchiveKinds } }, select: { payload: true } }),
  ]);
  const pages = archive.flatMap(({ payload }) => {
    const parsed = analyticsObservationSchema.safeParse(payload);
    return parsed.success ? scopedAnalytics([parsed.data]) : [];
  });
  return recentPublishedPages(workflow, pages, date, now, kind === "weekly", digestWindow(date, kind));
}

function summarizeWorkPlan(snapshot: Awaited<ReturnType<typeof loadWorkflowSnapshot>>): DigestWorkPlan | undefined {
  const plan = snapshot.plan;
  if (!plan) return undefined;
  const selected = new Set(plan.taskIds);
  const tasks = snapshot.tasks.flatMap<DigestWorkPlan["tasks"][number]>(task => {
    if (!selected.has(task.id)) return [];
    const kind = task.siteDomain === "flatkey.ai" ? task.kind
      : task.kind === "landing" ? "cluster_landing" : "cluster_work";
    if (kind !== "blog" && kind !== "landing" && kind !== "optimization" && kind !== "cluster_work" && kind !== "cluster_landing" && kind !== "research") return [];
    const automatic = kind === "blog" && !task.pageUrl || Boolean(automaticTaskPolicy(task));
    const pending = task.status === "review_pending";
    const canReview = pending && !automatic && snapshot.approvals.some(approval => approval.items.some(item =>
      item.taskId === task.id && item.contentVersion === task.contentVersion && approvalReviewReadiness(item).ready
      && workflowApprovalEffectiveItemStatus(approval, item.id, snapshot.approvals) === "pending"));
    const status = !pending ? task.status : automatic ? "ready" : canReview ? "review_pending" : "missing_materials";
    return [{ id: task.id, kind, title: task.title, pageUrl: task.pageUrl, keyword: task.keyword, country: task.country,
      language: task.language, owner: task.owner, dueAt: task.dueAt, status, action: task.nextAction }];
  }).sort((a, b) => a.dueAt.localeCompare(b.dueAt) || a.id.localeCompare(b.id));
  const targets = "clusterLanding" in plan.targets ? {
    blogs: plan.targets.apiBlogs + plan.targets.gpuBlogs, landing: plan.targets.landing,
    optimizedPages: plan.targets.optimizedPages, clusterLanding: plan.targets.clusterLanding,
  } : undefined;
  return { weekStart: snapshot.weekStart, status: plan.status, targets, tasks };
}

export async function loadDigestWorkPlan(date: string, kind: DigestKind) {
  const week = workflowWeek(new Date(date + "T12:00:00+08:00"));
  return summarizeWorkPlan(await loadWorkflowSnapshot({ week: kind === "weekly" ? shiftWorkflowDay(week, 7) : week }));
}

export async function generateSeoDigest(date: string, now = new Date(), kind: DigestKind = "daily"): Promise<SeoDigest> {
  const window = digestWindow(date, kind);
  const start = shiftWorkflowDay(window.trafficStart, -15);
  const reportHistoryEnd = [window.trafficEnd, shiftWorkflowDay(dailySeoPropertyDate(now), -1)].sort()[0];
  const reportHistoryStart = shiftWorkflowDay(window.trafficStart, kind === "weekly" ? -7 : -1);
  const historyQuery = { ...DAILY_SEO_TRAFFIC_DEFAULTS, start: kind === "daily" ? shiftWorkflowDay(window.trafficStart, -30) : reportHistoryStart, end: reportHistoryEnd };
  const hasClosedHistory = reportHistoryEnd >= reportHistoryStart;
  const monitoringAsOf = window.workTimezone === "America/Los_Angeles" ? now
    : new Date(Math.min(now.getTime(), Date.parse(window.readyAfter)));
  const monitoringEnd = [gscPeriodEnd(monitoringAsOf), window.trafficEnd].sort()[0];
  const monitoringStart = shiftWorkflowDay(monitoringEnd, -(OPTIMIZATION_HISTORY_DAYS + OPTIMIZATION_BASELINE_DAYS + 2));
  const reads = await Promise.allSettled([
    loadWorkflowSnapshot({ week: workflowWeek(new Date(date + "T12:00:00+08:00")), allHistory: true }, false),
    loadWorkflowSnapshot({ week: shiftWorkflowDay(workflowWeek(new Date(date + "T12:00:00+08:00")), 7) }, false),
    prisma.seoAnalyticsDay.findMany({ where: { date: { gte: start, lte: window.trafficEnd }, OR: [
      { kind: { startsWith: "ga4-site" } }, { kind: { startsWith: "gsc-site" } },
      { kind: { in: pageArchiveKinds } },
    ] }, select: { payload: true } }),
    prisma.collectorRun.findMany({ where: { startedAt: { gte: new Date(window.workStart), lt: new Date(Math.min(now.getTime(), Date.parse(window.workEnd))) } }, orderBy: { startedAt: "desc" }, take: 20 }),
    kind === "weekly" && date === "2026-11-13" ? Promise.resolve([]) : loadSerpTasks("all", "en", "desktop", kind === "daily" ? shiftWorkflowDay(date, -42) : window.workStart.slice(0, 10), date),
    loadBusinessAnalytics(shiftWorkflowDay(window.trafficStart, kind === "weekly" ? -7 : -1), window.trafficEnd),
    loadGithubChannels(start, window.trafficEnd),
    loadAccountRegistrationSummary({ start: window.trafficStart, end: window.trafficEnd }),
    kind === "daily" && hasClosedHistory ? loadDailySeoTrafficHistory(historyQuery) : Promise.resolve(undefined),
    hasClosedHistory ? loadDailySeoPageGroupsHistory({ ...historyQuery, ruleVersion: DAILY_SEO_PAGE_GROUP_RULE_VERSION }) : Promise.resolve(undefined),
    loadRegistrationPeriods(reportHistoryStart, window.trafficEnd),
  ]);
  const issues: string[] = reads.flatMap((read, index) => read.status === "rejected" ? [`${["执行台账", "下周计划", "GA4/GSC归档", "采集回执", "排名回执", "GA4业务归档", "GitHub渠道归档", "Flatkey 账户注册归档", "GA4 首次获客日报", "GA4 页面组和同日注册漏斗", "GA4 首次获客注册区间"][index]}读取失败，相关项保留缺失。`] : []);
  const workflow = reads[0].status === "fulfilled" ? reads[0].value : workflowSnapshot([], { week: workflowWeek(new Date(date + "T12:00:00+08:00")), allHistory: true }, "database");
  const nextWeek = reads[1].status === "fulfilled" ? reads[1].value : workflowSnapshot([], { week: shiftWorkflowDay(workflowWeek(new Date(date + "T12:00:00+08:00")), 7) }, "database");
  const analytics = reads[2].status === "fulfilled" ? reads[2].value : [];
  const collectors = reads[3].status === "fulfilled" ? reads[3].value : [];
  const observations: DigestObservation[] = [];
  const pageObservations: AnalyticsObservation[] = [];
  for (const { payload } of analytics) {
    const parsed = analyticsObservationSchema.safeParse(payload);
    if (!parsed.success) { issues.push("存在未通过结构校验的历史数据，已排除。"); continue; }
    const original = parsed.data;
    if (original.kind === "ga4-site" && original.property === "541304395" && original.hostScope !== GA4_HOST_SCOPE) { issues.push(GA4_HOST_UNVERIFIED); continue; }
    const row = scopedAnalytics([original])[0];
    if (!row) continue;
    if (row.kind === "gsc-pages" || row.kind === "ga4-pages") pageObservations.push(...scopedAnalytics([row]));
    const site = clusterDomainForProperty(row.property) ?? "flatkey.ai";
    if (row.kind === "ga4-site") observations.push({ site, country: row.country, date: row.date, source: "GA4", timezone: CLUSTER_SITES.find(s => s.domain === site)?.ga4TimeZone ?? "America/Los_Angeles", observedAt: row.observedAt, complete: row.sessions !== null, scope: "session-organic-search", registrationMetric: row.registrationMetric, sessions: row.sessions, registrations: row.complete ? row.registrations : null });
    if (row.kind === "gsc-site") observations.push({ site, country: row.country, date: row.date, source: "GSC", timezone: "America/Los_Angeles", observedAt: row.observedAt, complete: row.complete, scope: "google-web", clicks: row.clicks, impressions: row.impressions, position: row.position });
  }
  const verified = workflow.publications.filter(row => row.status === "verified" && row.verifiedAt && row.verificationRecordedAt);
  const publications: DigestInput["publications"] = verified.filter(row => row.kind !== "optimization").map(row => ({ id: row.id, url: row.pageUrl, title: row.title, kind: row.kind === "source_blog" ? "source" : row.kind as "translation" | "backfill_translation" | "landing" | "cluster" | "prompt", verifiedAt: row.verifiedAt!, recordedAt: row.verificationRecordedAt!, publishedAt: row.publishedAt }));
  const optimizations: DigestInput["optimizations"] = workflow.optimizations.flatMap(row => row.changes.flatMap(change => {
    const publication = verified.find(p => p.id === change.publicationId);
    return publication ? [{ id: change.id, url: row.pageUrl, keyword: row.keyword, changes: change.description, verifiedAt: publication.verifiedAt!, recordedAt: publication.verificationRecordedAt!, baselineId: row.id + ":baseline" }] : [];
  }));
  const relevantPlan = window.kind === "weekly" ? nextWeek : workflow;
  const priorities = relevantPlan.tasks.filter(task => relevantPlan.plan?.taskIds.includes(task.id) && (window.kind !== "weekly" || isExecutableWorkflowPlan(relevantPlan.plan.status)) && !["verified", "observing"].includes(task.status))
    .sort((a, b) => a.dueAt.localeCompare(b.dueAt)).map(task => ({ title: task.title, keyword: task.keyword ?? undefined, country: task.country ?? undefined, url: task.pageUrl ?? undefined, reason: task.research?.intent ?? task.acceptanceCriteria.join("；"), action: task.nextAction || task.acceptanceCriteria.join("；") }));
  const startStamp = Date.parse(window.workStart);
  const runs = workflow.runs.filter(run => Date.parse(run.scheduledFor) >= startStamp && Date.parse(run.scheduledFor) < Date.parse(window.workEnd));
  const stageCoverage = (stages: string[]): "verified" | "partial" | "missing" => {
    const matches = runs.filter(run => stages.includes(run.stage));
    if (!matches.length) return "missing";
    const expectedDays = window.kind === "weekly" ? 7 : 1;
    const completeDays = new Set(matches.filter(run => run.status === "completed" && run.coverage === "full" &&
      run.completedAt && Date.parse(run.completedAt) <= now.getTime()).map(run => new Intl.DateTimeFormat("en-CA", { timeZone: window.workTimezone ?? "Asia/Shanghai" }).format(new Date(run.scheduledFor))));
    return completeDays.size >= expectedDays ? "verified" : "partial";
  };
  const blogCoverage = stageCoverage(["BLOG_PUBLISH", "BLOG"]);
  const landingCoverage = stageCoverage(["LANDING_BUILD", "LANDING"]);
  const clusterCoverage = stageCoverage(["CLUSTER_DELIVERY", "CLUSTER"]);
  const optimizationCoverage = stageCoverage(["OPTIMIZATION", "OLD_PAGE"]);
  const publicationCoverages = [blogCoverage, landingCoverage, clusterCoverage];
  const versionCutoff = new Date(Math.min(monitoringAsOf.getTime(), Date.parse(window.workEnd) - 1));
  const monitoringKinds = [...new Set(verifiedPagePublications(workflow.publications, versionCutoff)
    .filter(row => row.kind === "optimization" && gscDate(new Date(row.publishedAt)) >= shiftWorkflowDay(gscDate(monitoringAsOf), -OPTIMIZATION_HISTORY_DAYS))
    .map(row => analyticsStorageKind("gsc-pages", row.country ?? "all", CLUSTER_SITES.find(site => site.domain === row.siteDomain)?.domain)))];
  const monitoringArchive = monitoringKinds.length ? await prisma.seoAnalyticsDay.findMany({
    where: { date: { gte: monitoringStart, lte: monitoringEnd }, kind: { in: monitoringKinds } }, select: { payload: true },
  }).catch(() => { issues.push("优化监控 GSC 归档读取失败，相关页面保留待数据。"); return []; }) : [];
  const monitorObservations = monitoringArchive.flatMap(({ payload }) => {
    const parsed = analyticsObservationSchema.safeParse(payload);
    return parsed.success ? [parsed.data] : [];
  });
  const optimizationMonitoring = optimizationReportRows(workflow, monitorObservations, monitoringAsOf, monitoringEnd, versionCutoff);
  const input: DigestInput = {
    date, kind, now, observations, pageObservations, publications, optimizations, optimizationMonitoring,
    registrationPeriods: reads[10].status === "fulfilled" ? reads[10].value : [],
    dailyAcquisition: reads[8].status === "fulfilled" ? reads[8].value : undefined,
    pageGroups: reads[9].status === "fulfilled" ? reads[9].value : undefined,
    workPlan: summarizeWorkPlan(relevantPlan),
    currentWorkPlan: summarizeWorkPlan(workflow),
    recentPages: recentPublishedPages(workflow, pageObservations, date, now, kind === "weekly", window), technicalQa: technicalQaReport(workflow, window.workStart, window.workEnd, monitoringAsOf), notificationCompact: true,
    accountRegistrations: reads[7].status === "fulfilled" ? reads[7].value : accountRegistrationSummary({ start: window.trafficStart, end: window.trafficEnd }),
    businessObservations: reads[5].status === "fulfilled" ? reads[5].value : [],
    githubObservations: reads[6].status === "fulfilled" ? reads[6].value : [],
    reviewWorkflow: reads[0].status === "fulfilled" ? workflow : undefined,
    historicalImports: workflow.historicalImports.map(archive => ({ id: archive.id, recordedAt: archive.recordedAt, sourceRunId: archive.sourceRunId,
      originals: archive.publications.filter(page => page.kind === "source_blog").length, translations: archive.publications.filter(page => page.kind === "translation").length,
      liveVerified: archive.publications.filter(page => page.verificationState === "live_verified").length, artifactOnly: archive.publications.filter(page => page.verificationState === "artifact_verified").length,
      unknownFirstVerification: archive.publications.filter(page => !page.firstVerifiedAt).length, pendingEvidence: archive.auditBacklog.pending, pendingRevisions: archive.pendingRevisions.count })),
    rankingNotes: reads[4].status !== "fulfilled" ? [] : kind === "daily"
      ? digestDailyRankingNotes(reads[4].value, now)
      : digestRankingNotes(reads[4].value, window.workStart, window.workEnd, now),
    resolvedIssues: reads[0].status === "fulfilled" ? workflow.issues.filter(issue => issue.status === "resolved" && issue.resolvedAt
      && issue.resolutionEvidence.length && Date.parse(issue.resolvedAt) >= (kind === "daily" ? Date.parse(date + "T00:00:00+08:00") : startStamp)
      && Date.parse(issue.resolvedAt) < Math.min(now.getTime(), Date.parse(window.workEnd))).length : null,
    effects: workflow.optimizations.flatMap(row => row.observations.filter(observation => Date.parse(observation.checkedAt) >= startStamp && Date.parse(observation.checkedAt) < Math.min(now.getTime(), Date.parse(window.workEnd))).map(observation => digestOptimizationEffect(row, observation))),
    priorities, issues: [...new Set([...issues, ...workflow.issues.filter(issue => issue.status !== "resolved" && Date.parse(issue.firstSeenAt) < Math.min(now.getTime(), Date.parse(window.workEnd))).map(issue => `${issue.siteDomain} · ${issue.title} · ${issue.nextAction}`)])],
    runNotes: [...runs.map(run => `${run.stage} · ${run.status} · ${run.completedItems}/${run.checkedItems} · ${run.failureReason ?? run.nextAction} · 来源日期 ${Object.entries(run.sourceDates).map(([source, day]) => `${source}:${day ?? "未知"}`).join("，")}`), ...collectors.map(run => `${run.kind} · ${run.status} · ${run.detail ?? "采集回执已归档"}`)],
    publicationCoverage: publicationCoverages.every(coverage => coverage === "verified") ? "verified"
      : publicationCoverages.some(coverage => coverage !== "missing") ? "partial" : "missing",
    optimizationCoverage,
    deliveryStates: {
      blogs: blogCoverage === "verified",
      landing: landingCoverage === "verified",
      cluster: clusterCoverage === "verified",
      optimizations: optimizationCoverage === "verified",
    },
    nextPlanStatus: window.kind === "weekly" && nextWeek.plan && isExecutableWorkflowPlan(nextWeek.plan.status) && nextWeek.plan.taskIds.length ? nextWeek.plan.status : undefined,
    nextPlanUrl: window.kind === "weekly" && nextWeek.plan ? `https://flatkey-seo-roadmap.vercel.app/work?${workPlanTaskFilters(nextWeek.weekStart)}` : undefined,
  };
  return buildSeoDigest(input);
}

export async function saveSeoDigest(digest: SeoDigest) {
  await prisma.seoReportVersion.createMany({ data: { id: digest.id, siteDomain: "flatkey.ai", kind: "SEO_DIGEST", periodStart: new Date(digest.date), periodEnd: new Date(digest.date), createdAt: new Date(digest.generatedAt), payload: json(digest) }, skipDuplicates: true });
  const stored = await prisma.seoReportVersion.findUniqueOrThrow({ where: { id: digest.id } });
  if ((stored.payload as unknown as SeoDigest).hash !== digest.hash) throw new DigestError("报告版本冲突");
  return digest;
}

export async function claimDigest(reportId: string, owner: string, now = new Date(), transport: "application-bot" | "signed-webhook" = "application-bot", messageFormat?: "actionCard", revision = false) {
  if (revision && transport !== "signed-webhook") throw new DigestError("修订版须通过原群机器人发送", 400);
  const control = await requireReportingEnabled(transport);
  if (transport === "signed-webhook" && messageFormat !== "actionCard") throw new DigestError("Webhook 发送必须使用已绑定的详情卡片", 400);
  return prisma.$transaction(async tx => {
    const saved = await tx.seoReportVersion.findUnique({ where: { id: reportId } });
    if (!saved || saved.kind !== "SEO_DIGEST") throw new DigestError("缺少报告快照", 404);
    const report = saved.payload as unknown as SeoDigest;
    if (report.draftBody) throw new DigestError("周报待审核；须先批准确切全文并另存已审版本", 409);
    if (report.kind === "daily" && dailyReportArchiveOnly(report.date, now)) throw new DigestError("洛杉矶周四日报只归档，不发送群消息");
    if (report.date !== reportDay(now)) throw new DigestError("自动通知仅发送洛杉矶当天报告；历史报告保留归档");
    if (report.deliveryProtocol !== 2) throw new DigestError("旧版通知快照已过期，请按日报或周报重新生成");
    const expected = digestWindow(report.date, report.kind);
    if (report.workWindow.start !== expected.workStart || report.workWindow.end !== expected.workEnd) throw new DigestError("报告统计窗口已过期；原快照保留归档，请生成当前洛杉矶口径预览");
    if (report.readyAfter !== expected.readyAfter || report.preliminary || Date.parse(report.readyAfter) > now.getTime()) throw new DigestError(`${expected.workTimezone === "America/Los_Angeles" ? report.kind === "weekly" ? "洛杉矶周四00:30" : "洛杉矶02:00" : report.kind === "weekly" ? "北京时间周五10:00" : "北京时间18:00"} 前的草稿不能发送，请刷新最终快照`);
    const originalId = `seo-digest-delivery:${report.kind}:${report.date}`;
    const id = revision ? originalId + ":revision" : originalId;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${id}))`;
    const [clock] = await tx.$queryRaw<{ now: Date }[]>`SELECT CURRENT_TIMESTAMP AS now`;
    if (revision) {
      const original = await tx.seoDigestDelivery.findUnique({ where: { id: originalId } });
      if (original?.status !== "DELIVERED" || original.reportId === reportId) throw new DigestError("修订版须绑定已送达原稿和不同报告快照");
    }
    const previous = await tx.seoDigestDelivery.findUnique({ where: { id } });
    const recovered = previous?.status === "REJECTED_CONFIRMED" && previous.reportId === reportId;
    if (previous?.status === "REJECTED_CONFIRMED" && !recovered) throw new DigestError("已核验拒绝仅允许恢复原报告快照");
    if (!recovered && ((!revision && now.getTime() - Date.parse(report.generatedAt) > 15 * 60000) || Date.parse(report.generatedAt) > now.getTime())) throw new DigestError("请在发送前刷新报告");
    if (previous && !digestClaimable(previous, clock.now)) throw new DigestError(previous.status === "DELIVERED" ? "当天该类报告已发送" : "发送已被领取或结果未核实，禁止重复发送");
    const payloadSha256 = transport === "signed-webhook" ? messageHash(actionCardPayload(report, revision)) : undefined;
    const data = { reportId, reportHash: report.hash, destination: control.destination, robotCode: control.robotCode, status: "CLAIMED", claimedBy: owner, fencingToken: (previous?.fencingToken ?? 0) + 1, leaseUntil: new Date(clock.now.getTime() + 5 * 60000), errorCode: null,
      receipt: json({ transport, ...(payloadSha256 ? { messageFormat, payloadSha256 } : {}), controlVersion: control.version, ...(control.webhookConfigSha256 ? { webhookConfigSha256: control.webhookConfigSha256 } : {}) }) };
    const receipt = previous ? await tx.seoDigestDelivery.update({ where: { id }, data }) : await tx.seoDigestDelivery.create({ data: { id, ...data } });
    return { id, fencingToken: receipt.fencingToken, destination: receipt.destination, robotCode: receipt.robotCode, transport, messageFormat, payloadSha256, webhookConfigSha256: control.webhookConfigSha256, report };
  });
}

export async function beginDigestAttempt(id: string, owner: string, fencingToken: number, transport: "application-bot" | "signed-webhook" = "application-bot") {
  const control = await requireReportingEnabled(transport);
  return prisma.$transaction(async tx => {
    const prior = await tx.seoDigestDelivery.findUnique({ where: { id } });
    const binding = prior?.receipt as { transport?: string; controlVersion?: number; webhookConfigSha256?: string } | null;
    if (!prior || prior.destination !== control.destination || prior.robotCode !== control.robotCode || binding?.transport !== transport || binding.webhookConfigSha256 !== control.webhookConfigSha256) throw new DigestError("通知渠道或绑定已变化，禁止使用旧发送令牌");
    const [clock] = await tx.$queryRaw<{ now: Date }[]>`SELECT CURRENT_TIMESTAMP AS now`;
    const result = await tx.seoDigestDelivery.updateMany({ where: { id, claimedBy: owner, fencingToken, status: "CLAIMED", attemptedAt: null, leaseUntil: { gt: clock.now } }, data: { status: "SENDING", attemptedAt: clock.now } });
    if (result.count !== 1) throw new DigestError("发送令牌已过期或已使用");
    return { attempted: true };
  });
}

export async function finishDigestAttempt(input: { id: string; owner: string; fencingToken: number; reportId: string; reportHash: string; destination: string; robotCode: string; status: "DELIVERED" | "UNKNOWN"; processQueryKey?: string; webhookReceipt?: WebhookReceipt; errorCode?: string }, now = new Date()) {
  const current = await prisma.seoDigestDelivery.findUnique({ where: { id: input.id } });
  const currentReceipt = current?.receipt as { messageFormat?: string; payloadSha256?: string; transport?: string; webhookConfigSha256?: string; webhookReceipt?: WebhookReceipt } | null;
  const transport = currentReceipt?.transport ?? (currentReceipt?.webhookReceipt ? "signed-webhook" : "application-bot");
  if (input.status === "DELIVERED" && transport === "signed-webhook") {
    const receipt = webhookReceiptSchema.safeParse(input.webhookReceipt);
    if (currentReceipt?.messageFormat === "actionCard" && (!receipt.success || receipt.data.messageFormat !== "actionCard" || receipt.data.payloadSha256 !== currentReceipt.payloadSha256)) throw new DigestError("卡片回执与已领取正文及按钮不匹配", 400);
    if (!receipt.success || input.processQueryKey || receipt.data.webhookConfigSha256 !== (currentReceipt?.webhookConfigSha256 ?? currentReceipt?.webhookReceipt?.webhookConfigSha256) || !current?.attemptedAt || Date.parse(receipt.data.acceptedAt) < current.attemptedAt.getTime() || Date.parse(receipt.data.acceptedAt) > now.getTime() + 300000) throw new DigestError("Webhook 需要实际成功回执及同一配置绑定", 400);
  } else if (input.status === "DELIVERED" && (!input.processQueryKey?.trim() || input.webhookReceipt)) throw new DigestError("应用机器人送达必须有钉钉 processQueryKey 回执", 400);
  const result = await prisma.seoDigestDelivery.updateMany({ where: { id: input.id, reportId: input.reportId, reportHash: input.reportHash, destination: input.destination, robotCode: input.robotCode, claimedBy: input.owner, fencingToken: input.fencingToken, status: { in: input.status === "DELIVERED" ? ["SENDING", "UNKNOWN"] : ["SENDING"] } }, data: {
    status: input.status, deliveredAt: input.status === "DELIVERED" ? now : null, leaseUntil: null,
    receipt: json({ transport, ...(currentReceipt?.messageFormat ? { messageFormat: currentReceipt.messageFormat, payloadSha256: currentReceipt.payloadSha256 } : {}), webhookConfigSha256: currentReceipt?.webhookConfigSha256 ?? currentReceipt?.webhookReceipt?.webhookConfigSha256, ...(input.webhookReceipt ? { webhookReceipt: input.webhookReceipt } : {}), processQueryKey: input.processQueryKey ?? null, recordedAt: now.toISOString(), receiptId: randomUUID() }), errorCode: input.errorCode ?? null,
  } });
  if (result.count !== 1) {
    const existing = await prisma.seoDigestDelivery.findUnique({ where: { id: input.id } });
    const receipt = existing?.receipt as { processQueryKey?: string; webhookReceipt?: WebhookReceipt } | null;
    const sameReceipt = input.webhookReceipt ? Object.entries(input.webhookReceipt).every(([key, value]) => receipt?.webhookReceipt?.[key as keyof WebhookReceipt] === value) && Object.keys(receipt?.webhookReceipt ?? {}).length === Object.keys(input.webhookReceipt).length : receipt?.processQueryKey === input.processQueryKey;
    if (input.status === "DELIVERED" && existing?.status === "DELIVERED" && existing.reportId === input.reportId && existing.reportHash === input.reportHash && existing.destination === input.destination && existing.robotCode === input.robotCode && existing.claimedBy === input.owner && existing.fencingToken === input.fencingToken && sameReceipt) return { status: "DELIVERED", replay: true };
    throw new DigestError("发送状态已变化，需核对原回执");
  }
  return { status: input.status };
}
