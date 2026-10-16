import { createHash } from "node:crypto";
import { z } from "zod";
import type { SerpTarget } from "@/lib/serp-targets";
import type { SerpMonitorConfiguration, SerpNormalizedResult, SerpOrganicResult, SerpQuote, SerpRegion } from "@/lib/serp-monitor-types";

export const SERP_TASK_POST_URL = "https://api.dataforseo.com/v3/serp/google/organic/task_post";
export const SERP_TASK_GET_URL = "https://api.dataforseo.com/v3/serp/google/organic/task_get/advanced";
export const SERP_CONFIG_ID = "default";
export const SERP_NORMALIZATION_VERSION = 2;
export const SERP_MARKETS: SerpRegion[] = ["US", "JP", "ES", "BR"];
export const SERP_MARKET_CONFIG = {
  US: { region: "US", languageCode: "en", locationCode: 2840, searchDomain: "google.com" },
  JP: { region: "JP", languageCode: "ja", locationCode: 2392, searchDomain: "google.co.jp" },
  ES: { region: "ES", languageCode: "es", locationCode: 2724, searchDomain: "google.es" },
  BR: { region: "BR", languageCode: "pt", locationCode: 2076, searchDomain: "google.com.br" },
} as const;
export const isSerpRegion = (value: unknown): value is SerpRegion => typeof value === "string" && Object.hasOwn(SERP_MARKET_CONFIG, value);
export function configForSerpRegion(region: SerpRegion, base: SerpMonitorConfiguration = SERP_DEFAULT_CONFIG): SerpMonitorConfiguration {
  if (!isSerpRegion(region)) throw new Error("UNAPPROVED_SERP_REGION");
  const market = SERP_MARKET_CONFIG[region];
  return { ...base, region, languageCode: market.languageCode, locationCode: market.locationCode };
}
export const SERP_DEFAULT_CONFIG: SerpMonitorConfiguration = {
  region: "US", regions: [...SERP_MARKETS], languageCode: "en", locationCode: 2840, device: "desktop", depth: 100,
  intervalDays: 14, paidEnabled: false, maxRunCostMicros: 50_000_000,
  schedule: "SEMI_MONTHLY", scheduleDays: [1, 16], timezone: "Asia/Shanghai", localTime: "10:30",
  maxMonthCostMicros: 100_000_000, revision: 0, nextDueAt: null,
};
export const SERP_PRICE_PER_QUERY_MICROS = 6_000;
export const serpQueryKey = (keyword: string) => keyword.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
const operator = /(?:^|\s)(?:allinanchor|allintext|allintitle|allinurl|cache|define|filetype|id|inanchor|info|intext|intitle|inurl|link|site):/i;
export const hasPaidSearchOperator = (keyword: string) => operator.test(keyword);

