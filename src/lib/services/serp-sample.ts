import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { decryptDataForSeoCredentials, signDataForSeoPreview, verifyDataForSeoPreview } from "@/lib/dataforseo-credentials";
import { envBool } from "@/lib/env";
import { ImportRequestError } from "@/lib/ranking-import";
import { buildSerpTask, groupSerpMarketQueries, configForSerpRegion, quoteSerpTargets, SERP_MARKETS, SERP_CONFIG_ID, SERP_DEFAULT_CONFIG, serpTaskId } from "@/lib/dataforseo-serp";
import { serpPeriod } from "@/lib/serp-periods";
import { serpTargetKey } from "@/lib/serp-targets";
import { selectSerpSampleTargets } from "@/lib/serp-sample-selection";
import { loadSerpTargetCohort } from "@/lib/services/serp-targets";
import { resumeSerpMonitorRun, submitSerpSampleBatch } from "@/lib/services/serp-monitor";
import { affordableSerpSample, parseSerpSampleBalance, serpSampleSubsetHash, SERP_SAMPLE_AUTHORIZATION_HASH,
  SERP_SAMPLE_AUTHORIZATION_ID, SERP_SAMPLE_MAX_COST_MICROS, SERP_SAMPLE_MAX_QUERIES, SERP_SAMPLE_PREVIEW_TTL_MS,
  SERP_SAMPLE_SAFETY_MARGIN_MICROS, SERP_USER_DATA_URL, type SerpSampleMutation,
  type SerpSamplePreview, type SerpSampleStartResult } from "@/lib/serp-sample";

const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const fingerprint = (ciphertext: string) => createHash("sha256").update(ciphertext).digest("hex");
const claimsSchema = z.object({
  purpose: z.literal("SERP_SAMPLE_V1"), authorizationId: z.literal(SERP_SAMPLE_AUTHORIZATION_ID),
  authorizationHash: z.literal(SERP_SAMPLE_AUTHORIZATION_HASH), cohortHash: z.string().regex(/^[a-f0-9]{64}$/),
  subsetHash: z.string().regex(/^[a-f0-9]{64}$/), connectionHash: z.string().regex(/^[a-f0-9]{64}$/),
  connectionVersion: z.number().int().positive(), liveBalanceMicros: z.number().int().nonnegative(),
  maxBudgetMicros: z.number().int().min(6000).max(SERP_SAMPLE_MAX_COST_MICROS),
  issuedAt: z.number().int().positive(), expiresAt: z.number().int().positive(),
}).strict();

function requireExternalAccess() {
  if (envBool("DISABLE_EXTERNAL_FETCH")) throw new ImportRequestError("外部请求已暂停，本次未提交抓取", 409);
}
async function connection() {
  requireExternalAccess();
  const value = await prisma.dataForSeoConnection.findUnique({ where: { siteDomain: "flatkey.ai" } });
  if (!value) throw new ImportRequestError("请先保存DataForSEO连接", 409);
  return { ...value, ...decryptDataForSeoCredentials(value.encryptedCredentials), connectionHash: fingerprint(value.encryptedCredentials) };
}
async function requireScheduledPaused() {
  const config = await prisma.serpMonitorConfig.findUnique({ where: { id: SERP_CONFIG_ID } });
  if (process.env.DATAFORSEO_SERP_PAID_ENABLED === "true" || config?.paidEnabled) throw new ImportRequestError("小批验证要求全量定时付费抓取保持关闭，请先暂停全量计划", 409);
}
async function fetchBalance(value: Awaited<ReturnType<typeof connection>>) {
  requireExternalAccess();
  try {
    // DataForSEO documents this fixed GET as free. Only balance is retained;
    // account login, usage, prices, response body and headers never leave here.
    const response = await fetch(SERP_USER_DATA_URL, { method: "GET", redirect: "error", cache: "no-store",
      signal: AbortSignal.timeout(8000), headers: { Authorization: `Basic ${Buffer.from(`${value.apiLogin}:${value.apiPassword}`).toString("base64")}` } });
    if (!response.ok) throw new Error("BALANCE_HTTP_ERROR");
    return parseSerpSampleBalance(await response.json());
  } catch { throw new ImportRequestError("无法确认DataForSEO实时余额，未提交付费任务；请稍后重新预览", 409); }
}

