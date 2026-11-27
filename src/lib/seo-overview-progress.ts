import { seoToday, shiftDay } from "./seo-date-range";
import { isContentWorkBoardTask, isExecutableWorkflowPlan, type WorkflowSnapshot } from "./seo-workflow";
import { workTaskStatus } from "./seo-workflow-list";
import type { RecentPublishedPage } from "./seo-digest-recent-pages";

export function overviewTaskProgress(workflow: Pick<WorkflowSnapshot, "tasks" | "approvals" | "publications">, plans: WorkflowSnapshot["plan"][], now: Date) {
  const end = seoToday(now), start = shiftDay(end, -6);
  const scheduled = new Set(plans.flatMap(plan => plan && isExecutableWorkflowPlan(plan.status) ? plan.taskIds : []));
  const rows = Array.from({ length: 7 }, (_, index) => ({
    date: shiftDay(start, index), due: 0, complete: 0, inProgress: 0, scheduled: 0, blocked: 0,
  }));
  const byDay = new Map(rows.map(row => [row.date, row]));
  for (const task of workflow.tasks) {
    const dueAt = new Date(task.dueAt);
    if (!scheduled.has(task.id) || task.deletedAt || !isContentWorkBoardTask(task) || !(dueAt.getTime() <= now.getTime())) continue;
    const day = byDay.get(seoToday(dueAt));
    if (!day) continue;
    day.due++;
    switch (workTaskStatus(task, workflow)) {
      case "completed": day.complete++; break;
      case "failed":
      case "rejected": day.blocked++; break;
      case "scheduled": day.scheduled++; break;
      default: day.inProgress++;
    }
  }
  return {
    start, end, rows,
    due: rows.reduce((total, row) => total + row.due, 0),
    complete: rows.reduce((total, row) => total + row.complete, 0),
    inProgress: rows.reduce((total, row) => total + row.inProgress, 0),
    scheduled: rows.reduce((total, row) => total + row.scheduled, 0),
    blocked: rows.reduce((total, row) => total + row.blocked, 0),
  };
}

export type OverviewProgress = {
  work: ReturnType<typeof overviewTaskProgress> | null;
  effects: { start: string; end: string; total: number; comparable: number; pages: RecentPublishedPage[] } | null;
};