export type SerpQuery = { queryKey: string; keyword: string; targets: SerpTarget[] };
export function groupSerpQueries(targets: SerpTarget[]): SerpQuery[] {
  const groups = new Map<string, SerpQuery>();
  for (const target of targets) {
    const queryKey = serpQueryKey(target.keyword);
    const group = groups.get(queryKey) ?? { queryKey, keyword: target.keyword.trim(), targets: [] };
    if (!group.targets.some(item => item.siteDomain === target.siteDomain && item.keywordId === target.keywordId)) group.targets.push(target);
    groups.set(queryKey, group);
  }
  return [...groups.values()].sort((a, b) => a.queryKey.localeCompare(b.queryKey));
}
export function groupSerpMarketQueries(targets: SerpTarget[], regions: SerpRegion[] = SERP_MARKETS): Array<SerpQuery & { region: SerpRegion }> {
  if (!regions.length || new Set(regions).size !== regions.length || regions.some(region => !isSerpRegion(region))) throw new Error("UNAPPROVED_SERP_REGIONS");
  return groupSerpQueries(targets).flatMap(query => regions.map(region => ({ ...query, region, queryKey: `${region}:${query.queryKey}` })));
}
export function quoteSerpTargets(targets: SerpTarget[], regions: SerpRegion[] = ["US"]): SerpQuote {
  const groups = groupSerpQueries(targets), queries = groupSerpMarketQueries(targets, regions);
  const maxCostMicros = queries.reduce((sum, group) => sum + SERP_PRICE_PER_QUERY_MICROS * (hasPaidSearchOperator(group.keyword) ? 5 : 1), 0);
  return { targetCount: targets.length, queryCount: queries.length, sharedQueriesSaved: (targets.length - groups.length) * regions.length,
    keywordQueryCount: groups.length, markets: [...regions], marketCount: regions.length,
    perQueryMaxCostMicros: SERP_PRICE_PER_QUERY_MICROS, maxCostMicros,
    annualRuns: 24, annual24RunsMicros: maxCostMicros * 24, monthlyAverageMicros: maxCostMicros * 2,
    batchCount: Math.ceil(queries.length / 100), provider: "dataforseo_serp", mode: "standard",
    pricingUrl: "https://dataforseo.com/pricing/google-serp/google-organic-serp-api", pricedAt: "2026-10-16" };
}
export function buildSerpTask(query: SerpQuery, tag: string, config: SerpMonitorConfiguration) {
  if (!query.keyword || query.keyword.length > 700 || [...query.keyword].some(character => character.charCodeAt(0) < 32)) throw new Error("INVALID_QUERY");
  if (hasPaidSearchOperator(query.keyword)) throw new Error("PAID_OPERATOR_REQUIRES_REVIEW");
  if (!isSerpRegion(config.region) || config.locationCode !== SERP_MARKET_CONFIG[config.region].locationCode || config.languageCode !== SERP_MARKET_CONFIG[config.region].languageCode || config.device !== "desktop" || config.depth !== 100 || config.schedule !== "SEMI_MONTHLY") throw new Error("UNAPPROVED_CONFIGURATION");
  return {
    // DataForSEO decodes literal '+' and '%xx' in keyword input. Escape exactly
    // these characters so C++/percent terms are searched as the original text.
    keyword: query.keyword.replace(/%/g, "%25").replace(/\+/g, "%2B"), location_code: config.locationCode,
    language_code: config.languageCode, se_domain: SERP_MARKET_CONFIG[config.region].searchDomain, device: config.device, os: "windows", depth: config.depth,
    max_crawl_pages: 10, priority: 1, tag,
    // No paid extras and no stop-on-match: preserve every ranking page.
    calculate_rectangles: false, load_async_ai_overview: false,
  };
}
export const serpTaskId = (runId: string, queryKey: string) => `serp-${createHash("sha256").update(`${runId}\n${queryKey}`).digest("hex").slice(0, 40)}`;
export const providerCostMicros = (cost: unknown): number | null => typeof cost === "number" && Number.isFinite(cost) && cost >= 0 && cost < 2_000 ? Math.round(cost * 1_000_000) : null;
export const providerIdIsSafe = (id: unknown): id is string => typeof id === "string" && /^[a-zA-Z0-9-]{5,100}$/.test(id);
const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
export function providerTaskEnvelope(raw: unknown, expectedId: string) {
  const root = record(raw), tasks = Array.isArray(root.tasks) ? root.tasks.map(record) : [];
  if (root.status_code !== 20000 || tasks.length !== 1 || tasks[0].id !== expectedId) throw new Error("INVALID_PROVIDER_ENVELOPE");
  return tasks[0];
}
function dateFromProvider(value: unknown): string {
  if (typeof value !== "string" || !/\d{4}-\d{2}-\d{2}[ T]/.test(value) || !/(?:Z|[+-]\d{2}:?\d{2})$/.test(value)) throw new Error("MISSING_SERP_TIMESTAMP");
  const date = new Date(value.replace(/^(\d{4}-\d{2}-\d{2}) /, "$1T").replace(/ ([+-]\d{2}:?\d{2})$/, "$1"));
  if (!Number.isFinite(date.getTime()) || date.getTime() > Date.now() + 5 * 60_000) throw new Error("INVALID_SERP_TIMESTAMP");
  return date.toISOString();
}
export function normalizeSerpAdvanced(raw: unknown, expected: { providerTaskId: string; keyword: string; config: SerpMonitorConfiguration }): SerpNormalizedResult {
  const task = providerTaskEnvelope(raw, expected.providerTaskId), data = record(task.data), results = Array.isArray(task.result) ? task.result.map(record) : [];
  if (task.status_code !== 20000 || results.length !== 1) throw new Error("SERP_NOT_READY");
  const result = results[0], config = expected.config;
  if (data.device !== config.device || (data.location_code !== undefined && data.location_code !== config.locationCode) ||
      (data.language_code !== undefined && data.language_code !== config.languageCode) || (data.depth !== undefined && data.depth !== config.depth) ||
      (data.se !== undefined && data.se !== "google") || (data.se_type !== undefined && data.se_type !== "organic") ||
      result.location_code !== config.locationCode || result.language_code !== config.languageCode ||
      result.type !== "organic" || !isSerpRegion(config.region) || result.se_domain !== SERP_MARKET_CONFIG[config.region].searchDomain) throw new Error("SERP_SCOPE_MISMATCH");
  const spell = record(result.spell), spellType = typeof spell.type === "string" ? spell.type : null;
  const corrected = typeof spell.keyword === "string" ? spell.keyword : typeof spell.spell === "string" ? spell.spell : null;
  const correctedKeyword = corrected?.trim() || null;
  const queryStatus = ["showing_results_for", "no_results_found_for", "including_results_for"].includes(spellType ?? "") ? "AUTOCORRECTED" : "EXACT";
  // The echoed request keyword is encoded, while the result keyword is decoded.
  // Some Google responses echo the corrected term in the result metadata;
  // retain that evidence as a completed, corrected query, never original rank.
  const expectedInput = expected.keyword.replace(/%/g, "%25").replace(/\+/g, "%2B");
  const resultKeyword = serpQueryKey(String(result.keyword ?? ""));
  if (data.keyword !== expectedInput || (resultKeyword !== serpQueryKey(expected.keyword) &&
    !(queryStatus === "AUTOCORRECTED" && correctedKeyword && resultKeyword === serpQueryKey(correctedKeyword)))) throw new Error("SERP_KEYWORD_MISMATCH");
  if (!Array.isArray(result.items)) throw new Error("INVALID_SERP_ITEMS");
  const organicResults: SerpOrganicResult[] = [], seen = new Set<string>();
  let invalidOrganic = false;
  for (const unknownItem of result.items) {
    const item = record(unknownItem);
    if (item.type !== "organic") continue;
    if (!Number.isInteger(item.rank_group) || Number(item.rank_group) < 1) { invalidOrganic = true; continue; }
    if (Number(item.rank_group) > 100) continue;
    let url: URL;
    try { url = new URL(String(item.url)); if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) throw new Error(); }
    catch { invalidOrganic = true; continue; }
    const identity = `${item.rank_group}:${url.href}`;
    if (seen.has(identity)) continue;
    seen.add(identity);
    organicResults.push({ url: url.href, domain: url.hostname.toLowerCase(), title: typeof item.title === "string" ? item.title : null,
      rankGroup: Number(item.rank_group), rankAbsolute: Number.isInteger(item.rank_absolute) && Number(item.rank_absolute) > 0 ? Number(item.rank_absolute) : null });
  }
  organicResults.sort((a, b) => a.rankGroup - b.rankGroup || a.url.localeCompare(b.url));
  const ranks = new Set(organicResults.map(item => item.rankGroup));
  // items_count includes ads/widgets. Neither it, se_results_count nor merely
  // requesting depth 100 proves that 100 organic positions were retrieved.
  let coveredThroughRank = 0;
  while (coveredThroughRank < 100 && ranks.has(coveredThroughRank + 1)) coveredThroughRank++;
  const captureComplete = !invalidOrganic, rankingVerified = captureComplete && queryStatus === "EXACT";
  const completeDepth = rankingVerified && coveredThroughRank === 100;
  let googleUrl: string | null = null;
  try { const parsed = new URL(String(result.check_url)); if (parsed.protocol === "https:" && isSerpRegion(config.region) && (parsed.hostname === SERP_MARKET_CONFIG[config.region].searchDomain || parsed.hostname.endsWith(`.${SERP_MARKET_CONFIG[config.region].searchDomain}`))) googleUrl = parsed.href; } catch { /* Optional source evidence. */ }
  return { normalizationVersion: SERP_NORMALIZATION_VERSION, captureComplete, organicCount: organicResults.length, coveredThroughRank,
    queryStatus, correctedKeyword, spellType, pagesCount: Number.isInteger(result.pages_count) && Number(result.pages_count) >= 0 ? Number(result.pages_count) : null,
    providerTaskId: expected.providerTaskId, keyword: expected.keyword, locationCode: config.locationCode,
    languageCode: config.languageCode, device: config.device, checkedAt: dateFromProvider(result.datetime), googleUrl,
    organicResults, completeDepth, rankingVerified, maxOrganicRank: Math.max(0, ...ranks) };
}

export const serpMonitorMutationSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("preview") }).strict(),
  z.object({ action: z.literal("configure"), paidEnabled: z.literal(false), expectedRevision: z.number().int().min(0).optional(),
    maxRunCostMicros: z.number().int().min(6_000).max(50_000_000).optional(), maxMonthCostMicros: z.number().int().min(6_000).max(100_000_000).optional() }).strict(),
  z.object({ action: z.literal("start"), idempotencyKey: z.string().regex(/^[a-zA-Z0-9-]{8,100}$/), expectedCohortHash: z.string().regex(/^[a-f0-9]{64}$/) }).strict(),
  z.object({ action: z.literal("resume"), runId: z.string().regex(/^[a-zA-Z0-9-]{8,100}$/) }).strict(),
  z.object({ action: z.literal("replay"), runId: z.string().regex(/^[a-zA-Z0-9-]{8,100}$/) }).strict(),
]);
export type SerpMonitorMutation = z.infer<typeof serpMonitorMutationSchema>;
