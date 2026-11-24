import type { GrowthGoalEvaluation } from "./growth-strategy";

export function dailyTrafficComparisonText(goals: GrowthGoalEvaluation): string | null {
  const row = goals.dailyTrafficObservation;
  if (!row) return null;
  return `日常滚动7日 ${row.period.start}—${row.period.end}（洛杉矶）；对比前一日滚动窗口 ${row.previousPeriod.start}—${row.previousPeriod.end}：${row.difference === null ? "同口径标量未齐，暂不计算变化" : `${row.previousSessions} → ${row.sessions}，${row.difference >= 0 ? "+" : ""}${row.difference} 次会话`}。仅作日常观察，固定周报及季末验收窗口不变。`;
}
