import { displayDataChanged } from "@/lib/services/display-change";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { AUTH_COOKIE_NAME, isAuthEnabled, isValidAuthToken } from "@/lib/auth";
import { isDatabaseConfigured } from "@/lib/env";
import { retryDatabaseRead } from "@/lib/database-read";
import { ImportRequestError, readImportJson } from "@/lib/ranking-import";
import { optimizedPageMutationSchema } from "@/lib/optimized-page-monitor";
import { loadOptimizedPageMonitor, mutateOptimizedPageMonitor } from "@/lib/services/optimized-page-monitor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;
const headers = { "Cache-Control": "private, no-store" };
async function authorize(request: Request) {
  if (!isAuthEnabled() || !await isValidAuthToken((await cookies()).get(AUTH_COOKIE_NAME)?.value)) return NextResponse.json({ message: "请先登录" }, { status: 401, headers });
  if (request.method === "POST" && request.headers.get("origin") && request.headers.get("origin") !== new URL(request.url).origin)
    return NextResponse.json({ message: "请求来源无效" }, { status: 403, headers });
  if (!isDatabaseConfigured()) return NextResponse.json({ message: "数据库未配置" }, { status: 503, headers });
}
function failure(error: unknown) {
  if (error instanceof ImportRequestError) return NextResponse.json({ message: error.message }, { status: error.status, headers });
  return NextResponse.json({ message: "暂时无法确认结果，请刷新查看原记录，勿重复抓取" }, { status: 503, headers });
}
export async function GET(request: Request) {
  const denied = await authorize(request); if (denied) return denied;
  try { return NextResponse.json(await retryDatabaseRead(loadOptimizedPageMonitor), { headers }); }
  catch (error) { return failure(error); }
}
export async function POST(request: Request) {
  const denied = await authorize(request); if (denied) return denied;
  try {
    const parsed = optimizedPageMutationSchema.safeParse(await readImportJson(request));
    if (!parsed.success) return NextResponse.json({ message: "每次只能操作一个页面" }, { status: 400, headers });
    const result = await mutateOptimizedPageMonitor(parsed.data);
    await displayDataChanged();
    return NextResponse.json(result, { headers });
  } catch (error) { return failure(error); }
}
