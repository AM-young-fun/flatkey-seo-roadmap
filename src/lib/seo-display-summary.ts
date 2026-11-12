import type { DateRange } from "./seo-date-range";
type Day = { sessions: number | null; registrations: number | null };
export function metricStats(points: Day[], key: keyof Day) {
  let total = 0, measured = 0;
  for (const point of points) { if (point[key] != null) { total += point[key]; measured++; } }
  return { total: measured ? total : null, measured, days: points.length };
}
export function changeText(current: ReturnType<typeof metricStats>, previous: ReturnType<typeof metricStats> | null, comparison: DateRange | null) {
  if (!comparison) return "";
  if (current.total === null || current.measured < current.days) return "数据未齐，暂不比较";
  if (!previous || previous.total === null || previous.measured < previous.days) return "对比期数据未齐";
  const unequal = current.days !== previous.days;
  const a = unequal ? current.total / current.days : current.total, b = unequal ? previous.total / previous.days : previous.total;
  const unit = unequal ? "日均" : "";
  if (a === b) return `${unit}与对比期持平`;
  if (b === 0) return `${unit}比对比期${a > b ? "多" : "少"} ${Math.abs(a-b).toLocaleString("zh-CN", {maximumFractionDigits:1})}`;
  return `${unit}比对比期${a > b ? "多" : "少"} ${Math.abs((a / b - 1) * 100).toFixed(1)}%`;
}
