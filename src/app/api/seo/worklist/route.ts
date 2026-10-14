import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { AUTH_COOKIE_NAME, isAuthEnabled, isValidAuthToken } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  if (!isAuthEnabled() || !(await isValidAuthToken((await cookies()).get(AUTH_COOKIE_NAME)?.value))) return NextResponse.json({ message: "需要登录" }, { status: 401 });
  try {
    const sites = await prisma.seoSite.findMany({ where: { active: true }, select: { domain: true, name: true, ga4PropertyId: true } });
    const links = await prisma.$queryRaw<Array<{ siteDomain: string; keyword: string; topic: string; origin: string; targetUrls: string[] }>>`
      SELECT sk."siteDomain", k."text" AS keyword, t."text" AS topic, sk."origin", sk."targetUrls"
      FROM "SiteKeyword" sk JOIN "Keyword" k ON k.id = sk."keywordId" JOIN "Topic" t ON t.id = sk."topicId"
      WHERE sk."active" = true AND k."active" = true
    `;
    const recentImports = await prisma.rankingImport.findMany({ orderBy: { importedAt: "desc" }, take: 1000, select: { requestId: true, count: true, siteDomain: true, importedAt: true } });
    return new NextResponse(JSON.stringify({ recentImports, generatedAt: new Date().toISOString(), regions: ["US", "JP", "ES", "BR"], sites: sites.map((site) => ({ ...site, keywords: links.filter((link) => link.siteDomain === site.domain).map((link) => ({ keyword: link.keyword, topic: link.topic, origin: link.origin, targetUrls: link.targetUrls })) })) }), {
      headers: { "Content-Type": "application/json; charset=utf-8", "Content-Disposition": "attachment; filename=seo-daily-worklist.json", "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : "UNKNOWN";
    console.error("Worklist export failed", code);
    return NextResponse.json({ message: `清单导出失败（${code}），请重试` }, { status: 503 });
  }
}
