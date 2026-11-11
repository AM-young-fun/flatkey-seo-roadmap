import { loadBusinessAnalytics } from "./seo-business-analytics";
import { loadGithubChannels } from "./seo-github-channel";
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { beijingDay, buildSeoDigest, digestClaimable, digestWindow, digestOptimizationEffect, SEO_REPORT_GROUP, SEO_REPORT_ROBOT, type DigestKind, type DigestInput, type DigestObservation, type SeoDigest } from "@/lib/seo-digest";
import { analyticsObservationSchema, type AnalyticsObservation } from "@/lib/seo-analytics";
import { CLUSTER_SITES, clusterDomainForProperty } from "@/lib/seo-cluster-sites";
import { loadWorkflowSnapshot } from "./seo-workflow";
import { shiftWorkflowDay, workflowWeek } from "@/lib/seo-workflow";
import { workflowSnapshot } from "@/lib/seo-workflow-state";
import { organicPeriodSchema } from "@/lib/seo-organic-period";
import { digestRankingNotes } from "@/lib/seo-digest-rankings";
import { loadSerpTasks } from "./serp-results";

const json = (value: unknown) => value as Prisma.InputJsonValue;
export class DigestError extends Error { constructor(message: string, public status = 409) { super(message); } }

export async function generateSeoDigest(date: string, now = new Date(), kind: DigestKind = "daily"): Promise<SeoDigest> {
  const window = digestWindow(date, kind);
  const start = shiftWorkflowDay(window.trafficStart, -15);
  const reads = await Promise.allSettled([
    loadWorkflowSnapshot({ week: workflowWeek(new Date(date + "T12:00:00+08:00")), allHistory: true }, false),
    loadWorkflowSnapshot({ week: shiftWorkflowDay(workflowWeek(new Date(date + "T12:00:00+08:00")), 7) }, false),
    prisma.seoAnalyticsDay.findMany({ where: { date: { gte: start, lte: window.trafficEnd } }, select: { payload: true } }),
    prisma.collectorRun.findMany({ where: { startedAt: { gte: new Date(window.workStart), lt: new Date(Math.min(now.getTime(), Date.parse(window.workEnd))) } }, orderBy: { startedAt: "desc" }, take: 20 }),
    prisma.seoReportVersion.findMany({ where: { kind: "ORGANIC_PERIOD", periodStart: { gte: new Date(start), lte: new Date(window.trafficEnd) } }, orderBy: { createdAt: "desc" }, take: 100, select: { payload: true } }),
    loadSerpTasks("all", "en", "desktop", window.workStart.slice(0, 10), date),
    loadBusinessAnalytics(window.trafficStart, window.trafficEnd),
    loadGithubChannels(start, window.trafficEnd),
  ]);
  const issues: string[] = reads.flatMap((read, index) => read.status === "rejected" ? [`${["执行台账", "下周计划", "GA4/GSC归档", "采集回执", "区间去重人数", "排名回执", "GA4业务归档", "GitHub渠道归档"][index]}读取失败，相关项保留缺失。`] : []);
  const workflow = reads[0].status === "fulfilled" ? reads[0].value : workflowSnapshot([], { week: workflowWeek(new Date(date + "T12:00:00+08:00")), allHistory: true }, "database");
  const nextWeek = reads[1].status === "fulfilled" ? reads[1].value : workflowSnapshot([], { week: shiftWorkflowDay(workflowWeek(new Date(date + "T12:00:00+08:00")), 7) }, "database");
  const analytics = reads[2].status === "fulfilled" ? reads[2].value : [];
  const collectors = reads[3].status === "fulfilled" ? reads[3].value : [];
  const observations: DigestObservation[] = [];
  const pageObservations: AnalyticsObservation[] = [];
  const periods = reads[4].status === "fulfilled" ? reads[4].value.flatMap(({ payload }) => { const parsed = organicPeriodSchema.safeParse(payload); return parsed.success ? [parsed.data] : []; }) : [];
  for (const { payload } of analytics) {
    const parsed = analyticsObservationSchema.safeParse(payload);
    if (!parsed.success) { issues.push("存在未通过结构校验的历史数据，已排除。"); continue; }
    const row = parsed.data;
    if (row.kind === "gsc-pages" || row.kind === "ga4-pages") pageObservations.push(row);
    const site = clusterDomainForProperty(row.property) ?? "flatkey.ai";
    if (row.kind === "ga4-site") observations.push({ site, country: row.country, date: row.date, source: "GA4", timezone: CLUSTER_SITES.find(s => s.domain === site)?.ga4TimeZone ?? "America/Los_Angeles", observedAt: row.observedAt, complete: row.sessions !== null, scope: "session-organic-search", sessions: row.sessions, registrations: row.complete ? row.registrations : null });
    if (row.kind === "gsc-site") observations.push({ site, country: row.country, date: row.date, source: "GSC", timezone: "America/Los_Angeles", observedAt: row.observedAt, complete: row.complete, scope: "google-web", clicks: row.clicks, impressions: row.impressions });
  }
  const verified = workflow.publications.filter(row => row.status === "verified" && row.verifiedAt && row.verificationRecordedAt);
  const publications: DigestInput["publications"] = verified.filter(row => row.kind !== "optimization").map(row => ({ id: row.id, url: row.pageUrl, title: row.title, kind: row.kind === "source_blog" ? "source" : row.kind as "translation" | "backfill_translation" | "landing" | "cluster", verifiedAt: row.verifiedAt!, recordedAt: row.verificationRecordedAt!, publishedAt: row.publishedAt }));
  const optimizations: DigestInput["optimizations"] = workflow.optimizations.flatMap(row => row.changes.flatMap(change => {
    const publication = verified.find(p => p.id === change.publicationId);
    return publication ? [{ id: change.id, url: row.pageUrl, keyword: row.keyword, changes: change.description, verifiedAt: publication.verifiedAt!, recordedAt: publication.verificationRecordedAt!, baselineId: row.id + ":baseline" }] : [];
  }));
  const relevantPlan = window.kind === "weekly" ? nextWeek : workflow;
  const priorities = relevantPlan.tasks.filter(task => relevantPlan.plan?.status === "reviewed" && relevantPlan.plan.taskIds.includes(task.id) && !["verified", "observing"].includes(task.status))
    .sort((a, b) => a.dueAt.localeCompare(b.dueAt)).map(task => ({ title: task.title, keyword: task.keyword ?? undefined, country: task.country ?? undefined, url: task.pageUrl ?? undefined, reason: task.research?.intent ?? task.acceptanceCriteria.join("；"), action: task.nextAction || task.acceptanceCriteria.join("；") }));
  const startStamp = Date.parse(window.workStart);
  const runs = workflow.runs.filter(run => Date.parse(run.scheduledFor) >= startStamp && Date.parse(run.scheduledFor) < Date.parse(window.workEnd));
  const stageCoverage = (stages: string[]): "verified" | "partial" | "missing" => {
    const matches = runs.filter(run => stages.includes(run.stage));
    if (!matches.length) return "missing";
    const expectedDays = window.kind === "weekly" ? 7 : 1;
    const completeDays = new Set(matches.filter(run => run.status === "completed" && run.coverage === "full").map(run => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(new Date(run.scheduledFor))));
    return completeDays.size >= expectedDays ? "verified" : "partial";
  };
  const input: DigestInput = {
    date, kind, now, observations, pageObservations, publications, optimizations, periods,
    businessObservations: reads[6].status === "fulfilled" ? reads[6].value : [],
    githubObservations: reads[7].status === "fulfilled" ? reads[7].value : [],
    reviewWorkflow: reads[0].status === "fulfilled" ? workflow : undefined,
    historicalImports: workflow.historicalImports.map(archive => ({ id: archive.id, recordedAt: archive.recordedAt, sourceRunId: archive.sourceRunId,
      originals: archive.publications.filter(page => page.kind === "source_blog").length, translations: archive.publications.filter(page => page.kind === "translation").length,
      liveVerified: archive.publications.filter(page => page.verificationState === "live_verified").length, artifactOnly: archive.publications.filter(page => page.verificationState === "artifact_verified").length,
      unknownFirstVerification: archive.publications.filter(page => !page.firstVerifiedAt).length, pendingEvidence: archive.auditBacklog.pending, pendingRevisions: archive.pendingRevisions.count })),
    rankingNotes: reads[5].status === "fulfilled" ? digestRankingNotes(reads[5].value, window.workStart, window.workEnd) : [],
    effects: workflow.optimizations.flatMap(row => row.observations.filter(observation => Date.parse(observation.checkedAt) >= startStamp && Date.parse(observation.checkedAt) < Math.min(now.getTime(), Date.parse(window.workEnd))).map(observation => digestOptimizationEffect(row, observation))),
    priorities, issues: [...new Set([...issues, ...workflow.issues.filter(issue => issue.status !== "resolved" && Date.parse(issue.firstSeenAt) < Math.min(now.getTime(), Date.parse(window.workEnd))).map(issue => `${issue.siteDomain} · ${issue.title} · ${issue.nextAction}`)])],
    runNotes: [...runs.map(run => `${run.stage} · ${run.status} · ${run.completedItems}/${run.checkedItems} · ${run.failureReason ?? run.nextAction} · 来源日期 ${Object.entries(run.sourceDates).map(([source, day]) => `${source}:${day ?? "未知"}`).join("，")}`), ...collectors.map(run => `${run.kind} · ${run.status} · ${run.detail ?? "采集回执已归档"}`)],
    publicationCoverage: stageCoverage(["BLOG_PUBLISH", "DELIVERY_VERIFY"]), optimizationCoverage: stageCoverage(["OPTIMIZATION", "DELIVERY_VERIFY"]),
    nextPlanUrl: window.kind === "weekly" && nextWeek.plan ? `https://flatkey-seo-roadmap.vercel.app/work?week=${nextWeek.weekStart}` : undefined,
  };
  return buildSeoDigest(input);
}

