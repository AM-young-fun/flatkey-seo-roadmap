import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ImportRequestError } from "@/lib/ranking-import";
import { normalizeKeywordText } from "@/lib/keyword-relevance";
import { PAGE_AUDIT_SOURCE_ID, type PageAuditPayload, type PageAuditResult } from "@/lib/page-audit";
import { planKeywordPageAudit, type PageAuditMembership, type PageAuditSourceState } from "@/lib/page-audit-plan";

export async function auditKeywordPages(payload: PageAuditPayload): Promise<PageAuditResult> {
  return prisma.$transaction(async transaction => {
    await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"seo-import:flatkey.ai"}))`;
    const site = await transaction.seoSite.findUnique({ where: { domain: "flatkey.ai" } });
    if (!site?.active) throw new ImportRequestError("Flatkey网站未启用", 400);
    const identities = await transaction.siteKeyword.findMany({ where: { siteDomain: "flatkey.ai", active: true, pool: "FORMAL", keyword: { active: true } },
      select: { keywordId: true, keyword: { select: { text: true, active: true } } } });
    const incoming = new Set(payload.rows.map(row => normalizeKeywordText(row.keyword)));
    const keywordIds = identities.filter(link => incoming.has(normalizeKeywordText(link.keyword.text))).map(link => link.keywordId);
    const relevant: PageAuditMembership[] = keywordIds.length ? await transaction.siteKeyword.findMany({ where: { siteDomain: "flatkey.ai", active: true, pool: "FORMAL", keyword: { active: true }, keywordId: { in: keywordIds } },
      select: { keywordId: true, keyword: { select: { text: true, active: true } }, active: true, pool: true, reviewStatus: true,
        curationId: true, curatedAt: true, targetUrls: true, candidateUrls: true, mappingStatus: true, topicId: true, protected: true, auditReason: true } }) : [];
    const priorRows: PageAuditSourceState[] = relevant.length ? await transaction.keywordSourceRow.findMany({ where: { siteDomain: "flatkey.ai", sourceId: PAGE_AUDIT_SOURCE_ID,
      rowKey: { in: relevant.map(link => `keyword:${link.keywordId}`) } }, select: { rowKey: true, snapshotHash: true, snapshot: true, observedAt: true } }) : [];
    const plan = planKeywordPageAudit(payload, priorRows, relevant);
    if (payload.action === "preview" || plan.result.duplicate) return plan.result;
    for (const { before, after } of plan.memberships) {
      const changed = await transaction.siteKeyword.updateMany({ where: { siteDomain: "flatkey.ai", keywordId: before.keywordId, active: before.active, pool: before.pool,
        reviewStatus: before.reviewStatus, curationId: before.curationId, curatedAt: before.curatedAt, mappingStatus: before.mappingStatus,
        targetUrls: { equals: before.targetUrls }, candidateUrls: { equals: before.candidateUrls }, topicId: before.topicId,
        protected: before.protected, auditReason: before.auditReason, keyword: { active: true, text: before.keyword.text },
      }, data: after });
      if (changed.count !== 1) throw new ImportRequestError("复核期间人工页面配置发生变化，本批事务已取消，请重新预览", 409);
    }
    const priorKeys = new Set(priorRows.map(row => row.rowKey));
    const snapshots = plan.snapshots.map(({ rowKey, snapshot, hash }) => ({ siteDomain: "flatkey.ai", sourceId: PAGE_AUDIT_SOURCE_ID, rowKey,
      snapshotHash: hash, snapshot: snapshot as unknown as Prisma.InputJsonValue, observedAt: new Date(snapshot.checkedAt) }));
    const initialSnapshots = snapshots.filter(row => !priorKeys.has(row.rowKey));
    // All writers for this site share the transaction lock. Do not skip a
    // uniqueness conflict: it must roll back the member changes for re-preview.
    if (initialSnapshots.length) await transaction.keywordSourceRow.createMany({ data: initialSnapshots });
    for (const row of snapshots.filter(row => priorKeys.has(row.rowKey))) {
      const { siteDomain, sourceId, rowKey, ...data } = row;
      await transaction.keywordSourceRow.upsert({ where: { siteDomain_sourceId_rowKey: { siteDomain, sourceId, rowKey } },
        create: row, update: data });
    }
    return plan.result;
  }, { timeout: 55_000, maxWait: 5000 });
}
