import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { MARKET_ASSIGNMENT_SOURCE_ID } from "@/lib/keyword-market-policy";
import type { WorkflowActor } from "@/lib/seo-workflow-state";
import { preFreezeCommandSchema, preFreezeHash, preFreezeStateHash, planPreFreezeIdentities, identityAuditId, identitySourceKey,
  HUMAN_WORD_LANGUAGE_SOURCE_ID, PRE_FREEZE_IDENTITY_AUDIT, PreFreezeIdentityError, hasHumanIdentityAudit,
  type PreFreezeReview, type PreFreezeIdentityState } from "@/lib/pre-freeze-market-identities";
import type { QuarterMembershipRow, QuarterMembershipTopic } from "@/lib/quarter-membership";

const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const plain = (value: unknown) => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
function human(actor: WorkflowActor) { if (actor !== "human") throw new PreFreezeIdentityError("human_required", "冻结前身份仅允许已登录用户逐项审核，采集器不能补写", 403); }
async function readState(tx: Prisma.TransactionClient, review: PreFreezeReview): Promise<PreFreezeIdentityState> {
  const sites = [...new Set(review.selection.members.map(row => row.siteDomain))].sort(), topicIds = [...new Set(review.selection.members.map(row => row.topicId))];
  const [members, topics, savedSites, sources, quarter] = await Promise.all([
    tx.siteKeyword.findMany({ where: { OR: sites.map(siteDomain => ({ siteDomain, keywordId: { in: review.selection.members.filter(row => row.siteDomain === siteDomain).map(row => row.keywordId) } })) }, include: { keyword: true, topicAssignments: true }, orderBy: [{ siteDomain: "asc" }, { keywordId: "asc" }] }),
    tx.topic.findMany({ where: { id: { in: topicIds } }, include: { sites: true }, orderBy: { id: "asc" } }),
    tx.seoSite.findMany({ where: { domain: { in: sites } }, orderBy: { domain: "asc" } }),
    tx.keywordSourceRow.findMany({ where: { OR: review.assignments.map(row => ({ siteDomain: row.siteDomain, rowKey: `keyword:${row.keywordId}`, sourceId: { in: [MARKET_ASSIGNMENT_SOURCE_ID, HUMAN_WORD_LANGUAGE_SOURCE_ID] } })) }, orderBy: [{ siteDomain: "asc" }, { sourceId: "asc" }, { rowKey: "asc" }] }),
    tx.seoWorkflowRecord.findUnique({ where: { key: "growth-strategy:2026-close" } }),
  ]);
  const auditIds = [...new Set(sources.filter(row => row.sourceId === HUMAN_WORD_LANGUAGE_SOURCE_ID).flatMap(row => typeof plain(row.snapshot).auditId === "string" ? [String(plain(row.snapshot).auditId)] : []))];
  const proofAudits = auditIds.length ? await tx.keywordCurationAudit.findMany({ where: { id: { in: auditIds }, status: PRE_FREEZE_IDENTITY_AUDIT }, select: { id: true, status: true, summary: true, payloadHash: true }, orderBy: { id: "asc" } }) : [];
  return { members: members.map(member => ({ ...member, topicAssignments: [...member.topicAssignments].sort((a, b) => a.topicId.localeCompare(b.topicId)) })) as unknown as QuarterMembershipRow[],
    topics: topics.map(topic => ({ ...topic, sites: [...topic.sites].sort((a, b) => a.siteDomain.localeCompare(b.siteDomain)) })) as unknown as QuarterMembershipTopic[],
    sites: savedSites, sources, proofAudits: proofAudits.map(audit => ({ id: audit.id, status: audit.status, authorityVerified: hasHumanIdentityAudit(audit),
      summary: { approvedLanguageSources: plain(audit.summary).approvedLanguageSources } })), quarter };
}
async function lockState(tx: Prisma.TransactionClient, review: PreFreezeReview) {
  const sites = [...new Set(review.selection.members.map(row => row.siteDomain))].sort(), ids = [...new Set(review.selection.members.map(row => row.keywordId))].sort(), topics = [...new Set(review.selection.members.map(row => row.topicId))].sort();
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('flatkey-seo-workflow-v1'))`;
  await tx.$queryRaw`SELECT "key" FROM "SeoWorkflowRecord" WHERE "key"='growth-strategy:2026-close' FOR UPDATE`;
  for (const site of sites) await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`seo-import:${site}`}))`;
  for (const row of [...review.assignments].sort((a, b) => `${a.siteDomain}:${a.keywordId}`.localeCompare(`${b.siteDomain}:${b.keywordId}`))) await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`seo-market:${row.siteDomain}:${row.keywordId}`}))`;
  await tx.$queryRaw(Prisma.sql`SELECT "domain" FROM "SeoSite" WHERE "domain" IN (${Prisma.join(sites)}) ORDER BY "domain" FOR SHARE`);
  await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "Keyword" WHERE "id" IN (${Prisma.join(ids)}) ORDER BY "id" FOR UPDATE`);
  for (const site of sites) {
    const selected = review.selection.members.filter(row => row.siteDomain === site).map(row => row.keywordId).sort();
    await tx.$queryRaw(Prisma.sql`SELECT "keywordId" FROM "SiteKeyword" WHERE "siteDomain"=${site} AND "keywordId" IN (${Prisma.join(selected)}) ORDER BY "keywordId" FOR UPDATE`);
  }
  await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "Topic" WHERE "id" IN (${Prisma.join(topics)}) ORDER BY "id" FOR SHARE`);
  for (const site of sites) {
    await tx.$queryRaw(Prisma.sql`SELECT "topicId" FROM "SiteTopic" WHERE "siteDomain"=${site} AND "topicId" IN (${Prisma.join(topics)}) ORDER BY "topicId" FOR SHARE`);
    const selected = review.selection.members.filter(row => row.siteDomain === site).map(row => row.keywordId).sort();
    await tx.$queryRaw(Prisma.sql`SELECT "topicId" FROM "SiteKeywordTopic" WHERE "siteDomain"=${site} AND "keywordId" IN (${Prisma.join(selected)}) ORDER BY "keywordId","topicId" FOR UPDATE`);
  }
  for (const row of review.assignments) await tx.$queryRaw`SELECT "sourceId" FROM "KeywordSourceRow" WHERE "siteDomain"=${row.siteDomain} AND "rowKey"=${`keyword:${row.keywordId}`} AND "sourceId" IN (${MARKET_ASSIGNMENT_SOURCE_ID},${HUMAN_WORD_LANGUAGE_SOURCE_ID}) ORDER BY "sourceId" FOR UPDATE`;
}
type StoredAudit = { id: string; status: string; payloadHash: string; before: unknown; after: unknown; summary: unknown };
function replay(audit: StoredAudit, requestId: string, payloadHash?: string) {
  const summary = plain(audit.summary), receipt = plain(summary.receipt);
  if (audit.id !== identityAuditId(requestId) || audit.status !== PRE_FREEZE_IDENTITY_AUDIT || payloadHash && audit.payloadHash !== payloadHash
    || receipt.requestId !== requestId || receipt.requestHash !== audit.payloadHash || receipt.actor !== "human"
    || summary.receiptHash !== preFreezeHash(receipt) || receipt.beforeHash !== preFreezeHash(audit.before) || receipt.afterHash !== preFreezeHash(audit.after)) throw new PreFreezeIdentityError("idempotency_conflict", "原请求已用于其他身份/来源，或原审计不一致；未覆盖", 409);
  return { status: "IDENTITIES_APPLIED" as const, replay: true, receipt, auditId: audit.id, currentStateVerified: false, auditReadbackVerified: true };
}
export async function loadPreFreezeIdentityReceipt(requestId: string, actor: WorkflowActor) {
  human(actor); const audit = await prisma.keywordCurationAudit.findUnique({ where: { id: identityAuditId(requestId) } });
  if (!audit) throw new PreFreezeIdentityError("audit_missing", "尚无该原请求回执，请保留编号核对，不自动重新提交", 404);
  return replay(audit, requestId);
}
export async function savePreFreezeIdentities(raw: unknown, actor: WorkflowActor, now = new Date()) {
  human(actor); const command = preFreezeCommandSchema.parse(raw), auditId = identityAuditId(command.requestId), payloadHash = preFreezeHash(command);
  try { return await prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${auditId}))`;
    if (command.action === "apply_identities") {
      const old = await tx.keywordCurationAudit.findUnique({ where: { id: auditId } }); if (old) return replay(old, command.requestId, payloadHash);
      await lockState(tx, command.review);
    }
    const before = await readState(tx, command.review), plan = planPreFreezeIdentities(command, before, now);
    if (command.action === "preview_identities") return { status: "IDENTITIES_PREVIEW" as const, stored: false, stateHash: plan.stateHash, readbackHash: preFreezeHash(before),
      reviewHash: plan.reviewHash, selectionHash: command.review.selectionHash, results: plan.results, createSourceRows: plan.creates.length, historicalTimeUnknown: plan.historicalTimeUnknown };
    for (const source of plan.creates) await tx.keywordSourceRow.create({ data: { ...source, snapshot: json(source.snapshot) } });
    // Own new proof audit does not exist yet. Verify all protected entities and
    // old source rows, then each exact new source before committing the audit.
    const after = await readState(tx, command.review);
    const protectedState = (state: PreFreezeIdentityState) => ({ members: state.members, topics: state.topics, sites: state.sites, quarter: state.quarter });
    if (preFreezeHash(protectedState(before)) !== preFreezeHash(protectedState(after))) throw new PreFreezeIdentityError("protected_state_changed", "原词、主父、成员、话题或季度记录被改变，事务已取消", 409);
    const actual = new Map(after.sources.map(row => [identitySourceKey(row), row]));
    if (before.sources.some(row => { const value = actual.get(identitySourceKey(row)); return !value || preFreezeHash(value) !== preFreezeHash(row); }) || after.sources.length !== before.sources.length + plan.creates.length
      || plan.creates.some(row => { const value = actual.get(identitySourceKey(row)); return !value || value.snapshotHash !== row.snapshotHash || preFreezeHash(value.snapshot) !== row.snapshotHash || new Date(value.observedAt instanceof Date ? value.observedAt.getTime() : String(value.observedAt)).toISOString() !== row.observedAt.toISOString(); })) throw new PreFreezeIdentityError("source_readback_changed", "源记录读回不是缺失项只增，事务已取消", 409);
    const approvedLanguageSources = plan.creates.filter(row => row.sourceId === HUMAN_WORD_LANGUAGE_SOURCE_ID).map(row => ({ siteDomain: row.siteDomain, rowKey: row.rowKey, snapshotHash: row.snapshotHash }));
    if (approvedLanguageSources.length) after.proofAudits.push({ id: auditId, status: PRE_FREEZE_IDENTITY_AUDIT, authorityVerified: true, summary: { approvedLanguageSources } });
    after.proofAudits.sort((a, b) => a.id.localeCompare(b.id));
    const receipt = { version: "pre-freeze-identities-v1", actor: "human", requestId: command.requestId, requestHash: payloadHash,
      appliedAt: now.toISOString(), reviewHash: plan.reviewHash, selectionHash: command.review.selectionHash,
      beforeHash: preFreezeHash(before), afterHash: preFreezeHash(after), results: plan.results, createdSourceRows: plan.creates.length,
      historicalTimeUnknown: plan.historicalTimeUnknown,
      historicalTimeUnknownAcknowledged: plan.historicalTimeUnknown.length > 0 && command.historicalTimeUnknownAcknowledged === true,
      quarterPlanUnchanged: true, requiresNormalPlanRefresh: true };
    await tx.keywordCurationAudit.create({ data: { id: auditId, siteDomain: "flatkey.ai", status: PRE_FREEZE_IDENTITY_AUDIT, payloadHash,
      before: json(before), after: json(after), summary: json({ receipt, receiptHash: preFreezeHash(receipt), approvedLanguageSources }), appliedAt: now } });
    const saved = await tx.keywordCurationAudit.findUnique({ where: { id: auditId } });
    if (!saved) throw new PreFreezeIdentityError("audit_readback_missing", "原审计读回失败，事务已取消", 409);
    if (preFreezeHash(await readState(tx, command.review)) !== receipt.afterHash) throw new PreFreezeIdentityError("human_proof_readback_failed", "人审来源与原审计完整读回未对平，事务已取消", 409);
    return { ...replay(saved, command.requestId, payloadHash), replay: false, currentStateVerified: true, stateHash: preFreezeStateHash(after, command.review) };
  }, { maxWait: 10_000, timeout: 110_000, isolationLevel: Prisma.TransactionIsolationLevel.Serializable }); }
  catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && ["P2002", "P2034"].includes(error.code)) throw new PreFreezeIdentityError("state_changed", "并发源或请求已变化，事务未提交；先读原回执，不自动重试", 409);
    throw error;
  }
}
