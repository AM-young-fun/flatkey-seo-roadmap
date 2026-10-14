import { importSeo } from "@/lib/services/seo-import";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isDatabaseConfigured } from "@/lib/env";
import { normalizeDomain } from "@/lib/seo";
import { getRankingImportSecret } from "@/lib/import-credential";
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
  const keywords = await prisma.siteKeyword.findMany({
    where: { siteDomain: targetDomain, active: true }, include: { keyword: true, topic: true },
  });
  return NextResponse.json({ targetDomain, ga4PropertyId: site.ga4PropertyId,
    regions: ["US", "JP", "ES", "BR"],
    keywords: keywords.map((link) => ({ id: link.keywordId, keyword: link.keyword.text, topic: link.topic?.text ?? null, origin: link.origin, targetUrls: link.targetUrls })),
  }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const authError = authorize(request);
  if (authError) return authError;
  try {
    const parsed = rankingImportSchema.safeParse(await readImportJson(request));
    if (!parsed.success)
      return NextResponse.json(
        { message: "导入数据校验失败", errors: parsed.error.issues },
        { status: 400 },
      );
    const result = await importSeo(parsed.data);
    return NextResponse.json(result, { status: result.duplicate ? 200 : 201 });
  } catch (error) {
    if (error instanceof ImportRequestError)
      return NextResponse.json(
        { message: error.message },
        { status: error.status },
      );
    console.error(
      "Ranking import failed",
      error instanceof Error ? error.name : "Unknown error",
    );
    return NextResponse.json(
      { message: "导入失败，未写入本批数据，请使用相同 requestId 重试" },
      { status: 500 },
    );
  }
}
