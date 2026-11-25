import { z } from "zod";
import { authorizeWorkflow, readWorkflowBody, workflowErrorResponse, workflowHeaders } from "@/lib/seo-workflow-http";
import { GrowthStrategyError } from "@/lib/growth-strategy";
import { withRequestReads } from "@/lib/request-read-scope";
import { loadGrowthQuarterReview, loadGrowthStrategy, loadGrowthStrategyDashboard, loadGrowthStrategyOverview, loadGrowthStrategyView, saveGrowthStrategy } from "@/lib/services/growth-strategy";
const weeklyGrowthRetrySchema = z.object({
  action: z.literal("retry_weekly_growth"), directionId: z.string().trim().min(1).max(200), revision: z.number().int().positive(),
}).strict();
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    const auth = await authorizeWorkflow(request);
    const params = new URL(request.url).searchParams, mode = params.get("view");
    if (mode === "traffic-state" && params.size === 1) {
      const { version, trafficEvidence } = await loadGrowthStrategy(auth.localPreview);
      return Response.json({ state: { version, trafficEvidence } }, { headers: workflowHeaders });
    }
    if (mode === "topic-directions") {
      const site = params.get("site"), topic = params.get("topic");
      if (!site || !topic || site.length > 240 || topic.length > 240 || params.size !== 3) return Response.json({ message: "话题方向查询参数无效" }, { status: 400, headers: workflowHeaders });
      const { directions } = await loadGrowthStrategy(auth.localPreview);
      return Response.json({ directions: directions.filter(direction => direction.scope.some(scope => scope.site === site && scope.topicId === topic)) }, { headers: workflowHeaders });
    }
    const view = await withRequestReads(async () => mode === "dashboard" ? loadGrowthStrategyDashboard(auth.localPreview)
      : mode === "overview" ? loadGrowthStrategyOverview(auth.localPreview)
        : mode === "quarter-review" ? loadGrowthQuarterReview(auth.localPreview, new Date()) : loadGrowthStrategyView(auth.localPreview));
    return Response.json(view, { headers: workflowHeaders });
  }
  catch (error) { return response(error); }
}
export async function POST(request: Request) {
  try {
    const auth = await authorizeWorkflow(request, true), command = await readWorkflowBody(request, auth.actor === "human" ? 2 * 1024 * 1024 : undefined);
    if (command && typeof command === "object" && "action" in command && command.action === "retry_weekly_growth") {
      const { directionId, revision } = weeklyGrowthRetrySchema.parse(command);
      const { admitApprovedWeeklyGrowthDirection } = await import("@/lib/services/growth-weekly-admission");
      const weeklyGrowthAdmission = await admitApprovedWeeklyGrowthDirection(directionId, revision, auth.actor, auth.localPreview);
      return Response.json({ weeklyGrowthAdmission }, { headers: workflowHeaders });
    }
    const saved = await saveGrowthStrategy(command, auth.actor, auth.localPreview);
    let hotspotAdmission: unknown, weeklyGrowthAdmission: unknown;
    if (auth.actor === "human" && command && typeof command === "object" && "action" in command && command.action === "decide_direction" && "decision" in command && command.decision === "approve" && "directionId" in command && typeof command.directionId === "string" && "revision" in command && typeof command.revision === "number") {
      const direction = saved.state.directions?.find(direction => direction.id === command.directionId && direction.revision === command.revision);
      if (direction?.weeklyGrowth) {
        try {
          const { admitApprovedWeeklyGrowthDirection } = await import("@/lib/services/growth-weekly-admission");
          weeklyGrowthAdmission = await admitApprovedWeeklyGrowthDirection(direction.id, direction.revision, auth.actor, auth.localPreview);
        } catch {
          weeklyGrowthAdmission = { status: "pending", reason: "方向决定已保存。原周报和排期暂未完成生产读回，可沿此方向版本重试。" };
        }
      } else {
        try { const { admitApprovedGrowthDirection } = await import("@/lib/services/growth-hotspot-admission"); hotspotAdmission = await admitApprovedGrowthDirection(command.directionId, command.revision, auth.actor, auth.localPreview); }
        catch { hotspotAdmission = { status: "pending", reason: "确切方向批准已保存；热点追加未完成，请在近期热点页按原任务重新核验，未冒称原子完成" }; }
      }
    }
    return Response.json({ ...saved, ...(hotspotAdmission ? { hotspotAdmission } : {}), ...(weeklyGrowthAdmission ? { weeklyGrowthAdmission } : {}) }, { headers: workflowHeaders });
  }
  catch (error) { return response(error); }
}
function response(error: unknown) {
  return error instanceof GrowthStrategyError ? Response.json({ code: error.code, message: error.message }, { status: error.status, headers: workflowHeaders }) : workflowErrorResponse(error);
}
