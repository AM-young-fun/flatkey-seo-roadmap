import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { AUTH_COOKIE_NAME, isAuthEnabled, isValidAuthToken } from "@/lib/auth";
import { isDatabaseConfigured } from "@/lib/env";
import { databaseErrorCode, retryDatabaseRead } from "@/lib/database-read";
import { ImportRequestError, readImportJson } from "@/lib/ranking-import";
import { dataForSeoMutationSchema } from "@/lib/dataforseo-management";
import { loadDataForSeoExport, loadDataForSeoStatus, mutateDataForSeo } from "@/lib/services/dataforseo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
const headers = { "Cache-Control": "private, no-store" };
async function authorize() {
  if (!isAuthEnabled() || !await isValidAuthToken((await cookies()).get(AUTH_COOKIE_NAME)?.value)) return NextResponse.json({ message: "需要登录后管理DataForSEO连接" }, { status: 401, headers });
  if (!isDatabaseConfigured()) return NextResponse.json({ message: "数据库未配置" }, { status: 503, headers });
}
function failure(error: unknown) {
  if (error instanceof ImportRequestError) return NextResponse.json({ message: error.message }, { status: error.status, headers });
  const code = databaseErrorCode(error);
  console.error("DataForSEO management failed", { code });
  return NextResponse.json({ message: "请求状态暂时无法确认，请查看账本；不要创建新扣费请求", code }, { status: 503, headers });
}
export async function GET(request?: Request) {
  const denied = await authorize(); if (denied) return denied;
  try {
    const requestId = request ? new URL(request.url).searchParams.get("requestId") : null;
    if (requestId !== null) {
      const parsed = dataForSeoMutationSchema.safeParse({ action: "replay", requestId });
      if (!parsed.success) return NextResponse.json({ message: "采集标识无效" }, { status: 400, headers });
      return NextResponse.json(await retryDatabaseRead(() => loadDataForSeoExport(requestId)), { headers: { ...headers, "Content-Disposition": `attachment; filename="dataforseo-${requestId}.json"` } });
    }
    return NextResponse.json(await retryDatabaseRead(loadDataForSeoStatus), { headers });
  } catch (error) { return failure(error); }
}
export async function POST(request: Request) {
  const denied = await authorize(); if (denied) return denied;
  try {
    const parsed = dataForSeoMutationSchema.safeParse(await readImportJson(request));
    if (!parsed.success) return NextResponse.json({ message: "操作参数无效" }, { status: 400, headers });
    // Mutations containing a paid POST must never be wrapped in a retry helper.
    return NextResponse.json(await mutateDataForSeo(parsed.data), { headers });
  } catch (error) { return failure(error); }
}
