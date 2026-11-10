import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getRankingImportSecret } from "@/lib/import-credential";
import { importSecretMatches } from "@/lib/ranking-import";
import { authorizeAnalyticsRead, privateAnalyticsHeaders as headers } from "@/lib/seo-analytics-access";
import { organicPeriodId, organicPeriodSchema } from "@/lib/seo-organic-period";

export const dynamic = "force-dynamic";
const authorized = (request: Request) => { const secret = getRankingImportSecret(); return !request.headers.get("origin") && Boolean(secret && importSecretMatches(request.headers.get("authorization"), secret)); };
export async function GET(request: Request) {
  if (!authorized(request) && !await authorizeAnalyticsRead(request)) return Response.json({ message: "请先登录" }, { status: 401, headers });
  try {
    const start = z.iso.date().parse(new URL(request.url).searchParams.get("start"));
    const rows = await prisma.seoReportVersion.findMany({ where: { siteDomain: "flatkey.ai", kind: "ORGANIC_PERIOD", periodStart: new Date(start) }, orderBy: { createdAt: "desc" }, take: 100, select: { id: true, payload: true } });
    return Response.json({ rows }, { headers });
  } catch (error) { return Response.json({ message: "区间日期无效或暂时无法读取" }, { status: error instanceof z.ZodError ? 400 : 503, headers }); }
}
export async function POST(request: Request) {
  if (!authorized(request)) return Response.json({ message: "需要服务器采集凭据" }, { status: 401, headers });
  try {
    const body = await request.text();
    if (body.length > 16000) return Response.json({ message: "请求过大" }, { status: 413, headers });
    const row = organicPeriodSchema.parse(JSON.parse(body)), id = organicPeriodId(row);
    await prisma.seoReportVersion.createMany({ data: { id, siteDomain: row.siteDomain, kind: "ORGANIC_PERIOD", periodStart: new Date(row.start), periodEnd: new Date(row.end), createdAt: new Date(row.observedAt), payload: row as Prisma.InputJsonValue }, skipDuplicates: true });
    const stored = await prisma.seoReportVersion.findUniqueOrThrow({ where: { id }, select: { payload: true } });
    if (organicPeriodId(organicPeriodSchema.parse(stored.payload)) !== id) throw Error("readback_failed");
    return Response.json({ stored: true, id, period: stored.payload }, { headers });
  } catch (error) { return Response.json({ message: "区间数据无效或保存失败" }, { status: error instanceof z.ZodError || error instanceof SyntaxError ? 400 : 503, headers }); }
}
