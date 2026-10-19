import { displayDataChanged } from "@/lib/services/display-change";
import { NextResponse } from "next/server";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { isDatabaseConfigured } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { ImportRequestError, readImportJson } from "@/lib/ranking-import";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const reviewSchema = z.object({
  siteDomain: z.enum(["flatkey.ai", "rackrate.org", "modelfit.cc"]),
  action: z.enum(["exclude", "restore"]),
  keywordIds: z.array(z.string().trim().min(1).max(200)).max(500).default([]),
  keywords: z.array(z.string().trim().min(1).max(2000).refine((value) => new TextEncoder().encode(value).length <= 2000)).max(500).default([]),
}).strict().superRefine((value, ctx) => {
  const count = value.keywordIds.length + value.keywords.length;
  if (count < 1 || count > 500) ctx.addIssue({ code: "custom", message: "每次请选择 1–500 个关键词" });
});

export async function GET(request: Request) {
  if (!isDatabaseConfigured()) return NextResponse.json({ message: "DATABASE_URL is not configured" }, { status: 503 });
  const params = new URL(request.url).searchParams;
  const parsed = z.object({
    siteDomain: z.enum(["flatkey.ai", "rackrate.org", "modelfit.cc"]),
    page: z.coerce.number().int().min(1).max(100000).default(1),
    pageSize: z.coerce.number().int().min(1).max(500).default(100),
  }).safeParse({ siteDomain: params.get("siteDomain"), page: params.get("page") ?? undefined, pageSize: params.get("pageSize") ?? undefined });
  if (!parsed.success) return NextResponse.json({ message: "归档查询参数无效" }, { status: 400 });
  try {
    const { siteDomain, page, pageSize } = parsed.data;
    const where = { siteDomain, active: false };
    const [total, links] = await Promise.all([
      prisma.siteKeyword.count({ where }),
      prisma.siteKeyword.findMany({ where, orderBy: { keywordId: "asc" }, skip: (page - 1) * pageSize, take: pageSize,
        select: { keywordId: true, exclusionReason: true, excludedAt: true, keyword: { select: { text: true } } },
      }),
    ]);
    return NextResponse.json({ siteDomain, total, page, pageSize, nextPage: page * pageSize < total ? page + 1 : null,
      keywords: links.map(link => ({ id: link.keywordId, text: link.keyword.text, siteDomain, exclusionReason: link.exclusionReason ?? "历史停用记录", excludedAt: link.excludedAt?.toISOString() ?? null })),
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return NextResponse.json({ message: "归档记录读取失败，请重试" }, { status: 503 });
  }
}

// This route uses the existing session-authenticated proxy, rather than the
// collector's Bearer credential. Only an explicit review can restore a word.
export async function POST(request: Request) {
  if (!isDatabaseConfigured()) return NextResponse.json({ message: "DATABASE_URL is not configured" }, { status: 503 });
  try {
    const parsed = reviewSchema.safeParse(await readImportJson(request));
    if (!parsed.success) return NextResponse.json({ message: "关键词筛检参数无效", errors: parsed.error.issues }, { status: 400 });
    const { siteDomain, action } = parsed.data;
    const keywordIds = [...new Set(parsed.data.keywordIds)];
    const keywords = [...new Set(parsed.data.keywords.map((text) => text.toLowerCase()))];
    const site = await prisma.seoSite.findUnique({ where: { domain: siteDomain } });
    if (!site?.active) return NextResponse.json({ message: "网站未启用" }, { status: 400 });
    const result = await prisma.$transaction(async (transaction) => {
      // Serialize reviews with both CSV and automatic ranking imports.
      await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`seo-import:${siteDomain}`}))`;
      const selectors: Prisma.SiteKeywordWhereInput[] = [];
      if (keywordIds.length) selectors.push({ keywordId: { in: keywordIds } });
      if (keywords.length) selectors.push({ keyword: { text: { in: keywords, mode: "insensitive" } } });
      const links = await transaction.siteKeyword.findMany({
        where: { siteDomain, OR: selectors },
        select: { keywordId: true, active: true, keyword: { select: { text: true } } },
      });
      const active = action === "restore";
      const changedIds = links.filter((link) => link.active !== active).map((link) => link.keywordId);
      const changed = changedIds.length ? (await transaction.siteKeyword.updateMany({
        where: { siteDomain, keywordId: { in: changedIds }, active: !active },
        data: { active, pool: active ? "RESEARCH" : "ARCHIVED", reviewStatus: active ? "RESTORED_FOR_RESEARCH" : "MANUALLY_ARCHIVED", excludedAt: active ? null : new Date(), exclusionReason: active ? null : "手动移除：经人工筛检", restoredAt: active ? new Date() : null },
      })).count : 0;
      const matchedIds = new Set(links.map((link) => link.keywordId));
      const matchedTexts = new Set(links.map((link) => link.keyword.text.toLowerCase()));
      return {
        siteDomain, action, matched: links.length, changed, unchanged: links.length - changed,
        notFound: { keywordIds: keywordIds.filter((id) => !matchedIds.has(id)), keywords: keywords.filter((text) => !matchedTexts.has(text)) },
        keywords: links.map((link) => ({ id: link.keywordId, text: link.keyword.text, active })),
      };
    }, { timeout: 55_000, maxWait: 5000 });
    await displayDataChanged();
    return NextResponse.json(result, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof ImportRequestError) return NextResponse.json({ message: error.message }, { status: error.status });
    console.error("Keyword review failed");
    return NextResponse.json({ message: "关键词筛检保存失败，请重试" }, { status: 503 });
  }
}
