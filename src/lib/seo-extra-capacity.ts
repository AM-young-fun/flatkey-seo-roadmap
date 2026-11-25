import { seoToday, workWeekDateRange } from "./seo-date-range";
import type { WorkflowTask } from "./seo-workflow";

export const HOTSPOT_EXTRA = "authorized_hotspot_extra";
export const WEEKLY_GROWTH_EXTRA = "authorized_weekly_growth_extra";

export function isSeoExtraCapacity(value: unknown) {
  return value === HOTSPOT_EXTRA || value === WEEKLY_GROWTH_EXTRA;
}

export function seoExtraCapacityProblem(tasks: WorkflowTask[], scheduledIds: ReadonlySet<string>, newIds: ReadonlySet<string>) {
  const scheduled = tasks.filter(task => scheduledIds.has(task.id) && !task.deletedAt && isSeoExtraCapacity(task.capacityClass))
    .map(task => ({ task, day: seoToday(new Date(task.dueAt)) }));
  for (const { task, day } of scheduled) {
    if (!newIds.has(task.id)) continue;
    const week = workWeekDateRange(day);
    const inWeek = scheduled.filter(other => other.day >= week.start && other.day <= week.end);
    if (inWeek.filter(other => other.day === day).length > 1) return "当日额外交付已有一个原任务，优先保留当日常规排期";
    if (inWeek.filter(({ task }) => task.kind !== "optimization").length > 2) return "当前北京时间业务周的额外新增页面已达到两页上限";
    if (task.capacityClass === WEEKLY_GROWTH_EXTRA) {
      const boosts = inWeek.filter(other => other.task.capacityClass === WEEKLY_GROWTH_EXTRA);
      if (boosts.length > 2) return "当前北京时间业务周的上涨加推已达到两项上限";
      if (boosts.some(other => other.task.topicId !== task.topicId)) return "当前北京时间业务周已经有一个上涨加推话题";
    }
  }
  return null;
}
