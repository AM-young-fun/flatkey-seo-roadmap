import { authorizeWorkflow, workflowErrorResponse, workflowHeaders } from "@/lib/seo-workflow-http";
import { seoTablePage } from "@/lib/seo-table-page";
import { loadGrowthHotspotView } from "@/lib/services/growth-hotspots";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
/** Saved-evidence read only. There is deliberately no mutation/provider edge. */
export async function GET(request: Request) {
  try {
    const auth = await authorizeWorkflow(request);
    const params = new URL(request.url).searchParams;
    const rawPage = params.get("page"), page = Number(rawPage);
    if (params.size && (params.size !== 1 || rawPage === null || !/^[1-9]\d*$/.test(rawPage) || !Number.isSafeInteger(page))) {
      return Response.json({ message: "热点查询仅接受有效的分页参数" }, { status: 400, headers: workflowHeaders });
    }
    const view = await loadGrowthHotspotView(auth.localPreview);
    if (rawPage === null) return Response.json(view, { headers: workflowHeaders });
    const { rows, ...pagination } = seoTablePage(view.items, page);
    return Response.json({ ...view, items: rows, pagination }, { headers: workflowHeaders });
  } catch (error) { return workflowErrorResponse(error); }
}
