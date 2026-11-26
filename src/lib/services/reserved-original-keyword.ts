import "server-only";
import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { isGrowthTopicPlaceholder } from "@/lib/seo-growth-markets";
import { WorkflowError, workflowHash, workflowKey, type WorkflowActor } from "@/lib/seo-workflow-state";
import type { WorkflowTask } from "@/lib/seo-workflow";
import {
  reservedOriginalCommandSchema, reservedOriginalIdentity, reservedOriginalIdentitySchema, reservedOriginalProblem,
  type ReservedOriginalIdentity,
} from "@/lib/reserved-original-keyword";
import { readGrowthStrategy } from "./growth-strategy";

const status = "RESERVED_ORIGINAL_KEYWORD_APPLIED";
const auditId = (taskId: string) => "reserved-original-keyword:" + taskId;
type Receipt = {
  requestId: string; identity: ReservedOriginalIdentity; taskVersion: number; quarterHash: string;
  actor: WorkflowActor; appliedAt: string; changed: boolean;
};

function readMember(db: Pick<Prisma.TransactionClient, "siteKeyword">, { siteDomain, keywordId }: ReservedOriginalIdentity) {
  return db.siteKeyword.findUnique({
    where: { siteDomain_keywordId: { siteDomain, keywordId } },
    include: { keyword: { select: { active: true, text: true } }, site: { select: { active: true } },
      topicAssignments: { select: { topicId: true } } },
  });
}

function sameMember(member: Awaited<ReturnType<typeof readMember>>, identity: ReservedOriginalIdentity) {
  return Boolean(member?.active && member.site.active && member.keyword.active && member.keyword.text === identity.keyword &&
    (member.topicId === identity.topicId || member.topicAssignments.some(row => row.topicId === identity.topicId)));
}

export async function loadReservedOriginalAdmissions(tasks: WorkflowTask[]): Promise<ReadonlyMap<string, ReservedOriginalIdentity>> {
  if (!tasks.length) return new Map();
  const rows = await prisma.keywordCurationAudit.findMany({
    where: { id: { in: tasks.map(task => auditId(task.id)) }, status, restoredAt: null },
    select: { id: true, summary: true },
  });
  const candidates: ReservedOriginalIdentity[] = [];
  for (const row of rows) {
    const identity = reservedOriginalIdentitySchema.safeParse((row.summary as unknown as Receipt).identity);
    if (identity.success && row.id === auditId(identity.data.taskId)) candidates.push(identity.data);
  }
  if (!candidates.length) return new Map();
  const members = await prisma.siteKeyword.findMany({
    where: { siteDomain: "modelfit.cc", keywordId: { in: candidates.map(row => row.keywordId) }, pool: "FORMAL" },
    include: { keyword: { select: { active: true, text: true } }, site: { select: { active: true } },
      topicAssignments: { select: { topicId: true } } },
  });
  const byKeyword = new Map(members.map(row => [row.keywordId, row]));
  return new Map(candidates.filter(row => sameMember(byKeyword.get(row.keywordId) ?? null, row)).map(row => [row.taskId, row]));
}

export async function loadReservedOriginalReceipt(taskId: string, requestId: string) {
  const audit = await prisma.keywordCurationAudit.findUnique({ where: { id: auditId(taskId) } });
  const receipt = audit?.summary as unknown as Receipt | undefined;
  if (audit?.status !== status || audit.restoredAt || receipt?.requestId !== requestId || receipt.identity.taskId !== taskId) {
    throw new WorkflowError("reserved_original_receipt_missing", "未找到该原任务和请求的确切回执", 404);
  }
  const member = await readMember(prisma, receipt.identity);
  return { status, ...receipt, readbackVerified: sameMember(member, receipt.identity) && member?.pool === "FORMAL" };
}

