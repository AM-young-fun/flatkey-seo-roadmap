import { z } from "zod";
import { authenticateImportToken } from "@/lib/services/import-tokens";
import { analyticsLocalPreview, authorizeAnalyticsRead, privateAnalyticsHeaders as headers } from "@/lib/seo-analytics-access";
import { businessCountrySchema, businessScopeSchema, latestBusinessPeriod } from "@/lib/seo-business-analytics";
import { loadBusinessAnalytics, saveBusinessAnalytics } from "@/lib/services/seo-business-analytics";
import { isDatabaseConfigured } from "@/lib/env";

export const dynamic = "force-dynamic";
const authorized = async (request: Request) => !request.headers.get("origin") && await authenticateImportToken(request);
export async function GET(request: Request) {
  if (!await authorized(request) && !await authorizeAnalyticsRead(request)) return Response.json({ message: "请先登录" }, { status: 401, headers });
  try {
    const params = new URL(request.url).searchParams;
    const start = z.iso.date().parse(params.get("start")), end = z.iso.date().parse(params.get("end"));
    if (end < start || Date.parse(end) - Date.parse(start) > 366 * 86400000) return Response.json({ message: "日期区间无效" }, { status: 400, headers });
    const country = businessCountrySchema.parse(params.get("country") ?? "all"), scope = businessScopeSchema.parse(params.get("scope") ?? "session-organic-search");
    if (analyticsLocalPreview(request) && !isDatabaseConfigured()) return Response.json({ record: null, status: "unavailable", message: "本地未接业务归档；GA4上线收数待核验。" }, { headers });
    const rows = await loadBusinessAnalytics(start, end), record = latestBusinessPeriod(rows, start, end, country, scope);
    return Response.json({ record, status: record ? record.complete ? "ready" : "partial" : "missing" }, { headers });
  } catch (error) { return Response.json({ message: "业务数据暂不可读或日期无效" }, { status: error instanceof z.ZodError ? 400 : 503, headers }); }
}
export async function POST(request: Request) {
  if (!await authorized(request)) return Response.json({ message: "需要服务器采集凭据" }, { status: 401, headers });
  try {
    const text = await request.text();
    if (text.length > 20000) return Response.json({ message: "请求过大" }, { status: 413, headers });
    return Response.json(await saveBusinessAnalytics(JSON.parse(text)), { headers });
  } catch (error) { return Response.json({ message: "业务数据无效或未保存" }, { status: error instanceof z.ZodError || error instanceof SyntaxError ? 400 : 503, headers }); }
}
