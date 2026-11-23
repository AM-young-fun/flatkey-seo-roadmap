import { Prisma } from "@prisma/client";
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
  try {
    return await timedRead("monthly-archive", () => prisma.$queryRaw<{ payload: unknown }[]>(Prisma.sql`
      SELECT day.payload || jsonb_build_object('rows', COALESCE((
        SELECT jsonb_agg(item ORDER BY ordinal)
        FROM jsonb_array_elements(day.payload->'rows') WITH ORDINALITY AS entry(item, ordinal)
        WHERE (day.payload->>'kind' = 'gsc-pages' AND item->>'url' IN (${Prisma.join(urls)}))
          OR (day.payload->>'kind' = 'ga4-pages' AND (item->>'hostname') || (item->>'path') IN (${Prisma.join(paths)}))
      ), '[]'::jsonb)) AS payload
      FROM "SeoAnalyticsDay" day
      WHERE day.date >= ${start} AND day.date <= ${end} AND day.kind IN (${Prisma.join(kinds)})
        AND jsonb_typeof(day.payload->'rows') = 'array'
    `));
  } catch {
    // Keep the complete month view available if a deployment cannot use the
    // projection. The timing explicitly distinguishes this slower fallback.
    return timedRead("monthly-fallback", () => prisma.seoAnalyticsDay.findMany({
      where: { date: { gte: start, lte: end }, kind: { in: kinds } }, select: { payload: true },
    }));
  }
}
