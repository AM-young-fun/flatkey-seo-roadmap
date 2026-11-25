import type { ApprovedCaptureRankedWord } from "./approved-weekly-keyword-capture";
import { linkedPublishedKeywordUrls } from "./growth-keyword-inventory";
import type { QuarterCalendarDisplay } from "./growth-quarter-display";
import type { GrowthHotspotItem } from "./growth-hotspots";
import type { GrowthWorkspace } from "./growth-types";
import { seoTablePage } from "./seo-table-page";

export const catalogGroups = { quarter: "季度关键词", hotspot: "近期热点词", published: "已有内容与排名" } as const;
type Category = keyof typeof catalogGroups;
type CatalogWord = { keyword: string; categories: Category[]; countries: string[]; urls: string[] };

export function growthKeywordCatalog(quarter: QuarterCalendarDisplay | null, hotspots: GrowthHotspotItem[], workspace: GrowthWorkspace,
  ranked: ApprovedCaptureRankedWord[], query: string, page: number) {
  const words = new Map<string, CatalogWord>();
  const keyOf = (word: string) => word.normalize("NFKC").trim().replace(/\s+/gu, " ").toLowerCase();
  const add = (keyword: string, category: Category, country: string | null, urls: readonly string[] = []) => {
    const key = keyOf(keyword);
    const entry = words.get(key) ?? { keyword, categories: [], countries: [], urls: [] };
    if (!entry.categories.includes(category)) entry.categories.push(category);
    if (country && !entry.countries.includes(country)) entry.countries.push(country);
    for (const url of urls) if (!entry.urls.includes(url)) entry.urls.push(url);
    words.set(key, entry);
  };
  for (const row of quarter?.rows ?? []) add(row.keyword, "quarter", row.country);
  for (const row of hotspots) add(row.keyword, "hotspot", row.country);
  for (const row of workspace.targets) {
    const urls = linkedPublishedKeywordUrls(row, workspace.generatedAt);
    if (urls.length) add(row.keyword, "published", row.country, urls);
  }
  for (const row of ranked) add(row.keyword, "published", row.country, row.pages.map(page => page.url));
  const result = seoTablePage([...words.values()].filter(row => keyOf(row.keyword).includes(keyOf(query)))
    .sort((a, b) => a.keyword.localeCompare(b.keyword, "zh-CN")), page);
  const { rows, ...pagination } = result;
  return { rows, pagination };
}

export type GrowthKeywordCatalogPage = ReturnType<typeof growthKeywordCatalog>;
