import { z } from "zod";
import { displayDataChanged } from "@/lib/services/display-change";
import { applyReservedOriginalKeyword, loadReservedOriginalReceipt } from "@/lib/services/reserved-original-keyword";
import { authorizeWorkflow, readWorkflowBody, workflowErrorResponse, workflowHeaders } from "@/lib/seo-workflow-http";
import { WorkflowError } from "@/lib/seo-workflow-state";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  try {
    const { localPreview } = await authorizeWorkflow(request);
    if (localPreview) throw new WorkflowError("production_required", "此入库回执仅保存于生产", 403);
    const { searchParams } = new URL(request.url);
    const taskId = z.string().min(1).max(200).parse(searchParams.get("taskId"));
    const requestId = z.string().regex(/^[a-zA-Z0-9:_-]{8,160}$/).parse(searchParams.get("requestId"));
    return Response.json(await loadReservedOriginalReceipt(taskId, requestId), { headers: workflowHeaders });
  } catch (error) { return workflowErrorResponse(error); }
}

export async function POST(request: Request) {
  try {
    const { actor, localPreview } = await authorizeWorkflow(request, true);
    if (localPreview) throw new WorkflowError("production_required", "此原词入库仅可使用生产入口", 403);
    const result = await applyReservedOriginalKeyword(await readWorkflowBody(request, 4096), actor);
    if (!result.replay) await displayDataChanged();
    return Response.json(result, { headers: workflowHeaders });
  } catch (error) { return workflowErrorResponse(error); }
}
