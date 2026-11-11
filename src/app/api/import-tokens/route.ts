import type { NextRequest } from "next/server";
import { ZodError } from "zod";
import { AUTH_COOKIE_NAME, isAuthEnabled, isValidAuthToken } from "@/lib/auth";
import { importTokenCommandSchema, ImportTokenError } from "@/lib/import-token";
import { listImportTokens, mutateImportToken } from "@/lib/services/import-tokens";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store", Vary: "Cookie", "X-Content-Type-Options": "nosniff" };
const bodyLimit = 8 * 1024;
async function authorize(request: NextRequest, write = false) {
  // A public dashboard or an import token never authorizes credential management.
  if (!isAuthEnabled() || !await isValidAuthToken(request.cookies.get(AUTH_COOKIE_NAME)?.value)) {
    throw new ImportTokenError("unauthorized", "请先登录后管理接入凭据", 401);
  }
  const origin = request.headers.get("origin");
  if ((write || origin !== null) && origin !== new URL(request.url).origin) {
    throw new ImportTokenError("invalid_origin", "请求来源无效", 403);
  }
  if (request.headers.get("sec-fetch-site") === "cross-site") throw new ImportTokenError("invalid_origin", "请求来源无效", 403);
}
async function readCommand(request: Request) {
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
    throw new ImportTokenError("unsupported_content_type", "需要 application/json", 415);
  }
  const reader = request.body?.getReader();
  if (!reader) throw new ImportTokenError("invalid_body", "缺少操作内容");
  const chunks: Uint8Array[] = []; let length = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > bodyLimit) { await reader.cancel(); throw new ImportTokenError("body_too_large", "操作内容不能超过 8 KB", 413); }
    chunks.push(value);
  }
  return importTokenCommandSchema.parse(JSON.parse(Buffer.concat(chunks).toString("utf8")));
}
function failure(error: unknown) {
  if (error instanceof ImportTokenError) return Response.json({ code: error.code, message: error.message }, { status: error.status, headers });
  if (error instanceof ZodError || error instanceof SyntaxError) return Response.json({ code: "invalid_request", message: "操作内容无效，请检查名称、有效期或凭据编号" }, { status: 400, headers });
  return Response.json({ code: "storage_unavailable", message: "接入凭据暂不可用，请稍后重试" }, { status: 503, headers });
}
export async function GET(request: NextRequest) {
  try { await authorize(request); return Response.json(await listImportTokens(), { headers }); }
  catch (error) { return failure(error); }
}
export async function POST(request: NextRequest) {
  try { await authorize(request, true); return Response.json(await mutateImportToken(await readCommand(request)), { headers }); }
  catch (error) { return failure(error); }
}
