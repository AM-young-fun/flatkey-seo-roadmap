import { isDatabaseConfigured } from "@/lib/env";
import { hasResearchReadHeader, SEO_RESEARCH_KEY_HEADER } from "@/lib/seo-research-read";
import { authenticateResearchApiKey } from "@/lib/services/export-api-keys";

const headers = { "Cache-Control": "private, no-store" };

export async function researchReadAccess(request: Request): Promise<typeof headers | Response | null> {
  if (!hasResearchReadHeader(request)) return null;

  if (!isDatabaseConfigured()) {
    return Response.json({ message: "数据库未配置" }, { status: 503, headers });
  }

  try {
    const key = request.headers.get(SEO_RESEARCH_KEY_HEADER) ?? "";
    if (await authenticateResearchApiKey(key)) return headers;
    return Response.json({ message: "Unauthorized" }, { status: 401, headers });
  } catch {
    return Response.json({ message: "只读凭据暂时无法验证" }, { status: 503, headers });
  }
}
