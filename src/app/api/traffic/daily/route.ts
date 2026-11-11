import {previewRead} from "@/lib/seo-preview";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { AUTH_COOKIE_NAME, isAuthEnabled, isValidAuthToken } from "@/lib/auth";
import { authenticateImportToken } from "@/lib/services/import-tokens";
import { ImportRequestError, readImportJson } from "@/lib/ranking-import";
import { dailySeoTrafficSchema, parseDailySeoTrafficQuery } from "@/lib/daily-seo-traffic";
import { importDailySeoTraffic, loadDailySeoTrafficHistory } from "@/lib/services/daily-seo-traffic";
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

// This API only stores collector evidence. It never calls GA4 or another provider.
export async function POST(request: Request) {
  if (!await authorized(request)) return NextResponse.json({ message: "请先登录或使用现有采集凭据" }, { status: 401, headers });
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return NextResponse.json({ message: "请求来源无效" }, { status: 403, headers });
  let requestId: string | undefined;
  try {
    const parsed = dailySeoTrafficSchema.safeParse(await readImportJson(request));
    if (!parsed.success) return NextResponse.json({ message: "自然搜索日数据格式错误", errors: parsed.error.issues }, { status: 400, headers });
    requestId = parsed.data.requestId;
    const result = await importDailySeoTraffic(parsed.data);
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
  try { query = parseDailySeoTrafficQuery(new URL(request.url).searchParams); }
  catch { return NextResponse.json({ message: "日趋势参数无效，日期须已结束且范围不超过366天" }, { status: 400, headers }); }
  try {
    return NextResponse.json(await retryDatabaseRead(() => loadDailySeoTrafficHistory(query)), { headers });
  } catch (error) {
    return NextResponse.json({ message: "自然搜索日趋势读取失败，请重试", code: databaseErrorCode(error) }, { status: 503, headers });
  }
}
