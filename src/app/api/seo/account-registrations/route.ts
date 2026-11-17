import { z } from "zod";
import { accountRegistrationRangeSchema } from "@/lib/seo-account-registrations";
import { privateAnalyticsHeaders as headers } from "@/lib/seo-analytics-access";
import { authenticateImportToken } from "@/lib/services/import-tokens";
import { loadAccountRegistrationSummary, saveAccountRegistrationSnapshot } from "@/lib/services/seo-account-registrations";

export const dynamic = "force-dynamic";
const authorized = async (request: Request) => !request.headers.get("origin") && await authenticateImportToken(request);
const denied = () => Response.json({ message: "需要服务器采集凭据" }, { status: 401, headers });

export async function GET(request: Request) {
  if (!await authorized(request)) return denied();
  try {
    const params = new URL(request.url).searchParams;
    const range = accountRegistrationRangeSchema.parse({ start: params.get("start"), end: params.get("end") });
    return Response.json({ registrations: await loadAccountRegistrationSummary(range) }, { headers });
  } catch (error) {
    return Response.json({ message: "日期无效或账户注册汇总暂不可读" }, { status: error instanceof z.ZodError ? 400 : 503, headers });
  }
}

export async function POST(request: Request) {
  if (!await authorized(request)) return denied();
  try {
    const text = await request.text();
    if (text.length > 10_000) return Response.json({ message: "请求过大" }, { status: 413, headers });
    return Response.json(await saveAccountRegistrationSnapshot(JSON.parse(text)), { headers });
  } catch (error) {
    return Response.json({ message: "账户注册快照无效或未保存" }, {
      status: error instanceof z.ZodError || error instanceof SyntaxError ? 400 : 503, headers,
    });
  }
}
