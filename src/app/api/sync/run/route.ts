import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Retire the legacy SerpApi worker even when a deployment still has its old
// credentials or enable flag. A request here can never call that provider.
function retired() {
  return NextResponse.json({ status: "RETIRED", message: "旧版SerpApi抓取入口已停用，请使用DataForSEO SERP实测计划。付费执行保持关闭。", paidRequests: 0 },
    { status: 410, headers: { "Cache-Control": "private, no-store" } });
}
export const GET = retired;
export const POST = retired;
