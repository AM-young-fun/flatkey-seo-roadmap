import type { ApprovedCaptureRankedWord } from "./approved-weekly-keyword-capture";
import { linkedPublishedKeywordUrls } from "./growth-keyword-inventory";
import type { QuarterCalendarDisplay } from "./growth-quarter-display";
import type { GrowthHotspotItem } from "./growth-hotspots";
import type { GrowthWorkspace } from "./growth-types";
import { growthTargetId, growthWordKey } from "./growth-workspace";
import type { GrowthTarget } from "./growth-types";
import { seoTablePage } from "./seo-table-page";
import { addKeywordTopic, createKeywordLookup, keywordTopic, keywordTopicIndex, keywordTopicKey,
  type KeywordCategory, type KeywordTopic, type KeywordTopicIdentity } from "./growth-keyword-lookup";

type CatalogWord = { keyword: string; categories: KeywordCategory[]; countries: string[]; urls: string[]; topics: KeywordTopic[] };
type CatalogEntry = CatalogWord & { topicPages: Map<string, Set<string>> };

export function buildGrowthKeywordCatalog(quarter: QuarterCalendarDisplay | null, hotspots: GrowthHotspotItem[], workspace: GrowthWorkspace,
  ranked: ApprovedCaptureRankedWord[]) {
  const words = new Map<string, CatalogEntry>();
  const topics = keywordTopicIndex(workspace.topics);
  const targetsByRankIdentity = new Map<string, GrowthTarget[]>();
  const add = (keyword: string, category: KeywordCategory, country: string | null, urls: readonly string[] = [], identity?: KeywordTopicIdentity) => {
    const key = growthWordKey(keyword);
    const entry: CatalogEntry = words.get(key) ?? { keyword, categories: [], countries: [], urls: [], topics: [], topicPages: new Map() };
    if (!entry.categories.includes(category)) entry.categories.push(category);
    if (country && !entry.countries.includes(country)) entry.countries.push(country);
    for (const url of urls) if (!entry.urls.includes(url)) entry.urls.push(url);
    const topic = identity && keywordTopic(identity, topics);
    addKeywordTopic(entry.topics, topic);
    if (topic && urls.length) {
      const topicKey = keywordTopicKey(topic.site, topic.topicId);
      const pages = entry.topicPages.get(topicKey) ?? new Set();
      for (const url of urls) pages.add(url);
      entry.topicPages.set(topicKey, pages);
    }
    words.set(key, entry);
  };
  for (const row of quarter?.rows ?? []) add(row.keyword, "quarter", row.country, [], row);
  for (const row of quarter?.satellite?.rows ?? []) add(row.keyword, "satellite", row.country, [], row);
  for (const row of quarter?.scheduled ?? []) add(row.keyword, row.site === "flatkey.ai" ? "quarter" : "satellite", row.country, [], row);
  for (const row of hotspots) add(row.keyword, "hotspot", row.country, [], row);
  const satellite = new Set(workspace.satelliteQuarter?.targetIds);
  for (const row of workspace.targets) {
    const urls = linkedPublishedKeywordUrls(row, workspace.generatedAt);
    if (satellite.has(row.id)) add(row.keyword, "satellite", row.country, urls, row);
    if (urls.length) add(row.keyword, "published", row.country, urls, row);
    const key = growthTargetId(row.site, row.keyword, row.country, row.language);
    const bucket = targetsByRankIdentity.get(key) ?? [];
    bucket.push(row);
    targetsByRankIdentity.set(key, bucket);
  }
  for (const row of ranked) {
    const urls = row.pages.map(page => page.url);
    const key = growthTargetId("flatkey.ai", row.keyword, row.country, row.language);
    const originals = targetsByRankIdentity.get(key);
    if (originals?.length) for (const target of originals) add(row.keyword, "published", row.country, urls, target);
    else add(row.keyword, "published", row.country, urls);
  }
  return words;
}

