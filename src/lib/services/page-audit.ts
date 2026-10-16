import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ImportRequestError } from "@/lib/ranking-import";
import { normalizeKeywordText } from "@/lib/keyword-relevance";
import { retryDatabaseRead } from "@/lib/database-read";
import { PAGE_AUDIT_SOURCE_ID, type PageAuditPayload, type PageAuditResult } from "@/lib/page-audit";
import { planKeywordPageAudit, type PageAuditMembership, type PageAuditSourceState } from "@/lib/page-audit-plan";

const failureStages = new WeakMap<object, string>();
export function pageAuditFailureStage(error: unknown): string | null {
  return error && typeof error === "object" ? failureStages.get(error) ?? null : null;
}

export async function auditKeywordPages(payload: PageAuditPayload): Promise<PageAuditResult> {
  const inspect = () => runKeywordPageAudit(payload);
  return payload.action === "preview" ? retryDatabaseRead(inspect) : inspect();
}

async function runKeywordPageAudit(payload: PageAuditPayload): Promise<PageAuditResult> {
  let stage = "OPEN_TRANSACTION";
  try { return await prisma.$transaction(async transaction => {
    // A preview never writes, so it need not wait on the daily source-sync
    // writer. Apply re-reads everything under the site lock and verifies the
    // preview state hash before changing any membership or evidence.
    if (payload.action === "apply") {
      stage = "LOCK_SITE";
      await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`seo-import:${payload.targetDomain}`}))`;
    }
    stage = "READ_SITE";
    const site = await transaction.seoSite.findUnique({ where: { domain: payload.targetDomain } });
    if (!site?.active) throw new ImportRequestError("本次审核的网站未启用", 400);
    const membershipWhere = { siteDomain: payload.targetDomain, active: true, keyword: { active: true },
      ...(payload.targetDomain === "flatkey.ai" ? { pool: "FORMAL" } : { topicId: { not: null } }) };
    stage = "READ_IDENTITIES";
    const identities = await transaction.siteKeyword.findMany({ where: membershipWhere,
      select: { keywordId: true, keyword: { select: { text: true, active: true } } } });
    const incoming = new Set(payload.rows.map(row => normalizeKeywordText(row.keyword)));
    const keywordIds = identities.filter(link => incoming.has(normalizeKeywordText(link.keyword.text))).map(link => link.keywordId);
    stage = "READ_MEMBERSHIPS";
    const relevant: PageAuditMembership[] = keywordIds.length ? await transaction.siteKeyword.findMany({ where: { ...membershipWhere, keywordId: { in: keywordIds } },
      select: { keywordId: true, keyword: { select: { text: true, active: true } }, active: true, pool: true, reviewStatus: true,
        curationId: true, curatedAt: true, targetUrls: true, candidateUrls: true, mappingStatus: true, topicId: true, protected: true, auditReason: true } }) : [];
    stage = "READ_EVIDENCE";
    const priorRows: PageAuditSourceState[] = relevant.length ? await transaction.keywordSourceRow.findMany({ where: { siteDomain: payload.targetDomain, sourceId: PAGE_AUDIT_SOURCE_ID,
      rowKey: { in: relevant.map(link => `keyword:${link.keywordId}`) } }, select: { rowKey: true, snapshotHash: true, snapshot: true, observedAt: true } }) : [];
    stage = "PLAN";
    const plan = planKeywordPageAudit(payload, priorRows, relevant);
    if (payload.action === "preview" || plan.result.duplicate) return plan.result;
    if (plan.memberships.length) {
      stage = "UPDATE_MEMBERSHIPS";
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
        WHERE m."siteDomain" = ${payload.targetDomain} AND m."keywordId" = d."keywordId"
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
    const snapshots = plan.snapshots.map(({ rowKey, snapshot, hash }) => ({ siteDomain: payload.targetDomain, sourceId: PAGE_AUDIT_SOURCE_ID, rowKey,
      snapshotHash: hash, snapshot: snapshot as unknown as Prisma.InputJsonValue, observedAt: new Date(snapshot.checkedAt) }));
    const initialSnapshots = snapshots.filter(row => !priorKeys.has(row.rowKey));
    // All writers for this site share the transaction lock. Do not skip a
    // uniqueness conflict: it must roll back the member changes for re-preview.
    if (initialSnapshots.length) {
      stage = "INSERT_EVIDENCE";
      await transaction.keywordSourceRow.createMany({ data: initialSnapshots });
    }
    const existingSnapshots = snapshots.filter(row => priorKeys.has(row.rowKey)).map(row => ({
      rowKey: row.rowKey, snapshotHash: row.snapshotHash, snapshot: row.snapshot,
      observedAt: row.observedAt.toISOString(), previousHash: priorRows.find(prior => prior.rowKey === row.rowKey)!.snapshotHash,
    }));
    if (existingSnapshots.length) {
      stage = "UPDATE_EVIDENCE";
      const count = await transaction.$executeRaw(Prisma.sql`
        /* page-audit:update-evidence */
        UPDATE "KeywordSourceRow" AS s SET "snapshotHash" = d."snapshotHash", snapshot = d.snapshot,
          "observedAt" = d."observedAt", "updatedAt" = NOW()
        FROM jsonb_to_recordset(${JSON.stringify(existingSnapshots)}::jsonb) AS d(
          "rowKey" text, "snapshotHash" text, snapshot jsonb, "observedAt" timestamptz, "previousHash" text
        )
        WHERE s."siteDomain" = ${payload.targetDomain} AND s."sourceId" = ${PAGE_AUDIT_SOURCE_ID}
          AND s."rowKey" = d."rowKey" AND s."snapshotHash" = d."previousHash"
      `);
      if (count !== existingSnapshots.length) throw new ImportRequestError("复核期间页面证据发生变化，本批事务已取消，请重新预览", 409);
    }
    stage = "COMMIT";
    return plan.result;
  }, { timeout: payload.action === "preview" ? 20_000 : 50_000, maxWait: 5000 }); }
  catch (error) { if (error && typeof error === "object") failureStages.set(error, stage); throw error; }
}
