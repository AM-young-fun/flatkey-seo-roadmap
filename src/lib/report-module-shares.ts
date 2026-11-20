export type ReportTrafficRange = { start: string; end: string };
export type ReportModuleShareComparison = {
  current: { all: number | null; modelDetail: number | null; prompts: number | null };
  previous: { all: number | null; modelDetail: number | null; prompts: number | null };
  observedAt?: string;
};

export function validReportTrafficRange(range: ReportTrafficRange): boolean {
  const valid = (date: string) => /^\d{4}-\d{2}-\d{2}$/.test(date)
    && Number.isFinite(Date.parse(date)) && new Date(date).toISOString().slice(0, 10) === date;
  return valid(range.start) && valid(range.end) && range.start <= range.end;
}

const validCount = (value: number | null | undefined): value is number => Number.isSafeInteger(value) && value! >= 0;

/** Each numerator and denominator must be queried over the whole selected interval. */
export function wholePeriodUserShare(users: number | null | undefined, all: number | null | undefined): number | null {
  return validCount(users) && validCount(all) && all > 0 && users <= all ? users / all : null;
}

export function reportModuleShareRows(values?: ReportModuleShareComparison) {
  return ([['modelDetail', '模型详情'], ['prompts', '提示词库']] as const).map(([key, label]) => {
    const previous = values?.previous[key] ?? null, current = values?.current[key] ?? null;
    const previousShare = wholePeriodUserShare(previous, values?.previous.all);
    const currentShare = wholePeriodUserShare(current, values?.current.all);
    return {
      key, label,
      previous: validCount(previous) ? previous : null,
      current: validCount(current) ? current : null,
      previousShare, currentShare,
      sharePoints: previousShare === null || currentShare === null ? null : (currentShare - previousShare) * 100,
    };
  });
}
