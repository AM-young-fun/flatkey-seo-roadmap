import { analyticsLocalPreview, authorizeAnalyticsRead, privateAnalyticsHeaders as headers } from "@/lib/seo-analytics-access";
import { getRankingImportSecret } from "@/lib/import-credential";
import { importSecretMatches } from "@/lib/ranking-import";
import { isLocalPreviewOrigin } from "@/lib/preview-origin";
import { propertyToday, shiftDay } from "@/lib/seo-date-range";
import { readWeeklyActionPlan, weeklyActionPeriodSchema, weeklyActionsDirectory, writeWeeklyActionPlan } from "@/lib/seo-weekly-actions";

export const dynamic = "force-dynamic";
const currentWeek = () => { const today = propertyToday(); return shiftDay(today, -((new Date(today + "T00:00:00Z").getUTCDay() + 2) % 7)); };
const unavailable = () => Response.json({ message: "周计划尚未配置持久存储" }, { status: 503, headers });

export async function GET(request: Request) {
  if (!await authorizeAnalyticsRead(request)) return Response.json({ message: "请先登录" }, { status: 401, headers });
  if (analyticsLocalPreview(request) && request.headers.get("origin") && !isLocalPreviewOrigin(request)) return Response.json({ message: "请求来源无效" }, { status: 403, headers });
  const requested = new URL(request.url).searchParams.get("week") ?? "current";
  const period = requested === "current" ? currentWeek() : requested;
  if (period !== "latest" && !weeklyActionPeriodSchema.safeParse(period).success) return Response.json({ message: "请选择周五开始的周期" }, { status: 400, headers });
  try {
    const directory = weeklyActionsDirectory(analyticsLocalPreview(request));
    if (!directory && !process.env.DATABASE_URL) return unavailable();
    const plan = directory ? await readWeeklyActionPlan(directory, period)
      : await (await import("@/lib/services/seo-action-storage")).readDatabaseWeeklyAction(period);
    return Response.json({ periodStart: plan?.periodStart ?? (period === "latest" ? null : period), plan }, { headers });
  } catch { return Response.json({ message: "周计划读取失败，请重试" }, { status: 503, headers }); }
}

export async function POST(request: Request) {
  const secret = getRankingImportSecret();
  const importAuthorized = Boolean(secret && importSecretMatches(request.headers.get("authorization"), secret));
  if (!importAuthorized && !await authorizeAnalyticsRead(request)) return Response.json({ message: "请先登录或使用采集凭据" }, { status: 401, headers });
  const local = analyticsLocalPreview(request), origin = request.headers.get("origin");
  if (importAuthorized ? Boolean(origin) : local ? !isLocalPreviewOrigin(request) : origin !== new URL(request.url).origin) {
    return Response.json({ message: "请求来源无效" }, { status: 403, headers });
  }
  const reader = request.body?.getReader();
  if (!reader) return Response.json({ message: "周计划为空" }, { status: 400, headers });
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    const directory = weeklyActionsDirectory(local);
    if (!directory && !process.env.DATABASE_URL) return unavailable();
    for (;;) {
      const { value, done } = await reader.read(); if (done) break;
      length += value.byteLength;
      if (length > 65536) { await reader.cancel(); return Response.json({ message: "周计划超出大小限制" }, { status: 413, headers }); }
      chunks.push(value);
    }
    const input: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    const plan = directory ? await writeWeeklyActionPlan(input, directory)
      : await (await import("@/lib/services/seo-action-storage")).saveDatabaseWeeklyAction(input);
    return Response.json({ stored: true, plan }, { headers });
  } catch (error) {
    const invalid = error instanceof SyntaxError || error instanceof Error && error.name === "ZodError";
    return Response.json({ message: invalid ? "周计划字段无效，请核对日期、主词和预估依据" : "周计划未保存，请重试" }, { status: invalid ? 400 : 503, headers });
  }
}
