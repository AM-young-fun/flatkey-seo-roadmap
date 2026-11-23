import { authorizeWorkflow, readWorkflowBody, workflowErrorResponse, workflowHeaders } from "@/lib/seo-workflow-http";
import { ImportRequestError } from "@/lib/ranking-import";
import { APPROVAL_QUOTE_SHA256, APPROVED_KEYWORD_REVIEW_MAX_COST_MICROS } from "@/lib/approved-keyword-review";
import { loadApprovedKeywordReview, prepareApprovedKeywordReview, advanceApprovedKeywordReview } from "@/lib/services/approved-keyword-review";
import { cookies } from "next/headers";
import { AUTH_COOKIE_NAME, isAuthEnabled, isValidAuthToken } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;
function failure(error: unknown) {
  if (error instanceof ImportRequestError) return Response.json({ message: error.message }, { status: error.status, headers: workflowHeaders });
  return workflowErrorResponse(error);
}
export async function GET(request: Request) {
  try {
    await authorizeWorkflow(request);
    if (new URL(request.url).searchParams.has("evidenceOffset")) {
      const { GET: readSavedEvidence } = await import("./evidence/route");
      return readSavedEvidence(request);
    }
    return Response.json(await loadApprovedKeywordReview(), { headers: workflowHeaders });
  }
  catch (error) { return failure(error); }
}
export async function POST(request: Request) {
  try {
    // Collector/export credentials can read progress but never authorize a bill.
    if (request.headers.has("authorization") || request.headers.get("origin") !== new URL(request.url).origin ||
      !isAuthEnabled() || !await isValidAuthToken((await cookies()).get(AUTH_COOKIE_NAME)?.value)) {
      return Response.json({ message: "请在已登录的工作台执行本次已批准采集" }, { status: 403, headers: workflowHeaders });
    }
    const body = await readWorkflowBody(request) as Record<string, unknown>;
    if (!body || !["prepare", "resume", "collect"].includes(String(body.action)) ||
      body.quoteSha256 !== APPROVAL_QUOTE_SHA256 || body.maxCostMicros !== APPROVED_KEYWORD_REVIEW_MAX_COST_MICROS) {
      throw new ImportRequestError("仅接受已批准的1031词原清单及6.186美元上限", 400);
    }
    // Preparing commits the exact ledger but does not contact the supplier.
    // A resume submits at most one non-retryable batch; collect only GETs known IDs.
    if (body.action === "prepare") { await prepareApprovedKeywordReview(); return Response.json(await loadApprovedKeywordReview(), { headers: workflowHeaders }); }
    return Response.json(await advanceApprovedKeywordReview(body.action === "resume"), { headers: workflowHeaders });
  } catch (error) { return failure(error); }
}
