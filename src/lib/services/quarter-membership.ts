import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { canonicalQuarterSelection, planQuarterMembership, quarterMembershipCommandSchema, quarterMembershipHash, QUARTER_MEMBERSHIP_STATUS, QuarterMembershipError, type QuarterMembershipSelection, type QuarterMembershipRow, type QuarterMembershipTopic } from "../quarter-membership";
import { readAppliedQuarterManifestAudit } from "../applied-quarter-manifest";
const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
type AuditSummary = { version: "quarter-membership-v1"; requestId: string; selectionHash: string; sourceHash: string; expectedStateHash: string; afterHash: string; selection: QuarterMembershipSelection; changed: number; uniqueWords: number; membershipCount: number; actor: "human" };

async function readMembers(db: Prisma.TransactionClient, selection: QuarterMembershipSelection) {
  const sites = [...new Set(selection.members.map(row => row.siteDomain))].sort();
  const rows = await db.siteKeyword.findMany({ where: { OR: sites.map(siteDomain => ({ siteDomain, keywordId: { in: selection.members.filter(row => row.siteDomain === siteDomain).map(row => row.keywordId) } })) }, include: { keyword: { select: { id: true, text: true, active: true, updatedAt: true } }, topicAssignments: { select: { topicId: true } } }, orderBy: [{ siteDomain: "asc" }, { keywordId: "asc" }] });
  return rows.map(row => ({ ...row, topicAssignments: [...row.topicAssignments].sort((a, b) => a.topicId.localeCompare(b.topicId)) })) as unknown as QuarterMembershipRow[];
}
async function readTopics(db: Prisma.TransactionClient, selection: QuarterMembershipSelection) {
  const topics = await db.topic.findMany({ where: { id: { in: [...new Set(selection.members.map(row => row.topicId))] } }, include: { sites: { select: { siteDomain: true } } }, orderBy: { id: "asc" } });
  return topics.map(topic => ({ ...topic, sites: [...topic.sites].sort((a, b) => a.siteDomain.localeCompare(b.siteDomain)) })) as unknown as QuarterMembershipTopic[];
}
export async function loadQuarterMembership(selectionHash?: string) {
  const row = await prisma.keywordCurationAudit.findFirst({ where: { status: QUARTER_MEMBERSHIP_STATUS, ...(selectionHash ? { summary: { path: ["selectionHash"], equals: selectionHash } } : {}) }, orderBy: { appliedAt: "desc" } });
  if (!row) return { initialized: false, manifest: null };
  const summary = row.summary as unknown as AuditSummary;
  return { initialized: true, auditId: row.id, appliedAt: row.appliedAt.toISOString(), ...summary, manifest: summary.selection };
}