export function growthKeywordCatalog(quarter: QuarterCalendarDisplay | null, hotspots: GrowthHotspotItem[], workspace: GrowthWorkspace,
  ranked: ApprovedCaptureRankedWord[], query: string, page: number) {
  const words = buildGrowthKeywordCatalog(quarter, hotspots, workspace, ranked);
  const lookup = createKeywordLookup(query);
  const visible: CatalogWord[] = [];
  for (const { topicPages, ...word } of words.values()) {
    if (lookup.matchText(word.keyword, ...word.topics.map(topic => topic.name))) visible.push(word);
    else {
      const urls = word.urls.filter(lookup.matchPage);
      if (urls.length) visible.push({ ...word, urls, topics: word.topics.filter(topic =>
        urls.some(url => topicPages.get(keywordTopicKey(topic.site, topic.topicId))?.has(url))) });
    }
  }
  const { rows, ...pagination } = seoTablePage(visible.sort((a, b) => a.keyword.localeCompare(b.keyword, "zh-CN")), page);
  return { rows, pagination };
}

export type GrowthKeywordCatalogPage = ReturnType<typeof growthKeywordCatalog>;

const emptyTarget = {
  keywordId: null, topicId: null, topicName: null, membership: "review", pageState: "unmapped", publishedUrls: [],
  plannedUrls: [], rank: null, rankUrl: null, rankSource: null, checkedAt: null, languageStatus: "unknown",
  languageReason: "", captureState: "unqueried", rankEligible: false, observationEligible: false, monitoringEligible: false,
  taskIds: [], reason: "",
} satisfies Omit<GrowthTarget, "id" | "keyword" | "site" | "country" | "language" | "workState">;

export function catalogWorkspace(workspace: GrowthWorkspace, hotspots: GrowthHotspotItem[], capture: ApprovedCaptureRankedWord[]): GrowthWorkspace {
  const quarter = new Set([...(workspace.quarter?.targetIds ?? []), ...(workspace.satelliteQuarter?.targetIds ?? [])]);
  const targets = new Map(workspace.targets.map(target => [target.id, target]));
  const included = new Map<string, GrowthTarget>();
  for (const target of workspace.targets) {
    const urls = linkedPublishedKeywordUrls(target, workspace.generatedAt);
    if (quarter.has(target.id) || urls.length) included.set(target.id, urls.length
      ? { ...target, publishedUrls: urls, pageState: "published", workState: "completed" } : target);
  }
  for (const row of hotspots) {
    const id = growthTargetId(row.site, row.keyword, row.country, row.language);
    if (included.has(id)) continue;
    const target = targets.get(id);
    const workState = row.stage === "in_progress" ? "in_progress" : row.stage === "scheduled" ? "scheduled" : "researching";
    included.set(id, target ? { ...target, workState } : {
      ...emptyTarget, id, keyword: row.keyword, site: row.site, country: row.country, language: row.language, topicId: row.topicId,
      publishedUrls: [], plannedUrls: [], workState, taskIds: row.taskIds,
    });
  }
  for (const row of capture) {
    const site = "flatkey.ai", id = growthTargetId(site, row.keyword, row.country, row.language);
    const target = included.get(id) ?? targets.get(id) ?? {
      ...emptyTarget, id, site, keyword: row.keyword, country: row.country, language: row.language, publishedUrls: [], plannedUrls: [], taskIds: [],
      workState: "completed",
    };
    const best = row.pages[0];
    if (!best) continue;
    const newer = target.rankSource === "serp" && target.checkedAt && Date.parse(target.checkedAt) >= Date.parse(row.checkedAt)
      && (target.rankEligible || target.captureState === "outside100" && target.observationEligible);
    const recent = Date.parse(workspace.generatedAt) - Date.parse(row.checkedAt);
    const evidence: Partial<GrowthTarget> = !newer && row.language && recent >= 0 && recent <= 14 * 86400000 ? {
      rank: best.rank, rankUrl: best.url, checkedAt: row.checkedAt, rankSource: "serp", captureState: "ranked",
      rankEligible: true, languageStatus: "match", wordLanguage: row.language,
    } : {};
    included.set(id, { ...target, ...evidence, workState: "completed", pageState: "published",
      publishedUrls: [...new Set([...target.publishedUrls, ...row.pages.map(page => page.url)])] });
  }
  return { ...workspace, targets: [...included.values()], opportunities: [] };
}
