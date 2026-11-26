import type { GrowthTopic } from "./growth-types";
import { growthWebsitePageUrl } from "./growth-live-page";
import { GROWTH_EXECUTION_SITES } from "./seo-growth-markets";

export const keywordCategories = {
  quarter: "季度关键词", satellite: "ModelFit／RackRate 季度词", hotspot: "近期热点词", published: "已有内容与排名",
} as const;
export type KeywordCategory = keyof typeof keywordCategories;
export type KeywordTopic = { topicId: string; site: string; name: string };
export type NumericSort = "asc" | "desc";
export type KeywordTopicIdentity = { topicId?: string | null; site?: string | null; topicName?: string | null };

export function numericKeywordOrder(a: number | null | undefined, b: number | null | undefined, order: NumericSort | null) {
  if (!order) return 0;
  if (a == null) return b == null ? 0 : 1;
  if (b == null) return -1;
  return order === "asc" ? a - b : b - a;
}

export function keywordTextMatches(query: string, ...values: string[]) {
  const normalize = (text: string) => text.normalize("NFKC").toLowerCase().replace(/[-_]+/gu, " ").trim();
  const terms = normalize(query).split(/\s+/u).filter(Boolean);
  const text = normalize(values.join(" "));
  return terms.every(term => text.includes(term));
}

export const keywordTopicKey = (site: string, topicId: string) => site + ":" + topicId;

export function keywordTopicIndex(topics: readonly GrowthTopic[]) {
  return new Map(topics.map(({ site, topicId, name }) => [keywordTopicKey(site, topicId), { site, topicId, name }]));
}

export function keywordTopic(identity: KeywordTopicIdentity, topics: ReadonlyMap<string, KeywordTopic>): KeywordTopic | undefined {
  const { site, topicId, topicName } = identity;
  if (!site || !topicId) return;
  return topics.get(keywordTopicKey(site, topicId)) ?? (topicName ? { site, topicId, name: topicName } : undefined);
}

export function addKeywordTopic(targets: KeywordTopic[], topic: KeywordTopic | undefined) {
  if (topic && !targets.some(row => row.site === topic.site && row.topicId === topic.topicId)) targets.push(topic);
}

function normalizedPage(value: string) {
  try {
    const url = new URL(value);
    const site = url.hostname.replace(/^www\./u, "");
    const canonical = growthWebsitePageUrl(value, site);
    if (!canonical) return null;
    const page = new URL(canonical);
    for (const key of [...page.searchParams.keys()]) {
      if (/^(?:utm_.+|gclid|fbclid|msclkid)$/iu.test(key)) page.searchParams.delete(key);
    }
    page.searchParams.sort();
    return { site, path: decodeURI(page.pathname), query: page.search };
  } catch {
    return null;
  }
}

export function createKeywordLookup(input: string) {
  const query = input.trim();
  const host = query.split(/[/?#]/u, 1)[0].toLowerCase().replace(/^www\./u, "");
  const siteOnly = GROWTH_EXECUTION_SITES.some(site => site === host);
  const absolute = siteOnly || /^(?:(?:[a-z][a-z\d+.-]*:)?\/\/|https?:|[^\s/?#]+\.[a-z]{2,}[/?#])/iu.test(query);
  const relative = !absolute && !/\s/u.test(query) && (query.startsWith("/") || query.includes("/"));
  const fullUrl = absolute ? (/^https?:/iu.test(query) ? query.replace(/^http:/iu, "https:") : query.startsWith("//") ? "https:" + query : "https://" + query) : null;
  const full = fullUrl ? normalizedPage(fullUrl) : null;
  const relativePath = relative ? (query.startsWith("/") ? query : "/" + query) : null;
  const matchPage = (url: string) => {
    const page = normalizedPage(url);
    if (!page) return false;
    if (absolute) return full !== null && full.site === page.site && full.path === page.path
      && (!full.query || full.query === page.query);
    if (!relativePath) return Boolean(query) && keywordTextMatches(query, page.path);
    const route = normalizedPage("https://" + page.site + relativePath);
    if (!route || route.query && route.query !== page.query) return false;
    return route.path === "/" ? page.path === "/" : page.path.toLowerCase().includes(route.path.toLowerCase());
  };
  const matchText = (keyword: string, ...topics: string[]) => !absolute && keywordTextMatches(query, keyword, ...topics);
  return { matchPage, matchText };
}
