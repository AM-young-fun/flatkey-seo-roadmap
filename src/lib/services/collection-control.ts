import { createHash } from "node:crypto";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { envBool } from "@/lib/env";
import { ImportRequestError } from "@/lib/ranking-import";
import { decryptDataForSeoCredentials, signDataForSeoPreview, verifyDataForSeoPreview } from "@/lib/dataforseo-credentials";
import { quoteSerpTargets, SERP_CONFIG_ID, SERP_MARKETS } from "@/lib/dataforseo-serp";
import { parseSerpSampleBalance, SERP_USER_DATA_URL } from "@/lib/serp-sample";
import { keywordCyclePlan } from "@/lib/keyword-cycle";
import { nextSerpPeriodKey, serpPeriod, serpPeriodFromKey } from "@/lib/serp-periods";
import { loadSerpMonitoringCohort } from "@/lib/services/serp-targets";
import { runKeywordDiscoveryCycle } from "@/lib/services/keyword-cycle";
import { runSerpMonitorCron, startSerpScheduledPeriod } from "@/lib/services/serp-monitor";
import type { CollectionControlMutation, CollectionSchedulePreview, CollectionCycleProgress } from "@/lib/collection-control";

const TTL = 6 * 60 * 60_000;
const fingerprint = (value: string) => createHash("sha256").update(value).digest("hex");
const claimsSchema = z.object({ purpose: z.literal("SEO_SCHEDULE_V1"), periodKey: z.string(), cohortHash: z.string().regex(/^[a-f0-9]{64}$/),
  connectionVersion: z.number().int().positive(), connectionHash: z.string().regex(/^[a-f0-9]{64}$/), revision: z.number().int().nonnegative(),
  maxRunCostMicros: z.number().int().positive().max(200_000_000), maxMonthCostMicros: z.number().int().positive().max(800_000_000),
  issuedAt: z.number().int().positive(), expiresAt: z.number().int().positive() }).strict();
function externalAccess() { if (envBool("DISABLE_EXTERNAL_FETCH")) throw new ImportRequestError("外部请求已由服务端紧急暂停", 409); }
function claims(token: string) {
  const parsed = claimsSchema.safeParse(verifyDataForSeoPreview(token));
  if (!parsed.success || parsed.data.expiresAt < Date.now() || parsed.data.issuedAt > Date.now() + 5000 || parsed.data.expiresAt - parsed.data.issuedAt > TTL) throw new ImportRequestError("费用预览已失效，请重新预览", 409);
  serpPeriodFromKey(parsed.data.periodKey);
  return parsed.data;
}
async function account() {
  externalAccess();
  const value = await prisma.dataForSeoConnection.findUnique({ where: { siteDomain: "flatkey.ai" } });
  if (!value) throw new ImportRequestError("请先保存DataForSEO连接", 409);
  return value;
}
async function balance(value: Awaited<ReturnType<typeof account>>) {
  externalAccess(); const credentials = decryptDataForSeoCredentials(value.encryptedCredentials);
  try {
    const response = await fetch(SERP_USER_DATA_URL, { method: "GET", redirect: "error", cache: "no-store", signal: AbortSignal.timeout(8000), headers: { Authorization: `Basic ${Buffer.from(`${credentials.apiLogin}:${credentials.apiPassword}`).toString("base64")}` } });
    if (!response.ok) throw new Error("BALANCE_UNAVAILABLE");
    return parseSerpSampleBalance(await response.json());
  } catch { throw new ImportRequestError("无法确认认证或余额，未提交付费抓取", 409); }
}

