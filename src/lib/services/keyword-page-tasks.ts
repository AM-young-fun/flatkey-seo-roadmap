import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ImportRequestError } from "@/lib/ranking-import";
import { normalizeKeywordText } from "@/lib/keyword-relevance";
import { readPageAuditVerdict } from "@/lib/keyword-monitoring";
import { isAuditPageForSite, keywordWorkPlanSchema, pageAuditDomainSchema, PAGE_AUDIT_SOURCE_ID, type PageAuditDomain } from "@/lib/page-audit";
import { buildPageTaskMerge, PAGE_TASK_PLAN_ID, type PageTaskRow, type PageTaskWorkItem, type PageTaskMergeResult } from "@/lib/keyword-page-tasks";

export type PageTaskMergeInput = { siteDomain: PageAuditDomain; action: "preview" | "apply"; expectedStateHash?: string };
const failureStages = new WeakMap<object, string>();
export function pageTaskMergeFailureStage(error: unknown): string | null {
  return error && typeof error === "object" ? failureStages.get(error) ?? null : null;
}

export async function mergeKeywordPageTasks(input: PageTaskMergeInput): Promise<PageTaskMergeResult> {
  if (!pageAuditDomainSchema.safeParse(input.siteDomain).success) throw new ImportRequestError("页面任务网站无效", 400);
  const planId = input.siteDomain === "flatkey.ai" ? PAGE_TASK_PLAN_ID : `${input.siteDomain}-page-work-plans-v1`;
  let stage = "LOCK";
  try { return await prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`seo-import:${input.siteDomain}`}))`;
    stage = "READ_SITE";
    const site = await tx.seoSite.findUnique({ where: { domain: input.siteDomain } });
    if (!site?.active) throw new ImportRequestError("本次合并的网站未启用", 400);
    stage = "READ_MEMBERS";
    const members = await tx.siteKeyword.findMany({ where: { siteDomain: input.siteDomain, active: true,
      ...(input.siteDomain === "flatkey.ai" ? { pool: "FORMAL" } : { topicId: { not: null }, keyword: { active: true } }) },
      select: { keywordId: true, keyword: { select: { text: true } } }, orderBy: { keywordId: "asc" } });
    const memberMap = new Map(members.map(row => [row.keywordId, row.keyword.text]));
    stage = "READ_WORK_PLANS";
    const snapshots = members.length ? await tx.keywordSourceRow.findMany({ where: { siteDomain: input.siteDomain, sourceId: PAGE_AUDIT_SOURCE_ID,
      rowKey: { in: members.map(row => `keyword:${row.keywordId}`) } }, select: { rowKey: true, snapshot: true } }) : [];
    const items: PageTaskWorkItem[] = [];
    for (const row of snapshots) {
      const keywordId = row.rowKey.slice("keyword:".length), keyword = memberMap.get(keywordId);
      const snapshot = row.snapshot && typeof row.snapshot === "object" && !Array.isArray(row.snapshot) ? row.snapshot as Record<string, unknown> : {};
      if (!keyword || (snapshot.keywordId !== undefined && snapshot.keywordId !== keywordId)) continue;
      const plan = keywordWorkPlanSchema.safeParse(snapshot.workPlan);
      if (!plan.success || plan.data.action === "LINK") continue;
      const urls = [...plan.data.pageUrls, plan.data.previousPageUrl, plan.data.plannedPageUrl].filter((url): url is string => typeof url === "string");
      if (urls.some(url => !isAuditPageForSite(url, input.siteDomain)) || (input.siteDomain !== "flatkey.ai" && plan.data.action === "BUILD" && !plan.data.plannedPageUrl)) throw new ImportRequestError(`关键词“${keyword}”的规划页面不属于本站或尚未明确，请先复核`, 409);
      const expected = { EXPAND: "CONTENT_GAP", BUILD: "NO_MATCH" } as const;
      if (readPageAuditVerdict(snapshot) !== expected[plan.data.action]) throw new ImportRequestError(`关键词“${keyword}”的页面核验和工作清单不一致，请先复核`, 409);
      if (typeof snapshot.keyword === "string" && normalizeKeywordText(snapshot.keyword) !== normalizeKeywordText(keyword)) throw new ImportRequestError("页面任务的关键词身份发生变化，请重新核对", 409);
      items.push({ ...plan.data, keyword, keywordId });
    }
    if (!items.length) throw new ImportRequestError("当前没有经过核验的待补充或待建设工作清单", 409);
    stage = "READ_TASKS";
    const stored = await tx.keywordContentTask.findMany({ where: { siteDomain: input.siteDomain }, orderBy: { id: "asc" } });
    const before: PageTaskRow[] = stored.map(row => ({ id: row.id, plannedUrl: row.plannedUrl, type: row.type, status: row.status, title: row.title,
      reason: row.reason, keywords: row.keywords, targetUrls: row.targetUrls, owner: row.owner, dueAt: row.dueAt?.toISOString() ?? null }));
    stage = "PLAN";
    const plan = buildPageTaskMerge(before, items, planId);
    if (input.action === "apply") {
      if (plan.conflicts.length) throw new ImportRequestError(`页面任务尚有冲突：${plan.conflicts.slice(0, 3).join("；")}`, 409);
      if (plan.changes.length && input.expectedStateHash !== plan.stateHash) throw new ImportRequestError("页面任务或关键词清单已变化，请重新预览后合并", 409);
      if (plan.changes.length) {
        const existing = new Set(stored.map(row => row.id));
        const create = plan.changes.filter(row => !existing.has(row.id));
        if (create.length) {
          // The additive production schema enforces this FK even though the
          // current Prisma model has no relation field. Create its dedicated
          // audit parent inside the same transaction before inserting tasks.
          stage = "CREATE_TASK_AUDIT";
          const originalParent = await tx.keywordCurationAudit.findUnique({ where: { id: planId } });
          const taskPayloadHash = createHash("sha256").update(JSON.stringify({ version: planId, items: [...items].sort((a, b) => a.keywordId.localeCompare(b.keywordId)) })).digest("hex");
          if (originalParent && (originalParent.siteDomain !== input.siteDomain || originalParent.status !== "PAGE_TASK_PLAN" || !/^[a-f0-9]{64}$/.test(originalParent.payloadHash))) throw new ImportRequestError("页面任务审计编号或已审核清单发生冲突，未保存任务", 409);
          // New reviewed work can extend a previous plan. Preserve its audit
          // parent and record a new batch instead of refusing future pages.
          const auditId = originalParent && originalParent.payloadHash !== taskPayloadHash ? `${planId}:${taskPayloadHash.slice(0, 20)}` : planId;
          const parent = auditId === planId ? originalParent : await tx.keywordCurationAudit.findUnique({ where: { id: auditId } });
          if (parent && (parent.siteDomain !== input.siteDomain || parent.status !== "PAGE_TASK_PLAN" || parent.payloadHash !== taskPayloadHash)) throw new ImportRequestError("页面任务审计编号或已审核清单发生冲突，未保存任务", 409);
          if (!parent) await tx.keywordCurationAudit.create({ data: { id: auditId, siteDomain: input.siteDomain, status: "PAGE_TASK_PLAN",
            payloadHash: taskPayloadHash, before: [], after: [],
            summary: { kind: "page-task-plan", ...plan.summary } as unknown as Prisma.InputJsonValue } });
          stage = "CREATE_TASKS";
          await tx.keywordContentTask.createMany({ data: create.map(row => ({ ...row, dueAt: row.dueAt ? new Date(row.dueAt) : null, siteDomain: input.siteDomain, auditId })) });
        }
        const update = plan.changes.filter(row => existing.has(row.id));
        if (update.length) {
          stage = "UPDATE_TASKS";
          // The common site advisory lock serializes this with imports and
          // page audits; updatedAt guards protect future task-editor writes too.
          const expectedUpdates = update.map(row => ({ ...row, expectedUpdatedAt: stored.find(old => old.id === row.id)!.updatedAt.toISOString() }));
          const count = await tx.$executeRaw(Prisma.sql`
            /* keyword-page-tasks:merge-existing */
            UPDATE "KeywordContentTask" AS t SET "plannedUrl" = d."plannedUrl", type = d.type, status = d.status,
              title = d.title, reason = d.reason, keywords = d.keywords, "targetUrls" = d."targetUrls", owner = d.owner, "dueAt" = d."dueAt", "updatedAt" = NOW()
            FROM jsonb_to_recordset(${JSON.stringify(expectedUpdates)}::jsonb) AS d(id text, "plannedUrl" text, type text, status text,
              title text, reason text, keywords text[], "targetUrls" text[], owner text, "dueAt" timestamp, "expectedUpdatedAt" timestamptz)
            WHERE t.id = d.id AND t."siteDomain" = ${input.siteDomain} AND t."updatedAt" = d."expectedUpdatedAt"
          `);
          if (count !== update.length) throw new ImportRequestError("页面任务刚被其他操作修改，本次合并已取消，请重新预览", 409);
        }
        // Keep the exact prior task fields, including owners and progress, in
        // an append-only source snapshot. No keyword or page audit is mutated.
        const rowKey = `${planId}:${plan.stateHash}`;
        stage = "WRITE_RECOVERY";
        await tx.keywordSourceRow.create({ data: { siteDomain: input.siteDomain, sourceId: "page_task_merge", rowKey,
          snapshotHash: plan.stateHash, snapshot: { version: planId, summary: plan.summary, before,
            after: plan.after, assignments: plan.tasks.map(row => ({ id: row.id, plannedUrl: row.plannedUrl, keywords: row.workPlans.map(item => item.keyword) })) } as unknown as Prisma.InputJsonValue } });
      }
    }
    return { siteDomain: input.siteDomain, action: input.action, status: input.action === "preview" ? "PREVIEW" : "APPLIED",
      stateHash: plan.stateHash, summary: plan.summary, conflicts: plan.conflicts, tasks: plan.tasks };
  }, { timeout: 55_000, maxWait: 5000 }); }
  catch (error) { if (error && typeof error === "object") failureStages.set(error, stage); throw error; }
}