/** Exact original receipt and current full selected rows; never reapplies an unknown request. */
export async function loadQuarterMembershipReceipt(requestId: string) {
  return prisma.$transaction(async tx => {
    const audit = await tx.keywordCurationAudit.findUnique({ where: { id: `quarter-membership:2026-close:${requestId}` } });
    if (!audit) throw new QuarterMembershipError("audit_missing", "尚无该原成员请求回执，保留原编号核对，不自动重提", 404);
    const approved = readAppliedQuarterManifestAudit(audit);
    if (!approved || approved.requestId !== requestId) throw new QuarterMembershipError("audit_invalid", "原成员审计与确切名单不一致，未覆盖或重新提交");
    const [members, topics, sites] = await Promise.all([readMembers(tx, approved.selection), readTopics(tx, approved.selection),
      tx.seoSite.findMany({ where: { domain: { in: [...new Set(approved.selection.members.map(row => row.siteDomain))] } }, select: { domain: true, active: true } })]);
    let readbackVerified = quarterMembershipHash(members) === approved.afterHash && members.every(row => row.pool === "FORMAL")
      && approved.selection.members.every(row => sites.some(site => site.domain === row.siteDomain && site.active));
    try { planQuarterMembership({ action: "preview", requestId, selection: approved.selection, selectionHash: approved.selectionHash }, members, topics); }
    catch (error) { if (error instanceof QuarterMembershipError) readbackVerified = false; else throw error; }
    return { status: "APPLIED" as const, actor: approved.actor, requestId: approved.requestId, auditId: approved.auditId, appliedAt: approved.appliedAt,
      selectionHash: approved.selectionHash, sourceHash: approved.sourceHash, expectedStateHash: approved.expectedStateHash, afterHash: approved.afterHash,
      changed: approved.changed, uniqueWords: approved.uniqueWords, membershipCount: approved.membershipCount, manifest: approved.selection, readbackVerified };
  }, { maxWait: 10_000, timeout: 90_000, isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
}

/** Public SEO library metadata only. Never changes words, market evidence, tasks or unselected members. */
export async function saveQuarterMembership(raw: unknown) {
  const command = quarterMembershipCommandSchema.parse(raw), selection = canonicalQuarterSelection(command.selection);
  const selectionHash = quarterMembershipHash(selection), auditId = `quarter-membership:2026-close:${command.requestId}`;
  const payloadHash = quarterMembershipHash(command);
  return prisma.$transaction(async tx => {
    for (const site of [...new Set(selection.members.map(row => row.siteDomain))].sort()) await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`seo-import:${site}`}))`;
    const audit = command.action === "apply" ? await tx.keywordCurationAudit.findUnique({ where: { id: auditId } }) : null;
    if (audit) {
      if (audit.status !== QUARTER_MEMBERSHIP_STATUS || audit.payloadHash !== payloadHash) throw new QuarterMembershipError("idempotency_conflict", "同一请求编号已用于其他季度清单或版本");
      const summary = audit.summary as unknown as AuditSummary;
      const rows = await readMembers(tx, selection);
      if (quarterMembershipHash(rows) !== summary.afterHash) throw new QuarterMembershipError("readback_changed", "原审批已应用，但成员此后已变化；保留原审计，不覆盖后续修改");
      return { status: "APPLIED", replay: true, auditId, ...summary, manifest: summary.selection, readbackVerified: true };
    }
    const [rows, topics] = await Promise.all([readMembers(tx, selection), readTopics(tx, selection)]);
    const plan = planQuarterMembership(command, rows, topics);
    if (command.action === "preview") return { status: "PREVIEW", stored: false, selectionHash: plan.selectionHash, stateHash: plan.stateHash, uniqueWords: plan.uniqueWords, membershipCount: plan.membershipCount, changed: plan.changes.length, changes: plan.changes, manifest: plan.selection };
    const sites = await tx.seoSite.findMany({ where: { domain: { in: [...new Set(selection.members.map(row => row.siteDomain))] } }, select: { domain: true, active: true } });
    if (selection.members.some(member => !sites.some(site => site.domain === member.siteDomain && site.active))) throw new QuarterMembershipError("inactive_site", "所选站点尚未启用");
    for (const change of plan.changes) {
      const before = rows.find(row => row.siteDomain === change.siteDomain && row.keywordId === change.keywordId)!;
      const changed = await tx.siteKeyword.updateMany({ where: { siteDomain: change.siteDomain, keywordId: change.keywordId, active: true, pool: "RESEARCH", topicId: before.topicId, protected: before.protected as boolean, reviewStatus: before.reviewStatus as string, curationId: before.curationId as string | null, targetUrls: { equals: before.targetUrls as string[] }, candidateUrls: { equals: before.candidateUrls as string[] }, keyword: { active: true } }, data: { pool: "FORMAL" } });
      if (changed.count !== 1) throw new QuarterMembershipError("state_changed", "纳入期间成员状态发生变化，事务已取消");
    }
    const after = await readMembers(tx, selection);
    const expected = rows.map(row => ({ ...row, pool: "FORMAL" }));
    if (quarterMembershipHash(after) !== quarterMembershipHash(expected)) throw new QuarterMembershipError("readback_failed", "季度成员完整读回与预期不一致，事务已取消");
    const summary: AuditSummary = { version: "quarter-membership-v1", requestId: command.requestId, selectionHash, sourceHash: selection.sourceHash, expectedStateHash: command.expectedStateHash, afterHash: quarterMembershipHash(after), selection, changed: plan.changes.length, uniqueWords: 1600, membershipCount: selection.members.length, actor: "human" };
    await tx.keywordCurationAudit.create({ data: { id: auditId, siteDomain: "flatkey.ai", payloadHash, status: QUARTER_MEMBERSHIP_STATUS, before: json({ members: rows, topics }), after: json({ members: after, topics }), summary: json(summary) } });
    const readback = await tx.keywordCurationAudit.findUnique({ where: { id: auditId } });
    if (!readback || readback.payloadHash !== payloadHash || quarterMembershipHash(readback.after) !== quarterMembershipHash(json({ members: after, topics }))) throw new QuarterMembershipError("audit_readback_failed", "季度审计存储读回不一致，事务已取消");
    return { status: "APPLIED", replay: false, auditId, ...summary, manifest: selection, readbackVerified: true };
  }, { maxWait: 10_000, timeout: 90_000, isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
}
