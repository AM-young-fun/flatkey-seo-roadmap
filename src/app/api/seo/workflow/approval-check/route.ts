import { authorizeWorkflow, readWorkflowBody, workflowErrorResponse, workflowHeaders } from "@/lib/seo-workflow-http";
import { checkWorkflowApprovalRequest } from "@/lib/services/seo-workflow";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  try { const auth = await authorizeWorkflow(request, true); return Response.json(await checkWorkflowApprovalRequest(await readWorkflowBody(request), auth.localPreview), { headers: workflowHeaders }); }
  catch (error) { return workflowErrorResponse(error); }
}