export async function previewSerpSample(): Promise<SerpSamplePreview> {
  await requireScheduledPaused();
  const [value, cohort, existing] = await Promise.all([connection(), loadSerpTargetCohort(),
    prisma.serpMonitorRun.findUnique({ where: { sampleAuthorizationHash: SERP_SAMPLE_AUTHORIZATION_HASH } })]);
  const liveBalanceMicros = await fetchBalance(value), selection = affordableSerpSample(selectSerpSampleTargets(cohort.targets), liveBalanceMicros);
  const quote = quoteSerpTargets(selection.targets, SERP_MARKETS);
  if (!quote.queryCount) throw new ImportRequestError("账户可用余额不足以在预留安全余量后进行本次验证，未提交付费任务", 409);
  if (!["BRAND", "MODEL_PRICE"].every(category => selection.targets.some(target => selection.categories[serpTargetKey(target)] === category))) throw new ImportRequestError("当前余额或正式词库不足以同时验证品牌词和模型价格词，未提交付费任务", 409);
  const issuedAt = Date.now(), expiresAt = issuedAt + SERP_SAMPLE_PREVIEW_TTL_MS, subsetHash = serpSampleSubsetHash(selection);
  const authorizationToken = signDataForSeoPreview({ purpose: "SERP_SAMPLE_V1", authorizationId: SERP_SAMPLE_AUTHORIZATION_ID,
    authorizationHash: SERP_SAMPLE_AUTHORIZATION_HASH, cohortHash: cohort.hash, subsetHash,
    connectionVersion: value.connectionVersion, connectionHash: value.connectionHash, liveBalanceMicros,
    maxBudgetMicros: quote.maxCostMicros, issuedAt, expiresAt });
  return { action: "previewSample", scope: "SAMPLE", authorizationId: SERP_SAMPLE_AUTHORIZATION_ID, subsetHash,
    targets: selection.targets.map(target => ({ ...target, category: selection.categories[serpTargetKey(target)] })), quote,
    liveBalanceMicros, maxBudgetMicros: quote.maxCostMicros, safetyMarginMicros: SERP_SAMPLE_SAFETY_MARGIN_MICROS,
    balanceCheckedAt: new Date(issuedAt).toISOString(), expiresAt: new Date(expiresAt).toISOString(), authorizationToken,
    scheduledPaidEnabled: false, existingRun: existing ? await resumeSerpMonitorRun(existing.id, { pollLimit: 0 }) : null };
}

