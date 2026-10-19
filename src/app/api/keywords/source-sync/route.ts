import { displayDataChanged } from "@/lib/services/display-change";
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { isDatabaseConfigured } from "@/lib/env";
import { AUTH_COOKIE_NAME, isAuthEnabled, isValidAuthToken } from "@/lib/auth";
import { getRankingImportSecret } from "@/lib/import-credential";
import { importSecretMatches, ImportRequestError, readImportJson } from "@/lib/ranking-import";
import { databaseErrorCode } from "@/lib/database-read";
import { sourceSyncSchema } from "@/lib/source-sync";
import { syncKeywordSources } from "@/lib/services/source-sync";
import { loadSourceSyncHealth } from "@/lib/services/source-sync-health";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
const headers = { "Cache-Control": "private, no-store" };

export async function GET() {
  // The narrow collector bearer can submit reviewed source rows, but must not
  // replace an administrator session for source configuration/status reads.
  if (!isAuthEnabled() || !await isValidAuthToken((await cookies()).get(AUTH_COOKIE_NAME)?.value)) {
    return NextResponse.json({ message: "需要登录后查看协作表同步状态" }, { status: 401, headers });
  }
  if (!isDatabaseConfigured()) return NextResponse.json({ message: "DATABASE_URL is not configured" }, { status: 503, headers });
  try {
    return NextResponse.json(await loadSourceSyncHealth(), { headers });
  } catch (error) {
    const code = databaseErrorCode(error);
    console.error("Keyword source health read failed", code);
    return NextResponse.json({ message: "协作表同步状态读取失败，请重试", code }, { status: 503, headers });
  }
}

export async function POST(request: Request) {
  const secret = getRankingImportSecret();
  const bearer = Boolean(secret && importSecretMatches(request.headers.get("authorization"), secret));
  const session = !bearer && isAuthEnabled() && await isValidAuthToken((await cookies()).get(AUTH_COOKIE_NAME)?.value);
  if (!bearer && !session) return NextResponse.json({ message: "需要登录或有效导入凭证" }, { status: 401, headers });
  if (!isDatabaseConfigured()) return NextResponse.json({ message: "DATABASE_URL is not configured" }, { status: 503, headers });
  try {
    const parsed = sourceSyncSchema.safeParse(await readImportJson(request));
    if (!parsed.success) return NextResponse.json({ message: "协作表增量数据格式无效", errors: parsed.error.issues }, { status: 400, headers });
    const result = await syncKeywordSources(parsed.data);
    if (parsed.data.action !== "preview") await displayDataChanged();
    return NextResponse.json(result, { headers });
  } catch (error) {
    if (error instanceof ImportRequestError) return NextResponse.json({ message: error.message }, { status: error.status, headers });
    const code = databaseErrorCode(error);
    console.error("Keyword source sync failed", code);
    return NextResponse.json({ message: "协作表增量保存失败，请保持原请求重试", code }, { status: 503, headers });
  }
}
