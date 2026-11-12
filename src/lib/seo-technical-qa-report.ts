import type { WorkflowSnapshot } from "./seo-workflow";

export function technicalQaReport(
  snapshot: Pick<WorkflowSnapshot, "runs" | "issues" | "approvals">, start: string, end: string, now: Date,
) {
  const cutoff = Math.min(now.getTime(), Date.parse(end));
  const run = snapshot.runs.filter(row => row.stage === "TECHNICAL_QA"
    && Date.parse(row.scheduledFor) >= Date.parse(start) && Date.parse(row.scheduledFor) < cutoff
    && Date.parse(row.startedAt) <= cutoff && (!row.completedAt || Date.parse(row.completedAt) <= cutoff))
    .sort((a, b) => Date.parse(b.scheduledFor) - Date.parse(a.scheduledFor))[0];
  if (!run) return null;
  const taskIds = new Set(run.taskIds);
  return {
    id: run.id, status: run.status, checked: run.checkedItems, completed: run.completedItems, coverage: run.coverage,
    scheduledFor: run.scheduledFor, failure: run.failureReason, nextAction: run.nextAction, sourceDates: run.sourceDates,
    issues: snapshot.issues.filter(row => row.taskId && taskIds.has(row.taskId)).map(row => ({
      id: row.id, title: row.title, status: row.status, priority: row.priority, url: row.pageUrl, nextAction: row.nextAction,
    })),
    approvals: snapshot.approvals.filter(row => row.submittedRecordedAt && Date.parse(row.submittedRecordedAt) <= cutoff
      && row.items.some(item => taskIds.has(item.taskId))).map(row => ({ id: row.id, title: row.title, status: row.status })),
  };
}

export type TechnicalQaReport = ReturnType<typeof technicalQaReport>;
export const technicalQaStatus = { completed: "已完成", partial: "部分完成", blocked: "有阻塞", failed: "失败", running: "进行中" };
export const technicalQaSummary = (run: TechnicalQaReport) => run
  ? `${technicalQaStatus[run.status]} · 已完成 ${run.completed}/${run.checked} 项检查 · ${run.approvals.length} 单已送审`
  : "待更新 · 本期尚未收到巡检回执";
