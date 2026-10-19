import { displayDataChanged } from "@/lib/services/display-change";
import { importFailure } from "@/lib/import-failure";
import { importSeo } from "@/lib/services/seo-import";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isDatabaseConfigured } from "@/lib/env";
import { normalizeDomain } from "@/lib/seo";
import { getRankingImportSecret } from "@/lib/import-credential";
import { canMonitorKeyword } from "@/lib/keyword-monitoring";
import { loadLatestPageAudits } from "@/lib/services/keyword-page-audit-state";
import {
  importSecretMatches,
  ImportRequestError,
  rankingImportSchema,
  readImportJson,
} from "@/lib/ranking-import";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorize(request: Request) {
  const secret = getRankingImportSecret();
  if (!secret)
    return NextResponse.json(
      { message: "RANKING_IMPORT_SECRET is not configured" },
      { status: 503 },
    );
  if (!importSecretMatches(request.headers.get("authorization"), secret)) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }
  if (!isDatabaseConfigured())
    return NextResponse.json(
      { message: "DATABASE_URL is not configured" },
      { status: 503 },
    );
}

// The same narrowly scoped credential lets the daily collector read its work list.
export async function GET(request: Request) {
  const error = authorize(request);
  if (error) return error;
  const targetDomain = normalizeDomain(new URL(request.url).searchParams.get("site") ?? process.env.SEO_TARGET_DOMAIN ?? "flatkey.ai");
  const site = await prisma.seoSite.findUnique({ where: { domain: targetDomain } });
  if (!site?.active) return NextResponse.json({ message: "网站未启用" }, { status: 400 });
  const curationApplied = targetDomain === "flatkey.ai" && Boolean(await prisma.keywordCurationAudit.findFirst({ where: { siteDomain: targetDomain, status: "APPLIED" }, select: { id: true } }));
  const keywords = await prisma.siteKeyword.findMany({
    where: { siteDomain: targetDomain, active: true, keyword: { active: true } }, include: { keyword: true, topic: true },
  });
  const audits = await loadLatestPageAudits(targetDomain === "flatkey.ai" ? keywords.map(link => link.keywordId) : []);
  const audited = keywords.map(link => ({ ...link, latestPageAuditVerdict: targetDomain === "flatkey.ai" ? audits.get(link.keywordId)?.verdict ?? null : null }));
  return NextResponse.json({ targetDomain, curationApplied, ga4PropertyId: site.ga4PropertyId,
    regions: ["US", "JP", "ES", "BR"],
    keywords: audited.filter(canMonitorKeyword).map((link) => ({ id: link.keywordId, keyword: link.keyword.text, topic: link.topic?.text ?? null, origin: link.origin, targetUrls: link.targetUrls, latestPageAuditVerdict: link.latestPageAuditVerdict })),
    candidates: audited.filter(link => !canMonitorKeyword(link)).map((link) => ({ id: link.keywordId, keyword: link.keyword.text, topic: link.topic?.text ?? null, origin: link.origin, pool: link.pool, mappingStatus: link.mappingStatus, targetUrls: link.targetUrls, latestPageAuditVerdict: link.latestPageAuditVerdict })),
  }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const authError = authorize(request);
  if (authError) return authError;
  let requestId: string | undefined;
  try {
    const parsed = rankingImportSchema.safeParse(await readImportJson(request));
    if (!parsed.success)
      return NextResponse.json(
        { message: "导入数据校验失败", errors: parsed.error.issues },
        { status: 400 },
      );
    requestId = parsed.data.requestId;
    const result = await importSeo(parsed.data);
    if (!result.duplicate) await displayDataChanged();
    return NextResponse.json(result, { status: result.duplicate ? 200 : 201 });
  } catch (error) {
    if (error instanceof ImportRequestError)
      return NextResponse.json(
        { message: error.message },
        { status: error.status },
      );
    const failure = importFailure(error, requestId);
    console.error("SEO import failed", {code:failure.body.code,requestId});
    return NextResponse.json(failure.body, {status:failure.status,headers:failure.headers});
  }
}
