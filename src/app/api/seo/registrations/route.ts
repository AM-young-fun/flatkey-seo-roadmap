import { ZodError } from "zod";
import { analyticsLocalPreview, authorizeAnalyticsRead, privateAnalyticsHeaders as headers } from "@/lib/seo-analytics-access";
import { businessCountrySchema } from "@/lib/seo-business-analytics";
import { propertyToday, validRange } from "@/lib/seo-date-range";
import { authenticateImportToken } from "@/lib/services/import-tokens";
import { loadRegistrationDays, saveRegistrationDays } from "@/lib/services/seo-registration-days";

export const dynamic = "force-dynamic";
const importAuthorized = (request: Request) => !request.headers.get("origin") && authenticateImportToken(request);

export async function GET(request: Request) {
  const preview = analyticsLocalPreview(request);
  if (!preview && !await authorizeAnalyticsRead(request) && !await importAuthorized(request)) {
    return Response.json({ message: "请先登录" }, { status: 401, headers });
  }
  const params = new URL(request.url).searchParams;
  const country = businessCountrySchema.safeParse(params.get("country") ?? "all");
  const range = { start: params.get("start") ?? "", end: params.get("end") ?? "" };
  if (!country.success || !validRange(range) || range.end >= propertyToday() || Date.parse(range.end) - Date.parse(range.start) > 365 * 86400000) {
    return Response.json({ message: "请选择有效国家和已结束日期，一次最多查询 366 天。" }, { status: 400, headers });
  }
  try {
    if (preview) {
      const query = new URLSearchParams({ ...range, country: country.data });
      const upstream = await fetch("https://flatkey-seo-roadmap.vercel.app/api/seo/registrations?" + query, {
        headers: { Authorization: `Bearer ${process.env.SEO_PREVIEW_UPSTREAM_TOKEN}` },
        cache: "no-store", redirect: "error", signal: AbortSignal.timeout(15000),
      });
      if (!upstream.ok) throw Error("registration_preview_unavailable");
      return Response.json(await upstream.json(), { headers });
    }
    return Response.json({ daily: await loadRegistrationDays(range, country.data) }, { headers });
  } catch {
    return Response.json({ message: "暂时无法读取 Flatkey 注册数据。" }, { status: 503, headers });
  }
}

export async function POST(request: Request) {
  if (!await importAuthorized(request)) return Response.json({ message: "需要服务器采集凭据" }, { status: 401, headers });
  try {
    const body = await request.text();
    if (body.length > 20000) return Response.json({ message: "请求过大" }, { status: 413, headers });
    return Response.json(await saveRegistrationDays(JSON.parse(body)), { headers });
  } catch (error) {
    return Response.json({ message: "注册数据无效或未保存。" }, { status: error instanceof ZodError || error instanceof SyntaxError ? 400 : 503, headers });
  }
}