export async function previewCollectionSchedule(): Promise<CollectionSchedulePreview> {
  const [connection, config, cohort, spent] = await Promise.all([account(), prisma.serpMonitorConfig.findUnique({ where: { id: SERP_CONFIG_ID } }), loadSerpMonitoringCohort(),
    prisma.serpMonitorRun.aggregate({ where: { createdAt: { gte: new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1)) } }, _sum: { reservedCostMicros: true } })]);
  const quote = quoteSerpTargets(cohort.targets, SERP_MARKETS);
  if (!quote.queryCount) throw new ImportRequestError("当前没有已核实页面的正式关键词", 409);
  let period = config?.nextDueAt ? serpPeriod(config.nextDueAt) : new Date() < new Date("2026-10-20T02:30:00Z") ? serpPeriodFromKey("2026-10-20") : serpPeriod();
  const existing = await prisma.serpMonitorRun.findUnique({ where: { periodKey_scope: { periodKey: period.key, scope: "SCHEDULED" } } });
  if (existing && ["COMPLETED", "PARTIAL", "FAILED"].includes(existing.status)) period = serpPeriodFromKey(nextSerpPeriodKey(period.key));
  const discovery = keywordCyclePlan(new Date(), period.key), balanceMicros = await balance(connection);
  if (balanceMicros < quote.maxCostMicros + discovery.maxDiscoveryCostMicros + 20_000) throw new ImportRequestError("余额不足以覆盖本轮预算，未提交付费抓取", 409);
  const issuedAt = Date.now(), maxMonthCostMicros = quote.maxCostMicros * 3 + (spent._sum.reservedCostMicros ?? 0);
  const previewToken = signDataForSeoPreview({ purpose: "SEO_SCHEDULE_V1", periodKey: period.key, cohortHash: cohort.hash, connectionVersion: connection.connectionVersion,
    connectionHash: fingerprint(connection.encryptedCredentials), revision: config?.revision ?? 0, maxRunCostMicros: quote.maxCostMicros, maxMonthCostMicros, issuedAt, expiresAt: issuedAt + TTL });
  return { action: "previewSchedule", periodKey: period.key, periodLabel: period.label, dueAt: period.dueAt, keywordCount: quote.keywordQueryCount, queryCount: quote.queryCount, discoveryJobs: 12,
    serpMaxCostMicros: quote.maxCostMicros, discoveryMaxCostMicros: discovery.maxDiscoveryCostMicros, totalMaxCostMicros: quote.maxCostMicros + discovery.maxDiscoveryCostMicros,
    maxMonthSerpCostMicros: maxMonthCostMicros, balanceMicros, checkedAt: new Date(issuedAt).toISOString(), previewToken };
}

export async function mutateCollectionControl(input: CollectionControlMutation) {
  if (input.action === "previewSchedule") return previewCollectionSchedule();
  if (input.action === "pauseSchedule") {
    await prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"serp-monitor:budget"}))`;
      await tx.serpMonitorConfig.updateMany({ where: { id: SERP_CONFIG_ID }, data: { paidEnabled: false, authorizationVersion: 0, revision: { increment: 1 } } });
      await tx.dataForSeoConnection.updateMany({ where: { siteDomain: "flatkey.ai" }, data: { scheduleEnabled: false } });
    });
    return { action: input.action, enabled: false, message: "已停止新的付费提交；已付费任务的结果仍会接收。" };
  }
  const approved = claims(input.previewToken); externalAccess();
  const connection = await account();
  if (connection.connectionVersion !== approved.connectionVersion || fingerprint(connection.encryptedCredentials) !== approved.connectionHash) throw new ImportRequestError("API连接已变化，请重新预览", 409);
  if (input.action === "enableSchedule") {
    const cohort = await loadSerpMonitoringCohort();
    if (cohort.hash !== approved.cohortHash) throw new ImportRequestError("关键词范围已变化，请重新预览费用", 409);
    await prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"serp-monitor:budget"}))`;
      const config = await tx.serpMonitorConfig.findUnique({ where: { id: SERP_CONFIG_ID } });
      const current = await tx.dataForSeoConnection.findUnique({ where: { siteDomain: "flatkey.ai" } });
      if (!current || current.connectionVersion !== approved.connectionVersion || fingerprint(current.encryptedCredentials) !== approved.connectionHash) throw new ImportRequestError("API连接已变化", 409);
      if (config?.revision === approved.revision + 1 && config.authorizationVersion === 1 && config.paidEnabled && config.maxRunCostMicros === approved.maxRunCostMicros && current.scheduleEnabled) return;
      if ((config?.revision ?? 0) !== approved.revision) throw new ImportRequestError("计划已变化，请重新预览", 409);
      const data = { paidEnabled: true, authorizationVersion: 1, region: "US", languageCode: "en", locationCode: 2840, device: "desktop", depth: 100, intervalDays: 14,
        schedule: "BIWEEKLY_TUESDAY", maxRunCostMicros: approved.maxRunCostMicros, maxMonthCostMicros: approved.maxMonthCostMicros, nextDueAt: new Date(serpPeriodFromKey(approved.periodKey).dueAt) };
      await tx.serpMonitorConfig.upsert({ where: { id: SERP_CONFIG_ID }, create: { id: SERP_CONFIG_ID, ...data, revision: 1 }, update: { ...data, revision: { increment: 1 } } });
      await tx.dataForSeoConnection.update({ where: { siteDomain: "flatkey.ai" }, data: { scheduleEnabled: true } });
    });
    return { action: input.action, enabled: true, message: "已开启隔周周二10:30自动更新；开启开关本身不执行抓取。" };
  }
  return runCollectionCycle(approved);
}

