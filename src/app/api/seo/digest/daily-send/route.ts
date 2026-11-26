import type { NextRequest } from "next/server";
import { z } from "zod";
import { AUTH_COOKIE_NAME, isAuthEnabled, isValidAuthToken } from "@/lib/auth";
import { DigestError } from "@/lib/services/seo-digest";
import { dispatchDailySend, readDailySendStatus } from "@/lib/services/seo-daily-manual-send";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store", Vary: "Cookie", "X-Content-Type-Options": "nosniff" };
const selection = z.object({
  reportId: z.string().regex(/^seo-digest:\d{4}-\d{2}-\d{2}:[a-f0-9]{16}$/),
  reportHash: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();

async function authorize(request: NextRequest, write = false) {
  const origin = request.headers.get("origin"), sameOrigin = new URL(request.url).origin;
  if (request.headers.get("sec-fetch-site") === "cross-site" || (write ? origin !== sameOrigin : origin && origin !== sameOrigin)) {
    throw new DigestError("请求来源无效", 403);
  }
  if (!isAuthEnabled() || !await isValidAuthToken(request.cookies.get(AUTH_COOKIE_NAME)?.value)) throw new DigestError("请先登录", 401);
}

function failure(error: unknown) {
  if (error instanceof DigestError) return Response.json({ message: error.message }, { status: error.status, headers });
  if (error instanceof z.ZodError || error instanceof SyntaxError) return Response.json({ message: "日报参数无效" }, { status: 400, headers });
  return Response.json({ message: "暂时无法核对发送状态，请刷新" }, { status: 503, headers });
}

export async function GET(request: NextRequest) {
  try {
    await authorize(request);
    const params = new URL(request.url).searchParams;
    const { reportId, reportHash } = selection.parse({ reportId: params.get("reportId"), reportHash: params.get("reportHash") });
    return Response.json(await readDailySendStatus(reportId, reportHash), { headers });
  } catch (error) { return failure(error); }
}

export async function POST(request: NextRequest) {
  try {
    await authorize(request, true);
    if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") throw new DigestError("需要 JSON 请求", 415);
    const reader = request.body?.getReader();
    if (!reader) throw new DigestError("缺少日报参数", 400);
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 1024) {
        await reader.cancel();
        throw new DigestError("请求过大", 413);
      }
      chunks.push(value);
    }
    const { reportId, reportHash } = selection.parse(JSON.parse(Buffer.concat(chunks).toString("utf8")));
    return Response.json(await dispatchDailySend(reportId, reportHash), { status: 202, headers });
  } catch (error) { return failure(error); }
}
