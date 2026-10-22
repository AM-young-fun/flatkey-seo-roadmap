import { createHash, randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { reviewCandidateKeyword, type CandidateReviewPreview } from "@/lib/candidate-keyword-review";
import { keywordBusiness } from "@/lib/keyword-business";
import { loadCloudGpuKeywordTexts } from "@/lib/services/keyword-business";
import { ImportRequestError } from "@/lib/ranking-import";

const siteDomain = "flatkey.ai" as const;
async function readCandidates(tx: Prisma.TransactionClient) {
  return tx.siteKeyword.findMany({ where: { siteDomain, pool: "RESEARCH", active: true, keyword: { active: true } },
    select: { keywordId: true, pool: true, active: true, protected: true, reviewStatus: true, exclusionReason: true, excludedAt: true,
      keyword: { select: { text: true } } }, orderBy: { keywordId: "asc" } });
}
function preview(rows: Awaited<ReturnType<typeof readCandidates>>): CandidateReviewPreview {
  const reviewed = rows.map(row => ({ id: row.keywordId, text: row.keyword.text, protected: row.protected, ...reviewCandidateKeyword(row.keyword.text, row.protected) }));
  return { siteDomain, stateHash: createHash("sha256").update(JSON.stringify({ rows, reviewed })).digest("hex"), total: rows.length,
    suggested: reviewed.filter(row => row.kind !== "KEEP").length, rows: reviewed };
}
export async function loadCandidateReview() {
  const [candidates, cloudKeywords] = await Promise.all([readCandidates(prisma), loadCloudGpuKeywordTexts()]);
  const plan = preview(candidates);
  return { ...plan, rows: plan.rows.map(row => ({ ...row, businessCategory: keywordBusiness({siteDomain, text:row.text}, cloudKeywords) })) };
}

export async function applyCandidateReview(keywordIds: string[], expectedStateHash: string) {
  return prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`seo-import:${siteDomain}`}))`;
    const before = await readCandidates(tx), plan = preview(before);
    if (plan.stateHash !== expectedStateHash) throw new ImportRequestError("候选词库已变化，请重新预览后再移除", 409);
    const selected = new Set(keywordIds), changes = plan.rows.filter(row => selected.has(row.id));
    if (changes.length !== selected.size || changes.some(row => row.protected)) throw new ImportRequestError("所选词已不在候选池或属于保护词，请重新预览", 409);
    const at = new Date(), auditId = `candidate-review:${randomUUID()}`;
    const records = changes.map(row => ({ keywordId: row.id, reason: row.kind === "KEEP" ? "人工候选筛检：人工选择移出候选池" : `${row.kind}：${row.reason}` }));
    const changed = await tx.$executeRaw(Prisma.sql`
      UPDATE "SiteKeyword" sk SET active = false, pool = 'ARCHIVED', "reviewStatus" = 'CANDIDATE_REVIEW_ARCHIVED',
        "excludedAt" = ${at}, "exclusionReason" = d.reason
      FROM jsonb_to_recordset(${JSON.stringify(records)}::jsonb) AS d("keywordId" text, reason text)
      WHERE sk."siteDomain" = ${siteDomain} AND sk."keywordId" = d."keywordId" AND sk.pool = 'RESEARCH' AND sk.active = true AND sk.protected = false
    `);
    if (changed !== records.length) throw new ImportRequestError("候选词状态已变化，本次未应用，请重新预览", 409);
    await tx.keywordCurationAudit.create({ data: { id: auditId, siteDomain, status: "CANDIDATE_CLEANUP",
      payloadHash: createHash("sha256").update(JSON.stringify(records)).digest("hex"), before: JSON.parse(JSON.stringify(before.filter(row => selected.has(row.keywordId)))) as Prisma.InputJsonValue,
      after: records as unknown as Prisma.InputJsonValue, summary: { checked: plan.total, archived: changed, stateHash: expectedStateHash } } });
    return { siteDomain, auditId, changed, remaining: plan.total - changed, records, appliedAt: at.toISOString() };
  }, { timeout: 55_000, maxWait: 5000 });
}
