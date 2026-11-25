import { marketTrendCount, type TrendPoint } from "@/lib/ranking-trends";

/** Keep the saved period on the timeline even if its chart value is unknown. */
export function rankingTrendDisplayPeriods(points: TrendPoint[]) {
  const byPeriod = new Map(points.map(point => [point.periodKey ?? point.date, point]));
  return [...byPeriod].map(([key, point]) => {
    const captured = point.captured ?? point.checked ?? point.ranked + point.outside;
    const coverageComplete = point.total > 0 && captured === point.total && point.pending === 0 && !point.sampleOnly
      && !point.failed && !point.incomplete && !point.queued && !point.queryChanged;
    const observed = marketTrendCount(point);
    const chartValue = observed === 0 && !coverageComplete ? null : observed;
    return { key, point, captured, chartValue, coverageComplete };
  });
}
