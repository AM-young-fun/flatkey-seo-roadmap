import { cookies } from "next/headers";
import { AUTH_COOKIE_NAME, isAuthEnabled, isValidAuthToken } from "@/lib/auth";
import { authorizeWorkflow, readWorkflowBody, workflowErrorResponse, workflowHeaders } from "@/lib/seo-workflow-http";
import { ImportRequestError } from "@/lib/ranking-import";
import { APPROVED_OTHER_REVIEW_QUOTE_SHA256, APPROVED_OTHER_REVIEW_MAX_COST_MICROS,
  loadApprovedOtherKeywordReview, prepareApprovedOtherKeywordReview, advanceApprovedOtherKeywordReview } from "@/lib/services/approved-other-keyword-review";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;
function failure(error: unknown) {
  if (error instanceof ImportRequestError) return Response.json({ message: error.message }, { status: error.status, headers: workflowHeaders });
  return workflowErrorResponse(error);
}
export async function GET(request: Request) {
  try { await authorizeWorkflow(request); return Response.json(await loadApprovedOtherKeywordReview(), { headers: workflowHeaders }); }
  catch (error) { return failure(error); }
}
export async function POST(request: Request) {
  try {
    if (request.headers.has("authorization") || request.headers.get("origin") !== new URL(request.url).origin ||
      !isAuthEnabled() || !await isValidAuthToken((await cookies()).get(AUTH_COOKIE_NAME)?.value)) {
      return Response.json({ message: "请在已登录的工作台执行本次已批准补采" }, { status: 403, headers: workflowHeaders });
    }
    const body = await readWorkflowBody(request) as Record<string, unknown>;
    if (!body || !["prepare", "resume", "collect"].includes(String(body.action)) ||
      body.quoteSha256 !== APPROVED_OTHER_REVIEW_QUOTE_SHA256 || body.maxCostMicros !== APPROVED_OTHER_REVIEW_MAX_COST_MICROS) {
      throw new ImportRequestError("仅接受已批准的467词补采清单及2.802美元上限", 400);
    }
    if (body.action === "prepare") { await prepareApprovedOtherKeywordReview(); return Response.json(await loadApprovedOtherKeywordReview(), { headers: workflowHeaders }); }
    return Response.json(await advanceApprovedOtherKeywordReview(body.action === "resume"), { headers: workflowHeaders });
  } catch (error) { return failure(error); }
}
