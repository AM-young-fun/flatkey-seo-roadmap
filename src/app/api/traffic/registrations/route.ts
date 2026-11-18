import { z } from "zod";
import { authenticateImportToken } from "@/lib/services/import-tokens";
import { authorizeAnalyticsRead, privateAnalyticsHeaders as headers } from "@/lib/seo-analytics-access";
import { loadRegistrationPeriods, saveRegistrationPeriod } from "@/lib/services/seo-registration-period";

export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  if (!await authenticateImportToken(request) && !await authorizeAnalyticsRead(request)) return Response.json({ message: "请先登录" }, { status: 401, headers });
  const params = new URL(request.url).searchParams;
  const range = z.object({ start: z.iso.date(), end: z.iso.date() }).refine(row => row.start <= row.end && Date.parse(row.end) - Date.parse(row.start) <= 366 * 86400000).safeParse({ start: params.get("start"), end: params.get("end") });
  if (!range.success) return Response.json({ message: "日期区间无效" }, { status: 400, headers });
  try { return Response.json({ records: await loadRegistrationPeriods(range.data.start, range.data.end), scope: "first-user-organic-search" }, { headers }); }
  catch { return Response.json({ message: "注册区间读取失败" }, { status: 503, headers }); }
}
export async function POST(request: Request) {
  if (request.headers.get("origin") || !await authenticateImportToken(request)) return Response.json({ message: "需要服务器采集凭据" }, { status: 401, headers });
  try {
    const text = await request.text();
    if (text.length > 10000) return Response.json({ message: "请求过大" }, { status: 413, headers });
    return Response.json(await saveRegistrationPeriod(JSON.parse(text)), { headers });
  } catch (error) { return Response.json({ message: "注册区间无效或未保存" }, { status: error instanceof z.ZodError || error instanceof SyntaxError ? 400 : 503, headers }); }
}
