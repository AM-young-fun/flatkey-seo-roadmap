import { classifyPage } from "./seo-page-inventory";
import { keywordMatchesCountry } from "./keyword-market";
import { keywordGraphKeywords } from "./keyword-graph-data";
import type { DashboardKeyword } from "./types";
import type { SeoCountry } from "./seo";

export const OVERVIEW_PAGE_MODULES = [
  ["all", "全部页面模块"], ["other", "首页及其他功能页"], ["prompts", "Prompt"],
  ["blog", "博客"], ["models", "模型"], ["gpu", "GPU"],
] as const;
export type OverviewPageModule = typeof OVERVIEW_PAGE_MODULES[number][0];
type KnownModule = Exclude<OverviewPageModule, "all">;
const sites = ["flatkey.ai", "rackrate.org", "modelfit.cc", "mochichatbot.com", "jev-llm.com"];
const staging = new Set(["staging-website.flatkey.ai", "staging-console.flatkey.ai", "staging-router.flatkey.ai"]);

export function overviewPageModule(value: string): KnownModule | null {
  let url: URL;
  try { url = new URL(value); } catch { return null; }
  if (url.protocol !== "https:" || url.username || url.password || url.port || staging.has(url.hostname)) return null;
  const host = url.hostname.replace(/^www\./, ""), path = url.pathname;
  if (!sites.includes(host)) return host.endsWith(".flatkey.ai") ? "other" : null;
  if (/^\/(?:en\/|zh\/|es\/|fr\/|pt\/|ru\/|ja\/|vi\/|de\/|id\/)?blog(?:\/|$)/.test(path)) return "blog";
  if (host === "flatkey.ai") {
    const category = classifyPage(value);
    return category === "home" || category === "other" ? "other" : category as KnownModule;
  }
  if (host === "modelfit.cc") {
    if (/^\/models(?:\/[^/]+)?\/?$/.test(path)) return "models";
    if (/^\/(?:hardware(?:\/[^/]+)?|calculator|calculators(?:\/(?:kv-cache|multi-gpu|model-memory))?)\/?$/.test(path)) return "gpu";
  }
  if (host === "rackrate.org" && /^\/(?:gpus(?:\/[^/]+)?|compare(?:\/(?:gpus|providers))?|providers(?:\/[^/]+)?|regions(?:\/[^/]+)?|tools\/(?:gpu-cost-calculator|llm-deployment-planner))\/?$/.test(path)) return "gpu";
  if (host === "jev-llm.com" && /^\/models\/open-source\/?$/.test(path)) return "models";
  return "other";
}

export function overviewModule(value: string | null): OverviewPageModule {
  if (value === "unknown") return "other";
  return OVERVIEW_PAGE_MODULES.find(([id]) => id === value)?.[0] ?? "all";
}

export function overviewTargetModules(urls: readonly string[] = []): Set<KnownModule> {
  const modules = new Set<KnownModule>();
  for (const url of urls) {
    const module = overviewPageModule(url);
    if (module) modules.add(module);
  }
  if (!modules.size) modules.add("other");
  return modules;
}

/** Filter site-specific members before text deduplication to preserve their rank and volume. */
export function overviewKeywordScope(input: DashboardKeyword[], country: SeoCountry, module: OverviewPageModule, crossLanguage = false) {
  const scoped = input.filter(keyword => keywordMatchesCountry(keyword, country, crossLanguage)
    && (module === "all" || overviewTargetModules(keyword.targetUrls).has(module)));
  return { keywords: keywordGraphKeywords(scoped, country, crossLanguage) };
}
