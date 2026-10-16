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
    if (plan.memberships.length) {
      const updates = plan.memberships.map(({ before, after }) => ({
        keywordId: before.keywordId, keywordText: before.keyword.text,
        beforeActive: before.active, beforePool: before.pool, beforeReviewStatus: before.reviewStatus,
        beforeCurationId: before.curationId, beforeCuratedAt: before.curatedAt, beforeMappingStatus: before.mappingStatus,
        beforeTargetUrls: before.targetUrls, beforeCandidateUrls: before.candidateUrls, beforeTopicId: before.topicId,
        beforeProtected: before.protected, beforeAuditReason: before.auditReason,
        mappingStatus: after.mappingStatus, targetUrls: after.targetUrls, candidateUrls: after.candidateUrls, auditReason: after.auditReason,
      }));
      // Bind the whole batch as JSON, retaining every per-member optimistic
      // condition. A partial match throws below and rolls back the transaction.
      const changed = await transaction.$queryRaw<Array<{ keywordId: string }>>(Prisma.sql`
        /* page-audit:update-memberships */
        WITH changes AS (
          SELECT * FROM jsonb_to_recordset(${JSON.stringify(updates)}::jsonb) AS d(
            "keywordId" text, "keywordText" text, "beforeActive" boolean, "beforePool" text,
            "beforeReviewStatus" text, "beforeCurationId" text, "beforeCuratedAt" timestamp,
            "beforeMappingStatus" text, "beforeTargetUrls" text[], "beforeCandidateUrls" text[],
            "beforeTopicId" text, "beforeProtected" boolean, "beforeAuditReason" text,
            "mappingStatus" text, "targetUrls" text[], "candidateUrls" text[], "auditReason" text
          )
        )
        UPDATE "SiteKeyword" AS m
        SET "mappingStatus" = d."mappingStatus", "targetUrls" = d."targetUrls",
          "candidateUrls" = d."candidateUrls", "auditReason" = d."auditReason"
        FROM changes AS d, "Keyword" AS k
        WHERE m."siteDomain" = ${"flatkey.ai"} AND m."keywordId" = d."keywordId"
          AND m.active = d."beforeActive" AND m.pool = d."beforePool"
          AND m."reviewStatus" = d."beforeReviewStatus"
          AND m."curationId" IS NOT DISTINCT FROM d."beforeCurationId"
          AND m."curatedAt" IS NOT DISTINCT FROM d."beforeCuratedAt"
          AND m."mappingStatus" = d."beforeMappingStatus"
          AND m."targetUrls" = d."beforeTargetUrls" AND m."candidateUrls" = d."beforeCandidateUrls"
          AND m."topicId" IS NOT DISTINCT FROM d."beforeTopicId"
          AND m.protected = d."beforeProtected"
          AND m."auditReason" IS NOT DISTINCT FROM d."beforeAuditReason"
          AND k.id = m."keywordId" AND k.active = true AND k.text = d."keywordText"
        RETURNING m."keywordId"
      `);
      if (changed.length !== plan.memberships.length) throw new ImportRequestError("复核期间人工页面配置发生变化，本批事务已取消，请重新预览", 409);
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
