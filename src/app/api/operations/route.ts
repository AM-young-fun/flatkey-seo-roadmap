import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { AUTH_COOKIE_NAME, isAuthEnabled, isValidAuthToken } from "@/lib/auth";
import { isDatabaseConfigured } from "@/lib/env";
import { retryDatabaseRead } from "@/lib/database-read";
import { loadOperationsStatus } from "@/lib/services/operations";
import { collectionControlSchema } from "@/lib/collection-control";
import { mutateCollectionControl } from "@/lib/services/collection-control";
import { ImportRequestError, readImportJson } from "@/lib/ranking-import";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;
const headers = { "Cache-Control": "private, no-store" };
export async function GET() {
  if (!isAuthEnabled() || !await isValidAuthToken((await cookies()).get(AUTH_COOKIE_NAME)?.value)) return NextResponse.json({ message: "请先登录" }, { status: 401, headers });
  if (!isDatabaseConfigured()) return NextResponse.json({ message: "数据库未配置" }, { status: 503, headers });
  try { return NextResponse.json(await retryDatabaseRead(loadOperationsStatus), { headers }); }
  catch { return NextResponse.json({ message: "运行记录暂时无法读取" }, { status: 503, headers }); }
}

export async function POST(request: Request) {
  if (!isAuthEnabled() || !await isValidAuthToken((await cookies()).get(AUTH_COOKIE_NAME)?.value)) return NextResponse.json({ message: "请先登录" }, { status: 401, headers });
  if (!isDatabaseConfigured()) return NextResponse.json({ message: "数据库未配置" }, { status: 503, headers });
  try {
    const parsed = collectionControlSchema.safeParse(await readImportJson(request));
    if (!parsed.success) return NextResponse.json({ message: "执行参数无效" }, { status: 400, headers });
    // No retries of mutations or provider POSTs.
    return NextResponse.json(await mutateCollectionControl(parsed.data), { headers });
  } catch (error) {
    if (error instanceof ImportRequestError) return NextResponse.json({ message: error.message }, { status: error.status, headers });
    return NextResponse.json({ message: "操作结果暂时无法确认，请查看原执行记录，勿重复提交" }, { status: 503, headers });
  }
}
