import { authorizeWorkflow, readWorkflowBody, workflowErrorResponse, workflowHeaders } from "@/lib/seo-workflow-http";
import { WorkflowError } from "@/lib/seo-workflow-state";
import { loadWeeklySupplement, saveWeeklySupplement } from "@/lib/services/seo-weekly-supplement";
import { weeklySupplementInput } from "@/lib/seo-weekly-supplement";

export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    const auth = await authorizeWorkflow(request);
    const reportId = weeklySupplementInput.shape.reportId.parse(new URL(request.url).searchParams.get("reportId"));
    return Response.json({ supplement: await loadWeeklySupplement(reportId, auth.localPreview), editable: auth.actor === "human" }, { headers: workflowHeaders });
  } catch (error) { return workflowErrorResponse(error); }
}
export async function POST(request: Request) {
  try {
    const auth = await authorizeWorkflow(request, true);
    if (auth.actor !== "human") throw new WorkflowError("human_only", "请登录后填写补充说明", 403);
    const input = weeklySupplementInput.parse(await readWorkflowBody(request));
    return Response.json({ supplement: await saveWeeklySupplement(input, auth.localPreview) }, { headers: workflowHeaders });
  } catch (error) { return workflowErrorResponse(error); }
}
