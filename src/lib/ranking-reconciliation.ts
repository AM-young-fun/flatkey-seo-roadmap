import { isOwnedBrandKeyword } from "./keyword-market-policy";
import languageReview from "./data/ranking-word-language-review-20261123.json";
export const RANKING_COUNTRIES = ["US", "JP", "ES", "BR", "CN"] as const;
const languages: Record<string, string> = { US: "en", JP: "ja", ES: "es-ES", BR: "pt-BR", CN: "zh-CN" };
export const wordKey = (word: string) => word.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
const pair = (word: string, country: string) => `${country}:${wordKey(word)}`;
const obj = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const array = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const text = (value: unknown) => typeof value === "string" ? value : "";
export type RankingObservation = { keyword: string; country: string; rank: number; url: string; checkedAt: string; source: "serp" | "database"; collectedAt: string };
export type RankingCheck = { keywordId: string; keyword: string; country: string; language: string; targetUrls: string[];
  checkedAt: string | null; captured: boolean; pages: RankingObservation[] };
export type RankingReconciliationInput = { checks: RankingCheck[]; discovery: unknown; memberships: unknown[]; inventory: unknown[]; workflow: unknown; generatedAt: string };
function publicUrl(value: string) {
  try { const url = new URL(value); return ["https:", "http:"].includes(url.protocol) && ["flatkey.ai", "www.flatkey.ai"].includes(url.hostname) && !url.username && !url.password && !url.port ? url.href : null; } catch { return null; }
}
const eligible = (word: string) => Boolean(wordKey(word)) && !isOwnedBrandKeyword(word);
const normalizeUrl = (value: string) => value.replace(/\/$/, "");
const urlLanguage = (url: string) => { const part = new URL(url).pathname.split("/")[1]; return ["ja", "es", "pt", "pt-BR", "zh", "zh-CN"].includes(part) ? part.split("-")[0] : "en"; };

