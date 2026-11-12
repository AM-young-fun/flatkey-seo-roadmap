import { workflowWeekSchema, pageBelongsToSite, WORKFLOW_SITES } from "@/lib/seo-workflow";
import { WorkflowError } from "@/lib/seo-workflow-state";
import { authorizeWorkflow, readWorkflowBody, workflowErrorResponse, workflowHeaders } from "@/lib/seo-workflow-http";
import { loadWorkflowSnapshot, saveWorkflowMutation } from "@/lib/services/seo-workflow";

export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    const auth = await authorizeWorkflow(request), params = new URL(request.url).searchParams;
    const week = params.get("week") ?? "current", pageUrl = params.get("pageUrl") ?? undefined;
    if (!["current", "next", "latest"].includes(week)) workflowWeekSchema.parse(week);
    if (pageUrl) { let valid = false; try { valid = WORKFLOW_SITES.some(site => pageBelongsToSite(pageUrl, site)); } catch { /* Invalid URL. */ } if (!valid) throw new WorkflowError("invalid_page", "请选择五站正式 HTTPS 页面", 400); }
    const snapshot = await loadWorkflowSnapshot({ week, pageUrl, allHistory: params.get("allHistory") === "true" }, auth.localPreview);
    return Response.json({ ...snapshot, capabilities: { promptPublication: 1 } }, { headers: workflowHeaders });
  } catch (error) { return workflowErrorResponse(error); }
}
export async function POST(request: Request) {
  try { const auth = await authorizeWorkflow(request, true); return Response.json(await saveWorkflowMutation(await readWorkflowBody(request), auth.actor, auth.localPreview), { headers: workflowHeaders }); }
  catch (error) { return workflowErrorResponse(error); }
}
