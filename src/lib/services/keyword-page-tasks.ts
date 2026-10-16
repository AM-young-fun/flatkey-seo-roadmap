import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ImportRequestError } from "@/lib/ranking-import";
import { normalizeKeywordText } from "@/lib/keyword-relevance";
import { readPageAuditVerdict } from "@/lib/keyword-monitoring";
import { keywordWorkPlanSchema, PAGE_AUDIT_SOURCE_ID } from "@/lib/page-audit";
import { buildPageTaskMerge, PAGE_TASK_PLAN_ID, type PageTaskRow, type PageTaskWorkItem, type PageTaskMergeResult } from "@/lib/keyword-page-tasks";

export type PageTaskMergeInput = { siteDomain: "flatkey.ai"; action: "preview" | "apply"; expectedStateHash?: string };

export async function mergeKeywordPageTasks(input: PageTaskMergeInput): Promise<PageTaskMergeResult> {
  if (input.siteDomain !== "flatkey.ai") throw new ImportRequestError("页面任务合并仅适用于已审核的 Flatkey 清单", 400);
  return prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"seo-import:flatkey.ai"}))`;
    const site = await tx.seoSite.findUnique({ where: { domain: input.siteDomain } });
    if (!site?.active) throw new ImportRequestError("Flatkey 网站未启用", 400);
    const members = await tx.siteKeyword.findMany({ where: { siteDomain: input.siteDomain, pool: "FORMAL", active: true },
      select: { keywordId: true, keyword: { select: { text: true } } }, orderBy: { keywordId: "asc" } });
    const memberMap = new Map(members.map(row => [row.keywordId, row.keyword.text]));
    const snapshots = members.length ? await tx.keywordSourceRow.findMany({ where: { siteDomain: input.siteDomain, sourceId: PAGE_AUDIT_SOURCE_ID,
      rowKey: { in: members.map(row => `keyword:${row.keywordId}`) } }, select: { rowKey: true, snapshot: true } }) : [];
    const items: PageTaskWorkItem[] = [];
    for (const row of snapshots) {
      const keywordId = row.rowKey.slice("keyword:".length), keyword = memberMap.get(keywordId);
      const snapshot = row.snapshot && typeof row.snapshot === "object" && !Array.isArray(row.snapshot) ? row.snapshot as Record<string, unknown> : {};
      if (!keyword || (snapshot.keywordId !== undefined && snapshot.keywordId !== keywordId)) continue;
      const plan = keywordWorkPlanSchema.safeParse(snapshot.workPlan);
      if (!plan.success || plan.data.action === "LINK") continue;
      const expected = { EXPAND: "CONTENT_GAP", BUILD: "NO_MATCH" } as const;
      if (readPageAuditVerdict(snapshot) !== expected[plan.data.action]) throw new ImportRequestError(`关键词“${keyword}”的页面核验和工作清单不一致，请先复核`, 409);
      if (typeof snapshot.keyword === "string" && normalizeKeywordText(snapshot.keyword) !== normalizeKeywordText(keyword)) throw new ImportRequestError("页面任务的关键词身份发生变化，请重新核对", 409);
      items.push({ ...plan.data, keyword, keywordId });
    }
    if (!items.length) throw new ImportRequestError("当前没有经过核验的待补充或待建设工作清单", 409);
    const stored = await tx.keywordContentTask.findMany({ where: { siteDomain: input.siteDomain }, orderBy: { id: "asc" } });
    const before: PageTaskRow[] = stored.map(row => ({ id: row.id, plannedUrl: row.plannedUrl, type: row.type, status: row.status, title: row.title,
      reason: row.reason, keywords: row.keywords, targetUrls: row.targetUrls, owner: row.owner, dueAt: row.dueAt?.toISOString() ?? null }));
    const plan = buildPageTaskMerge(before, items);
    if (input.action === "apply") {
      if (plan.conflicts.length) throw new ImportRequestError(`页面任务尚有冲突：${plan.conflicts.slice(0, 3).join("；")}`, 409);
      if (plan.changes.length && input.expectedStateHash !== plan.stateHash) throw new ImportRequestError("页面任务或关键词清单已变化，请重新预览后合并", 409);
      if (plan.changes.length) {
        const existing = new Set(stored.map(row => row.id));
        const create = plan.changes.filter(row => !existing.has(row.id));
        if (create.length) await tx.keywordContentTask.createMany({ data: create.map(row => ({ ...row, dueAt: row.dueAt ? new Date(row.dueAt) : null, siteDomain: input.siteDomain, auditId: PAGE_TASK_PLAN_ID })) });
        const update = plan.changes.filter(row => existing.has(row.id));
        if (update.length) {
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
        const rowKey = `${PAGE_TASK_PLAN_ID}:${plan.stateHash}`;
        await tx.keywordSourceRow.create({ data: { siteDomain: input.siteDomain, sourceId: "page_task_merge", rowKey,
          snapshotHash: plan.stateHash, snapshot: { version: PAGE_TASK_PLAN_ID, summary: plan.summary, before,
            after: plan.after, assignments: plan.tasks.map(row => ({ id: row.id, plannedUrl: row.plannedUrl, keywords: row.workPlans.map(item => item.keyword) })) } as unknown as Prisma.InputJsonValue } });
      }
    }
    return { siteDomain: input.siteDomain, action: input.action, status: input.action === "preview" ? "PREVIEW" : "APPLIED",
      stateHash: plan.stateHash, summary: plan.summary, conflicts: plan.conflicts, tasks: plan.tasks };
  }, { timeout: 55_000, maxWait: 5000 });
}
