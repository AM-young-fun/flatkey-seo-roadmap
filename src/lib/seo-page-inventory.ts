import { matchesDailySeoPageGroupUrl } from "./daily-seo-page-groups";

export const PAGE_CATEGORIES = [
  ["all", "全部页面"], ["home", "首页"], ["models", "模型页面"],
  ["prompts", "提示词页面"], ["gpu", "GPU 页面"], ["blog", "博客页面"], ["other", "其他功能页面"],
] as const;

export function normalizePageUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (!["flatkey.ai", "www.flatkey.ai"].includes(url.hostname) || url.protocol !== "https:" || url.username || url.password || url.port) return null;
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (key.startsWith("utm_") || ["gclid", "fbclid", "msclkid"].includes(key)) url.searchParams.delete(key);
    }
    return url.toString();
  } catch { return null; }
}

export function classifyPage(value: string): string {
  const normalized = normalizePageUrl(value);
  if (!normalized) return "other";
  const path = new URL(normalized).pathname;
  if (/^\/(?:(?:en|zh|es|fr|pt|ru|ja|vi|de|id)\/?)?$/.test(path)) return "home";
  if (/^\/(?:en\/|zh\/|es\/|fr\/|pt\/|ru\/|ja\/|vi\/|de\/|id\/)?blog(?:\/|$)/.test(path)) return "blog";
  if (matchesDailySeoPageGroupUrl("prompts", normalized)) return "prompts";
  if (matchesDailySeoPageGroupUrl("gpu_compute", normalized)) return "gpu";
  if (matchesDailySeoPageGroupUrl("model_list", normalized) || matchesDailySeoPageGroupUrl("model_detail", normalized)) return "models";
  return "other";
}

export type SitemapPage = { url: string; category: string; sourceUrl: string; sitemapLastmod: string | null };
export type InventoryPage = SitemapPage & { firstSeen: string; lastSeen: string; baseline: boolean };
const decodeXml = (value: string) => value.trim().replace(/^<!\[CDATA\[([\s\S]*)\]\]>$/, "$1")
  .replace(/&(amp|lt|gt|quot|apos);/g, (_, name) => ({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" })[name as "amp"])
  .replace(/&#(x[0-9a-f]+|\d+);/gi, (_, code) => String.fromCodePoint(code[0].toLowerCase() === "x" ? parseInt(code.slice(1), 16) : Number(code)));

export function parseSitemap(xml: string, sourceUrl: string): { children: string[]; pages: SitemapPage[] } {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw Error("不接受含外部实体的 sitemap");
  if (/<sitemapindex\b/.test(xml) && /<\/sitemapindex>/.test(xml)) {
    const children = [...xml.matchAll(/<sitemap\b[^>]*>([\s\S]*?)<\/sitemap>/g)].map(match => decodeXml(match[1].match(/<loc>([\s\S]*?)<\/loc>/)?.[1] ?? ""));
    if (!children.length || children.length > 30 || children.some(url => !/^https:\/\/flatkey\.ai\/sitemaps\/sitemap\/[a-z-]+\.xml$/.test(url))) throw Error("sitemap索引范围无效");
    return { children: [...new Set(children)], pages: [] };
  }
  if (!/<urlset\b/.test(xml) || !/<\/urlset>/.test(xml)) throw Error("sitemap内容不完整");
  const pages = [...xml.matchAll(/<url\b[^>]*>([\s\S]*?)<\/url>/g)].map(match => {
    const url = normalizePageUrl(decodeXml(match[1].match(/<loc>([\s\S]*?)<\/loc>/)?.[1] ?? ""));
    if (!url) throw Error("sitemap包含站外或无效地址");
    const lastmod = match[1].match(/<lastmod>([\s\S]*?)<\/lastmod>/)?.[1];
    return { url, category: classifyPage(url), sourceUrl, sitemapLastmod: lastmod ? decodeXml(lastmod) : null };
  });
  if (!pages.length || pages.length > 50000) throw Error("sitemap为空或超出页面上限");
  return { children: [], pages };
}

export function mergeInventory(existing: InventoryPage[], current: SitemapPage[], collectedAt: string): InventoryPage[] {
  const rows = new Map(existing.map(row => [row.url, row]));
  const baseline = existing.length === 0;
  for (const page of current) {
    const old = rows.get(page.url);
    rows.set(page.url, { ...page, firstSeen: old?.firstSeen ?? collectedAt, lastSeen: collectedAt, baseline: old?.baseline ?? baseline });
  }
  // Missing URLs remain in the inventory; absence from a sitemap is not proof of deletion.
  return [...rows.values()].sort((a, b) => b.firstSeen.localeCompare(a.firstSeen) || a.url.localeCompare(b.url));
}
