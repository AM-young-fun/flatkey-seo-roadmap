import { z } from "zod";
import { authorizeWorkflow, workflowErrorResponse, workflowHeaders } from "@/lib/seo-workflow-http";
import { readWorkflowHistory } from "@/lib/services/seo-workflow";
const query = z.object({ kind: z.enum(["approval", "plan", "task", "publication", "optimization", "issue", "run", "historical_import"]), id: z.string().min(1).max(160).regex(/^[a-zA-Z0-9_.:-]+$/) });
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try { const auth = await authorizeWorkflow(request), params = query.parse(Object.fromEntries(new URL(request.url).searchParams)); return Response.json({ records: await readWorkflowHistory(params.kind, params.id, auth.localPreview) }, { headers: workflowHeaders }); }
  catch (error) { return workflowErrorResponse(error); }
}
