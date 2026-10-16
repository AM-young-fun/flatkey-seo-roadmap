import { normalizeKeywordText, keywordRelevance } from "@/lib/keyword-relevance";
import { rankingImportSchema, type RankingImportPayload } from "@/lib/ranking-import";
import { ImportRequestError } from "@/lib/ranking-import";
import type { DataForSeoNormalized, DataForSeoObservation } from "@/lib/dataforseo-labs.cjs";
import type { DataForSeoSummary } from "@/lib/dataforseo-management";

export type DataForSeoMembership = { keywordId: string; pool: string; active: boolean; keyword: { text: string; active: boolean } };
// A newer provider SERP check takes precedence over an older, better rank.
// Equal-date pages stay independent; only the keyword summary chooses a best
// rank. Missing source dates never displace a dated result.
function preferObservation(row: DataForSeoObservation, prior: DataForSeoObservation) {
  const date = row.sourceSerpUpdatedAt ? Date.parse(row.sourceSerpUpdatedAt) : 0;
  const priorDate = prior.sourceSerpUpdatedAt ? Date.parse(prior.sourceSerpUpdatedAt) : 0;
  return date > priorDate || (date === priorDate && (row.rank_group < prior.rank_group ||
    (row.rank_group === prior.rank_group && row.url.localeCompare(prior.url) < 0)));
}
export function buildDataForSeoImportPlan(snapshot: DataForSeoNormalized, memberships: DataForSeoMembership[], requestId: string, previousRankedKeywords: string[] = []) {
  if ((snapshot.returnedItems > 0 && snapshot.rows.length === 0) || (snapshot.returnedItems === 0 && snapshot.totalMatchingCount > 0)) {
    throw new ImportRequestError("供应商返回行未通过排名证据解析，已保留原始结果，不能将词库误写为无数据", 422);
  }
  const eligible = memberships.filter(row => row.active && row.keyword.active && ["FORMAL", "RESEARCH"].includes(row.pool) && keywordRelevance("flatkey.ai", row.keyword.text).status !== "unrelated");
  const groups = new Map<string, DataForSeoMembership[]>();
  for (const row of eligible) { const text = normalizeKeywordText(row.keyword.text); groups.set(text, [...(groups.get(text) ?? []), row]); }
  const best = new Map<string, DataForSeoObservation>();
  const pageResults = new Map<string, DataForSeoObservation>();
  const candidates = [], matched = new Set<string>();
  let unrelatedFiltered = 0;
  for (const row of snapshot.rows) {
    const policy = keywordRelevance("flatkey.ai", row.keyword);
    if (policy.status === "unrelated") { unrelatedFiltered++; continue; }
    const links = groups.get(row.keyword) ?? [];
    if (links.length !== 1) {
      candidates.push({ ...row, relevance: policy.status, reason: links.length ? "存在多个规范化身份，待人工确认" : policy.reason ?? "新增业务候选，尚未进入本站词库" }); continue;
    }
    const prior = best.get(row.keyword);
    if (!prior || preferObservation(row, prior)) best.set(row.keyword, row);
    const pageKey = JSON.stringify([links[0].keywordId, row.url]), priorPage = pageResults.get(pageKey);
    if (!priorPage || preferObservation(row, priorPage)) pageResults.set(pageKey, row);
    matched.add(links[0].keywordId);
  }
  const observations: RankingImportPayload["observations"] = [...best].map(([text, row]): RankingImportPayload["observations"][number] => ({ keyword: groups.get(text)![0].keyword.text, region: "US", source: "dataforseo_labs",
    collectedAt: snapshot.collectedAt, rankStatus: "ranked", rank: row.rank_group, url: row.url,
    ...(row.sourceSerpUpdatedAt ? { dataUpdatedAt: row.sourceSerpUpdatedAt } : {}), ...(row.volume !== null ? { volume: row.volume } : {}) }));
  // Preserve every actual ranking URL with its own position and provider date.
  // These page records intentionally omit search volume to avoid counting one
  // query's volume once per page, and never change manually assigned targets.
  const pages: RankingImportPayload["pages"] = [...pageResults.values()].map(row => ({ keyword: groups.get(row.keyword)![0].keyword.text,
    region: "US", source: "dataforseo_labs", collectedAt: snapshot.collectedAt, rankStatus: "ranked", rank: row.rank_group, url: row.url,
    ...(row.sourceSerpUpdatedAt ? { dataUpdatedAt: row.sourceSerpUpdatedAt } : {}) }));
  const previouslyRanked = new Set(previousRankedKeywords.map(normalizeKeywordText));
  let missingFormal = 0, missingResearch = 0;
  for (const row of eligible) {
    const text = normalizeKeywordText(row.keyword.text);
    // A lost research result must not retain its previous positive rank, while
    // research that has never appeared receives no invented observations.
    if (matched.has(row.keywordId) || groups.get(text)!.length !== 1 || (row.pool !== "FORMAL" && !previouslyRanked.has(text))) continue;
    observations.push({ keyword: row.keyword.text, region: "US", source: "dataforseo_labs", collectedAt: snapshot.collectedAt, rankStatus: "no_data", rank: null });
    if (row.pool === "FORMAL") missingFormal++;
    else missingResearch++;
  }
  const batches: RankingImportPayload[] = [];
  const captureDate = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(new Date(snapshot.collectedAt));
  const records = [...observations.map(row => ({ kind: "observation" as const, row })), ...pages.map(row => ({ kind: "page" as const, row }))];
  for (let offset = 0; offset < records.length; offset += 500) {
    const slice = records.slice(offset, offset + 500);
    batches.push(rankingImportSchema.parse({ requestId: `dfs-${requestId}-part-${Math.floor(offset / 500) + 1}`, targetDomain: "flatkey.ai", allowNewKeywords: false,
      observations: slice.filter(record => record.kind === "observation").map(record => record.row), pages: slice.filter(record => record.kind === "page").map(record => record.row),
      capture: { id: `dfs-${requestId}`, date: captureDate, source: "dataforseo_labs", region: "US", coverage: "tracked", complete: offset + 500 >= records.length } }));
  }
  const summary: DataForSeoSummary = { returnedItems: snapshot.returnedItems, normalizedRows: snapshot.rows.length, matchedExisting: matched.size,
    matchedPages: pages.length,
    unknownCandidates: new Set(candidates.map(row => row.keyword)).size, unrelatedFiltered, missingFormal, missingResearch, importedObservations: 0, truncated: snapshot.truncated, totalMatchingCount: snapshot.totalMatchingCount };
  return { batches, candidates, summary };
}
