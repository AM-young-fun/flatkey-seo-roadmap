import { NextResponse } from "next/server";
import { z } from "zod";
import { isDatabaseConfigured } from "@/lib/env";
import { ImportRequestError, readImportJson } from "@/lib/ranking-import";
import { loadCandidateReview, applyCandidateReview } from "@/lib/services/candidate-keyword-review";
import { displayDataChanged } from "@/lib/services/display-change";
import { syncDisplaySourceVersion } from "@/lib/services/display-snapshots";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
const headers = { "Cache-Control": "private, no-store" };
const schema = z.object({ keywordIds: z.array(z.string().min(1).max(200)).min(1).max(5000), expectedStateHash: z.string().regex(/^[a-f0-9]{64}$/) }).strict();

export async function GET() {
  if (!isDatabaseConfigured()) return NextResponse.json({ message: "数据库未配置" }, { status: 503, headers });
  try {
    const result = await loadCandidateReview();
    await syncDisplaySourceVersion();
    return NextResponse.json(result, { headers });
  }
  catch { return NextResponse.json({ message: "候选词预览读取失败，请重试" }, { status: 503, headers }); }
}
export async function POST(request: Request) {
  if (request.headers.get("origin") && request.headers.get("origin") !== new URL(request.url).origin) return NextResponse.json({ message: "请求来源无效" }, { status: 403, headers });
  if (!isDatabaseConfigured()) return NextResponse.json({ message: "数据库未配置" }, { status: 503, headers });
  try {
    const parsed = schema.safeParse(await readImportJson(request));
    if (!parsed.success) return NextResponse.json({ message: "请选择 1–5000 个候选词并提供当前预览" }, { status: 400, headers });
    const result = await applyCandidateReview(parsed.data.keywordIds, parsed.data.expectedStateHash);
    await displayDataChanged();
    return NextResponse.json(result, { headers });
  } catch (error) {
    if (error instanceof ImportRequestError) return NextResponse.json({ message: error.message }, { status: error.status, headers });
    return NextResponse.json({ message: "候选词移除失败，请刷新预览核对状态" }, { status: 503, headers });
  }
}
