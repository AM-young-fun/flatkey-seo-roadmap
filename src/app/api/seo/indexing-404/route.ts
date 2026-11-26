import { authorizeWorkflow, workflowErrorResponse, workflowHeaders } from "@/lib/seo-workflow-http";
import { loadIndexing404History } from "@/lib/services/seo-workflow";
import { isIndexing404Day } from "@/lib/seo-indexing-404";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { localPreview } = await authorizeWorkflow(request);
    const params = new URL(request.url).searchParams;
    const dates = params.getAll("through");
    if (dates.length !== params.size || dates.length > 1 || dates.length === 1 && !isIndexing404Day(dates[0])) {
      return Response.json({ message: "404 记录日期无效" }, { status: 400, headers: workflowHeaders });
    }
    return Response.json(await loadIndexing404History(localPreview, dates[0]), { headers: workflowHeaders });
  } catch (error) {
    return workflowErrorResponse(error);
  }
}
