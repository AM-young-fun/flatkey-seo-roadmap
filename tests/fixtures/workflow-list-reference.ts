// Frozen pre-DTO list display rules used as an independent regression oracle.
import { groupApprovalPages, pendingTaskApproval } from "../../src/lib/seo-approval-display";
import { approvalItemNeedsHuman, approvalReviewReadiness, workflowApprovalEffectiveItemStatus, workflowTaskHasProgress, type WorkflowSnapshot, type WorkflowTask, type WorkflowApproval } from "../../src/lib/seo-workflow";

export function workTaskStatus(task: WorkflowTask, data?: Pick<WorkflowSnapshot, "approvals" | "publications" | "workWeek"> | null) {
  const approvals = data?.approvals ?? [];
  const pending = pendingTaskApproval(task, approvals);
  if (!pending && approvals.some(approval => approval.siteDomain === task.siteDomain && approval.items.some(item =>
    item.taskId === task.id && item.contentVersion === task.contentVersion && item.pageUrl === task.pageUrl
    && (!task.language || item.language === task.language)
    && (!item.codeSource || !task.branchObservation || task.branchObservation.headSha === item.codeSource.commitSha)
    && workflowApprovalEffectiveItemStatus(approval, item.id, approvals) === "rejected"
  ))) return "rejected";
  if (task.status === "blocked" || task.status === "failed") return "failed";
  if (pending && approvalReviewReadiness(pending.item).ready) return "review";
  if (data?.workWeek?.pendingRollbackTaskIds.includes(task.id)) return "accepted";
  if (["verified", "observing"].includes(task.status)) return "completed";
  const publication = data?.publications.find(row => row.taskId === task.id && row.contentVersion === task.contentVersion && row.status === "verified"
    && !["translation", "backfill_translation"].includes(row.kind));
  if (publication) return "completed";
  return workflowTaskHasProgress(task) ? "accepted" : "scheduled";
}

export function multilingualReviews(data: WorkflowSnapshot | null) {
  const byTask = new Map<string, { approval: WorkflowApproval; languages: string[]; key: string }>();
  if (!data) return byTask;
  const tasks = new Map(data.tasks.map(task => [task.id, task]));
  for (const approval of data.approvals ?? []) {
    if (approval.status === "draft") continue;
    const pending = approval.items.filter(item => {
      const task = tasks.get(item.taskId);
      return data.workWeek?.activeApprovalItems[approval.id]?.includes(item.id)
        && task?.siteDomain === approval.siteDomain && task.pageUrl === item.pageUrl && task.contentVersion === item.contentVersion
        && approvalItemNeedsHuman(item, [task]) && approvalReviewReadiness(item).ready
        && workflowApprovalEffectiveItemStatus(approval, item.id, data.approvals) === "pending";
    });
    for (const group of groupApprovalPages(pending)) {
      const languages = [...new Set(group.items.map(item => item.language))];
      if (languages.length < 2) continue;
      for (const item of group.items) {
        if (!byTask.has(item.taskId)) byTask.set(item.taskId, { approval, languages, key: approval.id + ":" + group.key });
      }
    }
  }
  return byTask;
}

