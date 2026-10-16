import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { AUTH_COOKIE_NAME, isAuthEnabled, isValidAuthToken } from "@/lib/auth";
import { isDatabaseConfigured } from "@/lib/env";
import { databaseErrorCode, retryDatabaseRead } from "@/lib/database-read";
import { ImportRequestError, readImportJson } from "@/lib/ranking-import";
import { serpMonitorMutationSchema } from "@/lib/dataforseo-serp";
import { loadSerpMonitorStatus, mutateSerpMonitor } from "@/lib/services/serp-monitor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
const headers = { "Cache-Control": "private, no-store" };
async function authorize() {
  if (!isAuthEnabled() || !await isValidAuthToken((await cookies()).get(AUTH_COOKIE_NAME)?.value)) return NextResponse.json({ message: "需要登录后管理SERP实测排名" }, { status: 401, headers });
  if (!isDatabaseConfigured()) return NextResponse.json({ message: "数据库未配置" }, { status: 503, headers });
}
function failure(error: unknown) {
  if (error instanceof ImportRequestError) return NextResponse.json({ message: error.message }, { status: error.status, headers });
  const code = databaseErrorCode(error);
  console.error("SERP monitor failed", { code });
  return NextResponse.json({ message: "SERP状态暂时无法确认，请保留原采集标识并查看账本，不要重复提交", code }, { status: 503, headers });
}
export async function GET() {
  const denied = await authorize(); if (denied) return denied;
  try { return NextResponse.json(await retryDatabaseRead(loadSerpMonitorStatus), { headers }); }
  catch (error) { return failure(error); }
}
export async function POST(request: Request) {
  const denied = await authorize(); if (denied) return denied;
  try {
    const parsed = serpMonitorMutationSchema.safeParse(await readImportJson(request));
    if (!parsed.success) return NextResponse.json({ message: "操作参数无效；本轮仅支持保存为付费关闭状态" }, { status: 400, headers });
    // No mutation retry: a start can reserve money and make one paid POST.
    return NextResponse.json(await mutateSerpMonitor(parsed.data), { headers });
  } catch (error) { return failure(error); }
}
