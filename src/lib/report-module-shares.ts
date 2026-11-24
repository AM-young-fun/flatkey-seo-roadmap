export type ReportTrafficRange = { start: string; end: string };
export type ReportModuleShareComparison = {
  current: { all: number | null; modelDetail: number | null; prompts: number | null };
  previous: { all: number | null; modelDetail: number | null; prompts: number | null };
  observedAt?: string;
};
export type ReportModuleShareSnapshot = {
  version: 1; period: ReportTrafficRange; comparisonPeriod: ReportTrafficRange; timezone: "America/Los_Angeles";
  sourceReportId: string; sourceEvidenceSha256: string; values: ReportModuleShareComparison & { observedAt: string };
};

export function validReportTrafficRange(range: ReportTrafficRange): boolean {
  const valid = (date: string) => /^\d{4}-\d{2}-\d{2}$/.test(date)
    && Number.isFinite(Date.parse(date)) && new Date(date).toISOString().slice(0, 10) === date;
  return valid(range.start) && valid(range.end) && range.start <= range.end;
}

const validCount = (value: number | null | undefined): value is number => Number.isSafeInteger(value) && value! >= 0;

/** Only the known scalar fields leave an archived payload. */
export function savedReportModuleShares(input: unknown): (ReportModuleShareComparison & { observedAt: string }) | undefined {
  if (!input || typeof input !== "object" || Array.isArray(input)) return undefined;
  const value = input as Record<string, unknown>;
  const side = (name: "current" | "previous") => {
    const source = value[name];
    if (!source || typeof source !== "object" || Array.isArray(source)) return undefined;
    const record = source as Record<string, unknown>;
    if (["all", "modelDetail", "prompts"].some(key => record[key] !== null && !validCount(record[key] as number))) return undefined;
    const result = { all: record.all as number | null, modelDetail: record.modelDetail as number | null, prompts: record.prompts as number | null };
    if (result.all !== null && [result.modelDetail, result.prompts].some(count => count !== null && count > result.all!)) return undefined;
    return result;
  };
  const current = side("current"), previous = side("previous");
  if (!current || !previous || typeof value.observedAt !== "string" || !Number.isFinite(Date.parse(value.observedAt))) return undefined;
  return { current, previous, observedAt: value.observedAt };
}

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

export function reportModuleShareLines(values?: ReportModuleShareComparison) {
  const rows = reportModuleShareRows(values);
  const share = (value: number | null) => value === null ? "未齐" : `${(value * 100).toFixed(1)}%`;
  if (rows.every(row => row.previousShare === null && row.currentShare === null)) return ["模块占比：同区间全站及模块整段去重访客来源未齐，暂不计算；未用每日人数相加。"];
  return ["模块占比（同区间全站去重访客为分母，模块可重叠，不相加）：",
    ...rows.map(row => `${row.label} ${share(row.previousShare)} → ${share(row.currentShare)}${row.current === null ? "" : `（本期${row.current}人）`}。`)];
}
