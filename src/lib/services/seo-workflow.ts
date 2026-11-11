import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ACTION_KIND, workflowClaimSchema, workflowMutationSchema, workflowApprovalCheckSchema, type WorkflowKind, type WorkflowRecord, type WorkflowTask, type WorkflowPlan, type WorkflowApproval } from "@/lib/seo-workflow";
import { validateInternalReviewAssets } from "./seo-review-assets";
import { prepareWorkflowMutation, workflowHash, workflowSnapshot, checkWorkflowApproval, WorkflowError, type WorkflowActor, type WorkflowStoredRow } from "@/lib/seo-workflow-state";
import { syncWorkflowMarketAssignment } from "./keyword-market-assignment";

const json = (value: unknown) => value as Prisma.InputJsonValue;
type LocalState = { records: WorkflowStoredRow[]; events: { requestId: string; requestHash: string; kind: WorkflowKind; record: WorkflowRecord }[] };
function localDirectory(localPreview: boolean) {
  if (!localPreview) return null;
  const directory = process.env.SEO_WORKFLOW_PREVIEW_DIR ?? join(process.cwd(), ".local", "seo-workflow");
  if (!isAbsolute(directory)) throw new WorkflowError("configuration", "本地预览目录必须是绝对路径", 503);
  return directory;
}
async function readLocal(directory: string): Promise<LocalState> {
  try { return JSON.parse(await readFile(join(directory, "workflow.json"), "utf8")) as LocalState; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return { records: [], events: [] }; throw error; }
}
function requireDatabase() { if (!process.env.DATABASE_URL) throw new WorkflowError("storage_unavailable", "执行台账尚未接通数据库，未写入任何生产记录", 503); }

export async function loadWorkflowSnapshot(options: { week?: string; pageUrl?: string; allHistory?: boolean } = {}, localPreview = false) {
  const directory = localDirectory(localPreview);
  if (directory) return workflowSnapshot((await readLocal(directory)).records, options, "local_preview");
  requireDatabase();
  const rows = await prisma.seoWorkflowRecord.findMany({ orderBy: { updatedAt: "desc" } });
  return workflowSnapshot(rows.map(row => ({ kind: row.kind as WorkflowKind, record: row.payload as unknown as WorkflowRecord })), options, "database");
}

async function saveLocalWorkflow(input: unknown, actor: WorkflowActor, directory: string) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const lock = join(directory, "write.lock");
  try { await mkdir(lock); } catch (error) { if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new WorkflowError("preview_busy", "本地预览正在写入；稍后重试。遗留锁须确认原进程结束后清理。"); throw error; }
  const temporary = join(directory, `.${randomUUID()}.json`);
  try {
    const state = await readLocal(directory), request = workflowMutationSchema.parse(input), hash = workflowHash(request);
    const prior = state.events.find(event => event.requestId === request.requestId);
    if (prior) { if (prior.requestHash !== hash) throw new WorkflowError("idempotency_conflict", "同一请求编号已用于不同内容"); return { stored: true, replay: true, kind: prior.kind, record: prior.record, storage: "local_preview" as const }; }
    const prepared = prepareWorkflowMutation(request, state.records, actor);
    state.records = state.records.filter(row => row.kind !== prepared.kind || row.record.id !== prepared.record.id);
    state.records.push({ kind: prepared.kind, record: prepared.record });
    state.events.push({ requestId: request.requestId, requestHash: hash, kind: prepared.kind, record: prepared.record });
    await writeFile(temporary, JSON.stringify(state), { flag: "wx", mode: 0o600 });
    await rename(temporary, join(directory, "workflow.json"));
    return { stored: true, replay: false, kind: prepared.kind, record: prepared.record, storage: "local_preview" as const };
  } finally { await rm(temporary, { force: true }); await rm(lock, { recursive: true, force: true }); }
}

