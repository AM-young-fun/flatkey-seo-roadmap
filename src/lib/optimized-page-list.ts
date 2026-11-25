import { dateInListRange, type DateRange } from "./seo-date-range";
import type { OptimizedEffectPage, OptimizedEffectVersion } from "./seo-page-effects";
import { seoTablePage, type SeoTablePagination } from "./seo-table-page";

export type OptimizedPageRow = { page: Omit<OptimizedEffectPage, "versions">; version: OptimizedEffectVersion };
export type OptimizedPagesResponse = (
  | ({ view: "list"; rows: OptimizedPageRow[] } & SeoTablePagination)
  | { view: "detail"; item: OptimizedPageRow | null }
) & { partial: boolean };

const item = ({ site, title, url }: OptimizedEffectPage, version: OptimizedEffectVersion): OptimizedPageRow => ({
  page: { site, title, url }, version,
});

export const optimizedPageKey = (url: string) => {
  const canonical = new URL(url);
  canonical.pathname = canonical.pathname.replace(/\/+$/, "") || "/";
  return canonical.href;
};

export function optimizedPageDetail(pages: Map<string, OptimizedEffectPage>, publication: string | null, url: string | null) {
  if (!publication) {
    const page = url ? pages.get(optimizedPageKey(url)) : undefined;
    return page?.versions[0] ? item(page, page.versions[0]) : null;
  }
  for (const page of pages.values()) {
    const version = page.versions.find(row => row.id === publication);
    if (version) return item(page, version);
  }
  return null;
}

export function optimizedPageList(pages: Iterable<OptimizedEffectPage>, options: { page: number; site: string; search: string; range: DateRange | null }) {
  const search = options.search.trim().toLowerCase(), matches: OptimizedPageRow[] = [];
  for (const page of pages) {
    if ((options.site !== "all" && page.site !== options.site)
      || ![page.title, page.url].some(value => value.toLowerCase().includes(search))) continue;
    const version = page.versions.find(row => dateInListRange(row.date, options.range));
    if (version) matches.push(item(page, version));
  }
  matches.sort((a, b) => (Date.parse(b.version.date ?? "") || 0) - (Date.parse(a.version.date ?? "") || 0)
    || a.page.url.localeCompare(b.page.url));
  return seoTablePage(matches, options.page);
}
