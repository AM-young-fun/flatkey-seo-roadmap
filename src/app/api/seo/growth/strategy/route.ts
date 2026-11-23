import { authorizeWorkflow, readWorkflowBody, workflowErrorResponse, workflowHeaders } from "@/lib/seo-workflow-http";
import { GrowthStrategyError } from "@/lib/growth-strategy";
import { loadGrowthStrategyView, saveGrowthStrategy } from "@/lib/services/growth-strategy";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try { const auth = await authorizeWorkflow(request); return Response.json(await loadGrowthStrategyView(auth.localPreview), { headers: workflowHeaders }); }
  catch (error) { return response(error); }
}
export async function POST(request: Request) {
  try { const auth = await authorizeWorkflow(request, true); return Response.json(await saveGrowthStrategy(await readWorkflowBody(request), auth.actor, auth.localPreview), { headers: workflowHeaders }); }
  catch (error) { return response(error); }
}
function response(error: unknown) {
  return error instanceof GrowthStrategyError ? Response.json({ code: error.code, message: error.message }, { status: error.status, headers: workflowHeaders }) : workflowErrorResponse(error);
}
