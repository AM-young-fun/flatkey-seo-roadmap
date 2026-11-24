import { authorizeWorkflow, readWorkflowBody, workflowErrorResponse, workflowHeaders } from "@/lib/seo-workflow-http";
import { WorkflowError } from "@/lib/seo-workflow-state";
import { saveGrowthHotspotAdmission } from "@/lib/services/growth-hotspot-admission";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
export async function POST(request: Request) {
  try {
    const auth = await authorizeWorkflow(request, true);
    if (auth.actor !== "human") throw new WorkflowError("human_hotspot_admission_required", "只接受已登录用户同源操作；采集器不能登记额外容量", 403);
    return Response.json(await saveGrowthHotspotAdmission(await readWorkflowBody(request), auth.actor, auth.localPreview), { headers: workflowHeaders });
  } catch (error) { return workflowErrorResponse(error); }
}
