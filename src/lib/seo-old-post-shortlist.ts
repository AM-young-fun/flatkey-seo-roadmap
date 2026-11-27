import { analyticsSiteForProperty, type AnalyticsObservation } from "./seo-analytics";
import { growthWebsitePageUrl } from "./growth-live-page";
import type { GrowthTarget } from "./growth-types";
import { seoToday, shiftDay } from "./seo-date-range";
import { GROWTH_BLOG_SITES, GROWTH_MARKET_LANGUAGES, GROWTH_RESEARCH_COUNTRIES } from "./seo-growth-markets";
import { gscDate } from "./seo-page-effects";
import { pageOptimizationPriorityRows } from "./seo-page-priority";
import type { WorkflowSnapshot } from "./seo-workflow";

export const oldPostMarkets = GROWTH_BLOG_SITES.flatMap(site => GROWTH_RESEARCH_COUNTRIES
  .filter(country => site === "flatkey.ai" || country === "US").map(country => ({ site, country })));

const postLimit = 10;
const postTarget = 5;

function blogPage(value: string, site: string) {
  const normalized = growthWebsitePageUrl(value, site);
  if (!normalized) return null;
  const url = new URL(normalized);
  return !url.search && /^\/(?:(?:en|zh|es|fr|pt|ja|vi|de|id)\/)?blog\/[^/]+$/u.test(url.pathname) ? normalized : null;
}

export function oldPostShortlist({ observations, workflow, targets, inventory, now }: {
  observations: AnalyticsObservation[];
  workflow: Pick<WorkflowSnapshot, "tasks" | "publications">;
  targets: GrowthTarget[];
  inventory: { url: string; firstSeen: Date }[];
  now: Date;
}) {
  const date = seoToday(now), ageCutoff = shiftDay(gscDate(now), -7);
  const known = new Map<string, { date: string; source: "inventory" | "publication" | "gsc" }>();
  const excluded = new Set<string>();
  const remember = (page: string, day: string, source: "inventory" | "publication" | "gsc") => {
    if (day <= ageCutoff && day < (known.get(page)?.date ?? "9999-12-31")) known.set(page, { date: day, source });
  };
  for (const entry of inventory) {
    const page = blogPage(entry.url, "flatkey.ai");
    if (page) remember(page, gscDate(entry.firstSeen), "inventory");
  }
  for (const publication of workflow.publications) {
    if (!["published", "verified"].includes(publication.status) || !GROWTH_BLOG_SITES.some(site => site === publication.siteDomain)) continue;
    const page = blogPage(publication.pageUrl, publication.siteDomain), observedAt = Date.parse(publication.publishedAt);
    if (!page || !Number.isFinite(observedAt) || observedAt > now.getTime()) continue;
    const day = gscDate(new Date(observedAt));
    remember(page, day, "publication");
    if (day >= ageCutoff) excluded.add(page);
  }
  for (const task of workflow.tasks) {
    if (!task.pageUrl || task.deletedAt || task.channel === "github" || task.channel === "product"
      || !["optimization", "technical", "blog"].includes(task.kind) || ["verified", "observing"].includes(task.status)
      || !GROWTH_BLOG_SITES.some(site => site === task.siteDomain)) continue;
    const page = blogPage(task.pageUrl, task.siteDomain);
    if (page) excluded.add(page);
  }
  for (const observation of observations) {
    if (observation.kind !== "gsc-pages" || !observation.complete || observation.date > ageCutoff
      || Date.parse(observation.observedAt) > now.getTime()) continue;
    const site = analyticsSiteForProperty(observation.property);
    if (!site || !GROWTH_BLOG_SITES.some(candidate => candidate === site)) continue;
    for (const row of observation.rows) {
      const page = row.impressions > 0 && blogPage(row.url, site);
      if (page) remember(page, observation.date, "gsc");
    }
  }
  const targetById = new Map(targets.map(row => [row.id, row]));
  const results = oldPostMarkets.map(({ site, country }) => {
    const inventoryTargets = targets.flatMap(target => {
      if (target.site !== site || target.country !== country || target.language !== GROWTH_MARKET_LANGUAGES[country]
        || target.languageStatus !== "match" || target.sourceActive !== true || !target.keywordId) return [];
      const maintenancePublishedUrls = (target.maintenancePublishedUrls ?? []).filter(url => {
        const page = blogPage(url, site);
        return page && known.has(page) && !excluded.has(page);
      });
      return maintenancePublishedUrls.length ? [{ ...target, maintenancePublishedUrls }] : [];
    });
    const { latestDay, sourceLatestDay, historical, property, pairedDays, recommendations } = pageOptimizationPriorityRows(observations, workflow, inventoryTargets, site, country, now, { rank: "all", signal: "all" }, true);
    const candidates = recommendations.flatMap(row => {
      if (row.rankStatus !== "outside100" && row.priority !== "高" && row.priority !== "中") return [];
      const url = blogPage(row.url, site)!;
      const { language, keywordId } = targetById.get(row.targetId)!;
      return [{ ...row, url, site, country, language, keywordId, firstEvidence: known.get(url)!, gscThrough: latestDay, historical, gscProperty: property }];
    });
    return { candidates, coverage: { site, country, latestGscDay: sourceLatestDay, comparisonThrough: latestDay, historical, pairedDays } };
  });
  const priorityOrder = { 高: 0, 中: 1, 低: 2, 观察中: 3, 待核实: 4 };
  const ranked = results.flatMap(result => result.candidates).sort((a, b) =>
    Number(b.rankStatus === "outside100") - Number(a.rankStatus === "outside100")
    || priorityOrder[a.priority] - priorityOrder[b.priority] || b.score - a.score
    || (b.current?.impressions ?? 0) - (a.current?.impressions ?? 0)
    || a.url.localeCompare(b.url) || a.targetId.localeCompare(b.targetId));
  const unique = new Map<string, typeof ranked[number]>();
  for (const row of ranked) if (!unique.has(row.url)) unique.set(row.url, row);
  const rows = [...unique.values()].slice(0, postLimit);
  return { date, generatedAt: now.toISOString(), rows, shortfall: Math.max(0, postTarget - rows.length),
    eligiblePages: unique.size, coverage: results.map(result => result.coverage) };
}
