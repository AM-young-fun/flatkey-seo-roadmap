import { prisma } from "@/lib/prisma";

const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const text = (value: unknown) => typeof value === "string" ? value : null;
const integer = (value: unknown) => Number.isInteger(value) ? value as number : null;
/** Public search-result fields only; never serialize credentials or provider request envelopes. */
export function publicSerpSnapshot(rawResponse: string | null) {
  let raw: unknown; try { raw = JSON.parse(rawResponse ?? "null"); } catch { return null; }
  const tasks = object(raw).tasks;
  const results = Array.isArray(tasks) ? object(tasks[0]).result : null;
  const snapshot = object(Array.isArray(results) ? results[0] : null);
  if (!Array.isArray(snapshot.items)) return null;
  return { keyword: text(snapshot.keyword), locationCode: integer(snapshot.location_code), languageCode: text(snapshot.language_code),
    datetime: text(snapshot.datetime), checkUrl: text(snapshot.check_url), spell: snapshot.spell ? { type: text(object(snapshot.spell).type), keyword: text(object(snapshot.spell).keyword) } : null,
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
