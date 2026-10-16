import { NextResponse } from "next/server";
import { z } from "zod";
import { isDatabaseConfigured } from "@/lib/env";
import { databaseErrorCategory, databaseErrorCode } from "@/lib/database-read";
import { ImportRequestError, readImportJson } from "@/lib/ranking-import";
import { mergeKeywordPageTasks, pageTaskMergeFailureStage } from "@/lib/services/keyword-page-tasks";
import { pageAuditDomainSchema } from "@/lib/page-audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
const headers = { "Cache-Control": "private, no-store" };
const schema = z.object({ siteDomain: pageAuditDomainSchema, action: z.enum(["preview", "apply"]), expectedStateHash: z.string().regex(/^[a-f0-9]{64}$/).optional() }).strict();

// Session authentication is enforced by the existing proxy. A collector token
// cannot merge editorial tasks, and there is no arbitrary task-list input.
export async function POST(request: Request) {
  if (!isDatabaseConfigured()) return NextResponse.json({ message: "数据库未配置" }, { status: 503, headers });
  try {
    const parsed = schema.safeParse(await readImportJson(request));
    if (!parsed.success) return NextResponse.json({ message: "页面任务合并参数无效", errors: parsed.error.issues }, { status: 400, headers });
    return NextResponse.json(await mergeKeywordPageTasks(parsed.data), { headers });
  } catch (error) {
    if (error instanceof ImportRequestError) return NextResponse.json({ message: error.message }, { status: error.status, headers });
    const code = databaseErrorCode(error), category = databaseErrorCategory(error), stage = pageTaskMergeFailureStage(error);
    console.error("Keyword page task merge failed", { code, category, stage });
    const diagnostic = [stage, code, category].filter(Boolean).join(" / ");
    return NextResponse.json({ message: `页面任务合并未完成，请重新预览后重试（${diagnostic}）`, code, category, stage }, { status: 503, headers });
  }
}
