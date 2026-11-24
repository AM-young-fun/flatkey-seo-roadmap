import { authorizeSavedRankingCoverage } from "@/lib/services/ranking-coverage-access";
import { historicalExportSelection } from "@/lib/ranking-history-export";
import { loadHistoricalRankingExport } from "@/lib/services/ranking-history-export";
import { retryDatabaseRead } from "@/lib/database-read";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };

/** Exact original three saved ledgers only. No POST or supplier path. */
export async function GET(request: Request) {
  if (!await authorizeSavedRankingCoverage(request)) return Response.json({ message: "请先登录或使用已有SEO只读凭据" }, { status: 401, headers });
  let selection;
  try { selection = historicalExportSelection(new URL(request.url).searchParams); }
  catch { return Response.json({ message: "请选择原历史三期之一和有效分页；本接口仅导出已存结果" }, { status: 400, headers }); }
  try { return Response.json(await retryDatabaseRead(() => loadHistoricalRankingExport(selection)), { headers }); }
  catch { return Response.json({ message: "原历史存档暂时无法读取；未新采集、付费或修改原快照" }, { status: 503, headers }); }
}
