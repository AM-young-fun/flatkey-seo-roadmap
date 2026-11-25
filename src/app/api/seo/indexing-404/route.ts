import { authorizeWorkflow, workflowErrorResponse, workflowHeaders } from "@/lib/seo-workflow-http";
import { loadIndexing404History } from "@/lib/services/seo-workflow";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { localPreview } = await authorizeWorkflow(request);
    return Response.json(await loadIndexing404History(localPreview), { headers: workflowHeaders });
  } catch (error) {
    return workflowErrorResponse(error);
  }
}
