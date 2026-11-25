import { comparableMarketTrendPoints, marketTrendCount, type TrendPoint } from "@/lib/ranking-trends";

/** Keep the saved period on the timeline even if its chart value is unknown. */
export function rankingTrendDisplayPeriods(points: TrendPoint[]) {
  const byPeriod = new Map(points.map(point => [point.periodKey ?? point.date, point]));
  return [...byPeriod].map(([key, point]) => {
    const captured = point.captured ?? point.checked ?? point.ranked + point.outside;
    const coverageComplete = point.total > 0 && captured === point.total && point.pending === 0 && !point.sampleOnly
      && !point.failed && !point.incomplete && !point.queued && !point.queryChanged;
    const observed = marketTrendCount(point);
    const chartValue = observed === 0 && !coverageComplete ? null : observed;
    const rawCaptured = point.languageProjection?.rawCaptured ?? captured;
    const status = chartValue === null && rawCaptured > 0
      ? { label: rawCaptured > captured && (point.languageProjection?.unknownLanguageWords ?? 0) > 0 ? "待语种核验" : "上榜证据待齐", rawCaptured }
      : null;
    return { key, point, captured, chartValue, coverageComplete, status };
  });
}

type DisplayPeriod = ReturnType<typeof rankingTrendDisplayPeriods>[number];

/** Dashed segments display successive reported counts. Only solid segments
 * have a verified comparison identity, and neither style crosses a gap. */
export function rankingTrendDisplaySegments(periods: DisplayPeriod[], showObservations: boolean) {
  return periods.slice(1).flatMap((current, index) => {
    const previous = periods[index];
    if (previous.chartValue === null || current.chartValue === null) return [];
    const comparable = comparableMarketTrendPoints(previous.point, current.point);
    if (!comparable && !showObservations) return [];
    const data = Array<number | null>(periods.length).fill(null);
    data[index] = previous.chartValue;
    data[index + 1] = current.chartValue;
    return [{ comparable, data }];
  });
}