async function runCollectionCycle(approved: z.infer<typeof claimsSchema>): Promise<CollectionCycleProgress> {
  const config = await prisma.serpMonitorConfig.findUnique({ where: { id: SERP_CONFIG_ID } });
  const connection = await account();
  if (!config?.paidEnabled || config.authorizationVersion !== 1 || config.revision !== approved.revision + 1 || !connection.scheduleEnabled || config.maxRunCostMicros !== approved.maxRunCostMicros) throw new ImportRequestError("自动更新已关闭或计划变化，请刷新后查看", 409);
  const period = serpPeriodFromKey(approved.periodKey), deadline = Date.now() + 230_000;
  let run = await prisma.serpMonitorRun.findUnique({ where: { periodKey_scope: { periodKey: period.key, scope: "SCHEDULED" } } });
  if (run && ["COMPLETED", "PARTIAL", "FAILED"].includes(run.status)) return { action: "runCycle", phase: "COMPLETE", finished: true, runId: run.id, message: "本期已结束，下次按原计划隔两周执行。" };
  if (!run) {
    if (config.nextDueAt?.toISOString() !== period.dueAt || Date.parse(period.dueAt) - Date.now() > 86400000) throw new ImportRequestError("只能在计划时间前24小时内提前执行本轮", 409);
    const discovery = await runKeywordDiscoveryCycle({ periodKey: period.key, deadline: Date.now() + 150_000 });
    if (["NEEDS_REVIEW", "UNAVAILABLE", "DISABLED", "NOT_DUE"].includes(discovery.status)) throw new ImportRequestError(`新词发现已停止（${discovery.status}），请查看原采集记录，勿重复提交`, 409);
    if (!discovery.ready) return { action: "runCycle", phase: "DISCOVERY", finished: false, message: "正在发现业务新词、去重并核对页面。" };
    const cohort = await loadSerpMonitoringCohort(), quote = quoteSerpTargets(cohort.targets, SERP_MARKETS);
    if (quote.maxCostMicros > approved.maxRunCostMicros) {
      // Freeze spending after discovery; a larger cohort needs a new explicit
      // fee preview, never silently expanding the previous authorization.
      await prisma.serpMonitorConfig.updateMany({ where: { id: SERP_CONFIG_ID }, data: { paidEnabled: false, authorizationVersion: 0, revision: { increment: 1 } } });
      throw new ImportRequestError(`新词筛选后需查询${quote.keywordQueryCount}词，SERP预算$${(quote.maxCostMicros/1e6).toFixed(3)}，超过已确认上限；自动更新已暂停，请重新确认费用`, 409);
    }
    const created = await startSerpScheduledPeriod(period.key, cohort.hash, deadline);
    run = await prisma.serpMonitorRun.findUniqueOrThrow({ where: { id: created.id } });
  }
  if (run.status === "UNKNOWN") throw new ImportRequestError("本期有响应不明的请求，已停止新的付费提交，请核对原账本", 409);
  const progress = await runSerpMonitorCron({ allowStart: false, maxDurationMs: Math.max(0, deadline - Date.now()) });
  if (progress.status === "NEEDS_REVIEW") throw new ImportRequestError("本期执行异常，请查看原采集记录", 409);
  return { action: "runCycle", phase: progress.status === "FINISHED" ? "COMPLETE" : "SERP", finished: progress.status === "FINISHED", runId: run.id,
    remainingQueries: "remainingQueries" in progress ? progress.remainingQueries : undefined, message: progress.status === "FINISHED" ? "本期已完成，下一期隔两周周二10:30自动执行。" : "正在查询四国实际排名，已提交的查询不会重复扣费。" };
}
