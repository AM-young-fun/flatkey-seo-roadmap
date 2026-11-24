import { createHash } from "node:crypto";
import { z } from "zod";
import type { GrowthTarget, GrowthWorkspace } from "./growth-types";
import { growthPublicUrl, growthWordKey } from "./growth-workspace";
import { isOwnedBrandKeyword } from "./keyword-market-policy";
import { nextSerpPeriodKey, serpPeriodFromKey } from "./serp-periods";

export const GROWTH_COLLECTION_KIND = "growth-collection";
export const GROWTH_COLLECTION_SCOPE = "GROWTH_APPROVED";
export const GROWTH_COLLECTION_MARKETS = {
  US: { language: "en", languageCode: "en", locationCode: 2840, searchDomain: "google.com" },
  JP: { language: "ja", languageCode: "ja", locationCode: 2392, searchDomain: "google.co.jp" },
  BR: { language: "pt-BR", languageCode: "pt", locationCode: 2076, searchDomain: "google.com.br" },
  SG: { language: "zh-CN", languageCode: "zh-CN", locationCode: 2702, searchDomain: "google.com.sg" },
  ES: { language: "es-ES", languageCode: "es", locationCode: 2724, searchDomain: "google.es" },
  FR: { language: "fr", languageCode: "fr", locationCode: 2250, searchDomain: "google.fr" },
  DE: { language: "de", languageCode: "de", locationCode: 2276, searchDomain: "google.de" },
  VN: { language: "vi", languageCode: "vi", locationCode: 2704, searchDomain: "google.com.vn" },
  ID: { language: "id", languageCode: "id", locationCode: 2360, searchDomain: "google.co.id" },
} as const;
export type GrowthCollectionCountry = keyof typeof GROWTH_COLLECTION_MARKETS;
export class GrowthCollectionError extends Error { constructor(public code: string, message: string, public status = 409) { super(message); } }
export const collectionHash = (value: unknown): string => {
  const stable = (value: unknown): unknown => Array.isArray(value) ? value.map(stable) : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, stable(child)])) : value;
  return createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
};
const strings = (items: string[]) => [...new Set(items)].sort();
export type GrowthCollectionTarget = Pick<GrowthTarget, "id" | "keywordId" | "site" | "topicId" | "keyword" | "country" | "language" | "publishedUrls">;
export type GrowthCollectionQuery = { key: string; keyword: string; country: GrowthCollectionCountry; language: string; targetIds: string[]; maxCostMicros: 6000 };
export type GrowthCollectionManifest = {
  version: "growth-collection-v1"; periodKey: string; periodLabel: string; periodDueAt: string; preparedAt: string; expiresAt: string;
  sourceHash: string; configRevision: number; connectionVersion: number; targets: GrowthCollectionTarget[];
  reused: { targetId: string; checkedAt: string; rank: number | null; captureState: string; originalScope: string | null; originalPeriodKey: string | null; originalRunId: string | null }[];
  held: { targetId: string; reason: string }[]; queries: GrowthCollectionQuery[]; maxCostMicros: number;
  provider: "dataforseo_serp"; device: "desktop"; depth: 100; hash: string;
};
export type GrowthCollectionState = { id: string; version: number; manifest: GrowthCollectionManifest; approval: { actor: "human"; approvedAt: string; manifestHash: string; maxCostMicros: number; reason: string } | null; runId: string | null };
const id = z.string().min(1).max(200), hash = z.string().regex(/^[a-f0-9]{64}$/), version = z.number().int().nonnegative();
export const growthCollectionCommandSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("prepare"), requestId: id, expectedVersion: version, periodKey: z.string().min(10).max(10) }).strict(),
  z.object({ action: z.literal("approve"), requestId: id, expectedVersion: version, periodKey: z.string().min(10).max(10), manifestHash: hash, maxCostMicros: z.number().int().nonnegative(), reason: z.string().trim().min(1).max(2000) }).strict(),
  z.object({ action: z.literal("reserve"), requestId: id, expectedVersion: version, periodKey: z.string().min(10).max(10), manifestHash: hash }).strict(),
  z.object({ action: z.literal("resume"), requestId: id, expectedVersion: version, periodKey: z.string().min(10).max(10), manifestHash: hash, allowSubmit: z.boolean().default(false) }).strict(),
]);
export type GrowthCollectionCommand = z.infer<typeof growthCollectionCommandSchema>;
export function growthCollectionTargets(workspace: GrowthWorkspace) {
  const ids = new Set([...(workspace.quarter?.targetIds ?? []), ...(workspace.hotspotTargetIds ?? [])]);
  return workspace.targets.filter(target => target.membership === "formal" && ids.has(target.id));
}
export function growthCollectionSourceHash(workspace: GrowthWorkspace) {
  return collectionHash({ quarter: workspace.quarter ?? null, hotspotTargetIds: strings(workspace.hotspotTargetIds ?? []), targets: growthCollectionTargets(workspace).map(target => [target.id, target.keywordId, target.site, target.topicId, target.keyword, target.country, target.language, target.languageStatus, target.pageState, [...target.publishedUrls].sort()]).sort((a,b) => String(a[0]).localeCompare(String(b[0]))) });
}
export function buildGrowthCollectionManifest(workspace: GrowthWorkspace, periodKey: string, configuration: { revision: number; connectionVersion: number }, now = new Date()): GrowthCollectionManifest {
  const period = serpPeriodFromKey(periodKey);
  const nextPeriod = serpPeriodFromKey(nextSerpPeriodKey(periodKey));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(period.key)) throw new GrowthCollectionError("legacy_period", "本轮使用保留的14天期次身份，不创建旧半月期替代批次");
  const targets: GrowthCollectionTarget[] = [], reused: GrowthCollectionManifest["reused"] = [], held: GrowthCollectionManifest["held"] = [], groups = new Map<string, GrowthCollectionQuery>();
  const candidates = growthCollectionTargets(workspace), marketsByWord = new Map<string, Set<string>>();
  for (const target of candidates) {
    const market = GROWTH_COLLECTION_MARKETS[target.country as GrowthCollectionCountry];
    if (!market || market.language !== target.language || target.languageStatus !== "match") continue;
    const key = growthWordKey(target.keyword), markets = marketsByWord.get(key) ?? new Set<string>();
    markets.add(`${target.country}:${target.language}`); marketsByWord.set(key, markets);
  }
  for (const target of candidates.sort((a,b) => a.id.localeCompare(b.id))) {
    const market = target.country ? GROWTH_COLLECTION_MARKETS[target.country as GrowthCollectionCountry] : null;
    const urls = target.publishedUrls.filter(url => growthPublicUrl(url, target.site));
    const reason = (marketsByWord.get(growthWordKey(target.keyword))?.size ?? 0) > 1 ? "同一原词存在多个主国家身份，须先核定一个已审主市场，不跨国重复收费" : !["flatkey.ai", "rackrate.org", "modelfit.cc"].includes(target.site) ? "本站不在付费排名或内容执行范围" : !target.topicId ? "正式话题归属未核实" : !market || market.language !== target.language ? "原市场/语言尚不支持，禁止回落其他国家" : target.languageStatus !== "match" ? target.languageReason : target.pageState !== "published" || !urls.length ? "没有真实已建页面证据，保留目标但不进入付费队列" : isOwnedBrandKeyword(target.keyword) ? "自有品牌词排除付费" : /(?:^|\s)(?:\w+):/u.test(target.keyword) ? "带搜索运算符，须单独核费" : !target.keywordId ? "缺少真实原关键词ID" : null;
    if (reason) { held.push({ targetId: target.id, reason }); continue; }
    targets.push({ id: target.id, keywordId: target.keywordId, site: target.site, topicId: target.topicId, keyword: target.keyword, country: target.country, language: target.language, publishedUrls: strings(urls) });
    const checkedAt = target.checkedAt ? Date.parse(target.checkedAt) : NaN;
    if (target.observationEligible && target.checkedAt && target.rankSource === "serp" && checkedAt >= Date.parse(period.dueAt) && checkedAt < Date.parse(nextPeriod.dueAt) && checkedAt <= now.getTime() && now.getTime() - checkedAt <= 14 * 86400000) {
      reused.push({ targetId: target.id, checkedAt: target.checkedAt, rank: target.rank, captureState: target.captureState, originalScope: target.captureScope ?? null, originalPeriodKey: target.capturePeriodKey ?? null, originalRunId: target.captureRunId ?? null }); continue;
    }
    const key = `${target.country}:${target.language}:${growthWordKey(target.keyword)}`, existing = groups.get(key);
    if (existing) existing.targetIds.push(target.id);
    else groups.set(key, { key, keyword: target.keyword, country: target.country as GrowthCollectionCountry, language: target.language!, targetIds: [target.id], maxCostMicros: 6000 });
  }
  const queries = [...groups.values()].sort((a,b) => a.key.localeCompare(b.key));
  const content: Omit<GrowthCollectionManifest,"hash"> = { version: "growth-collection-v1", periodKey: period.key, periodLabel: period.label, periodDueAt: period.dueAt, preparedAt: now.toISOString(), expiresAt: new Date(now.getTime()+24*3600000).toISOString(),
    sourceHash: growthCollectionSourceHash(workspace), configRevision: configuration.revision, connectionVersion: configuration.connectionVersion, targets, reused, held, queries, maxCostMicros: queries.length*6000, provider: "dataforseo_serp", device: "desktop", depth: 100 };
  return { ...content, hash: collectionHash(content) };
}
/** UI and the payable manifest share the exact target, reuse and price rules. */
export function growthCollectionMonitoringQuote(manifest: GrowthCollectionManifest): GrowthWorkspace["monitoringQuote"] {
  return { approved: false, paidRequests: 0, queryCount: manifest.queries.length, reusedCount: manifest.reused.length, heldCount: manifest.held.length, maxCostMicros: manifest.maxCostMicros,
    queries: manifest.queries.map(query => {
      const targets = manifest.targets.filter(target => query.targetIds.includes(target.id));
      const sites = strings(targets.map(target => target.site));
      return { id: `query:${query.key}`, site: sites[0], sites, keyword: query.keyword, country: query.country, language: query.language, targetIds: query.targetIds, urls: strings(targets.flatMap(target => target.publishedUrls)), approved: false, maxCostMicros: query.maxCostMicros, reason: "季度或已批准热点的真实已建页目标；缺本期完整同词同市场SERP，清单与费用须先审" };
    }), reason: "本页与正式采集清单共用规则；只读估算，未授权或提交新查询。" };
}
export function assertGrowthCollectionManifest(manifest: GrowthCollectionManifest) {
  const {hash: digest, ...content}=manifest;
  if (digest !== collectionHash(content) || manifest.maxCostMicros !== manifest.queries.length*6000 || manifest.version !== "growth-collection-v1" || manifest.device !== "desktop" || manifest.depth !== 100 || !Number.isFinite(Date.parse(manifest.preparedAt)) || !Number.isFinite(Date.parse(manifest.expiresAt))) throw new GrowthCollectionError("manifest_changed", "冻结清单或费用已变化，须重新审核");
  const targetMap = new Map(manifest.targets.map(target => [target.id,target]));
  const period=serpPeriodFromKey(manifest.periodKey),nextPeriod=serpPeriodFromKey(nextSerpPeriodKey(manifest.periodKey));
  if(manifest.periodDueAt!==period.dueAt||manifest.reused.some(row=>{const checkedAt=Date.parse(row.checkedAt);return !Number.isFinite(checkedAt)||checkedAt<Date.parse(period.dueAt)||checkedAt>=Date.parse(nextPeriod.dueAt)||checkedAt>Date.parse(manifest.preparedAt)||Date.parse(manifest.preparedAt)-checkedAt>14*86400000;}))throw new GrowthCollectionError("reuse_period_mismatch","复用回执不在本期真实采集窗口；保留原期次，不能作为本期占位");
  if (targetMap.size !== manifest.targets.length || new Set(manifest.queries.map(query=>query.key)).size !== manifest.queries.length || new Set(manifest.queries.map(query=>growthWordKey(query.keyword))).size !== manifest.queries.length) throw new GrowthCollectionError("duplicate_query", "清单目标或原词查询重复；同词本期只查一个主国家");
  const covered = new Set(manifest.reused.map(item=>item.targetId));
  for (const query of manifest.queries) {
    const market=GROWTH_COLLECTION_MARKETS[query.country];
    if (!market || market.language !== query.language || query.key !== `${query.country}:${query.language}:${growthWordKey(query.keyword)}` || query.maxCostMicros !== 6000 || !query.targetIds.length) throw new GrowthCollectionError("market_changed", "国家、原词或语言与冻结查询不一致");
    for (const targetId of query.targetIds) { const target=targetMap.get(targetId);
      if (!target || target.country!==query.country || target.language!==query.language || growthWordKey(target.keyword)!==growthWordKey(query.keyword) || covered.has(targetId)) throw new GrowthCollectionError("target_changed", "查询扩大或重复了冻结目标"); covered.add(targetId); }
  }
  if (covered.size!==targetMap.size || [...covered].some(targetId=>!targetMap.has(targetId))) throw new GrowthCollectionError("coverage_changed", "目标与复用/付费清单无法对平");
}
export function approveGrowthCollection(state: GrowthCollectionState, command: Extract<GrowthCollectionCommand,{action:"approve"}>, actor: "human"|"collector", now = new Date()): GrowthCollectionState {
  if (actor!=="human") throw new GrowthCollectionError("human_required", "付费清单必须由已登录用户在同源页面确认",403);
  assertGrowthCollectionManifest(state.manifest);
  if (state.version!==command.expectedVersion || command.periodKey!==state.id || command.manifestHash!==state.manifest.hash || command.maxCostMicros!==state.manifest.maxCostMicros) throw new GrowthCollectionError("approval_mismatch", "须批准当前确切清单、版本和费用上限");
  if (Date.parse(state.manifest.expiresAt)<=now.getTime() || state.runId) throw new GrowthCollectionError("approval_expired", "清单已过期或已转入原采集账本，请核对原记录");
  return {...state,version:state.version+1,approval:{actor:"human",approvedAt:now.toISOString(),manifestHash:command.manifestHash,maxCostMicros:command.maxCostMicros,reason:command.reason}};
}
export function assertGrowthCollectionApproval(state: GrowthCollectionState, now=new Date()) {
  assertGrowthCollectionManifest(state.manifest);
  // Expiry limits the initial reservation. A started single-use run continues
  // under its original frozen cap/IDs, including free retrieval after 24h.
  if (!state.approval || state.approval.actor!=="human" || state.approval.manifestHash!==state.manifest.hash || state.approval.maxCostMicros!==state.manifest.maxCostMicros || !state.runId && Date.parse(state.manifest.expiresAt)<=now.getTime()) throw new GrowthCollectionError("approval_required", "当前清单尚未获确切人工费用批准或已过期",403);
}
export function buildGrowthCollectionRequest(query: GrowthCollectionQuery, tag:string) {
  const market=GROWTH_COLLECTION_MARKETS[query.country];
  if (!market || market.language!==query.language || !query.keyword.trim() || query.keyword.length>700 || [...query.keyword].some(character=>character.charCodeAt(0)<32) || isOwnedBrandKeyword(query.keyword) || /(?:^|\s)\w+:/u.test(query.keyword) || query.key!==`${query.country}:${query.language}:${growthWordKey(query.keyword)}`) throw new GrowthCollectionError("invalid_query", "原词、国家、语言或收费参数不一致");
  return {keyword:query.keyword.replace(/%/g,"%25").replace(/\+/g,"%2B"),location_code:market.locationCode,language_code:market.languageCode,se_domain:market.searchDomain,device:"desktop",os:"windows",depth:100,max_crawl_pages:10,priority:1,tag,calculate_rectangles:false,load_async_ai_overview:false};
}
