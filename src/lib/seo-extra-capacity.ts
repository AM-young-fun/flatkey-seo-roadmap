import { seoToday, workWeekDateRange } from "./seo-date-range";
import type { WorkflowTask } from "./seo-workflow";

export const HOTSPOT_EXTRA = "authorized_hotspot_extra";
export const WEEKLY_GROWTH_EXTRA = "authorized_weekly_growth_extra";
export const WEEKLY_GROWTH_DELIVERY_LIMIT = 3;
export const WEEKLY_GROWTH_NEW_PAGE_LIMIT = 2;

export function isSeoExtraCapacity(value: unknown) {
  return value === HOTSPOT_EXTRA || value === WEEKLY_GROWTH_EXTRA;
}

export function seoExtraCapacityProblem(tasks: WorkflowTask[], scheduledIds: ReadonlySet<string>, newIds: ReadonlySet<string>) {
  const scheduled = tasks.filter(task => scheduledIds.has(task.id) && !task.deletedAt && isSeoExtraCapacity(task.capacityClass))
    .map(task => ({ task, day: seoToday(new Date(task.dueAt)) }));
  for (const { task, day } of scheduled) {
    if (!newIds.has(task.id)) continue;
    const week = workWeekDateRange(day);
    const inWeek = scheduled.filter(other => other.task.capacityClass === task.capacityClass && other.day >= week.start && other.day <= week.end);
    const label = task.capacityClass === WEEKLY_GROWTH_EXTRA ? "上涨加推" : "热点";
    if (inWeek.filter(other => other.day === day).length > 1) return `当日额外交付已有一个${label}任务`;
    if (task.capacityClass === WEEKLY_GROWTH_EXTRA) {
      if (inWeek.length > WEEKLY_GROWTH_DELIVERY_LIMIT) return "当前北京时间业务周的上涨加推已达到三项上限";
      if (inWeek.filter(other => other.task.kind === "blog").length > WEEKLY_GROWTH_NEW_PAGE_LIMIT) return "当前北京时间业务周的上涨加推已达到两篇新增博客上限";
      if (inWeek.some(other => other.task.topicId !== task.topicId)) return "当前北京时间业务周已经有一个上涨加推话题";
    } else if (inWeek.filter(other => other.task.kind !== "optimization").length > 2) return "当前北京时间业务周的热点已达到两页上限";
  }
  return null;
}
