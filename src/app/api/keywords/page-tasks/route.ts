import { NextResponse } from "next/server";
import { isDatabaseConfigured } from "@/lib/env";
import { databaseErrorCode } from "@/lib/database-read";
import { loadKeywordPageTasks } from "@/lib/services/keyword-page-task-read";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
const headers = { "Cache-Control": "private, no-store" };

// The session-authenticated proxy protects this read-only management route.
export async function GET() {
  if (!isDatabaseConfigured()) return NextResponse.json({ message: "数据库未配置，暂时无法读取页面任务" }, { status: 503, headers });
  try { return NextResponse.json(await loadKeywordPageTasks(), { headers }); }
  catch (error) {
    const code = databaseErrorCode(error);
    console.error("Keyword page tasks read failed", code);
    return NextResponse.json({ message: "页面任务暂时无法读取，请稍后重试", code }, { status: 503, headers });
  }
}
