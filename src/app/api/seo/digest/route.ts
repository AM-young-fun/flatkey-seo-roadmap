import { z } from "zod";
import { authenticateImportToken } from "@/lib/services/import-tokens";
import { authorizeAnalyticsRead, privateAnalyticsHeaders as headers } from "@/lib/seo-analytics-access";
import { beijingDay, digestDateSchema, digestKindSchema } from "@/lib/seo-digest";
import { beginDigestAttempt, claimDigest, DigestError, finishDigestAttempt, generateSeoDigest, saveSeoDigest } from "@/lib/services/seo-digest";

export const dynamic = "force-dynamic";
const auth = async (request: Request) => !request.headers.get("origin") && await authenticateImportToken(request);
const mutation = z.discriminatedUnion("action", [
  z.object({ action: z.literal("prepare"), date: digestDateSchema, kind: digestKindSchema.default("daily") }).strict(),
  z.object({ action: z.literal("claim"), reportId: z.string().min(1).max(200), owner: z.string().min(1).max(200) }).strict(),
  z.object({ action: z.literal("begin"), id: z.string().min(1).max(200), owner: z.string().min(1).max(200), fencingToken: z.number().int().positive() }).strict(),
  z.object({ action: z.literal("finish"), reportId: z.string().min(1).max(200), reportHash: z.string().regex(/^[a-f0-9]{64}$/), destination: z.string().min(1).max(200), robotCode: z.string().min(1).max(200), id: z.string().min(1).max(200), owner: z.string().min(1).max(200), fencingToken: z.number().int().positive(), status: z.enum(["DELIVERED", "UNKNOWN"]), processQueryKey: z.string().min(1).max(2000).optional(), errorCode: z.string().max(1000).optional() }).strict(),
]);
function errorResponse(error: unknown) {
  return Response.json({ message: error instanceof DigestError ? error.message : error instanceof z.ZodError ? "日报周报参数无效" : "无法完成报告操作" }, { status: error instanceof DigestError ? error.status : error instanceof z.ZodError || error instanceof SyntaxError ? 400 : 503, headers });
}
export async function GET(request: Request) {
  if (!await auth(request) && !await authorizeAnalyticsRead(request)) return Response.json({ message: "请先登录" }, { status: 401, headers });
  try {
    const date = digestDateSchema.parse(new URL(request.url).searchParams.get("date") ?? beijingDay());
    const kind = digestKindSchema.parse(new URL(request.url).searchParams.get("kind") ?? "daily");
    if (kind === "weekly" && new Date(date + "T00:00:00Z").getUTCDay() !== 5) return Response.json({ message: "周报日期必须是北京时间周五" }, { status: 400, headers });
    return Response.json({ report: await generateSeoDigest(date, new Date(), kind) }, { headers });
  } catch (error) { return errorResponse(error); }
}
export async function POST(request: Request) {
  if (!await auth(request)) return Response.json({ message: "需要服务器采集凭据" }, { status: 401, headers });
  try {
    const text = await request.text();
    if (text.length > 8000) return Response.json({ message: "请求过大" }, { status: 413, headers });
    const input = mutation.parse(JSON.parse(text));
    if (input.action === "prepare") {
      if (input.kind === "weekly" && new Date(input.date + "T00:00:00Z").getUTCDay() !== 5) return Response.json({ message: "周报日期必须是北京时间周五" }, { status: 400, headers });
      return Response.json({ report: await saveSeoDigest(await generateSeoDigest(input.date, new Date(), input.kind)) }, { headers });
    }
    if (input.action === "claim") return Response.json(await claimDigest(input.reportId, input.owner), { headers });
    if (input.action === "begin") return Response.json(await beginDigestAttempt(input.id, input.owner, input.fencingToken), { headers });
    return Response.json(await finishDigestAttempt(input), { headers });
  } catch (error) { return errorResponse(error); }
}
