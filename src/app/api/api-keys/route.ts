import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { AUTH_COOKIE_NAME, isAuthEnabled, isValidAuthToken } from "@/lib/auth";
import { isDatabaseConfigured } from "@/lib/env";
import { apiKeyMutationSchema } from "@/lib/keyword-export";
import { ImportRequestError, readImportJson } from "@/lib/ranking-import";
import { listExportApiKeys, mutateExportApiKey } from "@/lib/services/export-api-keys";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store", Vary: "Cookie", "X-Content-Type-Options": "nosniff" };
async function guard() {
  if (!isAuthEnabled() || !await isValidAuthToken((await cookies()).get(AUTH_COOKIE_NAME)?.value)) return NextResponse.json({ message: "请先登录后管理 API Key" }, { status: 401, headers });
  if (!isDatabaseConfigured()) return NextResponse.json({ message: "数据库未配置" }, { status: 503, headers });
}
export async function GET() {
  const denied = await guard(); if (denied) return denied;
  try { return NextResponse.json({ keys: await listExportApiKeys() }, { headers }); }
  catch { return NextResponse.json({ message: "API Key 列表暂时无法读取" }, { status: 503, headers }); }
}
export async function POST(request: Request) {
  const denied = await guard(); if (denied) return denied;
  if (request.headers.get("origin") && request.headers.get("origin") !== new URL(request.url).origin) return NextResponse.json({ message: "请求来源无效" }, { status: 403, headers });
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) return NextResponse.json({ message: "请使用 application/json" }, { status: 415, headers });
  try {
    const parsed = apiKeyMutationSchema.safeParse(await readImportJson(request));
    if (!parsed.success) return NextResponse.json({ message: "API Key 参数无效" }, { status: 400, headers });
    return NextResponse.json(await mutateExportApiKey(parsed.data), { status: parsed.data.action === "create" ? 201 : 200, headers });
  } catch (error) {
    if (error instanceof ImportRequestError) return NextResponse.json({ message: error.message }, { status: error.status, headers });
    return NextResponse.json({ message: "API Key 操作未确认，请刷新列表后检查" }, { status: 503, headers });
  }
}
