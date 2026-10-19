import { nextSerpPeriodDue, serpPeriod } from "./serp-periods";

export type OperationsStatus = {
  checkedAt: string;
  controls: { enabled: boolean; emergencyStopped: boolean; maxRunCostMicros: number; maxMonthCostMicros: number };
  scheduler: { configured: boolean; cadence: "每30分钟检查到期任务"; state: "UNCONFIRMED" | "HEALTHY" | "OVERDUE" | "ERROR"; lastStartedAt: string | null; lastCompletedAt: string | null };
  plans: { id: string; name: string; location: string; cadence: string; state: string; nextAt: string | null; note: string }[];
  records: { id: string; name: string; state: string; startedAt: string; completedAt: string | null; detail: string; failedDiscoveryId?: string }[];
};

export function schedulerState(last: { startedAt: Date; completedAt: Date | null; status: string } | null, now: Date): OperationsStatus["scheduler"]["state"] {
  if (!last) return "UNCONFIRMED";
  if (last.status === "FAILED" || last.status === "NEEDS_REVIEW") return "ERROR";
  if (now.getTime() - last.startedAt.getTime() > 75 * 60_000) return "OVERDUE";
  // A started check is not proof of a successfully completed invocation.
  return last.completedAt ? "HEALTHY" : "UNCONFIRMED";
}

export function plannedRankingTime(now: Date, stored: Date | null): string {
  if (stored) return stored.toISOString();
  const current = serpPeriod(now);
  return Date.parse(current.dueAt) > now.getTime() ? current.dueAt : nextSerpPeriodDue(now).toISOString();
}

export const operationStateLabels: Record<string, string> = {
  PLANNED: "已排队", RUNNING: "执行中", PENDING: "等待响应", QUEUED: "等待结果", RECEIVED: "结果已保存", ACTIVE: "执行中",
  COMPLETED: "已完成", COMPLETE: "已完成", FINISHED: "已完成", PARTIAL: "部分完成", FAILED: "失败", UNKNOWN: "响应不明，已停止提交", NEEDS_REVIEW: "异常，已停止提交", IMPORT_FAILED: "结果已保存，导入异常",
  DISABLED: "自动付费关闭", NOT_DUE: "未到执行时间", NOT_SCHEDULED: "尚未启用计划", PAUSED: "已暂停", UNAVAILABLE: "暂不可用",
};
