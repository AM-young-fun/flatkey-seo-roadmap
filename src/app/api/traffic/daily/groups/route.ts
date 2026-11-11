import {previewRead} from "@/lib/seo-preview";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { AUTH_COOKIE_NAME, isAuthEnabled, isValidAuthToken } from "@/lib/auth";
import { authenticateImportToken } from "@/lib/services/import-tokens";
import { ImportRequestError, readImportJson } from "@/lib/ranking-import";
import { dailySeoPageGroupsSchema, parseDailySeoPageGroupsQuery } from "@/lib/daily-seo-page-groups";
import { importDailySeoPageGroups, loadDailySeoPageGroupsHistory } from "@/lib/services/daily-seo-page-groups";
import { importFailure } from "@/lib/import-failure";
import { databaseErrorCode, retryDatabaseRead } from "@/lib/database-read";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
const headers = { "Cache-Control": "private, no-store" };
async function authorized(request: Request) {
  if (await authenticateImportToken(request)) return true;
  return isAuthEnabled() && await isValidAuthToken((await cookies()).get(AUTH_COOKIE_NAME)?.value);
}
// Stores browser-collected evidence only; never calls a provider or GA4 API.
export async function POST(request: Request) {
  if (!await authorized(request)) return NextResponse.json({ message: "请先登录或使用现有采集凭据" }, { status: 401, headers });
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return NextResponse.json({ message: "请求来源无效" }, { status: 403, headers });
  let requestId: string | undefined;
  try {
    const parsed = dailySeoPageGroupsSchema.safeParse(await readImportJson(request));
    if (!parsed.success) return NextResponse.json({ message: "页面组自然搜索日数据格式错误", errors: parsed.error.issues }, { status: 400, headers });
    requestId = parsed.data.requestId;
    const result = await importDailySeoPageGroups(parsed.data);
    return NextResponse.json(result, { status: result.duplicate ? 200 : 201, headers });
  } catch (error) {
    if (error instanceof ImportRequestError) return NextResponse.json({ message: error.message, requestId }, { status: error.status, headers });
    const failure = importFailure(error, requestId);
    return NextResponse.json(failure.body, { status: failure.status, headers: failure.headers });
  }
}
export async function GET(request: Request) {
  const preview=await previewRead(request);if(preview)return preview;
  if (!await authorized(request)) return NextResponse.json({ message: "请先登录或使用现有采集凭据" }, { status: 401, headers });
  let query;
  try { query = parseDailySeoPageGroupsQuery(new URL(request.url).searchParams); }
  catch { return NextResponse.json({ message: "页面组日趋势参数无效，须使用已结束日期和已核验口径" }, { status: 400, headers }); }
  try { return NextResponse.json(await retryDatabaseRead(() => loadDailySeoPageGroupsHistory(query)), { headers }); }
  catch (error) { return NextResponse.json({ message: "页面组日趋势读取失败，请重试", code: databaseErrorCode(error) }, { status: 503, headers }); }
}
