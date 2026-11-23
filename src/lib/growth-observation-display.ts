import type { GrowthObservationComparison } from "./growth-observation-comparison";

export function growthObservationComparisonText(comparison: GrowthObservationComparison | undefined, checkpoint: number) {
  if (!comparison) return `历史${checkpoint}天回执未保存等长前后窗口，本轮不以单日变化替代完整效果比较。`;
  const before = `${comparison.before.start}—${comparison.before.end}`, after = `${comparison.after.start}—${comparison.after.end}`;
  const coverage = `前窗${comparison.before.coveredDates.length}/${checkpoint}日，后窗${comparison.after.coveredDates.length}/${checkpoint}日（${comparison.sourceTimezone}）`;
  if (comparison.status === "complete") return `GA4自然会话：上线前${checkpoint}日 ${before} 的 ${comparison.previousSessions} → 上线后${checkpoint}日 ${after} 的 ${comparison.currentSessions}，变化${comparison.delta! > 0 ? "+" : ""}${comparison.delta}${comparison.relativeChange === null ? "（前窗为0，不计算百分比）" : `（${comparison.relativeChange > 0 ? "+" : ""}${(comparison.relativeChange * 100).toFixed(1)}%）`}；${coverage}。这是前后变化，尚不构成因果证明。`;
  if (comparison.status === "new_page") return `新页没有上线前${checkpoint}日历史基线，前窗保留未知；上线后 ${after} 自然会话${comparison.currentSessions === null ? "待补" : comparison.currentSessions}，不计算增量或涨幅。${coverage}。${comparison.reason}`;
  return `前后${checkpoint}日比较证据不足：前窗 ${before} ${comparison.previousSessions === null ? "未知" : comparison.previousSessions}，后窗 ${after} ${comparison.currentSessions === null ? "未知" : comparison.currentSessions}；${coverage}。不计算增量或涨幅。${comparison.reason} ${comparison.limitations.join("；")}`;
}
