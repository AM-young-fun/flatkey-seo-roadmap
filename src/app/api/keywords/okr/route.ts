import { NextResponse } from "next/server";
import { z } from "zod";
import { isDatabaseConfigured } from "@/lib/env";
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
    const site = new URL(request.url).searchParams.get("site") ?? "flatkey.ai";
    return NextResponse.json(await loadKeywordOkr(site), { headers });
  } catch (error) {
    if (error instanceof ImportRequestError) return NextResponse.json({ message: error.message }, { status: error.status, headers });
    console.error("Keyword OKR read failed");
    return NextResponse.json({ message: "正式目标读取失败；请确认数据库迁移已完成后重试" }, { status: 503, headers });
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