export async function applyReservedOriginalKeyword(raw: unknown, actor: WorkflowActor) {
  const command = reservedOriginalCommandSchema.parse(raw);
  const payloadHash = workflowHash(command);
  return prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('flatkey-seo-workflow-v1'))`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('flatkey-seo-workflow-claims-v1'))`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('seo-import:modelfit.cc'))`;
    const id = auditId(command.taskId);
    const audit = await tx.keywordCurationAudit.findUnique({ where: { id } });
    if (audit) {
      if (audit.status !== status || audit.restoredAt || audit.payloadHash !== payloadHash) {
        throw new WorkflowError("reserved_original_already_reviewed", "该原词已有审计，请读回原请求", 409);
      }
      const receipt = audit.summary as unknown as Receipt;
      const member = await readMember(tx, receipt.identity);
      if (!sameMember(member, receipt.identity) || member?.pool !== "FORMAL") throw new WorkflowError("reserved_original_readback_changed", "原回执之后成员状态已变化", 409);
      return { status, ...receipt, replay: true, readbackVerified: true };
    }
    const row = await tx.seoWorkflowRecord.findUnique({ where: { key: workflowKey("task", command.taskId) } });
    if (!row) throw new WorkflowError("task_not_found", "未找到原任务", 404);
    if (row.version !== command.expectedTaskVersion) throw new WorkflowError("version_conflict", "原任务版本已更新", 409);
    const task = row.payload as unknown as WorkflowTask;
    if (task.version !== row.version) throw new WorkflowError("reserved_original_task_version_mismatch", "原任务版本无法核对", 409);
    const [{ now }] = await tx.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`;
    const [strategy, dependencyRows] = await Promise.all([
      readGrowthStrategy(tx),
      tx.seoWorkflowRecord.findMany({ where: { kind: "task", recordId: { in: task.dependencies } }, select: { payload: true } }),
    ]);
    const dependencies = dependencyRows.map(dep => dep.payload as unknown as WorkflowTask);
    const problem = reservedOriginalProblem(command, task, strategy, dependencies, now);
    const identity = reservedOriginalIdentity(task);
    if (problem || !identity) throw new WorkflowError("reserved_original_not_eligible", problem ?? "原任务身份不完整", 422);

    const leaseId = "task-claim:" + createHash("sha256").update(task.id).digest("hex").slice(0, 24);
    const [lease, before, topic] = await Promise.all([
      tx.seoWorkflowLease.findUnique({ where: { runId: leaseId } }),
      readMember(tx, identity),
      tx.topic.findUnique({ where: { id: identity.topicId }, select: { active: true, text: true, sites: { select: { siteDomain: true } } } }),
    ]);
    if (lease?.status === "running" && lease.leaseUntil > now) throw new WorkflowError("reserved_original_in_flight", "原任务已有有效租约", 409);
    if (!before || !sameMember(before, identity) || !["RESEARCH", "FORMAL"].includes(before.pool) || !topic?.active ||
      isGrowthTopicPlaceholder(topic.text) || !topic.sites.some(site => site.siteDomain === identity.siteDomain)) {
      throw new WorkflowError("reserved_original_member_mismatch", "现有原词或话题的本站成员身份未对平", 422);
    }
    const changed = before.pool === "RESEARCH";
    if (changed) {
      const result = await tx.siteKeyword.updateMany({ where: { siteDomain: identity.siteDomain, keywordId: identity.keywordId,
        active: true, topicId: before.topicId, pool: before.pool, keyword: { active: true, text: identity.keyword } }, data: { pool: "FORMAL" } });
      if (result.count !== 1) throw new WorkflowError("reserved_original_member_changed", "原成员已发生变化", 409);
    }
    const after = await readMember(tx, identity);
    if (!after || !sameMember(after, identity) || after.pool !== "FORMAL") throw new WorkflowError("reserved_original_readback_failed", "正式成员读回未对平", 409);
    const receipt: Receipt = { requestId: command.requestId, identity, taskVersion: row.version, quarterHash: command.quarterHash,
      actor, appliedAt: now.toISOString(), changed };
    const saved = await tx.keywordCurationAudit.create({
      data: { id, siteDomain: identity.siteDomain, payloadHash, status, summary: receipt,
        before: { pool: before.pool }, after: { pool: after.pool }, appliedAt: now },
    });
    if (workflowHash(saved.summary) !== workflowHash(receipt)) throw new WorkflowError("reserved_original_audit_failed", "正式成员审计读回未对平", 409);
    return { status, ...receipt, replay: false, readbackVerified: true };
  }, { timeout: 30000, maxWait: 5000 });
}
