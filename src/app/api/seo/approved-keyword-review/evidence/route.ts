import { prisma } from "@/lib/prisma";
import { authorizeWorkflow, workflowErrorResponse, workflowHeaders } from "@/lib/seo-workflow-http";
import { approvedWeeklyCaptureRunIds } from "@/lib/approved-weekly-keyword-capture";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
// Saved evidence only. No supplier client, credentials, polling or mutation path.
export async function GET(request: Request) {
  try {
    await authorizeWorkflow(request);
    const offset = Number(new URL(request.url).searchParams.get("offset") ?? 0);
    if (!Number.isInteger(offset) || offset < 0 || offset > 1500) return Response.json({ message: "无效分页" }, { status: 400, headers: workflowHeaders });
    const tasks = await prisma.serpMonitorTask.findMany({ where: { runId: { in: approvedWeeklyCaptureRunIds() } },
      orderBy: { id: "asc" }, skip: offset, take: 50,
      select: { id: true, runId: true, keyword: true, region: true, providerTaskId: true, requestJson: true, rawResponse: true, normalizedJson: true } });
    const items = tasks.map(task => {
      let raw; try { raw = object(JSON.parse(task.rawResponse ?? "null")); } catch { raw = {}; }
      const envelope = object(Array.isArray(raw.tasks) ? raw.tasks[0] : null);
      const result = object(Array.isArray(envelope.result) ? envelope.result[0] : null);
      const request = object(task.requestJson), nodes: unknown[] = [];
      function visit(value: unknown, parent: string | null = null) {
        if (Array.isArray(value)) { value.forEach(item => visit(item, parent)); return; }
        const item = object(value);
        if (typeof item.type === "string" || typeof item.url === "string") nodes.push({ type: item.type ?? null, parentType: parent,
          url: item.url ?? null, domain: item.domain ?? null, rankGroup: item.rank_group ?? null, rankAbsolute: item.rank_absolute ?? null, page: item.page ?? null });
        for (const [key, child] of Object.entries(item)) if (key !== "links" && child && typeof child === "object") visit(child, typeof item.type === "string" ? item.type : parent);
      }
      visit(result.items);
      return { id: task.id, runId: task.runId, keyword: task.keyword, country: task.region, providerTaskId: task.providerTaskId,
        request: { depth: request.depth, maxCrawlPages: request.max_crawl_pages ?? null, searchParam: request.search_param ?? null, language: request.language_code, location: request.location_code },
        providerStatus: envelope.status_code ?? null, providerMessage: envelope.status_message ?? null, providerCost: envelope.cost ?? null,
        result: { keys: Object.keys(result), keyword: result.keyword, datetime: result.datetime, pagesCount: result.pages_count,
          itemsCount: result.items_count, itemTypes: result.item_types, seResultsCount: result.se_results_count,
          checkUrl: result.check_url, spell: result.spell ?? null, nodes }, normalized: task.normalizedJson };
    });
    return Response.json({ readOnly: true, newQueries: 0, offset, nextOffset: tasks.length === 50 ? offset + 50 : null, items }, { headers: workflowHeaders });
  } catch (error) { return workflowErrorResponse(error); }
}
