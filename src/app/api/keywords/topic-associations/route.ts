import { authorizeWorkflow, readWorkflowBody, workflowErrorResponse, workflowHeaders } from "@/lib/seo-workflow-http";
import { WorkflowError } from "@/lib/seo-workflow-state";
import { loadTopicAssociationPreview, loadTopicAssociationReceipt, saveTopicAssociation } from "@/lib/services/site-topic-association";
import { displayDataChanged } from "@/lib/services/display-change";

export const dynamic = "force-dynamic";
export const maxDuration = 45;
async function human(request: Request, write = false) {
  const auth = await authorizeWorkflow(request, write);
  if (auth.actor !== "human" || auth.localPreview) throw new WorkflowError("human_topic_association_required", "仅接受真实已登录用户；采集凭据和本地预览不能修改或读取本站关联管理", 403);
  return auth.actor;
}
export async function GET(request: Request) {
  try {
    const actor = await human(request), params = new URL(request.url).searchParams;
    if ([...params.keys()].length !== new Set(params.keys()).size) throw new WorkflowError("invalid_association_query", "查询字段不能重复", 400);
    const query = Object.fromEntries(params);
    if (params.has("requestId")) {
      if (Object.keys(query).length !== 1) throw new WorkflowError("invalid_association_query", "原审计回执须仅按requestId读取", 400);
      return Response.json(await loadTopicAssociationReceipt(query.requestId, actor), { headers: workflowHeaders });
    }
    return Response.json(await loadTopicAssociationPreview(query, actor), { headers: workflowHeaders });
  } catch (error) { return workflowErrorResponse(error); }
}
export async function POST(request: Request) {
  try {
    const actor = await human(request, true);
    const result = await saveTopicAssociation(await readWorkflowBody(request), actor);
    if (!result.replay && result.receipt.createdEdge) await displayDataChanged();
    return Response.json(result, { headers: workflowHeaders });
  } catch (error) { return workflowErrorResponse(error); }
}
