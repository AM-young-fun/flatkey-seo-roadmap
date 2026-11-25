import { z } from "zod";
import { authorizeAnalyticsRead } from "@/lib/seo-analytics-access";
import { authorizeSavedRankingCoverage } from "@/lib/services/ranking-coverage-access";
import { loadConversionProjection } from "@/lib/services/seo-conversion";
import { loadExactRegistrationPeriod } from "@/lib/services/seo-registration-period";
import { cohortDay } from "@/lib/seo-api-cohorts";
import { weeklyReportRange } from "@/lib/seo-date-range";
import { GROWTH_COUNTRIES } from "@/lib/seo-growth-markets";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
const querySchema = z.object({ start: z.iso.date(), end: z.iso.date(), site: z.enum(["flatkey.ai", "rackrate.org", "modelfit.cc"]), country: z.enum(["all", ...GROWTH_COUNTRIES]) }).strict();
export async function GET(request: Request) {
  if (!await authorizeAnalyticsRead(request) && !await authorizeSavedRankingCoverage(request)) return Response.json({ message: "请先登录或使用已有SEO只读凭据" }, { status: 401, headers });
  const now = new Date(), params = new URL(request.url).searchParams;
  try {
    const defaultPeriod = weeklyReportRange(cohortDay(now));
    const scope = querySchema.parse({ start: params.get("start") ?? defaultPeriod.start, end: params.get("end") ?? defaultPeriod.end,
      site: params.get("site") ?? "flatkey.ai", country: params.get("country") ?? "all" });
    if ([...params.keys()].some(key => !["start", "end", "site", "country"].includes(key)) || scope.start > scope.end || scope.end >= cohortDay(now)
      || Date.parse(scope.end) - Date.parse(scope.start) > 366 * 86400000) return Response.json({ message: "请选择已结束的有效来源窗口" }, { status: 400, headers });
    const [projection, registration] = await Promise.all([
      loadConversionProjection({ ...scope, timezone: "America/Los_Angeles" }, now),
      scope.site === "flatkey.ai" && scope.country === "all"
        ? loadExactRegistrationPeriod(scope.start, scope.end).catch(() => null)
        : null,
    ]);
    return Response.json({ ...projection, ga4OrganicRegistrants: registration ? { users: registration.users, observedAt: registration.observedAt } : null }, { headers });
  } catch (error) {
    return Response.json({ message: error instanceof z.ZodError ? "转化统计参数无效" : "转化来源暂时无法读取；未新增采集或修改数据" }, { status: error instanceof z.ZodError ? 400 : 503, headers });
  }
}
