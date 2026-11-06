import { analyticsLocalPreview, authorizeAnalyticsRead, privateAnalyticsHeaders as headers } from "@/lib/seo-analytics-access";
import { getRankingImportSecret } from "@/lib/import-credential";
import { importSecretMatches } from "@/lib/ranking-import";
import { isLocalPreviewOrigin } from "@/lib/preview-origin";
import { optimizationPlansDirectory, readOptimizationPlans, writeOptimizationPlan } from "@/lib/seo-optimization-plans";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const unavailable = () => Response.json({ message: "优化目标尚未配置持久存储" }, { status: 503, headers });

export async function GET(request: Request) {
  const secret = getRankingImportSecret();
  const importAuthorized = Boolean(secret && importSecretMatches(request.headers.get("authorization"), secret));
  if (!importAuthorized && !await authorizeAnalyticsRead(request)) return Response.json({ message: "请先登录或使用采集凭据" }, { status: 401, headers });
  if (importAuthorized && request.headers.get("origin") || analyticsLocalPreview(request) && request.headers.get("origin") && !isLocalPreviewOrigin(request)) return Response.json({ message: "请求来源无效" }, { status: 403, headers });
  try {
    const directory = optimizationPlansDirectory(analyticsLocalPreview(request));
    if (!directory && !process.env.DATABASE_URL) return unavailable();
    const plans = directory ? await readOptimizationPlans(directory)
      : await (await import("@/lib/services/seo-action-storage")).readDatabaseOptimizationPlans();
    return Response.json({ storage: "server", plans }, { headers });
  } catch { return Response.json({ message: "优化目标读取失败，请重试" }, { status: 503, headers }); }
}

export async function POST(request: Request) {
  const secret = getRankingImportSecret();
  const importAuthorized = Boolean(secret && importSecretMatches(request.headers.get("authorization"), secret));
  if (!importAuthorized && !await authorizeAnalyticsRead(request)) return Response.json({ message: "请先登录或使用采集凭据" }, { status: 401, headers });
  const local = analyticsLocalPreview(request), origin = request.headers.get("origin");
  if (importAuthorized ? Boolean(origin) : local ? !isLocalPreviewOrigin(request) : origin !== new URL(request.url).origin) return Response.json({ message: "请求来源无效" }, { status: 403, headers });
  const reader = request.body?.getReader();
  if (!reader) return Response.json({ message: "优化目标为空" }, { status: 400, headers });
  const chunks: Uint8Array[] = []; let length = 0;
  try {
    const directory = optimizationPlansDirectory(local);
    if (!directory && !process.env.DATABASE_URL) return unavailable();
    for (;;) {
      const { value, done } = await reader.read(); if (done) break;
      length += value.byteLength;
      if (length > 65536) { await reader.cancel(); return Response.json({ message: "优化目标超出大小限制" }, { status: 413, headers }); }
      chunks.push(value);
    }
    const input: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    const plan = directory ? await writeOptimizationPlan(input, directory)
      : await (await import("@/lib/services/seo-action-storage")).saveDatabaseOptimizationPlan(input);
    return Response.json({ stored: true, storage: "server", plan }, { headers });
  } catch (error) {
    const invalid = error instanceof SyntaxError || error instanceof Error && error.name === "ZodError";
    return Response.json({ message: invalid ? "优化目标字段无效，请核对页面、日期及 CTR 假设" : "优化目标未保存，请重试" }, { status: invalid ? 400 : 503, headers });
  }
}
