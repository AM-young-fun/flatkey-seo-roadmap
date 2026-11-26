import { profileRead, timedRead } from "@/lib/read-profile";
import { parseWorkflowWorkPageQuery, workflowWorkList, workflowWorkPage } from "@/lib/seo-workflow-list";
import { prisma } from "@/lib/prisma";
import { approvalMaterialBacklog } from "@/lib/seo-approval-display";
import { workflowRecordIdSchema, workflowWeekSchema, pageBelongsToSite, workflowReleaseCandidates, workflowClusterRollbackCandidates, WORKFLOW_SITES } from "@/lib/seo-workflow";
import { WorkflowError } from "@/lib/seo-workflow-state";
import { authorizeWorkflow, readWorkflowBody, workflowErrorResponse, workflowHeaders } from "@/lib/seo-workflow-http";
import { loadWorkflowSnapshot, loadWorkflowTaskDetail, saveWorkflowMutation } from "@/lib/services/seo-workflow";

export const dynamic = "force-dynamic";
async function workflowJson(value: unknown) {
  return timedRead("serialize", async () => Response.json(value, { headers: workflowHeaders }));
}

export async function GET(request: Request) {
  const result = await profileRead(async () => {
    try {
      const auth = await timedRead("authorize", () => authorizeWorkflow(request)), params = new URL(request.url).searchParams;
      const format = params.get("format");
      if (format !== null && (format !== "list" || params.get("operational") !== "1" || params.get("workList") !== "1"
        || ["taskId", "topicMap", "releaseQueue", "rollbackQueue", "materialQueue"].some(key => params.has(key)))) {
        throw new WorkflowError("invalid_format", "精简列表格式仅用于 operational=1 与 workList=1 的任务列表", 400);
      }
      const page = params.has("page") && format === "list" ? parseWorkflowWorkPageQuery(params) : null;
      if (params.has("page") && !page) throw new WorkflowError("invalid_work_page", "任务列表的页码或筛选条件无效", 400);
      if (params.has("taskId")) {
        const detail = await timedRead("detail", () => loadWorkflowTaskDetail(workflowRecordIdSchema.parse(params.get("taskId")), auth.localPreview));
        return workflowJson(detail);
      }
      if (params.get("topicMap") === "flatkey.ai") {
        if (!process.env.DATABASE_URL) throw new WorkflowError("storage_unavailable", "TopicMap 数据库不可用", 503);
        const topics = await prisma.topic.findMany({
          where: { active: true, sites: { some: { siteDomain: "flatkey.ai" } } },
          select: { id: true, text: true, type: true, parentId: true, updatedAt: true },
          orderBy: [{ type: "asc" }, { text: "asc" }],
        });
        const topicIds = topics.map(topic => topic.id);
        const relations = await prisma.topicRelation.findMany({
          where: { parentId: { in: topicIds }, childId: { in: topicIds } },
          select: { parentId: true, childId: true },
        });
        return workflowJson({ storage: "database", siteDomain: "flatkey.ai", topics, relations });
      }
      const week = params.get("week") ?? "current", pageUrl = params.get("pageUrl") ?? undefined;
      if (!["current", "next", "latest"].includes(week)) workflowWeekSchema.parse(week);
      if (pageUrl) { let valid = false; try { valid = WORKFLOW_SITES.some(site => pageBelongsToSite(pageUrl, site)); } catch { /* Invalid URL. */ } if (!valid) throw new WorkflowError("invalid_page", "请选择五站正式 HTTPS 页面", 400); }
      const releaseQueue = params.get("releaseQueue") === "1";
      const rollbackQueue = params.get("rollbackQueue") === "1";
      const materialQueue = params.get("materialQueue") === "1";
      const operational = !rollbackQueue && (releaseQueue || materialQueue || params.get("operational") === "1");
      const workList = !releaseQueue && !materialQueue && params.get("workList") === "1";
      const snapshot = await loadWorkflowSnapshot(operational ? { operational: true, workList, ...(page ? { boardDates: { preset: page.preset, customRange: page.customRange } } : {}) } : {
        week, pageUrl, allHistory: rollbackQueue || params.get("allHistory") === "true",
      }, auth.localPreview);
      if (format === "list") return workflowJson(await timedRead("list", async () => page ? workflowWorkPage(snapshot, page) : workflowWorkList(snapshot)));
      if (rollbackQueue) return workflowJson({ candidates: workflowClusterRollbackCandidates(snapshot), storage: snapshot.storage });
      if (materialQueue) return workflowJson({ candidates: approvalMaterialBacklog(snapshot.approvals, snapshot.tasks), storage: snapshot.storage });
      if (releaseQueue) return workflowJson({ candidates: workflowReleaseCandidates(snapshot), storage: snapshot.storage });
      return workflowJson({ ...snapshot, capabilities: { promptPublication: 1, automaticPublicationPolicy: 1 } });
    } catch (error) { return workflowErrorResponse(error); }
  });
  const response = result.value;
  const timing = [...result.phases.map(phase => `${phase.phase};dur=${phase.durationMs}`), `workflow;dur=${result.durationMs}`].join(", ");
  response.headers.set("Server-Timing", timing);
  if (response.ok && new URL(request.url).searchParams.get("profile") === "1") {
    const payloadBytes = Buffer.byteLength(await response.text());
    return Response.json({ durationMs: result.durationMs, phases: result.phases, payloadBytes,
      applicationRegion: result.applicationRegion, databaseRegion: result.databaseRegion }, { headers: response.headers });
  }
  return response;
}
export async function POST(request: Request) {
  try { const auth = await authorizeWorkflow(request, true); return Response.json(await saveWorkflowMutation(await readWorkflowBody(request), auth.actor, auth.localPreview), { headers: workflowHeaders }); }
  catch (error) { return workflowErrorResponse(error); }
}