/** Saved observations + existing page evidence only. No collection, billing or writes. */
export function reconcileRankings(input: RankingReconciliationInput) {
  const approved = new Map(input.checks.map(row => [pair(row.keyword, row.country), row]));
  const native = new Set(languageReview.rows.filter(row => row.classification === "CLEAR_MATCH").map(row => pair(row.keyword, row.country)));
  const observations: RankingObservation[] = [], historical: RankingObservation[] = [], languagePending: unknown[] = [];
  for (const itemValue of array(obj(input.discovery).items)) {
    const item = obj(itemValue);
    for (const value of array(item.observations)) {
      const row = obj(value), keyword = text(row.keyword), country = text(row.country), rank = row.rank, url = publicUrl(text(row.url));
      if (!eligible(keyword) || !url || typeof rank !== "number" || !Number.isInteger(rank) || rank < 1 || rank > 100 || !languages[country]) continue;
      const key = pair(keyword, country), check = approved.get(key);
      if (!native.has(key) && !check) { languagePending.push({ keyword, country, url, rank, reason: "原词语种尚未确认或不符合已批准国家" }); continue; }
      const checkedAt = text(row.sourceSerpUpdatedAt);
      if (!checkedAt || !Number.isFinite(Date.parse(checkedAt))) continue;
      const observation: RankingObservation = { keyword, country, rank, url, checkedAt, collectedAt: text(row.collectedAt), source: "database" };
      // A newer exact check takes precedence even when its saved range misses.
      // Keep the historical hit separately, never resurrect it as a current hit.
      if (check?.captured && check.checkedAt && check.checkedAt >= checkedAt) historical.push(observation);
      else observations.push(observation);
    }
  }
  for (const check of input.checks) for (const page of check.pages) {
    if (check.captured && eligible(page.keyword) && publicUrl(page.url) && page.rank >= 1 && page.rank <= 100) observations.push(page);
  }
  const memberships = new Map(input.memberships.map(value => { const row = obj(value); return [text(row.keywordId), row] as const; }));
  const built = new Map<string, { url: string; evidenceAt: string; evidence: string }>();
  for (const value of input.inventory) {
    const row = obj(value), url = publicUrl(text(row.url));
    if (url) built.set(normalizeUrl(url), { url, evidenceAt: text(row.lastSeen), evidence: "已存页面台账" });
  }
  const workflow = obj(input.workflow), tasks = new Map(array(workflow.tasks).map(value => { const row = obj(value); return [text(row.id), row] as const; }));
  const membershipByWord = new Map(input.memberships.map(value => { const row = obj(value); return [wordKey(text(obj(row.keyword).text)), row] as const; }));
  const publicationTargets: RankingCheck[] = [];
  for (const value of array(workflow.publications)) {
    const row = obj(value), url = publicUrl(text(row.pageUrl));
    if (!url || !["published", "verified"].includes(text(row.status)) || !row.publishedAt) continue;
    built.set(normalizeUrl(url), { url, evidenceAt: text(row.verifiedAt || row.publishedAt), evidence: `上线回执 ${text(row.id)}` });
    const task = tasks.get(text(row.taskId)) ?? {}, keyword = text(row.keyword || task.keyword), country = text(row.country || task.country), language = text(row.language || task.language);
    if (!eligible(keyword) || !languages[country] || language.split("-")[0] !== languages[country].split("-")[0] || urlLanguage(url) !== language.split("-")[0]) continue;
    const existingWord = input.checks.find(check => wordKey(check.keyword) === wordKey(keyword));
    if (existingWord && existingWord.country !== country) continue;
    publicationTargets.push({ keywordId: text(task.keywordId || membershipByWord.get(wordKey(keyword))?.keywordId), keyword, country, language, targetUrls: [url], captured: false, checkedAt: null, pages: [] });
  }
  const targets = new Map<string, { keywordId: string; keyword: string; country: string; language: string; pages: Array<{ url: string; evidenceAt: string; evidence: string }> }>();
  for (const check of [...input.checks, ...publicationTargets]) {
    if (!eligible(check.keyword)) continue;
    const key = pair(check.keyword, check.country), membership = memberships.get(check.keywordId);
    if (!publicationTargets.includes(check) && input.memberships.length && !membership) continue;
    if (membership && (membership.active === false || obj(membership.keyword).active === false || membership.pool !== "FORMAL")) continue;
    const urls = [...check.targetUrls, ...array(membership?.targetUrls).map(text)];
    const pages = urls.flatMap(url => {
      const parsed = publicUrl(url); if (!parsed || urlLanguage(parsed) !== check.language.split("-")[0]) return [];
      const evidence = built.get(normalizeUrl(parsed)); return evidence ? [evidence] : [];
    });
    if (!pages.length) continue;
    const old = targets.get(key);
    targets.set(key, { keywordId: check.keywordId, keyword: check.keyword, country: check.country, language: check.language,
      pages: [...new Map([...(old?.pages ?? []), ...pages].map(page => [page.url, page])).values()] });
  }
  const byWord = new Map<string, RankingObservation[]>();
  for (const row of observations) byWord.set(wordKey(row.keyword), [...(byWord.get(wordKey(row.keyword)) ?? []), row]);
  const ranked = [...byWord].map(([key, pages]) => {
    const distinct = [...new Map(pages.map(page => [`${page.country}:${page.url}:${page.checkedAt}:${page.source}`, page])).values()];
    distinct.sort((a, b) => a.rank - b.rank || RANKING_COUNTRIES.indexOf(a.country as typeof RANKING_COUNTRIES[number]) - RANKING_COUNTRIES.indexOf(b.country as typeof RANKING_COUNTRIES[number]) || a.url.localeCompare(b.url));
    const best = distinct[0], target = targets.get(pair(best.keyword, best.country));
    return { key, keyword: best.keyword, country: best.country, language: languages[best.country], rank: best.rank, url: best.url,
      checkedAt: best.checkedAt, source: best.source, expectedPages: target?.pages.map(page => page.url) ?? [],
      pageMatchesExpected: target ? target.pages.some(page => normalizeUrl(page.url) === normalizeUrl(best.url)) : null,
      pages: distinct };
  }).sort((a, b) => a.rank - b.rank || a.keyword.localeCompare(b.keyword));
  const foundPairs = new Set(observations.map(row => pair(row.keyword, row.country)));
  const unrankedBuilt = [...targets].filter(([key]) => !foundPairs.has(key)).map(([key, target]) => {
    const check = approved.get(key), evidenceAt = target.pages.map(page => page.evidenceAt).sort().at(-1)!;
    return { ...target, checkedAt: check?.checkedAt ?? null, captured: check?.captured ?? false,
      needsNewQuery: !check?.captured, reason: check?.captured ? "本次可见自然结果未检出" : "已建页面目标词尚无本次查询回执",
      pageEvidenceAfterCheck: Boolean(check?.checkedAt && evidenceAt > check.checkedAt) };
  }).sort((a, b) => a.country.localeCompare(b.country) || a.keyword.localeCompare(b.keyword));
  const total = ranked.length;
  const countries = RANKING_COUNTRIES.map(country => ({ country, language: languages[country], count: ranked.filter(row => row.country === country).length,
    share: total ? ranked.filter(row => row.country === country).length / total * 100 : 0 }));
  const bands = [{ label: "前10名", min: 1, max: 10 }, { label: "11–30名", min: 11, max: 30 }, { label: "31–50名", min: 31, max: 50 }, { label: "51–100名", min: 51, max: 100 }]
    .map(band => { const count = ranked.filter(row => row.rank >= band.min && row.rank <= band.max).length; return { ...band, count, share: total ? count / total * 100 : 0 }; });
  const missing = unrankedBuilt.filter(row => row.needsNewQuery).map(row => {
    const hasOriginalIdentity = Boolean(row.keywordId) || row.pages.some(page => page.evidence.startsWith("上线回执 "));
    const ready = native.has(pair(row.keyword, row.country)) && hasOriginalIdentity;
    return { keywordId: row.keywordId, keyword: row.keyword, country: row.country, language: row.language,
      urls: row.pages.map(page => page.url), originalPageEvidence: row.pages.map(page => ({ evidence: page.evidence, evidenceAt: page.evidenceAt })), reason: row.reason, ready,
      holdReason: !native.has(pair(row.keyword, row.country)) ? "原词语种不符或中性词国家待核，不收费查询" : !hasOriginalIdentity ? "缺少原词库或原发布回执身份，不收费查询" : null,
      queryCount: ready ? 1 : 0, depth: 200, maxCrawlPages: 20, maxCostMicros: ready ? 12000 : 0, approved: false };
  });
  // Shared technical terms must never create one paid request per translation.
  const readyWords = missing.filter(row => row.ready).map(row => wordKey(row.keyword));
  for (const row of missing) if (row.ready && readyWords.filter(word => word === wordKey(row.keyword)).length > 1) {
    row.ready = false; row.queryCount = 0; row.maxCostMicros = 0; row.holdReason = "同一原词有多个国家候选，先核定唯一国家，不重复付费";
  }
  return { siteDomain: "flatkey.ai", generatedAt: input.generatedAt, total, countries, bands, ranked, unrankedBuilt, historical, languagePending, missing,
    coverage: { discoverySavedComplete: obj(input.discovery).complete === true, discoveryRawKeywords: array(obj(input.discovery).items).length,
      targetChecks: input.checks.filter(row => row.captured).length, builtTargetPairs: targets.size, newerChecksSupersedeOldHits: historical.length,
      note: "已复用实测与数据库发现；数据库记录保留原索引日期，不冒充实时实测。总数是当前已取得证据的非品牌排名词并集。" },
    quote: { newQueryCount: missing.filter(row => row.ready).length, heldCount: missing.filter(row => !row.ready).length,
      maxCostMicros: missing.reduce((sum, row) => sum + row.maxCostMicros, 0), paidApproved: false, newPaidRequests: 0 } };
}
export type RankingReconciliation = ReturnType<typeof reconcileRankings>;
