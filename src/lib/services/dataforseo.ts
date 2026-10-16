import { createHash } from "node:crypto";
import { Prisma, type DataForSeoRun } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ENDPOINT, buildRankedKeywordsTask, quoteForLimit, normalizeRankedKeywords, type DataForSeoNormalized } from "@/lib/dataforseo-labs.cjs";
import { decryptDataForSeoCredentials, encryptDataForSeoCredentials, maskDataForSeoLogin, signDataForSeoPreview, verifyDataForSeoPreview } from "@/lib/dataforseo-credentials";
import { DATAFORSEO_TRIAL_BUDGET_MICROS, type DataForSeoMutation, type DataForSeoMutationResult, type DataForSeoRunDto, type DataForSeoRunResult, type DataForSeoRunStatus, type DataForSeoStatus, type DataForSeoSummary } from "@/lib/dataforseo-management";
import { buildDataForSeoImportPlan } from "@/lib/dataforseo-import-plan";
import { ImportRequestError, rankingImportSchema } from "@/lib/ranking-import";
import { importSeo } from "@/lib/services/seo-import";

const SITE = "flatkey.ai", LIMIT = 1000, quote = quoteForLimit(LIMIT);
const UNRESOLVED_STATUSES = ["PENDING", "UNKNOWN", "RECEIVED", "IMPORT_FAILED"];
const connectionHash = (ciphertext: string) => createHash("sha256").update(ciphertext).digest("hex");
const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const runSelect = { requestId: true, status: true, createdAt: true, completedAt: true, errorCode: true, actualCostMicros: true, budgetCostMicros: true, summary: true } as const;
type RunRow = Pick<DataForSeoRun, keyof typeof runSelect>;
function runDto(run: RunRow): DataForSeoRunDto {
  return { requestId: run.requestId, status: run.status as DataForSeoRunStatus, startedAt: run.createdAt.toISOString(), completedAt: run.completedAt?.toISOString() ?? null,
    errorCode: run.errorCode, actualCostMicros: run.actualCostMicros, budgetCostMicros: run.budgetCostMicros, summary: run.summary as DataForSeoSummary | null };
}
const budget = (usedMicros: number) => ({ limitMicros: DATAFORSEO_TRIAL_BUDGET_MICROS, usedMicros, remainingMicros: Math.max(0, DATAFORSEO_TRIAL_BUDGET_MICROS - usedMicros) });
async function usedBudget(client: Prisma.TransactionClient = prisma) {
  return (await client.dataForSeoRun.aggregate({ where: { siteDomain: SITE }, _sum: { budgetCostMicros: true } }))._sum.budgetCostMicros ?? 0;
}
export async function loadDataForSeoStatus(): Promise<DataForSeoStatus> {
  const connection = await prisma.dataForSeoConnection.findUnique({ where: { siteDomain: SITE } });
  let canDecrypt = false;
  if (connection) { try { decryptDataForSeoCredentials(connection.encryptedCredentials); canDecrypt = true; } catch { /* A rotated login password requires reconnecting. */ } }
  const runs = await prisma.dataForSeoRun.findMany({ where: { siteDomain: SITE }, select: runSelect, orderBy: { createdAt: "desc" }, take: 20 });
  return { connection: { configured: Boolean(connection), loginMasked: connection?.loginMasked ?? null, canDecrypt, scheduleEnabled: false },
    quote, trialBudget: budget(await usedBudget()), runs: runs.map(runDto) };
}
function result(action: "update" | "replay", run: RunRow, duplicate: boolean): DataForSeoRunResult {
  return { action, requestId: run.requestId, status: run.status as DataForSeoRunStatus, duplicate, run: runDto(run) };
}
async function replayRun(requestId: string, action: "update" | "replay" = "replay", duplicate = true): Promise<DataForSeoRunResult> {
  let run = await prisma.dataForSeoRun.findUnique({ where: { requestId } });
  if (!run || run.siteDomain !== SITE) throw new ImportRequestError("没有找到此采集账本", 404);
  if (run.status === "COMPLETED") return result(action, run, true);
  if (!run.normalized && !(run.rawResponse && run.collectedAt && ["RECEIVED", "IMPORT_FAILED"].includes(run.status))) return result(action, run, true);
  if (!Array.isArray(run.importPayload)) {
    try { run = await saveImportPlan(requestId, run.normalized as unknown as DataForSeoNormalized | undefined); }
    catch {
      await prisma.dataForSeoRun.updateMany({ where: { requestId, importedBatches: run.importedBatches, status: { in: ["RECEIVED", "IMPORT_FAILED"] } }, data: { status: "IMPORT_FAILED", errorCode: "IMPORT_PLAN_FAILED" } });
      return result(action, await prisma.dataForSeoRun.findUniqueOrThrow({ where: { requestId } }), duplicate);
    }
  }
  if (run.status === "COMPLETED") return result(action, run, true);
  const batches = run.importPayload as Prisma.JsonArray, cursor = run.importedBatches ?? 0;
  try {
    // One <=500-row batch per zero-fee request fits a 60-second route. The
    // durable cursor resumes later batches instead of replaying a whole run.
    const imported = cursor < batches.length ? (await importSeo(rankingImportSchema.parse(batches[cursor]))).imported : 0;
    const next = Math.min(cursor + 1, batches.length), complete = next >= batches.length;
    const summary = { ...(run.summary as object), importedObservations: ((run.summary as DataForSeoSummary | null)?.importedObservations ?? 0) + imported };
    await prisma.dataForSeoRun.updateMany({ where: { requestId, importedBatches: cursor }, data: { status: complete ? "COMPLETED" : "RECEIVED", importedBatches: next,
      completedAt: complete ? new Date() : null, errorCode: complete ? null : "IMPORT_CONTINUE_FROM_CACHE", summary: json(summary) } });
    return result(action, await prisma.dataForSeoRun.findUniqueOrThrow({ where: { requestId } }), duplicate);
  } catch {
    // A slower concurrent replay may fail after another request advanced this
    // cursor or completed the capture. Never regress that successful receipt.
    await prisma.dataForSeoRun.updateMany({ where: { requestId, importedBatches: cursor, status: { in: ["RECEIVED", "IMPORT_FAILED"] } }, data: { status: "IMPORT_FAILED", errorCode: "IMPORT_FAILED" } });
    return result(action, await prisma.dataForSeoRun.findUniqueOrThrow({ where: { requestId } }), duplicate);
  }
}
async function saveImportPlan(requestId: string, normalized?: DataForSeoNormalized) {
  return prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`dataforseo:import-plan:${requestId}`}))`;
    const current = await tx.dataForSeoRun.findUniqueOrThrow({ where: { requestId } });
    if (Array.isArray(current.importPayload)) return current;
    if (current.rawResponse && current.collectedAt) {
      // A parser fix may recover a previously rejected paid response. Its true
      // original collection time stays unchanged and no network call is made.
      normalized = normalizeRankedKeywords(JSON.parse(current.rawResponse), { runId: requestId, collectedAt: current.collectedAt.toISOString(), limit: LIMIT });
    }
    if (!normalized) throw new ImportRequestError("原始采集结果尚未完整保存，不能重放或再次扣费", 409);
    const memberships = await tx.siteKeyword.findMany({ where: { siteDomain: SITE, active: true, pool: { in: ["FORMAL", "RESEARCH"] }, keyword: { active: true } },
      select: { keywordId: true, active: true, pool: true, keyword: { select: { text: true, active: true } } } });
    const plan = buildDataForSeoImportPlan(normalized, memberships, requestId);
    return tx.dataForSeoRun.update({ where: { requestId }, data: { normalized: json(normalized), importPayload: json(plan.batches), candidates: json(plan.candidates), summary: json(plan.summary),
      actualCostMicros: normalized.actualCostMicros, budgetCostMicros: normalized.actualCostMicros ?? quote.maxCostMicros, status: "RECEIVED", errorCode: null } });
  });
}
async function reserveRun(requestId: string, previewToken: string) {
  return prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"dataforseo:budget:flatkey.ai"}))`;
    const existing = await tx.dataForSeoRun.findUnique({ where: { requestId } });
    if (existing) {
      if (existing.siteDomain !== SITE) throw new ImportRequestError("requestId已用于其他网站", 409);
      return { existing, credentials: null, run: null };
    }
    // An unresolved outcome must be investigated, rather than minting a new ID
    // and spending again after a network failure.
    if (await tx.dataForSeoRun.findFirst({ where: { siteDomain: SITE, status: { in: UNRESOLVED_STATUSES } }, select: { requestId: true } })) throw new ImportRequestError("已有采集账本尚未处理完成，请先确认结果或重放缓存，不能重复扣费", 409);
    const site = await tx.seoSite.findUnique({ where: { domain: SITE } });
    if (!site?.active) throw new ImportRequestError("Flatkey网站未启用，本次未请求供应商", 409);
    const connection = await tx.dataForSeoConnection.findUnique({ where: { siteDomain: SITE } });
    if (!connection) throw new ImportRequestError("请先保存API连接", 409);
    const credentials = decryptDataForSeoCredentials(connection.encryptedCredentials), claims = verifyDataForSeoPreview(previewToken);
    const request = [buildRankedKeywordsTask(LIMIT, requestId)], requestHash = createHash("sha256").update(JSON.stringify(request)).digest("hex"), used = await usedBudget(tx);
    if (claims.requestId !== requestId || claims.connectionVersion !== connection.connectionVersion || claims.connectionHash !== connectionHash(connection.encryptedCredentials) || claims.requestHash !== requestHash || claims.usedMicros !== used
      || typeof claims.expiresAt !== "number" || claims.expiresAt < Date.now()) throw new ImportRequestError("费用或连接状态在预览后已变化，请重新预览", 409);
    if (used + quote.maxCostMicros > DATAFORSEO_TRIAL_BUDGET_MICROS) throw new ImportRequestError("本系统1美元试用预算不足，本次未请求供应商", 409);
    const run = await tx.dataForSeoRun.create({ data: { requestId, siteDomain: SITE, status: "PENDING", requestHash, requestJson: json(request),
      connectionVersion: connection.connectionVersion, estimatedCostMicros: quote.maxCostMicros, budgetCostMicros: quote.maxCostMicros } });
    return { existing: null, credentials, run };
  });
}
async function executeRun(requestId: string, previewToken: string) {
  const reserved = await reserveRun(requestId, previewToken);
  if (reserved.existing) return result("update", reserved.existing, true);
  const run = reserved.run!, credentials = reserved.credentials!;
  let response: Response;
  try {
    // Exactly one POST. No automatic redirect, retry, pagination or provider
    // balance probe. PENDING was committed before reaching this line.
    response = await fetch(ENDPOINT, { method: "POST", redirect: "error", signal: AbortSignal.timeout(40000),
      headers: { "Content-Type": "application/json", Authorization: `Basic ${Buffer.from(`${credentials.apiLogin}:${credentials.apiPassword}`).toString("base64")}` }, body: JSON.stringify(run.requestJson) });
  } catch {
    const unknown = await prisma.dataForSeoRun.update({ where: { requestId }, data: { status: "UNKNOWN", errorCode: "OUTCOME_UNKNOWN" } });
    return result("update", unknown, false);
  }
  let rawResponse: string;
  try { rawResponse = await response.text(); }
  catch {
    const unknown = await prisma.dataForSeoRun.update({ where: { requestId }, data: { status: "UNKNOWN", errorCode: "RESPONSE_INCOMPLETE" } });
    return result("update", unknown, false);
  }
  const collectedAt = new Date();
  // Receipt time and recoverable state are durable together with the raw paid
  // response. A process stop before parsing can then replay without spending.
  await prisma.dataForSeoRun.update({ where: { requestId }, data: { rawResponse, collectedAt,
    status: response.ok ? "RECEIVED" : "FAILED", errorCode: response.ok ? null : `HTTP_${response.status}` } });
  let normalized: DataForSeoNormalized;
  try {
    if (!response.ok) throw new Error(`HTTP_${response.status}`);
    normalized = normalizeRankedKeywords(JSON.parse(rawResponse), { runId: requestId, collectedAt: collectedAt.toISOString(), limit: LIMIT });
  } catch {
    let errorCode = `HTTP_${response.status}`;
    if (response.ok) {
      try {
        const raw = JSON.parse(rawResponse), taskCode = raw.tasks?.[0]?.status_code;
        const providerCode = Number.isInteger(taskCode) && taskCode !== 20000 ? taskCode : Number.isInteger(raw.status_code) && raw.status_code !== 20000 ? raw.status_code : null;
        errorCode = providerCode === null ? "INVALID_RESPONSE" : `PROVIDER_${providerCode}`;
      }
      catch { errorCode = "INVALID_RESPONSE"; }
    }
    const failed = await prisma.dataForSeoRun.update({ where: { requestId }, data: { status: "FAILED", errorCode } });
    return result("update", failed, false);
  }
  // Store the successful paid response before planning/importing any inventory
  // observations. If an import fails, replay can use this cache at zero cost.
  await prisma.dataForSeoRun.updateMany({ where: { requestId, importedBatches: 0, status: { in: ["RECEIVED", "IMPORT_FAILED"] } }, data: { normalized: json(normalized), collectedAt: new Date(normalized.collectedAt),
    actualCostMicros: normalized.actualCostMicros, budgetCostMicros: normalized.actualCostMicros ?? quote.maxCostMicros, status: "RECEIVED" } });
  try {
    await saveImportPlan(requestId, normalized);
  } catch {
    await prisma.dataForSeoRun.updateMany({ where: { requestId, importedBatches: 0, status: { in: ["RECEIVED", "IMPORT_FAILED"] } }, data: { status: "IMPORT_FAILED", errorCode: "IMPORT_PLAN_FAILED" } });
    return result("update", await prisma.dataForSeoRun.findUniqueOrThrow({ where: { requestId } }), false);
  }
  return result("update", await prisma.dataForSeoRun.findUniqueOrThrow({ where: { requestId } }), false);
}

