import type { InventoryPage } from "./seo-page-inventory";

export type CatalogRow = { url: string; keywords: string[]; inventory?: InventoryPage; sourceUrls?: string[] };

// Fragments and acquisition parameters identify a visit/section, not a new page.
// Preserve host, language path, slash and business query parameters as evidence.
export function catalogUrl(value: string, site: string) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.port || !(url.hostname === site || url.hostname.endsWith("." + site))) return null;
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) if (/^utm_/i.test(key) || /^(gclid|dclid|fbclid|msclkid|gbraid|wbraid)$/i.test(key)) url.searchParams.delete(key);
    url.searchParams.sort();
    return url.toString();
  } catch { return null; }
}

export function mergeCatalogRows(targets: CatalogRow[], inventory: InventoryPage[], pages: { url: string; sourceUrls?: string[] }[], site: string): CatalogRow[] {
  const merged = new Map<string, CatalogRow>();
  const add = (raw: string, keywords: string[] = [], entry?: InventoryPage, sources: string[] = []) => {
    const url = catalogUrl(raw, site);
    if (!url) return;
    const row = merged.get(url) ?? { url, keywords: [], sourceUrls: [] };
    row.keywords = [...new Set([...row.keywords, ...keywords])];
    row.sourceUrls = [...new Set([...(row.sourceUrls ?? []), raw, ...sources.filter(source => catalogUrl(source, site) === url)])].sort();
    if (entry && (!row.inventory || raw === url)) row.inventory = entry;
    merged.set(url, row);
  };
  for (const row of targets) add(row.url, row.keywords, row.inventory, row.sourceUrls);
  for (const row of inventory) add(row.url, [], row);
  for (const row of pages) add(row.url, [], undefined, row.sourceUrls);
  return [...merged.values()];
}
