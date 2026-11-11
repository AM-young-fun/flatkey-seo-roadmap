import type { NextRequest } from "next/server";
import { z } from "zod";
import { AUTH_COOKIE_NAME, isAuthEnabled, isValidAuthToken } from "@/lib/auth";
import { authenticateImportToken } from "@/lib/services/import-tokens";
import { getSeoReportingControl, setSeoReportingControl, SeoReportingControlError, seoReportingCommandSchema } from "@/lib/services/seo-reporting-control";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store", Vary: "Cookie, Authorization", "X-Content-Type-Options": "nosniff" };
async function authorize(request: NextRequest, write = false): Promise<"import-token" | "admin-session"> {
  const origin = request.headers.get("origin");
  if (request.headers.get("sec-fetch-site") === "cross-site" || origin !== null && origin !== new URL(request.url).origin) throw new SeoReportingControlError("invalid_origin", "请求来源无效", 403);
  // Server credentials never authorize browser-origin writes; a real session is required there.
  if (origin === null && await authenticateImportToken(request)) return "import-token";
  if (!isAuthEnabled() || !await isValidAuthToken(request.cookies.get(AUTH_COOKIE_NAME)?.value)) throw new SeoReportingControlError("unauthorized", "需要接入凭据或登录管理会话", 401);
  if (write && origin === null) throw new SeoReportingControlError("invalid_origin", "管理会话写入需要同源请求", 403);
  return "admin-session";
}
async function readCommand(request: Request) {
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") throw new SeoReportingControlError("unsupported_content_type", "需要 application/json", 415);
  const reader = request.body?.getReader();
  if (!reader) throw new SeoReportingControlError("invalid_body", "缺少操作内容", 400);
  const chunks: Uint8Array[] = []; let size = 0;
  for (;;) {
    const { value, done } = await reader.read(); if (done) break;
    size += value.byteLength;
    if (size > 8192) { await reader.cancel(); throw new SeoReportingControlError("body_too_large", "操作内容不能超过8KB", 413); }
    chunks.push(value);
  }
  return seoReportingCommandSchema.parse(JSON.parse(Buffer.concat(chunks).toString("utf8")));
}
function failure(error: unknown) {
  if (error instanceof SeoReportingControlError) return Response.json({ code: error.code, message: error.message }, { status: error.status, headers });
  if (error instanceof z.ZodError || error instanceof SyntaxError) return Response.json({ code: "invalid_request", message: "通知开关参数无效" }, { status: 400, headers });
  return Response.json({ code: "storage_unavailable", message: "通知开关不可验证，发送保持关闭" }, { status: 503, headers });
}
export async function GET(request: NextRequest) {
  try { await authorize(request); return Response.json({ control: await getSeoReportingControl(), storage: "database" }, { headers }); }
  catch (error) { return failure(error); }
}
export async function POST(request: NextRequest) {
  try { const actor = await authorize(request, true); return Response.json(await setSeoReportingControl(await readCommand(request), actor), { headers }); }
  catch (error) { return failure(error); }
}
