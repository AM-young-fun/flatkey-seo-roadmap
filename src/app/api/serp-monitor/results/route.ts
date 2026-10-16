import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { AUTH_COOKIE_NAME, isAuthEnabled, isValidAuthToken } from "@/lib/auth";
import { isDatabaseConfigured } from "@/lib/env";
import { databaseErrorCode, retryDatabaseRead } from "@/lib/database-read";
import { REGION_CODES, type SearchRegionCode } from "@/lib/seo";
import { SERP_MARKET_LANGUAGE } from "@/lib/serp-results";
import { loadSerpResults } from "@/lib/services/serp-results";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
const headers = { "Cache-Control": "private, no-store" };

export async function GET(request: Request) {
  if (!isAuthEnabled() || !await isValidAuthToken((await cookies()).get(AUTH_COOKIE_NAME)?.value))
    return NextResponse.json({ message: "需要登录后查看实测排名" }, { status: 401, headers });
  if (!isDatabaseConfigured()) return NextResponse.json({ message: "数据库未配置" }, { status: 503, headers });
  const params = new URL(request.url).searchParams, site = params.get("site") ?? "all", region = params.get("region") ?? "US";
  if (!["all", "flatkey.ai", "rackrate.org", "modelfit.cc"].includes(site) || !REGION_CODES.includes(region as SearchRegionCode))
    return NextResponse.json({ message: "网站或地区无效" }, { status: 400, headers });
  const language = params.get("language") ?? SERP_MARKET_LANGUAGE[region as SearchRegionCode], device = params.get("device") ?? "desktop";
  if (!/^[a-z]{2}(?:-[A-Z]{2})?$/.test(language) || !["desktop", "mobile"].includes(device))
    return NextResponse.json({ message: "语言或设备无效" }, { status: 400, headers });
  try {
    return NextResponse.json(await retryDatabaseRead(() => loadSerpResults(site, region as SearchRegionCode, language, device)), { headers });
  } catch (error) {
    const code = databaseErrorCode(error);
    console.error("SERP ranking read failed", { code });
    return NextResponse.json({ message: "实测排名暂时读取失败，请稍后刷新", code }, { status: 503, headers });
  }
}