export async function startSerpSample(input: Extract<SerpSampleMutation, { action: "startSample" }>): Promise<SerpSampleStartResult> {
  requireExternalAccess();
  await requireScheduledPaused();
  const verified = claimsSchema.safeParse(verifyDataForSeoPreview(input.authorizationToken));
  if (!verified.success) throw new ImportRequestError("小批费用预览无效，请重新预览", 409);
  const claims = verified.data;
  if (claims.expiresAt < Date.now() || claims.issuedAt > Date.now() + 5000 || claims.expiresAt - claims.issuedAt > SERP_SAMPLE_PREVIEW_TTL_MS ||
    input.expectedSubsetHash !== claims.subsetHash || input.maxBudgetMicros !== claims.maxBudgetMicros) throw new ImportRequestError("小批费用预览已变化或过期，请重新预览", 409);

  const duplicate = await prisma.serpMonitorRun.findUnique({ where: { sampleAuthorizationHash: SERP_SAMPLE_AUTHORIZATION_HASH } });
  if (duplicate) {
    // Reusing this authorization under any new request identity can only read
    // and collect the original paid tasks, never submit PLANNED tasks again.
    return { action: "startSample", scope: "SAMPLE", duplicate: true,
      run: await resumeSerpMonitorRun(duplicate.id), scheduledPaidEnabled: false };
  }
  const [value, cohort] = await Promise.all([connection(), loadSerpTargetCohort()]);
  if (cohort.hash !== claims.cohortHash || value.connectionVersion !== claims.connectionVersion || value.connectionHash !== claims.connectionHash) throw new ImportRequestError("目标词或API连接已变化，请重新预览", 409);
  const selection = affordableSerpSample(selectSerpSampleTargets(cohort.targets), claims.liveBalanceMicros), groups = groupSerpMarketQueries(selection.targets), quote = quoteSerpTargets(selection.targets, SERP_MARKETS);
  if (serpSampleSubsetHash(selection) !== claims.subsetHash || !groups.length || groups.length > SERP_SAMPLE_MAX_QUERIES || quote.maxCostMicros !== claims.maxBudgetMicros || quote.maxCostMicros > SERP_SAMPLE_MAX_COST_MICROS) throw new ImportRequestError("小批目标或预算不一致，请重新预览", 409);
  const balanceBeforeMicros = await fetchBalance(value);
  if (quote.maxCostMicros + SERP_SAMPLE_SAFETY_MARGIN_MICROS > balanceBeforeMicros) throw new ImportRequestError("账户余额已减少，本次未提交付费任务；请重新预览", 409);
  const period = serpPeriod(new Date()), runId = input.idempotencyKey;
  const reserved = await prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"serp-monitor:budget"}))`;
    const used = await tx.serpMonitorRun.findUnique({ where: { sampleAuthorizationHash: SERP_SAMPLE_AUTHORIZATION_HASH } });
    if (used) return { id: used.id, duplicate: true };
    if (await tx.serpMonitorRun.findUnique({ where: { id: runId } })) throw new ImportRequestError("采集标识已用于其他记录，请刷新预览", 409);
    const config = await tx.serpMonitorConfig.findUnique({ where: { id: SERP_CONFIG_ID } });
    if (process.env.DATAFORSEO_SERP_PAID_ENABLED === "true" || config?.paidEnabled || envBool("DISABLE_EXTERNAL_FETCH")) throw new ImportRequestError("采集开关已变化，未提交小批任务", 409);
    if (await tx.serpMonitorRun.findFirst({ where: { status: { in: ["PLANNED", "RUNNING", "UNKNOWN"] } }, select: { id: true } })) throw new ImportRequestError("已有未完成或结果不明的采集记录，请先核对原账本", 409);
    const latestConnection = await tx.dataForSeoConnection.findUnique({ where: { siteDomain: "flatkey.ai" } });
    if (!latestConnection || latestConnection.connectionVersion !== value.connectionVersion || fingerprint(latestConnection.encryptedCredentials) !== value.connectionHash) throw new ImportRequestError("API连接已变化，请重新预览", 409);
    if (claims.expiresAt < Date.now()) throw new ImportRequestError("费用预览已过期，请重新预览", 409);
    const snapshot = { ...SERP_DEFAULT_CONFIG, connectionHash: value.connectionHash,
      selectedTargetIds: selection.targets.map(serpTargetKey), selectedSubsetHash: claims.subsetHash,
      sampleAuthorizationId: SERP_SAMPLE_AUTHORIZATION_ID, sampleAuthorizationHash: SERP_SAMPLE_AUTHORIZATION_HASH,
      sampleMaxBudgetMicros: quote.maxCostMicros, sampleBalanceBeforeMicros: balanceBeforeMicros,
      sampleSafetyMarginMicros: SERP_SAMPLE_SAFETY_MARGIN_MICROS, sampleAuthorizedAt: new Date(claims.issuedAt).toISOString(),
      sampleAuthorizationExpiresAt: new Date(claims.expiresAt).toISOString() };
    const tasks = groups.map(group => { const id = serpTaskId(runId, group.queryKey); return { id, runId, queryKey: group.queryKey, region: group.region,
      keyword: group.keyword, targetsJson: json(group.targets), state: "PLANNED", requestJson: json(buildSerpTask(group, id, configForSerpRegion(group.region))) }; });
    // Full frozen inventory remains the overview denominator. The task rows
    // and selectedTargetIds state precisely which subset was actually queried.
    await tx.serpMonitorRun.create({ data: { id: runId, scope: "SAMPLE", sampleAuthorizationHash: SERP_SAMPLE_AUTHORIZATION_HASH,
      periodKey: period.key, periodLabel: `${period.label} · 品牌与模型价格验证`,
      periodStart: new Date(`${period.start}T00:00:00+08:00`), periodEnd: new Date(`${period.end}T23:59:59.999+08:00`),
      status: "PLANNED", cohortHash: cohort.hash, cohortJson: json(cohort.targets), configJson: json(snapshot),
      queryCount: groups.length, targetCount: selection.targets.length, estimatedCostMicros: quote.maxCostMicros,
      reservedCostMicros: quote.maxCostMicros, connectionVersion: value.connectionVersion } });
    await tx.serpMonitorTask.createMany({ data: tasks });
    return { id: runId, duplicate: false };
  }, { maxWait: 10_000, timeout: 30_000 });
  if (!reserved.duplicate) {
    // At most 200 market queries means at most two paid POSTs. A receipt with
    // UNKNOWN outcome stops immediately; a new HTTP request never retries it.
    for (let batch = 0; batch < 2; batch++) {
      const current = await prisma.serpMonitorRun.findUnique({ where: { id: reserved.id } });
      if (!current || current.status === "UNKNOWN") break;
      const submitted = await submitSerpSampleBatch(reserved.id, SERP_SAMPLE_AUTHORIZATION_HASH);
      if (!submitted) break;
    }
  }
  return { action: "startSample", scope: "SAMPLE", duplicate: reserved.duplicate,
    run: await resumeSerpMonitorRun(reserved.id, { pollLimit: 0 }), scheduledPaidEnabled: false };
}

export async function mutateSerpSample(input: SerpSampleMutation) {
  return input.action === "previewSample" ? previewSerpSample() : startSerpSample(input);
}
