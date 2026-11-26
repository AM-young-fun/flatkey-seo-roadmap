import type { ApprovedCaptureRankedWord } from "./approved-weekly-keyword-capture";
import { linkedPublishedKeywordUrls } from "./growth-keyword-inventory";
import type { QuarterCalendarDisplay } from "./growth-quarter-display";
import type { GrowthHotspotItem } from "./growth-hotspots";
import type { GrowthWorkspace } from "./growth-types";
import { growthTargetId, growthWordKey } from "./growth-workspace";
import type { GrowthTarget } from "./growth-types";
import { seoTablePage } from "./seo-table-page";

export const catalogGroups = { quarter: "季度关键词", satellite: "ModelFit／RackRate 季度词", hotspot: "近期热点词", published: "已有内容与排名" } as const;
type Category = keyof typeof catalogGroups;
type CatalogWord = { keyword: string; categories: Category[]; countries: string[]; urls: string[] };

export function growthKeywordCatalog(quarter: QuarterCalendarDisplay | null, hotspots: GrowthHotspotItem[], workspace: GrowthWorkspace,
  ranked: ApprovedCaptureRankedWord[], query: string, page: number) {
  const words = new Map<string, CatalogWord>();
  const add = (keyword: string, category: Category, country: string | null, urls: readonly string[] = []) => {
    const key = growthWordKey(keyword);
    const entry = words.get(key) ?? { keyword, categories: [], countries: [], urls: [] };
    if (!entry.categories.includes(category)) entry.categories.push(category);
    if (country && !entry.countries.includes(country)) entry.countries.push(country);
    for (const url of urls) if (!entry.urls.includes(url)) entry.urls.push(url);
    words.set(key, entry);
  };
  for (const row of quarter?.rows ?? []) add(row.keyword, "quarter", row.country);
  for (const row of hotspots) add(row.keyword, "hotspot", row.country);
  const satellite = new Set(workspace.satelliteQuarter?.targetIds);
  for (const row of workspace.targets) {
    const urls = linkedPublishedKeywordUrls(row, workspace.generatedAt);
    if (satellite.has(row.id)) add(row.keyword, "satellite", row.country, urls);
    if (urls.length) add(row.keyword, "published", row.country, urls);
  }
  for (const row of ranked) add(row.keyword, "published", row.country, row.pages.map(page => page.url));
  const result = seoTablePage([...words.values()].filter(row => growthWordKey(row.keyword).includes(growthWordKey(query)))
    .sort((a, b) => a.keyword.localeCompare(b.keyword, "zh-CN")), page);
  const { rows, ...pagination } = result;
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
