import { authorizeWorkflow, readWorkflowBody, workflowErrorResponse, workflowHeaders } from "@/lib/seo-workflow-http";
import { GrowthStrategyError } from "@/lib/growth-strategy";
import { withRequestReads } from "@/lib/request-read-scope";
import { loadGrowthStrategyOverview, loadGrowthStrategyView, saveGrowthStrategy } from "@/lib/services/growth-strategy";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    const auth = await authorizeWorkflow(request);
    const overview = new URL(request.url).searchParams.get("view") === "overview";
    const view = await withRequestReads(async () => overview
      ? loadGrowthStrategyOverview(auth.localPreview)
      : loadGrowthStrategyView(auth.localPreview));
    return Response.json(view, { headers: workflowHeaders });
  }
  catch (error) { return response(error); }
}
export async function POST(request: Request) {
  try {
    const auth = await authorizeWorkflow(request, true), command = await readWorkflowBody(request);
    const saved = await saveGrowthStrategy(command, auth.actor, auth.localPreview);
    let hotspotAdmission: unknown;
    if (auth.actor === "human" && command && typeof command === "object" && "action" in command && command.action === "decide_direction" && "decision" in command && command.decision === "approve" && "directionId" in command && typeof command.directionId === "string" && "revision" in command && typeof command.revision === "number") {
      try { const { admitApprovedGrowthDirection } = await import("@/lib/services/growth-hotspot-admission"); hotspotAdmission = await admitApprovedGrowthDirection(command.directionId, command.revision, auth.actor, auth.localPreview); }
      catch { hotspotAdmission = { status: "pending", reason: "确切方向批准已保存；热点追加未完成，请在近期热点页按原任务重新核验，未冒称原子完成" }; }
    }
    return Response.json({ ...saved, ...(hotspotAdmission ? { hotspotAdmission } : {}) }, { headers: workflowHeaders });
  }
  catch (error) { return response(error); }
}
function response(error: unknown) {
  return error instanceof GrowthStrategyError ? Response.json({ code: error.code, message: error.message }, { status: error.status, headers: workflowHeaders }) : workflowErrorResponse(error);
}
