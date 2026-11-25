import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { AUTH_COOKIE_NAME, isAuthEnabled, isValidAuthToken } from "@/lib/auth";
import { isDatabaseConfigured } from "@/lib/env";
import { retryDatabaseRead } from "@/lib/database-read";
import { analyticsLocalPreview } from "@/lib/seo-analytics-access";
import { configurationOnlyOperationsStatus } from "@/lib/operations";
import { automationSchedulePage } from "@/lib/seo-automation-schedule";
import { loadAutomationSchedulePage, loadOperationsStatus } from "@/lib/services/operations";
import { collectionControlSchema } from "@/lib/collection-control";
import { mutateCollectionControl } from "@/lib/services/collection-control";
import { ImportRequestError, readImportJson } from "@/lib/ranking-import";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;
const headers = { "Cache-Control": "private, no-store" };
export async function GET(request: Request) {
  const preview = analyticsLocalPreview(request);
  if (!preview && (!isAuthEnabled() || !await isValidAuthToken((await cookies()).get(AUTH_COOKIE_NAME)?.value))) return NextResponse.json({ message: "请先登录" }, { status: 401, headers });
  const params = new URL(request.url).searchParams;
  const schedule = params.get("view") === "schedule", pageText = params.get("page") ?? "1", page = Number(pageText);
  if (schedule && (!/^[1-9]\d*$/.test(pageText) || !Number.isSafeInteger(page) || params.getAll("page").length > 1)) {
    return NextResponse.json({ message: "定时任务页码无效" }, { status: 400, headers });
  }
  const fallback = (note?: string) => {
    const status = configurationOnlyOperationsStatus(new Date(), note);
    return NextResponse.json(schedule ? automationSchedulePage(status, page) : status, { headers });
  };
  if (!isDatabaseConfigured()) return fallback(preview ? "本地预览未连接执行数据库，显示已回读配置；最近运行待核实。" : "执行数据库未配置，显示已回读配置；最近运行待核实。");
  try {
    const status = schedule ? await retryDatabaseRead(() => loadAutomationSchedulePage(page)) : await retryDatabaseRead(loadOperationsStatus);
    return NextResponse.json(status, { headers });
  } catch { return fallback(); }
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
