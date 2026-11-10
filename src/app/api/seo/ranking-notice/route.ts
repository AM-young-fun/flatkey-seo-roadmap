import { getRankingImportSecret } from "@/lib/import-credential";
import { importSecretMatches } from "@/lib/ranking-import";
import { readRankingNotice } from "@/lib/services/ranking-notice";

const headers = { "Cache-Control": "private, no-store" };

export async function GET(request: Request) {
  const secret = getRankingImportSecret();
  if (!secret || !importSecretMatches(request.headers.get("authorization"), secret) || request.headers.get("origin")) {
    return Response.json({ message: "需要采集凭据" }, { status: 401, headers });
  }
  return Response.json({ notice: await readRankingNotice() }, { headers });
}
