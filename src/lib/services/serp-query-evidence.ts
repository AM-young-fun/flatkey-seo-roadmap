import { prisma } from "@/lib/prisma";
import { decryptDataForSeoCredentials } from "@/lib/dataforseo-credentials";
import { providerIdIsSafe, providerTaskEnvelope, serpQueryKey, SERP_MARKET_CONFIG } from "@/lib/dataforseo-serp";
import type { SerpRegion } from "@/lib/serp-monitor-types";
import { ImportRequestError } from "@/lib/ranking-import";

const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const text = (value: unknown) => typeof value === "string" ? value : null;
const googleUrl = (value: unknown) => {
  try { const url = new URL(String(value)); return url.protocol === "https:" && !url.username && !url.password && ["www.google.com", "www.google.co.jp", "www.google.es", "www.google.com.br"].includes(url.hostname) ? url.href : null; } catch { return null; }
};
const integer = (value: unknown) => Number.isInteger(value) ? value as number : null;
/** Public search-result fields only; never serialize credentials or provider request envelopes. */
export function publicSerpSnapshot(rawResponse: string | null) {
  let raw: unknown; try { raw = JSON.parse(rawResponse ?? "null"); } catch { return null; }
  const tasks = object(raw).tasks;
  const results = Array.isArray(tasks) ? object(tasks[0]).result : null;
  const snapshot = object(Array.isArray(results) ? results[0] : null);
  if (!Array.isArray(snapshot.items)) return null;
  return { keyword: text(snapshot.keyword), locationCode: integer(snapshot.location_code), languageCode: text(snapshot.language_code),
    datetime: text(snapshot.datetime), checkUrl: googleUrl(snapshot.check_url), spell: snapshot.spell ? { type: text(object(snapshot.spell).type), keyword: text(object(snapshot.spell).keyword) } : null,
    organicResults: snapshot.items.filter(item => object(item).type === "organic").map(value => { const item = object(value); return {
      rankGroup: integer(item.rank_group), rankAbsolute: integer(item.rank_absolute), page: integer(item.page),
      title: text(item.title), url: text(item.url), domain: text(item.domain),
    }; }) };
}
export async function loadSerpQueryEvidence(keyword: string, region: string) {
  const run = await prisma.serpMonitorRun.findFirst({ where: { scope: "SCHEDULED" }, orderBy: { createdAt: "desc" }, select: { id: true, periodLabel: true } });
  if (!run) return null;
  const task = await prisma.serpMonitorTask.findFirst({ where: { runId: run.id, region, keyword: { equals: keyword, mode: "insensitive" } },
    select: { keyword: true, region: true, state: true, checkedAt: true, requestJson: true, rawResponse: true } });
  if (!task) return null;
  const request = object(task.requestJson);
  return { periodLabel: run.periodLabel, keyword: task.keyword, region: task.region, state: task.state, checkedAt: task.checkedAt?.toISOString() ?? null,
    request: { keyword: text(request.keyword), locationCode: integer(request.location_code), languageCode: text(request.language_code),
      device: text(request.device), os: text(request.os), depth: integer(request.depth), searchDomain: text(request.se_domain) },
    snapshot: publicSerpSnapshot(task.rawResponse) };
}

/** Read an already-paid task only. This path has no task submission or database writes. */
export async function downloadSerpQueryEvidence(keyword: string, region: SerpRegion) {
  const run = await prisma.serpMonitorRun.findFirst({ where: { scope: "SCHEDULED" }, orderBy: { createdAt: "desc" }, select: { id: true, periodLabel: true } });
  if (!run) throw new ImportRequestError("本期尚无采集记录", 404);
  const task = await prisma.serpMonitorTask.findFirst({ where: { runId: run.id, region, keyword: { equals: keyword, mode: "insensitive" } },
    select: { keyword: true, region: true, state: true, checkedAt: true, providerTaskId: true, rawResponse: true } });
  if (!task || task.state !== "COMPLETE" || !providerIdIsSafe(task.providerTaskId)) throw new ImportRequestError("该词尚无已完成的供应商任务", 409);
  const connection = await prisma.dataForSeoConnection.findUnique({ where: { siteDomain: "flatkey.ai" }, select: { encryptedCredentials: true } });
  if (!connection) throw new ImportRequestError("DataForSEO连接不存在", 409);
  const credentials = decryptDataForSeoCredentials(connection.encryptedCredentials);
  const response = await fetch(`https://api.dataforseo.com/v3/serp/google/organic/task_get/html/${task.providerTaskId}`, {
    method: "GET", redirect: "error", cache: "no-store", signal: AbortSignal.timeout(20_000),
    headers: { Authorization: `Basic ${Buffer.from(`${credentials.apiLogin}:${credentials.apiPassword}`).toString("base64")}` },
  });
  if (!response.ok) throw new ImportRequestError("供应商原始HTML暂时无法读取", 502);
  const raw: unknown = await response.json(), receipt = providerTaskEnvelope(raw, task.providerTaskId);
  if (receipt.status_code !== 20000) throw new ImportRequestError(`原始HTML不可用（供应商状态 ${integer(receipt.status_code) ?? "未提供"}）；未提交新任务`, 502);
  const results = Array.isArray(receipt.result) ? receipt.result.map(object) : [], market = SERP_MARKET_CONFIG[region];
  if (results.length !== 1 || serpQueryKey(String(results[0].keyword)) !== serpQueryKey(task.keyword) || results[0].location_code !== market.locationCode || results[0].language_code !== market.languageCode) throw new ImportRequestError("供应商HTML与原任务范围不符", 502);
  const pages = Array.isArray(results[0].items) ? results[0].items.map(object).filter(page => typeof page.html === "string").map(page => ({ page: integer(page.page), date: text(page.date), html: text(page.html) })) : [];
  if (!pages.length) throw new ImportRequestError("供应商未返回原始HTML（仅保留7天）", 404);
  return { keyword: task.keyword, region: task.region, providerTaskId: task.providerTaskId, periodLabel: run.periodLabel,
    checkedAt: task.checkedAt?.toISOString() ?? null, newTaskSubmitted: false, providerReportedCost: typeof object(raw).cost === "number" ? object(raw).cost : null,
    providerTaskReportedCost: typeof receipt.cost === "number" ? receipt.cost : null, snapshot: publicSerpSnapshot(task.rawResponse), pages };
}
