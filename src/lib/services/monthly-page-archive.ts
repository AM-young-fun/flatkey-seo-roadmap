import { prisma } from "../prisma";
import { CLUSTER_SITES } from "../seo-cluster-sites";
import { analyticsStorageKind } from "../seo-analytics";
import { timedRead } from "../read-profile";

export function monthlyArchiveScope(targets: readonly { pageUrl: string; siteDomain: string }[]) {
  const sites = new Set(targets.map(page => page.siteDomain));
  const domains = ["flatkey.ai", ...CLUSTER_SITES.map(site => site.domain)].filter(site => sites.has(site));
  const kinds = domains.flatMap(site => ["ga4-pages", "gsc-pages"].map(kind =>
    analyticsStorageKind(kind as "ga4-pages" | "gsc-pages", "all", site === "flatkey.ai" ? undefined : CLUSTER_SITES.find(entry => entry.domain === site)!.domain)));
  return { kinds, urls: [...new Set(targets.map(page => page.pageUrl))],
    paths: [...new Set(targets.map(page => { const url = new URL(page.pageUrl); return url.hostname + url.pathname + url.search; }))] };
}

// Imported archives have already passed the observation schema. Preserve their
// metadata and every matching row; validate the projected observations again.
export async function loadMonthlyPageArchive(targets: readonly { pageUrl: string; siteDomain: string }[], start: string, end: string) {
  if (!targets.length) return [];
  const { kinds, urls, paths } = monthlyArchiveScope(targets);
  const archive = await timedRead("monthly-archive", () => prisma.seoAnalyticsDay.findMany({
    where: { date: { gte: start, lte: end }, kind: { in: kinds } }, select: { payload: true },
  }));
  const urlSet = new Set(urls), pathSet = new Set(paths);
  return archive.map(({ payload }) => {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return { payload };
    const value = payload as Record<string, unknown>;
    if (!Array.isArray(value.rows)) return { payload };
    return { payload: { ...value, rows: value.rows.filter(item => {
      if (!item || typeof item !== "object") return false;
      return value.kind === "gsc-pages" ? urlSet.has(item.url) : value.kind === "ga4-pages" && pathSet.has(item.hostname + item.path);
    }) } };
  });
}
