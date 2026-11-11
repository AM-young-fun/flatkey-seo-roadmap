import { authenticateImportToken } from "@/lib/services/import-tokens";
import { readRankingNotice } from "@/lib/services/ranking-notice";

const headers = { "Cache-Control": "private, no-store" };

export async function GET(request: Request) {
  if (!await authenticateImportToken(request) || request.headers.get("origin")) {
    return Response.json({ message: "需要采集凭据" }, { status: 401, headers });
  }
  return Response.json({ notice: await readRankingNotice() }, { headers });
}
