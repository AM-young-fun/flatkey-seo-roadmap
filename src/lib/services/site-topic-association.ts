import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { WorkflowError, type WorkflowActor } from "@/lib/seo-workflow-state";
import { addTopicAssociationSchema, associationAuditId, associationHash, associationRequestIdSchema,
  canonicalAssociationState, prepareTopicAssociation, previewTopicAssociation, requireAssociationHuman,
  topicAssociationIdentitySchema, TOPIC_ASSOCIATION_AUDIT_STATUS,
  type TopicAssociationIdentity, type TopicAssociationState } from "@/lib/site-topic-association";

const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
type Receipt = {
  version: "site-topic-association-v1"; requestId: string; requestHash: string; actor: "human";
  identity: TopicAssociationIdentity; status: "created" | "reused"; createdEdge: boolean;
  beforeHash: string; afterHash: string; appliedAt: string;
};
type Audit = { id: string; siteDomain: string; status: string; payloadHash: string; before: unknown; after: unknown; summary: unknown };

async function readState(db: Prisma.TransactionClient, identity: TopicAssociationIdentity): Promise<TopicAssociationState> {
  const [site, keyword, member, topic, siteTopic, assignments] = await Promise.all([
    db.seoSite.findUnique({ where: { domain: identity.siteDomain } }),
    db.keyword.findUnique({ where: { id: identity.keywordId } }),
    db.siteKeyword.findUnique({ where: { siteDomain_keywordId: { siteDomain: identity.siteDomain, keywordId: identity.keywordId } } }),
    db.topic.findUnique({ where: { id: identity.topicId } }),
    db.siteTopic.findUnique({ where: { siteDomain_topicId: { siteDomain: identity.siteDomain, topicId: identity.topicId } } }),
    db.siteKeywordTopic.findMany({ where: { siteDomain: identity.siteDomain, keywordId: identity.keywordId },
      orderBy: [{ siteDomain: "asc" }, { keywordId: "asc" }, { topicId: "asc" }] }),
  ]);
  return canonicalAssociationState({ site, keyword, member, topic, siteTopic, assignments });
}
async function lockState(tx: Prisma.TransactionClient, identity: TopicAssociationIdentity) {
  // Parent locks also block concurrent FK child inserts. Existing edge locks
  // prevent deletes while the exact before/after snapshot is being checked.
  await tx.$queryRaw`SELECT "domain" FROM "SeoSite" WHERE "domain" = ${identity.siteDomain} FOR SHARE`;
  await tx.$queryRaw`SELECT "id" FROM "Keyword" WHERE "id" = ${identity.keywordId} FOR UPDATE`;
  await tx.$queryRaw`SELECT "keywordId" FROM "SiteKeyword" WHERE "siteDomain" = ${identity.siteDomain} AND "keywordId" = ${identity.keywordId} FOR UPDATE`;
  await tx.$queryRaw`SELECT "id" FROM "Topic" WHERE "id" = ${identity.topicId} FOR UPDATE`;
  await tx.$queryRaw`SELECT "topicId" FROM "SiteTopic" WHERE "siteDomain" = ${identity.siteDomain} AND "topicId" = ${identity.topicId} FOR SHARE`;
  await tx.$queryRaw`SELECT "topicId" FROM "SiteKeywordTopic" WHERE "siteDomain" = ${identity.siteDomain} AND "keywordId" = ${identity.keywordId} ORDER BY "topicId" FOR UPDATE`;
}
function auditReceipt(audit: Audit, requestId: string, requestHash?: string) {
  const summary = audit.summary as { receipt?: Receipt; receiptHash?: string } | null, receipt = summary?.receipt;
  if (audit.id !== associationAuditId(requestId) || audit.status !== TOPIC_ASSOCIATION_AUDIT_STATUS
    || !receipt || receipt.version !== "site-topic-association-v1" || receipt.requestId !== requestId || receipt.actor !== "human"
    || audit.siteDomain !== receipt.identity?.siteDomain
    || receipt.requestHash !== audit.payloadHash || requestHash && audit.payloadHash !== requestHash
    || associationHash(receipt) !== summary?.receiptHash || associationHash(audit.before) !== receipt.beforeHash
    || associationHash(audit.after) !== receipt.afterHash) {
    throw new WorkflowError("association_request_conflict", "同一请求已用于其他内容，或原审计读回不匹配；保留原记录，不重写", 409);
  }
  return receipt;
}
function result(audit: Audit, requestId: string, replay: boolean, requestHash?: string) {
  return { auditId: audit.id, receipt: auditReceipt(audit, requestId, requestHash), replay,
    receiptReadbackVerified: true, currentStateVerified: !replay };
}
export async function loadTopicAssociationPreview(raw: unknown, actor: WorkflowActor) {
  requireAssociationHuman(actor);
  const identity = topicAssociationIdentitySchema.parse(raw);
  return prisma.$transaction(async tx => ({ status: "preview" as const, stored: false,
    ...previewTopicAssociation(identity, await readState(tx, identity), actor) }),
  { maxWait: 10_000, timeout: 20_000, isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
}
export async function loadTopicAssociationReceipt(rawRequestId: unknown, actor: WorkflowActor) {
  requireAssociationHuman(actor);
  const requestId = associationRequestIdSchema.parse(rawRequestId);
  const audit = await prisma.keywordCurationAudit.findUnique({ where: { id: associationAuditId(requestId) } });
  if (!audit) throw new WorkflowError("association_audit_missing", "未找到该请求的原关联审计，请先读当前预览，不盲目重发", 404);
  return result(audit, requestId, true);
}
/** The one edge and its immutable audit commit together. No broad import or
 * member update is used. A replay returns its original receipt, never a fresh
 * claim that subsequent library changes have not occurred. */
export async function saveTopicAssociation(raw: unknown, actor: WorkflowActor, now = new Date()) {
  requireAssociationHuman(actor);
  const command = addTopicAssociationSchema.parse(raw), requestHash = associationHash(command), auditId = associationAuditId(command.requestId);
  try {
    return await prisma.$transaction(async tx => {
      // requestId is global across sites; take it before the existing site lock.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${auditId}))`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`seo-import:${command.siteDomain}`}))`;
      const previous = await tx.keywordCurationAudit.findUnique({ where: { id: auditId } });
      if (previous) return result(previous, command.requestId, true, requestHash);
      await lockState(tx, command);
      const prepared = prepareTopicAssociation(command, await readState(tx, command), actor);
      if (prepared.createdEdge) await tx.siteKeywordTopic.upsert({
        where: { siteDomain_keywordId_topicId: prepared.edge }, create: prepared.edge, update: {},
      });
      const after = await readState(tx, command);
      if (associationHash(after) !== prepared.afterHash) throw new WorkflowError("association_readback_changed", "完整读回不是仅增加所选一边，事务已取消", 409);
      const identity = topicAssociationIdentitySchema.parse({ siteDomain: command.siteDomain,
        keywordId: command.keywordId, keyword: command.keyword, topicId: command.topicId });
      const receipt: Receipt = { version: "site-topic-association-v1", requestId: command.requestId, requestHash,
        actor: "human", identity, status: prepared.createdEdge ? "created" : "reused", createdEdge: prepared.createdEdge,
        beforeHash: prepared.beforeHash, afterHash: prepared.afterHash, appliedAt: now.toISOString() };
      await tx.keywordCurationAudit.create({ data: { id: auditId, siteDomain: command.siteDomain, payloadHash: requestHash,
        status: TOPIC_ASSOCIATION_AUDIT_STATUS, before: json(prepared.before), after: json(after),
        summary: json({ receipt, receiptHash: associationHash(receipt) }), appliedAt: now } });
      const stored = await tx.keywordCurationAudit.findUnique({ where: { id: auditId } });
      if (!stored) throw new WorkflowError("association_audit_readback_failed", "原关联审计读回失败，事务已取消", 409);
      return result(stored, command.requestId, false, requestHash);
    }, { maxWait: 10_000, timeout: 30_000, isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && ["P2034", "P2002"].includes(error.code)) {
      throw new WorkflowError("association_state_changed", "并发状态或请求编号已变化，请按requestId读原回执和当前预览；未自动重试", 409);
    }
    throw error;
  }
}
