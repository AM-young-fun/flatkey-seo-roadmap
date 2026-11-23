import { isDatabaseConfigured } from "@/lib/env";
import { retryDatabaseRead } from "@/lib/database-read";
import { coverageSelection } from "@/lib/saved-ranking-coverage";
import { authorizeSavedRankingCoverage } from "@/lib/services/ranking-coverage-access";
import { loadSavedRankingCoverage } from "@/lib/services/saved-ranking-coverage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
const headers = { "Cache-Control": "private, no-store" };
export async function GET(request: Request) {
  if (!await authorizeSavedRankingCoverage(request)) return Response.json({ message: "请先登录或使用已有SEO接入凭据" }, { status: 401, headers });
  const params = new URL(request.url).searchParams;
  if (params.get("reconciled") === "1") {
    try {
      const { loadRankingReconciliation } = await import("@/lib/services/ranking-reconciliation");
      return Response.json(await retryDatabaseRead(loadRankingReconciliation), { headers });
    } catch { return Response.json({ message: "已有排名与页面关联暂时读取失败；未发起新采集或付费。" }, { status: 503, headers }); }
  }
  let selection;
  try { selection = coverageSelection(new URL(request.url).searchParams); }
  catch { return Response.json({ message: "请选择明确周期或同周期四国已存runId；仅支持Flatkey。" }, { status: 400, headers }); }
  if (!isDatabaseConfigured()) return Response.json({ message: "数据库未配置" }, { status: 503, headers });
  try { return Response.json(await retryDatabaseRead(() => loadSavedRankingCoverage(selection)), { headers }); }
  catch { return Response.json({ message: "已存排名汇总读取失败，未请求供应商或产生费用。" }, { status: 503, headers }); }
}
