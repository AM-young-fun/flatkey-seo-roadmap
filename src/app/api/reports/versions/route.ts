import { previewReportVersions } from "@/lib/preview-report-versions";
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { z } from "zod";
import { AUTH_COOKIE_NAME, isAuthEnabled, isValidAuthToken } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { parseDailySeoTrafficQuery } from "@/lib/daily-seo-traffic";
import { loadDailySeoTrafficHistory } from "@/lib/services/daily-seo-traffic";
import { loadDailySeoPageGroupsHistory } from "@/lib/services/daily-seo-page-groups";
import { reportInputSchema, reportPayload, validateReportRanges } from "@/lib/seo-report";
import type { DateRange } from "@/lib/seo-date-range";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };
async function authorized() { return isAuthEnabled() && await isValidAuthToken((await cookies()).get(AUTH_COOKIE_NAME)?.value); }

export async function GET(request: Request) {
  try { const preview = await previewReportVersions(request); if (preview) return preview; }
  catch { return NextResponse.json({ message: "本地归档读取失败" }, { status: 503, headers }); }
  if (!await authorized()) return NextResponse.json({ message: "请先登录" }, { status: 401, headers });
  const id = new URL(request.url).searchParams.get("id");
  if (id && !z.uuid().safeParse(id).success) return NextResponse.json({ message: "报告编号无效" }, { status: 400, headers });
  try {
    if (id) {
      const version = await prisma.seoReportVersion.findFirst({ where: { id, siteDomain: "flatkey.ai", kind: "INTERVAL" } });
      return version ? NextResponse.json(version, { headers }) : NextResponse.json({ message: "报告不存在" }, { status: 404, headers });
    }
    return NextResponse.json(await prisma.seoReportVersion.findMany({ where: { siteDomain: "flatkey.ai", kind: "INTERVAL" }, orderBy: { createdAt: "desc" }, take: 50, select: { id: true, kind: true, periodStart: true, periodEnd: true, createdAt: true } }), { headers });
  } catch { return NextResponse.json({ message: "报告存储未就绪，请检查数据库迁移与连接" }, { status: 503, headers }); }
}

export async function POST(request: Request) {
  try { const preview = await previewReportVersions(request); if (preview) return preview; }
  catch { return NextResponse.json({ message: "本地归档保存失败，可重试" }, { status: 503, headers }); }
  if (!await authorized()) return NextResponse.json({ message: "请先登录" }, { status: 401, headers });
  if (request.headers.get("origin") !== new URL(request.url).origin) return NextResponse.json({ message: "请求来源无效" }, { status: 403, headers });
  let input;
  try { input = reportInputSchema.parse(await request.json()); validateReportRanges(input); }
  catch { return NextResponse.json({ message: "仅支持1至366个已结束日，请核对日期和报告编号" }, { status: 400, headers }); }
  try {
    const existing = await prisma.seoReportVersion.findUnique({ where: { id: input.id } });
    if (existing) {
      const payload = existing.payload as { comparisonRange?: DateRange | null };
      if (existing.siteDomain !== "flatkey.ai" || existing.periodStart.toISOString().slice(0, 10) !== input.start || existing.periodEnd.toISOString().slice(0, 10) !== input.end
        || JSON.stringify(payload.comparisonRange ?? null) !== JSON.stringify(input.comparison ?? null)) {
        return NextResponse.json({ message: "请求编号与已保存区间冲突" }, { status: 409, headers });
      }
      return NextResponse.json(existing, { headers });
    }
    const load = async (range: DateRange) => {
      const query = parseDailySeoTrafficQuery(new URLSearchParams(range));
      const [daily, groups] = await Promise.all([loadDailySeoTrafficHistory(query), loadDailySeoPageGroupsHistory({ ...query, ruleVersion: 1 })]);
      return { daily, groups };
    };
    const [current, comparison] = await Promise.all([load({ start: input.start, end: input.end }), input.comparison ? load(input.comparison) : null]);
    const payload = JSON.parse(JSON.stringify(reportPayload(input, current, comparison)));
    const saved = await prisma.seoReportVersion.create({ data: { id: input.id, siteDomain: "flatkey.ai", kind: "INTERVAL", periodStart: new Date(input.start), periodEnd: new Date(input.end), payload } });
    return NextResponse.json(saved, { status: 201, headers });
  } catch { return NextResponse.json({ message: "报告保存失败，保留相同请求编号可重试" }, { status: 503, headers }); }
}
