import { prisma } from "@/lib/prisma";
import { approvedWeeklyCaptureRunIds } from "@/lib/approved-weekly-keyword-capture";
import { decryptDataForSeoCredentials } from "@/lib/dataforseo-credentials";
import { providerIdIsSafe, providerTaskEnvelope, serpQueryKey } from "@/lib/dataforseo-serp";
import { ImportRequestError } from "@/lib/ranking-import";
import { createHash } from "node:crypto";
const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
/** Existing paid receipt only; task_get/html is free, never submit or mutate. */
export async function readSavedHtml(providerTaskId: string) {
  if (!providerIdIsSafe(providerTaskId)) throw new ImportRequestError("无效原任务", 400);
  const task = await prisma.serpMonitorTask.findFirst({ where: { providerTaskId, runId: { in: approvedWeeklyCaptureRunIds() }, state: "COMPLETE" },
    select: { keyword: true, region: true, requestJson: true, checkedAt: true } });
  if (!task) throw new ImportRequestError("仅可读取两批已批准的完成任务", 404);
  const connection = await prisma.dataForSeoConnection.findUnique({ where: { siteDomain: "flatkey.ai" }, select: { encryptedCredentials: true } });
  if (!connection) throw new ImportRequestError("连接不可用", 409);
  const credentials = decryptDataForSeoCredentials(connection.encryptedCredentials);
  const response = await fetch(`https://api.dataforseo.com/v3/serp/google/organic/task_get/html/${providerTaskId}`, {
    method: "GET", redirect: "error", cache: "no-store", signal: AbortSignal.timeout(25_000),
    headers: { Authorization: `Basic ${Buffer.from(`${credentials.apiLogin}:${credentials.apiPassword}`).toString("base64")}` },
  });
  if (!response.ok) throw new ImportRequestError("原HTML读取暂不可用", 502);
  const raw = object(await response.json()), receipt = providerTaskEnvelope(raw, providerTaskId);
  if (receipt.status_code !== 20000) return { providerTaskId, keyword: task.keyword, country: task.region, providerReportedCost: raw.cost ?? null, status: receipt.status_code, pages: [], newQueries: 0 };
  const result = object(Array.isArray(receipt.result) ? receipt.result[0] : null), request = object(task.requestJson);
  if (serpQueryKey(String(result.keyword)) !== serpQueryKey(task.keyword) || result.location_code !== request.location_code || result.language_code !== request.language_code) throw new ImportRequestError("原HTML范围不匹配", 502);
  const pages = Array.isArray(result.items) ? result.items.map(object).filter(item => typeof item.html === "string").map(item => {
    const html = String(item.html);
    const text = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ").replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");
    return { page: item.page ?? null, htmlSha256: createHash("sha256").update(html).digest("hex"), htmlBytes: Buffer.byteLength(html),
      visibleEnd: text.slice(-6000), hasExplicitNextControl: /<a\b[^>]*(?:id=["']pnnext["']|rel=["']next["'])/i.test(html),
      flatkeyReferences: [...new Set(html.match(/https?:\/\/(?:[a-z0-9-]+\.)*flatkey\.ai[^\s"'<>\\]*/gi) ?? [])].slice(0, 100) };
  }) : [];
  return { providerTaskId, keyword: task.keyword, country: task.region, checkedAt: task.checkedAt, providerReportedCost: raw.cost ?? null, status: receipt.status_code, pages, newQueries: 0 };
}
