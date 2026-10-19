import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { AUTH_COOKIE_NAME, isAuthEnabled, isValidAuthToken } from "@/lib/auth";
import { isDatabaseConfigured } from "@/lib/env";
import { databaseErrorCode, retryDatabaseRead } from "@/lib/database-read";
import { ImportRequestError, readImportJson } from "@/lib/ranking-import";
import { serpSampleMutationSchema } from "@/lib/serp-sample";
import { loadSerpSampleEvidence, mutateSerpSample } from "@/lib/services/serp-sample";
import { serpMonitorMutationSchema } from "@/lib/dataforseo-serp";
import { loadSerpMonitorStatus, mutateSerpMonitor } from "@/lib/services/serp-monitor";
import type { SerpRegion } from "@/lib/serp-monitor-types";
import { downloadSerpQueryEvidence, loadSerpQueryEvidence } from "@/lib/services/serp-query-evidence";
import { loadSerpCollectionProgress } from "@/lib/services/serp-collection-progress";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;
const headers = { "Cache-Control": "private, no-store" };
async function authorize() {
  if (!isAuthEnabled() || !await isValidAuthToken((await cookies()).get(AUTH_COOKIE_NAME)?.value)) return NextResponse.json({ message: "需要登录后管理SERP实测排名" }, { status: 401, headers });
  if (!isDatabaseConfigured()) return NextResponse.json({ message: "数据库未配置" }, { status: 503, headers });
}
function failure(error: unknown) {
  if (error instanceof ImportRequestError) return NextResponse.json({ message: error.message }, { status: error.status, headers });
  const code = databaseErrorCode(error);
  console.error("SERP monitor failed", { code });
  return NextResponse.json({ message: "SERP状态暂时无法确认，请保留原采集标识并查看账本，不要重复提交", code }, { status: 503, headers });
}
export async function GET(request: Request) {
  const denied = await authorize(); if (denied) return denied;
  try {
    const params = request && new URL(request.url).searchParams;
    if (params?.has("queryEvidence")) {
      const keyword = params.get("queryEvidence")?.trim() ?? "", region = params.get("region") ?? "US";
      if (!keyword || keyword.length > 700 || !["US", "JP", "ES", "BR"].includes(region)) return NextResponse.json({ message: "查询参数无效" }, { status: 400, headers });
      if (params.get("format") === "html") {
        const evidence = await downloadSerpQueryEvidence(keyword, region as SerpRegion);
        return new NextResponse(JSON.stringify(evidence), { headers: { ...headers, "Content-Type": "application/json; charset=utf-8", "Content-Disposition": 'attachment; filename="serp-evidence.json"', "X-Content-Type-Options": "nosniff" } });
      }
      return NextResponse.json({ evidence: await retryDatabaseRead(() => loadSerpQueryEvidence(keyword, region)) }, { headers });
    }
    if (params && params.get("progress") === "1") {
      const site = params.get("site") ?? "all";
      if (!["all", "flatkey.ai", "rackrate.org", "modelfit.cc"].includes(site)) return NextResponse.json({message:"网站无效"},{status:400,headers});
      return NextResponse.json({progress:await retryDatabaseRead(() => loadSerpCollectionProgress(site))},{headers});
    }
    const evidence = request && new URL(request.url).searchParams.get("sampleEvidence") === "1";
    const value = evidence ? await retryDatabaseRead(loadSerpSampleEvidence) : await retryDatabaseRead(loadSerpMonitorStatus);
    return NextResponse.json(value, { headers });
  }
  catch (error) { return failure(error); }
}
export async function POST(request: Request) {
  const denied = await authorize(); if (denied) return denied;
  try {
    const body = await readImportJson(request);
    const sample = serpSampleMutationSchema.safeParse(body);
    if (sample.success) return NextResponse.json(await mutateSerpSample(sample.data), { headers });
    const parsed = serpMonitorMutationSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ message: "操作参数无效；全量计划仅支持保存为关闭，小批验证需专用费用预览" }, { status: 400, headers });
    // No mutation retry: a start can reserve money and make one paid POST.
    return NextResponse.json(await mutateSerpMonitor(parsed.data), { headers });
  } catch (error) { return failure(error); }
}
