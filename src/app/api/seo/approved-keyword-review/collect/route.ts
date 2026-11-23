import { authorizeWorkflow, readWorkflowBody, workflowErrorResponse, workflowHeaders } from "@/lib/seo-workflow-http";
import { ImportRequestError } from "@/lib/ranking-import";
import { APPROVED_KEYWORD_REVIEW_RUN_ID } from "@/lib/approved-keyword-review";
import { APPROVED_OTHER_KEYWORD_REVIEW_RUN_ID } from "@/lib/approved-other-keyword-review";
import { advanceApprovedKeywordReview } from "@/lib/services/approved-keyword-review";
import { advanceApprovedOtherKeywordReview } from "@/lib/services/approved-other-keyword-review";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Existing SEO import credentials may persist results from already-paid IDs.
// This route cannot prepare a ledger, select arbitrary IDs, or submit queries.
export async function POST(request: Request) {
  try {
    await authorizeWorkflow(request, true);
    const body = await readWorkflowBody(request) as Record<string, unknown>;
    if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).length !== 1 || typeof body.runId !== "string" ||
      ![APPROVED_KEYWORD_REVIEW_RUN_ID, APPROVED_OTHER_KEYWORD_REVIEW_RUN_ID].includes(body.runId)) {
      throw new ImportRequestError("仅可免费取回本次两个既有账本的已付费结果", 400);
    }
    const result = body.runId === APPROVED_KEYWORD_REVIEW_RUN_ID
      ? await advanceApprovedKeywordReview(false) : await advanceApprovedOtherKeywordReview(false);
    return Response.json(result, { headers: workflowHeaders });
  } catch (error) {
    if (error instanceof ImportRequestError) return Response.json({ message: error.message }, { status: error.status, headers: workflowHeaders });
    return workflowErrorResponse(error);
  }
}
