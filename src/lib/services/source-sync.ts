import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { normalizeKeywordText } from "@/lib/keyword-relevance";
import { ImportRequestError } from "@/lib/ranking-import";
import { planSourceSync, sourceSyncDocumentUrl, type SourceState, type SyncKeyword, type SyncMembership } from "@/lib/source-sync-plan";
import type { SourceSyncPayload, SourceSyncResult } from "@/lib/source-sync";

export async function syncKeywordSources(payload: SourceSyncPayload): Promise<SourceSyncResult> {
  return prisma.$transaction(async transaction => {
    // Match the import/review/curation lock. Recompute from current state even
    // after a preview, rather than replaying stale membership mutations.
    await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"seo-import:flatkey.ai"}))`;
    const site = await transaction.seoSite.findUnique({ where: { domain: "flatkey.ai" } });
    if (!site?.active) throw new ImportRequestError("Flatkey网站未启用", 400);
    const priorRows = payload.rows.length ? await transaction.keywordSourceRow.findMany({
      where: { siteDomain: "flatkey.ai", sourceId: payload.sourceId, rowKey: { in: payload.rows.map(row => row.rowKey.normalize("NFKC").trim()) } },
      select: { rowKey: true, snapshotHash: true, snapshot: true, observedAt: true },
    }) as SourceState[] : [];
    // Inventory is small and keyword.text is case-sensitive unique. Read only
    // identity/activation fields once so Unicode aliases cannot create a second
    // global keyword merely because a SQL lower() lookup missed NFKC variants.
    const allKeywords: SyncKeyword[] = payload.rows.length ? await transaction.keyword.findMany({ select: { id: true, text: true, active: true } }) : [];
    const incoming = new Set(payload.rows.flatMap(row => row.keywords.map(word => normalizeKeywordText(word.keyword))));
    const keywords = allKeywords.filter(keyword => incoming.has(normalizeKeywordText(keyword.text)));
    const links: SyncMembership[] = keywords.length ? await transaction.siteKeyword.findMany({ where: { siteDomain: "flatkey.ai", keywordId: { in: keywords.map(keyword => keyword.id) } },
      select: { keywordId: true, active: true, pool: true, reviewStatus: true, curationId: true, curatedAt: true,
        targetUrls: true, candidateUrls: true, mappingStatus: true, topicId: true, protected: true },
    }) : [];
    const plan = planSourceSync(payload, priorRows, keywords, links);
    // No empty RankingImport, timestamp refresh, metrics or cleanup is written.
    if (payload.action === "preview" || !plan.snapshots.length) return plan.result;
    const known = new Map(keywords.map(keyword => [normalizeKeywordText(keyword.text), keyword.id]));
    if (plan.newKeywords.length) {
      const created = plan.newKeywords.map(keyword => ({ id: randomUUID(), ...keyword, active: true }));
      await transaction.keyword.createMany({ data: created });
      for (const keyword of created) known.set(keyword.text, keyword.id);
    }
    const additions = plan.memberships.filter(change => change.create);
    const promotions = plan.memberships.filter(change => !change.create && !change.verifyExisting);
    const verifications = plan.memberships.filter(change => change.verifyExisting);
    if (additions.length) {
      const topic = await transaction.topic.upsert({ where: { text: "协作表新增目标" }, create: { text: "协作表新增目标", type: "MAIN" }, update: {} });
      await transaction.siteTopic.createMany({ data: [{ siteDomain: "flatkey.ai", topicId: topic.id }], skipDuplicates: true });
      await transaction.siteKeyword.createMany({ data: additions.map(change => ({ siteDomain: "flatkey.ai", keywordId: change.keywordId ?? known.get(change.normalized)!, topicId: topic.id,
        origin: "PLANNED", active: true, pool: change.pool, reviewStatus: change.reviewStatus,
        mappingStatus: change.pool === "FORMAL" ? "READY" : "UNMAPPED", targetUrls: change.pageUrl ? [change.pageUrl] : [],
        sourceUrl: sourceSyncDocumentUrl(payload.sourceId), auditReason: change.reason, protected: change.protected,
      })) });
      await transaction.siteKeywordTopic.createMany({ data: additions.map(change => ({ siteDomain: "flatkey.ai", keywordId: change.keywordId ?? known.get(change.normalized)!, topicId: topic.id })), skipDuplicates: true });
    }
    const linkById = new Map(links.map(link => [link.keywordId, link]));
    for (const change of promotions) {
      const before = linkById.get(change.keywordId!)!;
      const changed = await transaction.siteKeyword.updateMany({ where: { siteDomain: "flatkey.ai", keywordId: change.keywordId!, active: true, pool: "RESEARCH",
        reviewStatus: before.reviewStatus, curationId: before.curationId, mappingStatus: before.mappingStatus,
        targetUrls: { equals: before.targetUrls }, candidateUrls: { equals: before.candidateUrls }, keyword: { active: true },
      }, data: { pool: "FORMAL", reviewStatus: "SOURCE_CONFIRMED", mappingStatus: "READY",
        // Filling the first verified page is allowed; replacing any existing
        // page association is never part of a daily source sync.
        ...(change.fillInitialPage ? { targetUrls: [change.pageUrl!] } : {}),
      } });
      if (changed.count !== 1) throw new ImportRequestError("同步期间人工审核状态发生变化，本批事务已取消，请重新预览", 409);
    }
    for (const change of verifications) {
      const before = linkById.get(change.keywordId!)!;
      const changed = await transaction.siteKeyword.updateMany({ where: { siteDomain: "flatkey.ai", keywordId: change.keywordId!, active: before.active,
        pool: before.pool, reviewStatus: before.reviewStatus, curationId: before.curationId, curatedAt: before.curatedAt,
        mappingStatus: before.mappingStatus, targetUrls: { equals: before.targetUrls }, candidateUrls: { equals: before.candidateUrls },
        topicId: before.topicId, protected: before.protected, keyword: { active: true },
      }, data: { mappingStatus: "READY" } });
      if (changed.count !== 1) throw new ImportRequestError("同步期间人工审核状态发生变化，本批事务已取消，请重新预览", 409);
    }
    const priorObserved = new Map(priorRows.map(row => [row.rowKey, row.observedAt]));
    for (const { row, hash } of plan.snapshots) {
      const observedAt = payload.collectedAt ? new Date(payload.collectedAt) : priorObserved.get(row.rowKey) ?? null;
      await transaction.keywordSourceRow.upsert({
      where: { siteDomain_sourceId_rowKey: { siteDomain: "flatkey.ai", sourceId: payload.sourceId, rowKey: row.rowKey } },
      create: { siteDomain: "flatkey.ai", sourceId: payload.sourceId, rowKey: row.rowKey, snapshotHash: hash, snapshot: row as unknown as Prisma.InputJsonValue, observedAt },
      update: { snapshotHash: hash, snapshot: row as unknown as Prisma.InputJsonValue, observedAt },
      });
    }
    return plan.result;
  }, { timeout: 55_000, maxWait: 5000 });
}
