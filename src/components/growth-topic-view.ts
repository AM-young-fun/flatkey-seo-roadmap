import type { GrowthTarget, GrowthTopic, GrowthWorkspace } from "@/lib/growth-types";
import { currentRankingSummary } from "@/lib/current-ranking-summary";

export type GrowthScope = { site: string; country: string; language: string; membership: "formal" | "opportunity" | "review"; search: string };
export const defaultGrowthScope: GrowthScope = { site: "all", country: "all", language: "all", membership: "formal", search: "" };
export type GrowthRankingView = "all" | "formal";

/** The execution workspace contains the one quarterly TopicMap list. Discovery
 * observations remain available to the overview without becoming target queues. */
export function quarterTargetWorkspace(data: GrowthWorkspace): GrowthWorkspace {
  const ids = new Set(data.quarter?.targetIds ?? []);
  const rows = data.targets.filter(target => target.membership === "formal" && target.topicId
    && data.topics.some(topic => topic.topicId === target.topicId && topic.site === target.site)
    && ids.has(target.id));
  const words = new Map<string, GrowthTarget>();
  for (const target of rows) {
    const key = target.keyword.normalize("NFKC").trim().replace(/\s+/gu, " ").toLowerCase();
    if (!words.has(key)) words.set(key, target);
  }
  return { ...data, targets: [...words.values()], opportunities: [] };
}

/** Ranking observations have their own scope; a formal TopicMap membership is
 * not a condition for an existing exact-market rank to be visible. */
export function growthRankingEvidence(data: GrowthWorkspace, scope: GrowthScope, view: GrowthRankingView) {
  const targets = [...new Map(data.targets.map(target => [target.id, target])).values()].filter(target =>
    (view === "all" || target.membership === "formal") && (scope.site === "all" || target.site === scope.site)
    && (scope.country === "all" || target.country?.toUpperCase() === scope.country)
    && (scope.language === "all" || target.language === scope.language));
  const summary = currentRankingSummary(targets, data.generatedAt);
  const ranked = summary.combinations;
  const currentIds = new Set(ranked.map(target => target.id)), generatedAt = Date.parse(data.generatedAt);
  const background = targets.filter(target => !currentIds.has(target.id) && target.rank !== null && target.rankSource).map(target => {
    const expired = target.checkedAt && Number.isFinite(generatedAt) && generatedAt - Date.parse(target.checkedAt) > 14 * 86400000;
    const kind: "database" | "gsc" | "expired" | "unverified" = target.rankSource === "database" ? "database" : target.rankSource === "gsc" ? "gsc" : expired ? "expired" : "unverified";
    return { target, kind };
  });
  return { targets, ranked, background, summary, uniqueWords: summary.total };
}

export function readGrowthScope(params: URLSearchParams): GrowthScope {
  const membership = params.get("pool");
  return { site: params.get("site") || "all", country: (params.get("country") || "all").toUpperCase().replace(/^ALL$/, "all"),
    language: params.get("language") || "all", membership: membership === "opportunity" || membership === "review" ? membership : "formal", search: params.get("q") || "" };
}

export function growthLink(scope: GrowthScope, topic?: GrowthTopic, targetId?: string): string {
  const params = new URLSearchParams();
  if (scope.site !== "all" || topic) params.set("site", topic?.site || scope.site);
  if (scope.country !== "all") params.set("country", scope.country);
  if (scope.language !== "all") params.set("language", scope.language);
  if (scope.membership !== "formal") params.set("pool", scope.membership);
  if (scope.search) params.set("q", scope.search);
  if (targetId) params.set("target", targetId);
  const path = topic ? `/topics/${encodeURIComponent(topic.topicId)}` : "/opportunities";
  return path + (params.size ? `?${params}` : "");
}