export async function saveWorkflowMutation(input: unknown, actor: WorkflowActor, localPreview = false) {
  const directory = localDirectory(localPreview);
  if (directory) return saveLocalWorkflow(input, actor, directory);
  requireDatabase();
  const request = workflowMutationSchema.parse(input), requestHash = workflowHash(request);
  return prisma.$transaction(async tx => {
    // Serializes dependent plan/task/publication transitions across all instances;
    // these low-volume writes need a consistent graph, not a process-local mutex.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('flatkey-seo-workflow-v1'))`;
    const replay = await tx.seoWorkflowEvent.findUnique({ where: { requestId: request.requestId } });
    if (replay) {
      if (replay.requestHash !== requestHash) throw new WorkflowError("idempotency_conflict", "同一请求编号已用于不同内容");
      return { stored: true, replay: true, kind: replay.kind as WorkflowKind, record: replay.payload as unknown as WorkflowRecord, storage: "database" as const };
    }
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('flatkey-seo-workflow-claims-v1'))`;
    const rawRecord = request.record as Record<string, unknown> | null;
    const associatedRun = request.claim?.runId ?? (request.action === "record_run" ? rawRecord?.id : request.action === "record_publication" ? rawRecord?.runId : undefined);
    if (request.claim && (request.action === "record_run" && rawRecord?.id !== request.claim.runId || request.action === "record_publication" && rawRecord?.runId !== request.claim.runId)) throw new WorkflowError("claim_record_mismatch", "回执记录与阶段租约编号不一致");
    if (typeof associatedRun === "string") {
      const lease = await tx.seoWorkflowLease.findUnique({ where: { runId: associatedRun } });
      if (lease || request.claim) {
        const [clock] = await tx.$queryRaw<{ now: Date }[]>`SELECT CURRENT_TIMESTAMP AS now`;
        if (!request.claim || !lease || lease.status !== "running" || lease.owner !== request.claim.owner || lease.fencingToken !== request.claim.fencingToken || lease.leaseUntil <= clock.now) throw new WorkflowError("lease_lost", "当前阶段租约无效；不能由旧执行器覆盖新回执");
      }
    }
    const rows = await tx.seoWorkflowRecord.findMany();
    const all = rows.map(row => ({ kind: row.kind as WorkflowKind, record: row.payload as unknown as WorkflowRecord }));
    const prepared = prepareWorkflowMutation(request, all, actor);
    if (prepared.kind === "approval") await validateInternalReviewAssets(prepared.record as WorkflowApproval, tx);
    if (prepared.kind === "publication") {
      const approvalId = (prepared.record as { approvalId: string }).approvalId;
      const approval = all.find(row => row.kind === "approval" && row.record.id === approvalId)?.record as WorkflowApproval | undefined;
      if (approval) await validateInternalReviewAssets(approval, tx, true);
    }
    const data = { kind: prepared.kind, recordId: prepared.record.id, weekStart: prepared.record.weekStart, siteDomain: "siteDomain" in prepared.record ? prepared.record.siteDomain : null, status: prepared.record.status, version: prepared.record.version, payload: json(prepared.record) };
    await tx.seoWorkflowRecord.upsert({ where: { key: prepared.key }, create: { key: prepared.key, ...data }, update: data });
    await tx.seoWorkflowEvent.create({ data: { requestId: request.requestId, requestHash, recordKey: prepared.key, kind: prepared.kind, version: prepared.record.version, payload: json(prepared.record) } });
    const marketTasks: WorkflowTask[] = prepared.kind === "task" && (prepared.record as WorkflowTask).status === "approved" ? [prepared.record as WorkflowTask]
      : prepared.kind === "plan" && (prepared.record as WorkflowPlan).status === "reviewed" ? all.filter(row => row.kind === "task" && (prepared.record as WorkflowPlan).taskIds.includes(row.record.id)).map(row => row.record as WorkflowTask) : [];
    for (const task of marketTasks) if (task.keywordId && task.keyword && task.country && task.language && task.evidence.length) {
      await syncWorkflowMarketAssignment(tx, { siteDomain: task.siteDomain, keywordId: task.keywordId, keyword: task.keyword, country: task.country, language: task.language, evidence: task.evidence, reviewedAt: prepared.record.updatedAt });
    }
    return { stored: true, replay: false, kind: prepared.kind, record: prepared.record, storage: "database" as const };
  }, { maxWait: 10_000, timeout: 30_000 });
}

/** Read-only preflight before an external CMS/deploy. Publication receipts recheck
 * the same graph in their write transaction; this cannot make an external CMS atomic. */
export async function checkWorkflowApprovalRequest(input: unknown, localPreview = false) {
  const request = workflowApprovalCheckSchema.parse(input), directory = localDirectory(localPreview);
  if (directory) return { ...checkWorkflowApproval(request, (await readLocal(directory)).records), storage: "local_preview" as const };
  requireDatabase();
  const rows = await prisma.seoWorkflowRecord.findMany();
  const approval = rows.find(row => row.kind === "approval" && row.recordId === request.approvalId)?.payload as unknown as WorkflowApproval | undefined;
  if (approval) await validateInternalReviewAssets(approval, undefined, true);
  return { ...checkWorkflowApproval(request, rows.map(row => ({ kind: row.kind as WorkflowKind, record: row.payload as unknown as WorkflowRecord }))), storage: "database" as const };
}

export async function readWorkflowHistory(kind: WorkflowKind, recordId: string, localPreview = false) {
  const directory = localDirectory(localPreview);
  if (directory) return (await readLocal(directory)).events.filter(row => row.kind === kind && row.record.id === recordId).map(row => row.record);
  requireDatabase();
  const rows = await prisma.seoWorkflowEvent.findMany({ where: { recordKey: `${kind}:${recordId}` }, orderBy: { version: "asc" }, select: { payload: true } });
  return rows.map(row => row.payload as unknown as WorkflowRecord);
}

export async function mutateWorkflowClaim(input: unknown) {
  requireDatabase();
  const command = workflowClaimSchema.parse(input);
  return prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('flatkey-seo-workflow-claims-v1'))`;
    // Database clock is shared by all workers; local clocks do not decide leases.
    const [clock] = await tx.$queryRaw<{ now: Date }[]>`SELECT CURRENT_TIMESTAMP AS now`;
    const now = clock.now, expires = new Date(now.getTime() + command.leaseSeconds * 1000);
    const existing = await tx.seoWorkflowLease.findUnique({ where: { runId: command.runId } });
    if (existing && (existing.stage !== command.stage || existing.scheduledFor.getTime() !== Date.parse(command.scheduledFor))) throw new WorkflowError("claim_identity_conflict", "同一运行编号不能改换阶段或计划时间");
    if (command.action === "claim") {
      if (existing?.status === "completed") return { acquired: false, reason: "completed", runId: existing.runId, status: existing.status };
      if (existing && existing.status === "running" && existing.leaseUntil > now) return { acquired: false, reason: "leased", runId: existing.runId, status: existing.status, leaseUntil: existing.leaseUntil.toISOString() };
      const other = await tx.seoWorkflowLease.findUnique({ where: { stage_scheduledFor: { stage: command.stage, scheduledFor: new Date(command.scheduledFor) } } });
      if (other && other.runId !== command.runId) throw new WorkflowError("stage_already_claimed", "同一阶段与计划时间已有运行编号，请续跑原编号");
      const lease = await tx.seoWorkflowLease.upsert({ where: { runId: command.runId }, create: { runId: command.runId, stage: command.stage, scheduledFor: new Date(command.scheduledFor), owner: command.owner, fencingToken: 1, leaseUntil: expires }, update: { owner: command.owner, fencingToken: { increment: 1 }, leaseUntil: expires, status: "running", result: Prisma.DbNull } });
      return { acquired: true, runId: lease.runId, status: lease.status, fencingToken: lease.fencingToken, leaseUntil: lease.leaseUntil.toISOString() };
    }
    if (!existing || existing.status !== "running" || existing.owner !== command.owner || existing.fencingToken !== command.fencingToken || existing.leaseUntil <= now) throw new WorkflowError("lease_lost", "租约已失效或已被其他执行器续跑；旧执行器不得提交完成");
    if (command.action === "renew") {
      const renewed = await tx.seoWorkflowLease.update({ where: { runId: command.runId }, data: { leaseUntil: expires } });
      return { acquired: true, runId: renewed.runId, status: renewed.status, fencingToken: renewed.fencingToken, leaseUntil: renewed.leaseUntil.toISOString() };
    }
    if (!command.status || !command.evidence.length) throw new WorkflowError("completion_evidence_missing", "结束租约需要实际状态和回执证据");
    const receipt = await tx.seoWorkflowRecord.findUnique({ where: { key: `run:${command.runId}` } });
    const receiptPayload = receipt?.payload as Record<string, unknown> | undefined;
    if (!receipt || receipt.status !== command.status || receiptPayload?.stage !== command.stage || Date.parse(String(receiptPayload?.scheduledFor)) !== Date.parse(command.scheduledFor)) throw new WorkflowError("run_receipt_missing", "先保存同阶段、计划时间及状态的回执，再结束租约");
    const completed = await tx.seoWorkflowLease.update({ where: { runId: command.runId }, data: { status: command.status, leaseUntil: now, result: json({ evidence: command.evidence, completedAt: now.toISOString() }) } });
    return { acquired: false, runId: completed.runId, status: completed.status, fencingToken: completed.fencingToken };
  }, { maxWait: 10_000, timeout: 15_000 });
}

export { ACTION_KIND };
