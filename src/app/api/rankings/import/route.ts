import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
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
  const keywords = await prisma.keyword.findMany({
    where: { active: true, topicId: { not: null } },
    select: { id: true, text: true, topic: { select: { text: true } } },
    orderBy: { text: "asc" },
  });
  return NextResponse.json(
    {
      targetDomain: process.env.SEO_TARGET_DOMAIN ?? null,
      regions: ["US", "JP", "ES", "BR"],
      keywords: keywords.map((keyword) => ({
        id: keyword.id,
        keyword: keyword.text,
        topic: keyword.topic?.text ?? null,
      })),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
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
    const payload = parsed.data;
    const targetDomain = normalizeDomain(process.env.SEO_TARGET_DOMAIN ?? "");
    if (!targetDomain)
      throw new ImportRequestError("SEO_TARGET_DOMAIN is not configured", 503);
    if (normalizeDomain(payload.targetDomain) !== targetDomain)
      throw new ImportRequestError("目标域名不匹配", 400);
    const observations = [...payload.observations].sort((a, b) =>
      `${a.keyword.toLowerCase()}:${a.region}:${a.source}`.localeCompare(
        `${b.keyword.toLowerCase()}:${b.region}:${b.source}`,
      ),
    );
    const payloadHash = createHash("sha256")
      .update(JSON.stringify({ targetDomain, observations }))
      .digest("hex");
    const replay = (batch: {
      id: string;
      payloadHash: string;
      count: number;
      importedAt: Date;
    }) => {
      if (batch.payloadHash !== payloadHash)
        throw new ImportRequestError("requestId 已被不同内容使用", 409);
      return {
        importId: batch.id,
        requestId: payload.requestId,
        imported: batch.count,
        duplicate: true,
        importedAt: batch.importedAt.toISOString(),
      };
    };
    const existing = await prisma.rankingImport.findUnique({
      where: { requestId: payload.requestId },
    });
    if (existing) return NextResponse.json(replay(existing));
    const keywords = await prisma.keyword.findMany({
      where: { active: true, topicId: { not: null } },
      select: { id: true, text: true },
    });
    const byText = new Map(
      keywords.map((keyword) => [keyword.text.toLowerCase(), keyword]),
    );
    const ambiguous = new Set<string>();
    const seenTexts = new Set<string>();
    for (const keyword of keywords) {
      const text = keyword.text.toLowerCase();
      if (seenTexts.has(text)) ambiguous.add(text);
      seenTexts.add(text);
    }
    const unknown = observations.filter(
      (row) =>
        !byText.has(row.keyword.toLowerCase()) ||
        ambiguous.has(row.keyword.toLowerCase()),
    );
    if (unknown.length)
      return NextResponse.json(
        {
          message: "关键词未启用、不在当前列表或大小写匹配不唯一，整批未写入",
          keywords: [...new Set(unknown.map((row) => row.keyword))],
        },
        { status: 422 },
      );
    let result;
    try {
      result = await prisma.$transaction(
        async (tx) => {
          const batch = await tx.rankingImport.create({
            data: {
              requestId: payload.requestId,
              payloadHash,
              count: observations.length,
            },
          });
          await tx.keywordObservation.createMany({
            data: observations.map((row) => ({
              keywordId: byText.get(row.keyword.toLowerCase())!.id,
              importId: batch.id,
              region: row.region,
              source: row.source,
              rank: row.rank ?? null,
              rankReported: row.rank !== undefined,
              volume: row.volume,
              clicks: row.clicks,
              impressions: row.impressions,
              ctr: row.ctr,
              periodStart: row.periodStart
                ? new Date(`${row.periodStart}T00:00:00Z`)
                : null,
              periodEnd: row.periodEnd
                ? new Date(`${row.periodEnd}T00:00:00Z`)
                : null,
              collectedAt: new Date(row.collectedAt),
            })),
          });
          return {
            importId: batch.id,
            requestId: batch.requestId,
            imported: batch.count,
            duplicate: false,
            importedAt: batch.importedAt.toISOString(),
          };
        },
        { timeout: 30_000 },
      );
    } catch (error) {
      // Concurrent retries may both pass the first lookup. The unique key and
      // transaction ensure only one batch is committed.
      if (
        !(error instanceof Prisma.PrismaClientKnownRequestError) ||
        error.code !== "P2002"
      )
        throw error;
      const batch = await prisma.rankingImport.findUnique({
        where: { requestId: payload.requestId },
      });
      if (!batch) throw error;
      result = replay(batch);
    }
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
