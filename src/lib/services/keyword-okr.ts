import { createHash, randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { retryDatabaseRead } from "@/lib/database-read";
import { loadLatestPageAudits } from "@/lib/services/keyword-page-audit-state";
import { normalizeKeywordText } from "@/lib/keyword-relevance";
import { pageTaskWorkDetails, type PageTaskWorkItem } from "@/lib/keyword-page-tasks";
import { ImportRequestError } from "@/lib/ranking-import";
import { KEYWORD_OKR_AUDIT_ID, type KeywordOkrMutation, type KeywordOkrMutationResponse, type KeywordOkrResponse, type KeywordOkrItem } from "@/lib/keyword-okr";
import { OKR_SITE, okrAudit, buildCurationPlan, restoredCuration, summarizeCuration, type CurationState, type CurationKeyword } from "@/lib/keyword-okr-curation";

const payloadHash = createHash("sha256").update(JSON.stringify(okrAudit)).digest("hex");
const auditInfo = { id: KEYWORD_OKR_AUDIT_ID, asOf: okrAudit.asOf, formalKeywords: okrAudit.keywords.length, tasks: okrAudit.tasks.length };
const iso = (value: Date | string | null | undefined) => value == null ? null : new Date(value).toISOString();

async function readState(tx: Prisma.TransactionClient, pool?: "FORMAL" | "RESEARCH"): Promise<CurationState[]> {
  const rows = await tx.siteKeyword.findMany({ where: { siteDomain: OKR_SITE, ...(pool ? { pool, active: true, keyword: { active: true } } : {}) }, include: { keyword: { select: { text: true } } }, orderBy: { keywordId: "asc" } });
  return rows.map(row => ({
    keywordId: row.keywordId, text: row.keyword.text, active: row.active, topicId: row.topicId, origin: row.origin,
    targetUrls: row.targetUrls, pool: row.pool as CurationState["pool"], reviewStatus: row.reviewStatus,
    mappingStatus: row.mappingStatus as CurationState["mappingStatus"], candidateUrls: row.candidateUrls,
    auditReason: row.auditReason, protected: row.protected, curatedAt: iso(row.curatedAt), curationId: row.curationId,
    exclusionReason: row.exclusionReason, excludedAt: iso(row.excludedAt), restoredAt: iso(row.restoredAt),
  }));
}

type RelationState = { keywordTopics: Array<{ keywordId: string; topicId: string }>; siteTopics: string[] };
async function readRelations(tx: Prisma.TransactionClient): Promise<RelationState> {
  const [keywordTopics, siteTopics] = await Promise.all([
    tx.siteKeywordTopic.findMany({ where: { siteDomain: OKR_SITE }, select: { keywordId: true, topicId: true } }),
    tx.siteTopic.findMany({ where: { siteDomain: OKR_SITE }, select: { topicId: true } }),
  ]);
  return { keywordTopics: keywordTopics.sort((a, b) => `${a.keywordId}:${a.topicId}`.localeCompare(`${b.keywordId}:${b.topicId}`)), siteTopics: siteTopics.map(row => row.topicId).sort() };
}
async function restoreRelations(tx: Prisma.TransactionClient, metadata: unknown) {
  const snapshots = metadata as { relationSnapshots?: { before: RelationState; after: RelationState } };
  if (!snapshots.relationSnapshots) throw new ImportRequestError("缺少话题关联恢复快照，请核对审计记录", 409);
  const { before, after } = snapshots.relationSnapshots;
  const current = await readRelations(tx);
  const relationKey = (value: RelationState) => JSON.stringify({ keywordTopics: value.keywordTopics.map(row => `${row.keywordId}:${row.topicId}`).sort(), siteTopics: [...value.siteTopics].sort() });
  if (relationKey(current) !== relationKey(after)) throw new ImportRequestError("审计后话题关联已变化，不能覆盖后续修改", 409);
  const beforeKeys = new Set(before.keywordTopics.map(row => `${row.keywordId}:${row.topicId}`));
  const created = after.keywordTopics.filter(row => !beforeKeys.has(`${row.keywordId}:${row.topicId}`));
  if (created.length) await tx.siteKeywordTopic.deleteMany({ where: { siteDomain: OKR_SITE, OR: created } });
  const createdSiteTopics = after.siteTopics.filter(id => !before.siteTopics.includes(id));
  if (createdSiteTopics.length) await tx.siteTopic.deleteMany({ where: { siteDomain: OKR_SITE, topicId: { in: createdSiteTopics } } });
}

async function writeState(tx: Prisma.TransactionClient, rows: CurationState[]) {
  if (!rows.length) return;
  // A single typed JSON parameter avoids PostgreSQL's bind-parameter limit and
  // keeps the entire site review atomic, including thousands of research rows.
  await tx.$executeRaw(Prisma.sql`
    /* keyword-okr:write-memberships */
    INSERT INTO "SiteKeyword" ("siteDomain", "keywordId", active, "topicId", origin, "targetUrls", pool,
      "reviewStatus", "mappingStatus", "candidateUrls", "auditReason", protected, "curatedAt", "curationId",
      "exclusionReason", "excludedAt", "restoredAt")
    SELECT ${OKR_SITE}, d."keywordId", d.active, d."topicId", d.origin, d."targetUrls", d.pool,
      d."reviewStatus", d."mappingStatus", d."candidateUrls", d."auditReason", d.protected,
      d."curatedAt", d."curationId", d."exclusionReason", d."excludedAt", d."restoredAt"
    FROM jsonb_to_recordset(${JSON.stringify(rows)}::jsonb) AS d("keywordId" text, active boolean, "topicId" text,
      origin text, "targetUrls" text[], pool text, "reviewStatus" text, "mappingStatus" text, "candidateUrls" text[],
      "auditReason" text, protected boolean, "curatedAt" timestamp, "curationId" text,
      "exclusionReason" text, "excludedAt" timestamp, "restoredAt" timestamp)
    ON CONFLICT ("siteDomain", "keywordId") DO UPDATE SET active = EXCLUDED.active, "topicId" = EXCLUDED."topicId",
      origin = EXCLUDED.origin, "targetUrls" = EXCLUDED."targetUrls", pool = EXCLUDED.pool,
      "reviewStatus" = EXCLUDED."reviewStatus", "mappingStatus" = EXCLUDED."mappingStatus", "candidateUrls" = EXCLUDED."candidateUrls",
      "auditReason" = EXCLUDED."auditReason", protected = EXCLUDED.protected, "curatedAt" = EXCLUDED."curatedAt",
      "curationId" = EXCLUDED."curationId", "exclusionReason" = EXCLUDED."exclusionReason", "excludedAt" = EXCLUDED."excludedAt", "restoredAt" = EXCLUDED."restoredAt"
  `);
}

async function knownKeywords(tx: Prisma.TransactionClient): Promise<CurationKeyword[]> {
  const texts = okrAudit.keywords.map(row => normalizeKeywordText(row.text));
  return tx.$queryRaw<CurationKeyword[]>(Prisma.sql`/* keyword-okr:known-keywords */ SELECT id, text, "topicId", active FROM "Keyword" WHERE lower(text) IN (${Prisma.join(texts)}) OR id IN (SELECT "keywordId" FROM "SiteKeyword" WHERE "siteDomain" = ${OKR_SITE})`);
}

export async function mutateKeywordOkr(input: KeywordOkrMutation): Promise<KeywordOkrMutationResponse> {
  if (input.siteDomain !== OKR_SITE || input.auditId !== KEYWORD_OKR_AUDIT_ID) throw new ImportRequestError("仅允许应用本轮已审核的 Flatkey 清单", 400);
  return prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`seo-import:${OKR_SITE}`}))`;
    const site = await tx.seoSite.findUnique({ where: { domain: OKR_SITE } });
    if (!site?.active) throw new ImportRequestError("Flatkey 网站未启用", 400);
    const priorAudit = await tx.keywordCurationAudit.findUnique({ where: { id: input.auditId } });
    if (priorAudit && (priorAudit.siteDomain !== OKR_SITE || priorAudit.payloadHash !== payloadHash)) throw new ImportRequestError("审计编号与清单内容冲突", 409);
    const before = await readState(tx);
    if (input.action === "restore") {
      if (!priorAudit) throw new ImportRequestError("本轮审计尚未应用", 409);
      if (priorAudit.status === "RESTORED") return { siteDomain: OKR_SITE, auditId: input.auditId, action: input.action, status: "RESTORED", changed: 0, unchanged: true, summary: summarizeCuration(before), rankingCaptureEnabled: false };
      let restored: CurationState[];
      try { restored = restoredCuration(priorAudit.before as unknown as CurationState[], priorAudit.after as unknown as CurationState[], before, new Date().toISOString()); }
      catch (error) { throw new ImportRequestError(error instanceof Error ? error.message : "恢复冲突", 409); }
      // Content work done after the audit must never be silently overwritten.
      const changedTasks = await tx.keywordContentTask.count({ where: { auditId: input.auditId, OR: [{ status: { not: "TODO" } }, { owner: { not: null } }, { dueAt: { not: null } }] } });
      if (changedTasks) throw new ImportRequestError("审计后内容任务已更新，不能覆盖后续修改", 409);
      await restoreRelations(tx, priorAudit.summary);
      await writeState(tx, restored);
      await tx.keywordContentTask.updateMany({ where: { auditId: input.auditId, siteDomain: OKR_SITE }, data: { status: "RESTORED" } });
      await tx.keywordCurationAudit.update({ where: { id: input.auditId }, data: { status: "RESTORED", restoredAt: new Date() } });
      return { siteDomain: OKR_SITE, auditId: input.auditId, action: input.action, status: "RESTORED", changed: restored.length, unchanged: false, summary: summarizeCuration(restored), rankingCaptureEnabled: false };
    }
    if (priorAudit?.status === "APPLIED") return { siteDomain: OKR_SITE, auditId: input.auditId, action: input.action, status: "APPLIED", changed: 0, unchanged: true, summary: summarizeCuration(before), rankingCaptureEnabled: false };
    if (priorAudit?.status === "RESTORED") throw new ImportRequestError("此批次已恢复；重新整理需要新的审计版本", 409);
    let keywords = await knownKeywords(tx);
    const formalTexts = new Set(okrAudit.keywords.map(row => normalizeKeywordText(row.text)));
    const inactive = keywords.filter(row => row.active === false && formalTexts.has(normalizeKeywordText(row.text)));
    if (inactive.length) throw new ImportRequestError(`正式目标中有 ${inactive.length} 个全局停用词，需先单独审核：${inactive.slice(0, 10).map(row => row.text).join("、")}`, 409);
    const now = new Date().toISOString();
    if (input.action === "preview") {
      const plan = buildCurationPlan(before, keywords, { formal: "preview-formal", model: "preview-model" }, now);
      return { siteDomain: OKR_SITE, auditId: input.auditId, action: input.action, status: "PREVIEW", changed: plan.length, unchanged: false, summary: summarizeCuration(plan), rankingCaptureEnabled: false };
    }
    const beforeRelations = await readRelations(tx);
    const formalTopic = await tx.topic.upsert({ where: { text: "SEO正式目标（待分组）" }, create: { text: "SEO正式目标（待分组）", type: "MAIN" }, update: {} });
    const modelTopic = await tx.topic.upsert({ where: { text: "模型详情目标" }, create: { text: "模型详情目标", type: "MAIN" }, update: {} });
    await tx.siteTopic.createMany({ data: [formalTopic, modelTopic].map(topic => ({ siteDomain: OKR_SITE, topicId: topic.id })), skipDuplicates: true });
    const known = new Set([...keywords.map(row => normalizeKeywordText(row.text)), ...before.map(row => normalizeKeywordText(row.text))]);
    const missing = okrAudit.keywords.filter(row => !known.has(normalizeKeywordText(row.text)));
    if (missing.length) await tx.keyword.createMany({ data: missing.map(row => ({ id: randomUUID(), text: normalizeKeywordText(row.text), type: "MAIN" as const, active: true })), skipDuplicates: true });
    keywords = await knownKeywords(tx);
    const after = buildCurationPlan(before, keywords, { formal: formalTopic.id, model: modelTopic.id }, now);
    if (after.some(row => row.keywordId.startsWith("new:"))) throw new ImportRequestError("正式目标创建不完整，事务已取消", 409);
    const summary = summarizeCuration(after);
    if (summary.formal !== 1512 || summary.protectedModels !== 95 || summary.mapping.READY !== 42) throw new ImportRequestError("审核清单数量校验失败，事务已取消", 409);
    await tx.keywordCurationAudit.create({ data: { id: input.auditId, siteDomain: OKR_SITE, payloadHash, before: before as unknown as Prisma.InputJsonValue, after: after as unknown as Prisma.InputJsonValue, summary: summary as unknown as Prisma.InputJsonValue } });
    await writeState(tx, after);
    const assigned = after.filter(row => row.pool === "FORMAL" && row.topicId);
    await tx.siteKeywordTopic.createMany({ data: assigned.map(row => ({ siteDomain: OKR_SITE, keywordId: row.keywordId, topicId: row.topicId! })), skipDuplicates: true });
    await tx.siteTopic.createMany({ data: [...new Set(assigned.map(row => row.topicId!))].map(topicId => ({ siteDomain: OKR_SITE, topicId })), skipDuplicates: true });
    const afterRelations = await readRelations(tx);
    await tx.keywordCurationAudit.update({ where: { id: input.auditId }, data: { summary: { ...summary, relationSnapshots: { before: beforeRelations, after: afterRelations } } as unknown as Prisma.InputJsonValue } });
    await tx.keywordContentTask.createMany({ data: okrAudit.tasks.map(row => ({
      id: `${input.auditId}:page:${row.number}`, siteDomain: OKR_SITE, auditId: input.auditId,
      plannedUrl: row.plannedUrl, type: row.type, status: "TODO", title: row.title,
      reason: okrAudit.reasons[row.reason], keywords: row.keywords, targetUrls: row.targetUrls,
    })) });
    return { siteDomain: OKR_SITE, auditId: input.auditId, action: input.action, status: "APPLIED", changed: after.length, unchanged: false, summary, rankingCaptureEnabled: false };
  }, { timeout: 55_000, maxWait: 5000 });
}

export async function loadKeywordOkr(siteDomain: string, pool?: "FORMAL" | "RESEARCH"): Promise<KeywordOkrResponse> {
  if (siteDomain !== OKR_SITE) throw new ImportRequestError("当前正式目标审计仅适用于 Flatkey", 400);
  return retryDatabaseRead(() => readKeywordOkr(siteDomain, pool));
}

async function readKeywordOkr(siteDomain: string, pool?: "FORMAL" | "RESEARCH"): Promise<KeywordOkrResponse> {
  type AuditSummary = { id: string; status: string; appliedAt: Date; restoredAt: Date | null; changed: number };
  // Before/after payloads contain the entire site inventory. Count in PostgreSQL
  // so viewing audit history never transfers multi-megabyte recovery snapshots.
  const audits = await prisma.$queryRaw<AuditSummary[]>(Prisma.sql`
    /* keyword-okr:audit-summaries */
    SELECT id, status, "appliedAt", "restoredAt",
      CASE WHEN jsonb_typeof("after") = 'array' THEN jsonb_array_length("after") ELSE 0 END AS changed
    FROM "KeywordCurationAudit" WHERE "siteDomain" = ${siteDomain} AND status <> 'PAGE_TASK_PLAN'
    ORDER BY "appliedAt" DESC, id DESC LIMIT 10
  `);
  const initialized = audits.some(row => row.status === "APPLIED");
  const rows = initialized ? await readState(prisma, pool) : [];
  const pageAudits = await loadLatestPageAudits(rows.map(row => row.keywordId));
  const tasks = initialized && !pool ? (await prisma.keywordContentTask.findMany({ where: { siteDomain, status: { notIn: ["RESTORED", "MERGED"] } }, orderBy: { id: "asc" } })).filter(row => !["RESTORED", "MERGED"].includes(row.status)) : [];
  const workItems: PageTaskWorkItem[] = rows.flatMap(row => {
    const plan = pageAudits.get(row.keywordId)?.workPlan;
    return row.active && row.pool === "FORMAL" && plan ? [{ ...plan, keyword: row.text, keywordId: row.keywordId }] : [];
  });
  type PageRow = { keywordId: string; url: string; source: string; region: string; periodStart: Date | null; periodEnd: Date | null; collectedAt: Date; rank: number | null };
  const pages = initialized ? await prisma.$queryRaw<PageRow[]>(Prisma.sql`
    /* keyword-okr:observed-pages */
    SELECT DISTINCT ON ("keywordId", source, region, url) "keywordId", url, source, region,
      "periodStart", "periodEnd", "collectedAt", rank
    FROM "KeywordPageObservation" WHERE "siteDomain" = ${siteDomain} AND source IN ('gsc','ahrefs')
      ${pool ? Prisma.sql`AND "keywordId" IN (SELECT "keywordId" FROM "SiteKeyword" WHERE "siteDomain" = ${siteDomain} AND pool = ${pool} AND active = true)` : Prisma.empty}
    ORDER BY "keywordId", source, region, url, "periodEnd" DESC NULLS LAST, "collectedAt" DESC
  `) : [];
  const byKeyword = new Map<string, KeywordOkrItem["actualPages"]>();
  for (const row of pages) {
    const prior = byKeyword.get(row.keywordId) ?? [];
    if (prior.length >= 8) continue;
    prior.push({ url: row.url, source: row.source, region: row.region, periodStart: iso(row.periodStart)?.slice(0, 10) ?? null, periodEnd: iso(row.periodEnd)?.slice(0, 10) ?? null, collectedAt: iso(row.collectedAt)!, rank: row.rank });
    byKeyword.set(row.keywordId, prior);
  }
  const summary = summarizeCuration(rows);
  // The summary reflects stored task rows. A pristine database must not claim
  // that bundled content tasks or formal keyword memberships were applied.
  summary.tasks = {};
  for (const task of tasks) summary.tasks[task.type] = (summary.tasks[task.type] ?? 0) + 1;
  return {
    siteDomain, initialized, rankingCaptureEnabled: false, availableAudit: auditInfo, summary,
    keywords: rows.map(row => ({ id: row.keywordId, text: row.text, siteDomain, active: row.active, pool: row.pool,
      reviewStatus: row.reviewStatus, mappingStatus: row.mappingStatus, targetUrls: row.targetUrls, candidateUrls: row.candidateUrls,
      reason: pageAudits.get(row.keywordId)?.reason ?? row.auditReason ?? row.exclusionReason, protected: row.protected, auditedAt: row.curatedAt, auditId: row.curationId,
      latestPageAuditVerdict: pageAudits.get(row.keywordId)?.verdict ?? null, latestPageAuditReason: pageAudits.get(row.keywordId)?.reason ?? null,
      latestPageAuditCheckedAt: pageAudits.get(row.keywordId)?.checkedAt ?? null,
      workPlan: pageAudits.get(row.keywordId)?.workPlan ?? null,
      actualPages: byKeyword.get(row.keywordId) ?? [],
    })),
    tasks: tasks.map(row => ({ id: row.id, plannedUrl: row.plannedUrl, type: row.type as "NEW" | "EXPAND" | "REUSE", status: row.status,
      title: row.title, reason: row.reason, keywords: row.keywords, targetUrls: row.targetUrls, owner: row.owner, dueAt: iso(row.dueAt),
      ...pageTaskWorkDetails(row, workItems) })),
    audits: audits.map(row => ({ id: row.id, status: row.status, appliedAt: iso(row.appliedAt)!, restoredAt: iso(row.restoredAt), changed: row.changed })),
  };
}
