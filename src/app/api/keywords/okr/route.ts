import { NextResponse } from "next/server";
import { z } from "zod";
import { isDatabaseConfigured } from "@/lib/env";
import { databaseErrorCode } from "@/lib/database-read";
import { ImportRequestError, readImportJson } from "@/lib/ranking-import";
import { loadKeywordOkr, mutateKeywordOkr } from "@/lib/services/keyword-okr";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
const headers = { "Cache-Control": "private, no-store" };
const mutationSchema = z.object({ siteDomain: z.literal("flatkey.ai"), action: z.enum(["preview", "apply", "restore"]), auditId: z.string().min(1).max(160) }).strict();

export async function GET(request: Request) {
  if (!isDatabaseConfigured()) return NextResponse.json({ message: "数据库未配置，尚未应用正式目标清单" }, { status: 503, headers });
  try {
    const params = new URL(request.url).searchParams, site = params.get("site") ?? "flatkey.ai", pool = params.get("pool");
    if (pool !== null && pool !== "FORMAL" && pool !== "RESEARCH") return NextResponse.json({ message: "词库分类无效" }, { status: 400, headers });
    return NextResponse.json(await loadKeywordOkr(site, pool ?? undefined), { headers });
  } catch (error) {
    if (error instanceof ImportRequestError) return NextResponse.json({ message: error.message }, { status: error.status, headers });
    const code = databaseErrorCode(error);
    console.error("Keyword OKR read failed", code);
    return NextResponse.json({ message: "正式目标暂时无法读取，请稍后重试", code }, { status: 503, headers });
  }
}

// The existing session-authenticated proxy protects this route. The collector
// import credential cannot mutate the curated target pool or restore an audit.
export async function POST(request: Request) {
  if (!isDatabaseConfigured()) return NextResponse.json({ message: "DATABASE_URL is not configured" }, { status: 503, headers });
  try {
    const parsed = mutationSchema.safeParse(await readImportJson(request));
    if (!parsed.success) return NextResponse.json({ message: "正式目标操作参数无效", errors: parsed.error.issues }, { status: 400, headers });
    return NextResponse.json(await mutateKeywordOkr(parsed.data), { headers });
  } catch (error) {
    if (error instanceof ImportRequestError) return NextResponse.json({ message: error.message }, { status: error.status, headers });
    console.error("Keyword OKR mutation failed");
    return NextResponse.json({ message: "正式目标保存失败；本次事务未完成，请重试" }, { status: 503, headers });
  }
}
