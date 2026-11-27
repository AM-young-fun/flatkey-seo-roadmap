import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { latestClosedLa7DayRange } from "@/lib/seo-date-range";
import { coreKeywordArchiveKind, coreKeywordArchiveSchema } from "@/lib/seo-core-keyword-evidence";
import { authorizeWorkflow, readWorkflowBody, workflowErrorResponse, workflowHeaders } from "@/lib/seo-workflow-http";
import { WorkflowError, workflowHash } from "@/lib/seo-workflow-state";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const auth = await authorizeWorkflow(request, true);
    if (auth.localPreview) throw new WorkflowError("local_preview", "本地预览不写入生产来源", 403);
    const archive = coreKeywordArchiveSchema.parse(await readWorkflowBody(request, 32768));
    const now = new Date(), observedAt = new Date(archive.observedAt);
    if (archive.end > latestClosedLa7DayRange(now).end || observedAt.getTime() > now.getTime()) {
      throw new WorkflowError("future_evidence", "只能归档已结束日期的实际 Search Console 来源", 422);
    }
    const saved = await prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${coreKeywordArchiveKind}))`;
      const where = { kind_date: { kind: coreKeywordArchiveKind, date: archive.end } };
      const previous = await tx.seoAnalyticsDay.findUnique({ where });
      if (previous && previous.observedAt >= observedAt) {
        if (workflowHash(previous.payload) === workflowHash(archive)) return coreKeywordArchiveSchema.parse(previous.payload);
        throw new WorkflowError("source_conflict", "同一窗口已有更新或同观测时刻不同正文", 409);
      }
      const data = { observedAt, complete: true, payload: archive as Prisma.InputJsonValue };
      await tx.seoAnalyticsDay.upsert({ where, create: { ...where.kind_date, ...data }, update: data });
      const readBack = await tx.seoAnalyticsDay.findUniqueOrThrow({ where });
      if (workflowHash(readBack.payload) !== workflowHash(archive)) throw new WorkflowError("readback_failed", "核心词来源读回不一致", 503);
      return coreKeywordArchiveSchema.parse(readBack.payload);
    });
    return Response.json({ stored: true, archive: saved }, { headers: workflowHeaders });
  } catch (error) { return workflowErrorResponse(error); }
}
