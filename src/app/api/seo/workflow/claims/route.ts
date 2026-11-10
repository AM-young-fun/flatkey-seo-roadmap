import { authorizeWorkflow, readWorkflowBody, workflowErrorResponse, workflowHeaders } from "@/lib/seo-workflow-http";
import { mutateWorkflowClaim } from "@/lib/services/seo-workflow";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  try { await authorizeWorkflow(request, true); return Response.json(await mutateWorkflowClaim(await readWorkflowBody(request)), { headers: workflowHeaders }); }
  catch (error) { return workflowErrorResponse(error); }
}