export async function mutateDataForSeo(input: DataForSeoMutation): Promise<DataForSeoMutationResult> {
  if (input.action === "connect") {
    const encryptedCredentials = encryptDataForSeoCredentials(input.apiLogin, input.apiPassword), loginMasked = maskDataForSeoLogin(input.apiLogin);
    await prisma.dataForSeoConnection.upsert({ where: { siteDomain: SITE }, create: { siteDomain: SITE, encryptedCredentials, loginMasked },
      update: { encryptedCredentials, loginMasked, connectionVersion: { increment: 1 }, scheduleEnabled: false } });
    return loadDataForSeoStatus();
  }
  if (input.action === "disconnect") {
    await prisma.dataForSeoConnection.deleteMany({ where: { siteDomain: SITE } }); return loadDataForSeoStatus();
  }
  if (input.action === "update") return executeRun(input.requestId, input.previewToken);
  if (input.action === "replay") return replayRun(input.requestId);
  const connection = await prisma.dataForSeoConnection.findUnique({ where: { siteDomain: SITE } });
  if (!connection) throw new ImportRequestError("请先保存API连接", 409);
  decryptDataForSeoCredentials(connection.encryptedCredentials);
  if (await prisma.dataForSeoRun.findFirst({ where: { siteDomain: SITE, status: { in: UNRESOLVED_STATUSES } }, select: { requestId: true } })) throw new ImportRequestError("已有采集账本待处理，请先确认结果或重放缓存，不能开启另一次扣费", 409);
  if (await prisma.dataForSeoRun.findUnique({ where: { requestId: input.requestId }, select: { requestId: true } })) throw new ImportRequestError("此requestId已有账本，请查看记录或重放缓存", 409);
  const used = await usedBudget();
  if (used + quote.maxCostMicros > DATAFORSEO_TRIAL_BUDGET_MICROS) throw new ImportRequestError("本系统1美元试用预算不足", 409);
  const requestHash = createHash("sha256").update(JSON.stringify([buildRankedKeywordsTask(LIMIT, input.requestId)])).digest("hex"), expiresAt = Date.now() + 10 * 60000;
  return { action: "preview", requestId: input.requestId, quote, trialBudget: budget(used), expiresAt: new Date(expiresAt).toISOString(),
    previewToken: signDataForSeoPreview({ requestId: input.requestId, requestHash, connectionVersion: connection.connectionVersion, connectionHash: connectionHash(connection.encryptedCredentials), usedMicros: used, expiresAt }) };
}
