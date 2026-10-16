import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { AUTH_COOKIE_NAME, isAuthEnabled, isValidAuthToken } from "@/lib/auth";
import { isDatabaseConfigured } from "@/lib/env";
import { databaseErrorCategory, databaseErrorCode } from "@/lib/database-read";
import { ImportRequestError, readImportJson } from "@/lib/ranking-import";
import { pageAuditSchema } from "@/lib/page-audit";
import { auditKeywordPages, pageAuditFailureStage } from "@/lib/services/page-audit";
import { exportHeldPageAuditWorklist } from "@/lib/services/page-audit-export";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
const headers = { "Cache-Control": "private, no-store" };
export async function GET() {
  if (!isAuthEnabled() || !await isValidAuthToken((await cookies()).get(AUTH_COOKIE_NAME)?.value)) return NextResponse.json({ message: "页面核实清单需要登录" }, { status: 401, headers });
  if (!isDatabaseConfigured()) return NextResponse.json({ message: "DATABASE_URL is not configured" }, { status: 503, headers });
  try {
    return NextResponse.json(await exportHeldPageAuditWorklist(), { headers: { ...headers,
      "Content-Disposition": 'attachment; filename="keyword-page-audit-worklist.json"' } });
  } catch (error) {
    const code = databaseErrorCode(error);
    console.error("Keyword page audit export failed", code);
    return NextResponse.json({ message: "页面核实清单导出失败", code }, { status: 503, headers });
  }
}
export async function POST(request: Request) {
  // Manual per-keyword page decisions require a real signed-in session even
  // when page login is disabled; collector and cron credentials never suffice.
  if (!isAuthEnabled() || !await isValidAuthToken((await cookies()).get(AUTH_COOKIE_NAME)?.value)) return NextResponse.json({ message: "逐词页面复核需要登录" }, { status: 401, headers });
  if (!isDatabaseConfigured()) return NextResponse.json({ message: "DATABASE_URL is not configured" }, { status: 503, headers });
  try {
    const parsed = pageAuditSchema.safeParse(await readImportJson(request));
    if (!parsed.success) return NextResponse.json({ message: "逐词页面复核格式无效", errors: parsed.error.issues }, { status: 400, headers });
    return NextResponse.json(await auditKeywordPages(parsed.data), { headers });
  } catch (error) {
    if (error instanceof ImportRequestError) return NextResponse.json({ message: error.message }, { status: error.status, headers });
    const code = databaseErrorCode(error), category = databaseErrorCategory(error), stage = pageAuditFailureStage(error);
    console.error("Keyword page audit failed", { code, category, stage });
    return NextResponse.json({ message: `页面复核未完成，请保留原请求重试（${[stage, code, category].filter(Boolean).join(" / ")}）`, code, category, stage }, { status: 503, headers });
  }
}
