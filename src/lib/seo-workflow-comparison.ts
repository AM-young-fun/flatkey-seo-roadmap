import type { WorkflowOptimization } from "./seo-workflow";

const shiftDay = (value: string, days: number) => new Date(Date.parse(value + "T00:00:00Z") + days * 86400000).toISOString().slice(0, 10);

/** A numerical observation is anchored to a verified publication, not a draft's
 * edited timestamp. Missing values remain null and old note-only history stays
 * readable without inventing a structured comparison. */
export function optimizationComparisonProblems(value: WorkflowOptimization, verifiedPublicationTimes: Map<string, string>, previous?: WorkflowOptimization): string[] {
  const problems: string[] = [];
  for (const [index, observation] of value.observations.entries()) {
    const comparison = observation.comparison;
    if (!comparison) {
      if (index >= (previous?.observations.length ?? 0) && observation.status === "improved") problems.push("新增改善结论必须附有结构化可比指标，旧备注不补造数据");
      continue;
    }
    const publishedAt = verifiedPublicationTimes.get(comparison.changeId);
    if (!publishedAt) { problems.push("效果对比必须锚定已验收上线的变更"); continue; }
    if (comparison.pageUrl !== value.pageUrl || comparison.country !== value.country || comparison.targetKeyword !== value.keyword) problems.push("对比页面、国家和目标词必须与优化一致");
    const days = Number(observation.windowDays), day = new Date(publishedAt).toLocaleDateString("en-CA", { timeZone: comparison.timezone });
    if (comparison.before.periodStart !== shiftDay(day, -days) || comparison.before.periodEnd !== shiftDay(day, -1) || comparison.after.periodStart !== shiftDay(day, 1) || comparison.after.periodEnd !== shiftDay(day, days)) problems.push("前后7/28/56天窗口须等长且排除上线当天");
    const checkedDay = new Date(observation.checkedAt).toLocaleDateString("en-CA", { timeZone: comparison.timezone });
    for (const window of [comparison.before, comparison.after]) {
      if (window.sourceDate > checkedDay || window.actualDays.some(day => day > checkedDay)) problems.push("观察不能包含核查时尚未产生的数据日期");
    }
    const coverage = Math.min(comparison.before.actualDays.length, comparison.after.actualDays.length);
    if (observation.comparableDays > coverage || (comparison.status === "comparable" && observation.comparableDays !== days)) problems.push("可比天数不能超过真实覆盖；完整比较须覆盖整个窗口");
    if (observation.status === "improved" && comparison.status !== "comparable") problems.push("数据未齐时不能宣称优化已改善");
    if (observation.status === "improved" && !Object.keys(comparison.before.metrics).some(key => comparison.before.metrics[key as keyof typeof comparison.before.metrics] !== null && comparison.after.metrics[key as keyof typeof comparison.after.metrics] !== null)) problems.push("前后没有相同的已知指标，不能支持改善结论");
    const sourceDate = [comparison.before.sourceDate, comparison.after.sourceDate].sort().at(-1)!;
    if (!comparison.evidence.some(item => new Date(item.observedAt).toLocaleDateString("en-CA", { timeZone: comparison.timezone }) >= sourceDate)) problems.push("来源证据的采集时间不能早于数据截至日期");
    const laterChange = value.changes.some(change => change.id !== comparison.changeId && verifiedPublicationTimes.has(change.id) && (() => { const otherDay = new Date(verifiedPublicationTimes.get(change.id)!).toLocaleDateString("en-CA", { timeZone: comparison.timezone }); return otherDay > day && otherDay <= comparison.after.periodEnd; })());
    if (laterChange && !comparison.reason) problems.push("观察窗口内还有其他上线变更，须说明不能单独归因");
  }
  return [...new Set(problems)];
}