export function selectGrowthTargets(data: GrowthWorkspace, scope: GrowthScope, topic?: GrowthTopic): GrowthTarget[] {
  const query = scope.search.trim().toLocaleLowerCase();
  const descendants = topic ? growthDescendantIds(data.topics, topic) : null;
  const matchedTopics = query ? data.topics.filter(item => item.name.toLocaleLowerCase().includes(query)).map(item => ({ site: item.site, ids: growthDescendantIds(data.topics, item) })) : [];
  return data.targets.filter(target => target.membership === scope.membership
    && (scope.site === "all" || target.site === scope.site)
    && (scope.country === "all" || target.country?.toUpperCase() === scope.country)
    && (scope.language === "all" || target.language === scope.language)
    && (!topic || target.site === topic.site && target.topicId != null && descendants!.has(target.topicId))
    && (!query || `${target.keyword} ${target.topicName || ""}`.toLocaleLowerCase().includes(query)
      || matchedTopics.some(item => item.site === target.site && (item.ids.has(target.topicId || "") || target.relatedTopicIds?.some(id => item.ids.has(id))))));
}

export function growthTopicContains(topic: GrowthTopic, target: GrowthTarget): boolean {
  return topic.site === target.site && target.topicId === topic.topicId;
}

/** Follow original DAG edges without changing them; cycles cannot duplicate targets. */
export function growthDescendantIds(topics: GrowthTopic[], topic: GrowthTopic): Set<string> {
  const ids = new Set<string>(), pending = [topic.topicId];
  while (pending.length) {
    const id = pending.pop()!;
    if (ids.has(id)) continue;
    ids.add(id);
    for (const child of topics) if (child.site === topic.site && child.parentIds.includes(id) && !ids.has(child.topicId)) pending.push(child.topicId);
  }
  return ids;
}

export function growthTopicTargets(topics: GrowthTopic[], topic: GrowthTopic, targets: GrowthTarget[]): GrowthTarget[] {
  const ids = growthDescendantIds(topics, topic);
  return targets.filter(target => target.site === topic.site && target.topicId != null && ids.has(target.topicId));
}

export function growthRelatedTargets(topics: GrowthTopic[], topic: GrowthTopic, targets: GrowthTarget[]): GrowthTarget[] {
  const ids = growthDescendantIds(topics, topic);
  return targets.filter(target => target.site === topic.site && !ids.has(target.topicId || "") && target.relatedTopicIds?.some(id => ids.has(id)));
}

export function growthCounts(targets: GrowthTarget[]) {
  const ranked = targets.filter(target => target.rankEligible && target.rank != null && target.rank >= 1 && target.rank <= 100);
  return { total: targets.length, built: targets.filter(target => target.pageState === "published").length,
    ranked: ranked.length, top50: ranked.filter(target => target.rank! <= 50).length,
    unknown: targets.filter(target => !target.rankEligible && target.captureState !== "outside100").length };
}

export function growthRankKind(target: GrowthTarget): string {
  if (target.rankEligible && target.rank != null && target.rank >= 1 && target.rank <= 100) return target.rank <= 10 ? "top10" : target.rank <= 30 ? "top30" : target.rank <= 50 ? "top50" : "top100";
  if (target.languageStatus === "mismatch") return "mismatch";
  return target.captureState === "outside100" ? "outside" : "unknown";
}

export function growthRankText(target: GrowthTarget): string {
  if (!target.country || !target.language) return "目标身份待核";
  if (target.rankEligible && target.rank != null) return `第 ${target.rank} 名`;
  if (target.languageStatus === "mismatch") return "语言不匹配";
  if (target.rank != null) return `${target.rankSource === "gsc" ? "GSC均位" : "已有观察"} ${target.rank} · 待核定`;
  return ({ outside100: "已查未进前100", incomplete: "结果未齐", failed: "查询失败", unqueried: "尚未查询", ranked: "排名待核定" })[target.captureState];
}

export function growthMarketLabel(data: GrowthWorkspace, country: string | null, language: string | null): string {
  const market = data.markets.find(item => item.country === country && item.language === language);
  return market?.label || `${country || "国家待核"} · ${language || "语言待核"}`;
}