export async function saveSeoDigest(digest: SeoDigest) {
  await prisma.seoReportVersion.createMany({ data: { id: digest.id, siteDomain: "flatkey.ai", kind: "SEO_DIGEST", periodStart: new Date(digest.date), periodEnd: new Date(digest.date), createdAt: new Date(digest.generatedAt), payload: json(digest) }, skipDuplicates: true });
  const stored = await prisma.seoReportVersion.findUniqueOrThrow({ where: { id: digest.id } });
  if ((stored.payload as unknown as SeoDigest).hash !== digest.hash) throw new DigestError("报告版本冲突");
  return digest;
}

export async function claimDigest(reportId: string, owner: string, now = new Date()) {
  if (process.env.SEO_UNIFIED_REPORTING_ENABLED !== "true") throw new DigestError("统一通知尚未切换", 503);
  return prisma.$transaction(async tx => {
    const saved = await tx.seoReportVersion.findUnique({ where: { id: reportId } });
    if (!saved || saved.kind !== "SEO_DIGEST") throw new DigestError("缺少报告快照", 404);
    const report = saved.payload as unknown as SeoDigest;
    if (report.date !== beijingDay(now)) throw new DigestError("自动通知仅发送当天报告；历史报告保留归档");
    if (report.deliveryProtocol !== 2) throw new DigestError("旧版通知快照已过期，请按日报或周报重新生成");
    const expected = digestWindow(report.date, report.kind);
    if (report.readyAfter !== expected.readyAfter || report.preliminary || Date.parse(report.readyAfter) > now.getTime()) throw new DigestError(`${report.kind === "weekly" ? "周五10:00" : "18:00"} 前的草稿不能发送，请刷新最终快照`);
    if (now.getTime() - Date.parse(report.generatedAt) > 15 * 60000 || Date.parse(report.generatedAt) > now.getTime()) throw new DigestError("请在发送前刷新报告");
    const id = `seo-digest-delivery:${report.kind}:${report.date}`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${id}))`;
    const [clock] = await tx.$queryRaw<{ now: Date }[]>`SELECT CURRENT_TIMESTAMP AS now`;
    const previous = await tx.seoDigestDelivery.findUnique({ where: { id } });
    if (previous && !digestClaimable(previous, clock.now)) throw new DigestError(previous.status === "DELIVERED" ? "当天该类报告已发送" : "发送已被领取或结果未核实，禁止重复发送");
    const data = { reportId, reportHash: report.hash, destination: SEO_REPORT_GROUP, robotCode: SEO_REPORT_ROBOT, status: "CLAIMED", claimedBy: owner, fencingToken: (previous?.fencingToken ?? 0) + 1, leaseUntil: new Date(clock.now.getTime() + 5 * 60000), errorCode: null };
    const receipt = previous ? await tx.seoDigestDelivery.update({ where: { id }, data }) : await tx.seoDigestDelivery.create({ data: { id, ...data } });
    return { id, fencingToken: receipt.fencingToken, destination: receipt.destination, robotCode: receipt.robotCode, report };
  });
}

export async function beginDigestAttempt(id: string, owner: string, fencingToken: number) {
  return prisma.$transaction(async tx => {
    const [clock] = await tx.$queryRaw<{ now: Date }[]>`SELECT CURRENT_TIMESTAMP AS now`;
    const result = await tx.seoDigestDelivery.updateMany({ where: { id, claimedBy: owner, fencingToken, status: "CLAIMED", attemptedAt: null, leaseUntil: { gt: clock.now } }, data: { status: "SENDING", attemptedAt: clock.now } });
    if (result.count !== 1) throw new DigestError("发送令牌已过期或已使用");
    return { attempted: true };
  });
}

export async function finishDigestAttempt(input: { id: string; owner: string; fencingToken: number; reportId: string; reportHash: string; destination: string; robotCode: string; status: "DELIVERED" | "UNKNOWN"; processQueryKey?: string; errorCode?: string }, now = new Date()) {
  if (input.status === "DELIVERED" && !input.processQueryKey?.trim()) throw new DigestError("送达必须有钉钉 processQueryKey 回执", 400);
  const result = await prisma.seoDigestDelivery.updateMany({ where: { id: input.id, reportId: input.reportId, reportHash: input.reportHash, destination: input.destination, robotCode: input.robotCode, claimedBy: input.owner, fencingToken: input.fencingToken, status: { in: input.status === "DELIVERED" ? ["SENDING", "UNKNOWN"] : ["SENDING"] } }, data: {
    status: input.status, deliveredAt: input.status === "DELIVERED" ? now : null, leaseUntil: null,
    receipt: json({ processQueryKey: input.processQueryKey ?? null, recordedAt: now.toISOString(), receiptId: randomUUID() }), errorCode: input.errorCode ?? null,
  } });
  if (result.count !== 1) {
    const existing = await prisma.seoDigestDelivery.findUnique({ where: { id: input.id } });
    const receipt = existing?.receipt as { processQueryKey?: string } | null;
    if (input.status === "DELIVERED" && existing?.status === "DELIVERED" && existing.reportId === input.reportId && existing.reportHash === input.reportHash && existing.destination === input.destination && existing.robotCode === input.robotCode && existing.claimedBy === input.owner && existing.fencingToken === input.fencingToken && receipt?.processQueryKey === input.processQueryKey) return { status: "DELIVERED", replay: true };
    throw new DigestError("发送状态已变化，需核对原回执");
  }
  return { status: input.status };
}
