import { z } from "zod";
import { authenticateImportToken } from "@/lib/services/import-tokens";
import { authorizeAnalyticsRead, privateAnalyticsHeaders as headers } from "@/lib/seo-analytics-access";
import { PROMPT_REPOSITORIES } from "@/lib/seo-github-channel";
import { loadGithubChannels, saveGithubChannel } from "@/lib/services/seo-github-channel";
import { fetchGithubReferrals } from "@/lib/services/ga4-github-referrals";
export const dynamic = "force-dynamic";
const authorized = async (request: Request) => !request.headers.get("origin") && await authenticateImportToken(request);
export async function GET(request: Request) {
  const importer = await authorized(request);
  if (!importer && !await authorizeAnalyticsRead(request)) return Response.json({ message: "请先登录" }, { status: 401, headers });
  try {
    const p = new URL(request.url).searchParams, start = z.iso.date().parse(p.get("start")), end = z.iso.date().parse(p.get("end"));
    if (end < start || Date.parse(end) - Date.parse(start) > 90 * 86400000) throw Error("invalid_range");
    if (p.get("collect") === "referrals") {
      if (!importer) return Response.json({ message: "需要采集凭据" }, { status: 403, headers });
      const repository = z.enum(PROMPT_REPOSITORIES).parse(p.get("repository"));
      return Response.json({ record: await fetchGithubReferrals(repository, start, end) }, { headers });
    }
    return Response.json({ records: await loadGithubChannels(start, end), storage: "database" }, { headers });
  } catch (error) { return Response.json({ message: "GitHub渠道数据无效或暂不可读" }, { status: error instanceof z.ZodError || error instanceof Error && error.message === "invalid_range" ? 400 : 503, headers }); }
}
export async function POST(request: Request) {
  if (!await authorized(request)) return Response.json({ message: "需要采集凭据" }, { status: 401, headers });
  try {
    const text = await request.text();
    if (text.length > 40000) return Response.json({ message: "请求过大" }, { status: 413, headers });
    return Response.json(await saveGithubChannel(JSON.parse(text)), { headers });
  } catch (error) { return Response.json({ message: "GitHub渠道数据无效或未保存" }, { status: error instanceof z.ZodError || error instanceof SyntaxError ? 400 : 503, headers }); }
}
