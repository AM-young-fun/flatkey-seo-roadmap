import type { GrowthDriver, GrowthReportSnapshot } from "./growth-strategy";
import type { GrowthTopic } from "./growth-types";

export const growthContributionMetricNames = { sessions: "页面会话贡献", clicks: "Google点击", impressions: "Google曝光" } as const;

/** The same saved, exact-window page evidence feeds both overview and topic list.
 * These are page contributions, not a deduplicated topic/whole-site traffic total. */
export function growthContributionDrivers(snapshot: GrowthReportSnapshot | null, metric?: GrowthDriver["metric"]): GrowthDriver[] {
  if (!snapshot) return [];
  const rows = snapshot.directions.flatMap(direction => direction.drivers).filter(row => {
    const w = row.window;
    if (metric && row.metric !== metric || !w || w.start !== snapshot.period.start || w.end !== snapshot.period.end || w.timezone !== snapshot.period.timezone || w.previousStart > w.previousEnd || w.previousEnd >= w.start) return false;
    if (!Number.isFinite(row.current) || !Number.isFinite(row.previous) || row.current < 0 || row.previous < 0 || (row.metric === "sessions" ? row.source !== "GA4" : row.source !== "GSC")) return false;
    try { const url = new URL(row.url); return url.protocol === "https:" && !url.username && !url.password; } catch { return false; }
  });
  const observations = new Map<string, { row: GrowthDriver; topics: Set<string>; modules: Set<string> }>(), conflicts = new Set<string>();
  for (const row of rows) {
    // Topic/direction is an attribution, not an extra observation. Repeating
    // the same page in two directions must not double its module traffic.
    const key = JSON.stringify([row.url, row.country, row.language, row.metric, row.window, row.source]), prior = observations.get(key);
    if (prior) {
      if (prior.row.current !== row.current || prior.row.previous !== row.previous) conflicts.add(key);
      if (row.topicId) prior.topics.add(row.topicId);
      prior.modules.add(row.module);
    } else observations.set(key, { row, topics: new Set(row.topicId ? [row.topicId] : []), modules: new Set([row.module]) });
  }
  return [...observations.entries()].filter(([key]) => !conflicts.has(key)).map(([, { row, topics, modules }]) => ({ ...row, topicId: topics.size === 1 ? [...topics][0] : null, module: modules.size === 1 ? [...modules][0] : "模块待核" }));
}

export type GrowthTopicContribution = { metric: GrowthDriver["metric"]; source: GrowthDriver["source"]; country: string; language: string; previous: number; current: number; window: GrowthDriver["window"]; urls: string[] };
export function growthTopicContributions(snapshot: GrowthReportSnapshot | null, topic: Pick<GrowthTopic, "site" | "topicId">, scope: { country: string; language: string }): GrowthTopicContribution[] {
  const groups = new Map<string, GrowthTopicContribution>();
  for (const row of growthContributionDrivers(snapshot)) {
    if (row.topicId !== topic.topicId || new URL(row.url).hostname.replace(/^www\./, "") !== topic.site || scope.country !== "all" && row.country !== scope.country || scope.language !== "all" && row.language !== scope.language) continue;
    const key = JSON.stringify([row.metric, row.source, row.country, row.language, row.window]);
    const old = groups.get(key);
    groups.set(key, { metric: row.metric, source: row.source, country: row.country, language: row.language, previous: (old?.previous ?? 0) + row.previous, current: (old?.current ?? 0) + row.current, window: row.window, urls: [...(old?.urls ?? []), row.url] });
  }
  return [...groups.values()].sort((a, b) => a.metric.localeCompare(b.metric) || a.country.localeCompare(b.country) || a.language.localeCompare(b.language));
}
