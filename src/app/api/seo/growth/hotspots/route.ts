import { authorizeWorkflow, workflowErrorResponse, workflowHeaders } from "@/lib/seo-workflow-http";
import { loadGrowthHotspotView } from "@/lib/services/growth-hotspots";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
/** Saved-evidence read only. There is deliberately no mutation/provider edge. */
export async function GET(request: Request) {
  try {
    const auth = await authorizeWorkflow(request);
    if (new URL(request.url).searchParams.size) return Response.json({ message: "热点投影仅读取当前原始研究与任务，不接受改写参数" }, { status: 400, headers: workflowHeaders });
    return Response.json(await loadGrowthHotspotView(auth.localPreview), { headers: workflowHeaders });
  } catch (error) { return workflowErrorResponse(error); }
}
