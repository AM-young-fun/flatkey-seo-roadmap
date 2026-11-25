import { analyticsSiteForProperty, rangeDays, type AnalyticsObservation } from "./seo-analytics";
import type { DateRange } from "./seo-date-range";

const flatkeyBrand = /(?:^|[^a-z0-9])flat[\s._-]*key(?=$|[^a-z0-9])/iu;

export function flatkeyBrandTraffic(range: DateRange, observations: AnalyticsObservation[]) {
  const days = new Map(observations.flatMap(row => row.kind === "gsc-page-queries" && row.complete
    && analyticsSiteForProperty(row.property) === "flatkey.ai" && (row.country ?? "all") === "all" ? [[row.date, row] as const] : []));
  return { ...range, daily: rangeDays(range).map(date => {
    const source = days.get(date);
    if (!source) return { date, branded: null, nonBranded: null };
    let branded = 0, nonBranded = 0;
    for (const row of source.rows) {
      if (!["flatkey.ai", "www.flatkey.ai"].includes(new URL(row.url).hostname)) continue;
      if (flatkeyBrand.test(row.query.normalize("NFKC"))) branded += row.clicks;
      else nonBranded += row.clicks;
    }
    return { date, branded, nonBranded };
  }) };
}
export type FlatkeyBrandTraffic = ReturnType<typeof flatkeyBrandTraffic>;
