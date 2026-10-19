import { NextResponse } from "next/server";
import { isDatabaseConfigured } from "@/lib/env";
import { pageAuditDomainSchema, type PageAuditDomain } from "@/lib/page-audit";
import { CONTENT_TARGET_RANK, exportRegionSchema, opportunitiesCsv } from "@/lib/keyword-export";
import { authenticateExportApiKey } from "@/lib/services/export-api-keys";
import { loadContentOpportunities } from "@/lib/services/content-opportunities";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
const headers = { "Cache-Control": "private, no-store", Vary: "Authorization, X-API-Key", "X-Content-Type-Options": "nosniff" };
export async function GET(request: Request) {
  if (!isDatabaseConfigured()) return NextResponse.json({ message: "数据库未配置" }, { status: 503, headers });
  try {
    const key = await authenticateExportApiKey(request);
    if (!key) return NextResponse.json({ message: "API Key 缺失、无效或已停用" }, { status: 401, headers: { ...headers, "WWW-Authenticate": "Bearer" } });
    const params = new URL(request.url).searchParams;
    const format = params.get("format") ?? "json", requestedSite = params.get("siteDomain");
    const region = exportRegionSchema.safeParse(params.get("region") ?? "all");
    if (!region.success) return NextResponse.json({ message: "region 仅支持 all、US、JP、ES、BR" }, { status: 400, headers });
    if (!["json", "csv"].includes(format) || (requestedSite !== null && !pageAuditDomainSchema.safeParse(requestedSite).success)) {
      return NextResponse.json({ message: "format 仅支持 json/csv；siteDomain 仅支持 flatkey.ai、rackrate.org、modelfit.cc" }, { status: 400, headers });
    }
    if (key.siteDomain && requestedSite && key.siteDomain !== requestedSite) return NextResponse.json({ message: "此 API Key 无权导出该网站" }, { status: 403, headers });
    const siteDomain = (requestedSite ?? key.siteDomain) as PageAuditDomain | null;
    const rows = await loadContentOpportunities(siteDomain, region.data);
    // Recheck revocation after the read; an in-flight export cannot update a revoked key.
    const used = await prisma.keywordExportApiKey.updateMany({ where: { id: key.id, revokedAt: null }, data: { lastUsedAt: new Date() } });
    if (!used.count) return NextResponse.json({ message: "API Key 已停用" }, { status: 401, headers });
    if (format === "csv") return new Response(opportunitiesCsv(rows), { headers: { ...headers, "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="content-opportunities-${siteDomain ?? "all"}.csv"` } });
    return NextResponse.json({ kind: "content-opportunities", generatedAt: new Date().toISOString(), siteDomain, region: region.data,
      targetRank: CONTENT_TARGET_RANK, rankingSource: "dataforseo_serp", total: rows.length,
      summary: { outsideTop100: rows.length }, rows }, { headers });
  } catch {
    return NextResponse.json({ message: "关键词导出暂时不可用，请稍后重试" }, { status: 503, headers });
  }
}
