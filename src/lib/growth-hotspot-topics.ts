import type { GrowthHotspotItem, GrowthHotspotView } from "./growth-hotspots";
import { seoTablePage, type SeoTablePagination } from "./seo-table-page";

export type SavedHotspotTopic = { id: string; text: string; sites: { siteDomain: string }[] };
export type HotspotTopic = {
  key: string;
  topicId: string | null;
  title: string;
  site: string;
  keywordCount: number;
  taskCount: number;
  latestEventAt: string;
};

type HotspotPageBase = Omit<GrowthHotspotView, "items"> & { pagination: SeoTablePagination };
export type HotspotTopicPage = HotspotPageBase & (
  | { kind: "topics"; topics: HotspotTopic[] }
  | { kind: "keywords"; topic: HotspotTopic | null; items: GrowthHotspotItem[] }
);

export function growthHotspotTopicPage(view: GrowthHotspotView, savedTopics: SavedHotspotTopic[], page: number, topicKey: string | null): HotspotTopicPage {
  const topicNames = new Map(savedTopics.flatMap(topic => topic.sites.map(({ siteDomain }) => [JSON.stringify([siteDomain, topic.id]), topic.text])));
  const groups = new Map<string, { title: string; site: string; topicId: string | null; items: GrowthHotspotItem[] }>();
  for (const item of view.items) {
    const topicName = item.topicId ? topicNames.get(JSON.stringify([item.site, item.topicId])) : undefined;
    const topicId = topicName ? item.topicId : null;
    // Existing projection keys begin with the verified event key before the site and original word.
    const eventKey = item.id.slice("hotspot:".length).split("|", 1)[0];
    const key = `${item.site}:${topicId ? `topic:${topicId}` : `event:${eventKey}`}`;
    const group = groups.get(key) ?? { title: topicName || item.title, site: item.site, topicId, items: [] };
    group.items.push(item);
    groups.set(key, group);
  }
  const topics = [...groups].map(([key, group]): HotspotTopic => ({
    key, topicId: group.topicId, title: group.title, site: group.site,
    keywordCount: group.items.length,
    taskCount: new Set(group.items.flatMap(item => item.taskIds)).size,
    latestEventAt: group.items[0].eventAt,
  })).sort((a, b) => Number(Boolean(b.topicId)) - Number(Boolean(a.topicId)) || b.latestEventAt.localeCompare(a.latestEventAt) || a.key.localeCompare(b.key));
  const base = { version: view.version, generatedAt: view.generatedAt, businessWeek: view.businessWeek };
  if (topicKey === null) {
    const { rows, ...pagination } = seoTablePage(topics, page);
    return { ...base, kind: "topics", topics: rows, pagination };
  }
  const topic = topics.find(row => row.key === topicKey) ?? null;
  const { rows, ...pagination } = seoTablePage(groups.get(topicKey)?.items ?? [], page);
  return { ...base, kind: "keywords", topic, items: rows, pagination };
}
