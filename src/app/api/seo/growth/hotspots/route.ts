import { authorizeWorkflow, workflowErrorResponse, workflowHeaders } from "@/lib/seo-workflow-http";
import { seoTablePage } from "@/lib/seo-table-page";
import { growthHotspotTopicPage } from "@/lib/growth-hotspot-topics";
import { loadGrowthHotspotView, loadSavedHotspotTopics } from "@/lib/services/growth-hotspots";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
/** Saved-evidence read only. There is deliberately no mutation/provider edge. */
export async function GET(request: Request) {
  try {
    const auth = await authorizeWorkflow(request);
    const params = new URL(request.url).searchParams;
    const rawPage = params.get("page"), page = Number(rawPage ?? 1), viewMode = params.get("view"), topic = params.get("topic");
    const supported = viewMode === "topics" ? ["view", "page", "topic"] : ["page"];
    if ([...params.keys()].some(key => !supported.includes(key) || params.getAll(key).length !== 1)
      || (rawPage !== null && (!/^[1-9]\d*$/.test(rawPage) || !Number.isSafeInteger(page)))
      || (topic !== null && (!topic.trim() || topic.length > 260))) {
      return Response.json({ message: "热点查询参数无效" }, { status: 400, headers: workflowHeaders });
    }
    const view = await loadGrowthHotspotView(auth.localPreview);
    if (viewMode === "topics") {
      const topicIds = [...new Set(view.items.flatMap(item => item.topicId ? [item.topicId] : []))];
      const saved = await loadSavedHotspotTopics(topicIds, auth.localPreview);
      return Response.json(growthHotspotTopicPage(view, saved, page, topic), { headers: workflowHeaders });
    }
    if (rawPage === null) return Response.json(view, { headers: workflowHeaders });
    const { rows, ...pagination } = seoTablePage(view.items, page);
    return Response.json({ ...view, items: rows, pagination }, { headers: workflowHeaders });
  } catch (error) { return workflowErrorResponse(error); }
}
