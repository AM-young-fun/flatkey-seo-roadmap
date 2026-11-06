import { authorizeAnalyticsRead, privateAnalyticsHeaders as headers } from "@/lib/seo-analytics-access";
import { fetchGa4Realtime } from "@/lib/services/ga4-organic";
import { GoogleReadError } from "@/lib/google-read-auth";

export const dynamic = "force-dynamic";
type Realtime = Awaited<ReturnType<typeof fetchGa4Realtime>>;
let cache: { at: number; data: Realtime } | undefined;
let pending: Promise<Realtime> | undefined;

export async function GET(request: Request) {
  if (!await authorizeAnalyticsRead(request)) return Response.json({ message: "请先登录" }, { status: 401, headers });
  const base = { scope: "all-traffic", windowMinutes: 30 as const };
  try {
    if (!cache || Date.now() - cache.at >= 60_000) {
      pending ??= fetchGa4Realtime().then(data => {
        cache = { at: Date.now(), data };
        return data;
      }).finally(() => { pending = undefined; });
      await pending;
    }
    const data = cache!.data;
    return Response.json({ ...base, status: "ready", activeUsers: data.activeUsers, observedAt: data.fetchedAt,
      reason: "GA4 实时报告未提供会话渠道维度；此处是全渠道活跃用户。"
    }, { headers });
  } catch (error) {
    const missing = error instanceof GoogleReadError && error.code === "missing_credentials";
    return Response.json({ ...base, status: missing ? "missing" : "error", activeUsers: null, observedAt: null,
      reason: missing ? "尚无可持续调用的 GA4 实时连接。可在已登录的 GA4 实时报告查看。" : "GA4 实时读取未成功，请稍后重试。"
    }, { headers });
  }
}
