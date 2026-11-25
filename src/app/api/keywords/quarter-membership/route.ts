import { cookies } from "next/headers";
import { z, ZodError } from "zod";
import { AUTH_COOKIE_NAME, isAuthEnabled, isValidAuthToken } from "@/lib/auth";
import { ImportRequestError, readImportJson } from "@/lib/ranking-import";
import { QuarterMembershipError } from "@/lib/quarter-membership";
import { loadQuarterMembership, loadQuarterMembershipReceipt, saveQuarterMembership } from "@/lib/services/quarter-membership";
import { displayDataChanged } from "@/lib/services/display-change";
import { PreFreezeIdentityError } from "@/lib/pre-freeze-market-identities";
import { savePreFreezeIdentities, loadPreFreezeIdentityReceipt } from "@/lib/services/pre-freeze-market-identities";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;
const headers = { "Cache-Control": "private, no-store" };
async function authorize(request: Request, write = false) {
  if (request.headers.has("authorization") || !isAuthEnabled() || !await isValidAuthToken((await cookies()).get(AUTH_COOKIE_NAME)?.value)) throw new QuarterMembershipError("human_required", "季度成员仅允许已登录用户确认，采集凭据不能代替人工", 403);
  const origin = request.headers.get("origin");
  if (write ? origin !== new URL(request.url).origin : origin && origin !== new URL(request.url).origin) throw new QuarterMembershipError("invalid_origin", "请求须来自当前平台同源页面", 403);
}
function failure(error: unknown) {
  if (error instanceof PreFreezeIdentityError) return Response.json({ code: error.code, message: error.message }, { status: error.status, headers });
  if (error instanceof QuarterMembershipError) return Response.json({ code: error.code, message: error.message }, { status: error.status, headers });
  if (error instanceof ImportRequestError) return Response.json({ message: error.message }, { status: error.status, headers });
  if (error instanceof ZodError || error instanceof SyntaxError) return Response.json({ code: "invalid_record", message: "季度清单字段、原词数量或哈希无效" }, { status: 400, headers });
  return Response.json({ code: "storage_unavailable", message: "季度成员存储暂不可用；请保留确切请求并先读回，不重复改写" }, { status: 503, headers });
}
export async function GET(request: Request) {
  try { await authorize(request); const params = new URL(request.url).searchParams;
    if (params.has("identityRequestId")) return Response.json(await loadPreFreezeIdentityReceipt(z.string().min(1).max(200).parse(params.get("identityRequestId")), "human"), { headers });
    if (params.has("membershipRequestId")) return Response.json(await loadQuarterMembershipReceipt(z.string().min(1).max(200).parse(params.get("membershipRequestId"))), { headers });
    const value = params.get("selectionHash"); const hash = value === null ? undefined : z.string().regex(/^[a-f0-9]{64}$/).parse(value); return Response.json(await loadQuarterMembership(hash), { headers }); } catch (error) { return failure(error); }
}
export async function POST(request: Request) {
  try { await authorize(request, true); const input = await readImportJson(request);
    if (input && typeof input === "object" && "action" in input && ["preview_identities", "apply_identities"].includes(String(input.action))) {
      const result = await savePreFreezeIdentities(input, "human");
      if (result.status === "IDENTITIES_APPLIED" && !result.replay) await displayDataChanged();
      return Response.json(result, { headers });
    }
    if (input && typeof input === "object" && "action" in input && input.action === "stage_new_words") {
      const { stageQuarterWordResearch } = await import("@/lib/services/quarter-word-research");
      const result = await stageQuarterWordResearch(input);
      if (!result.replay) await displayDataChanged();
      return Response.json(result, { headers });
    }
    const result = await saveQuarterMembership(input); if (result.status === "APPLIED" && "replay" in result && !result.replay) await displayDataChanged(); return Response.json(result, { headers }); } catch (error) { return failure(error); }
}
