import { groupApprovalPages, pendingTaskApproval } from "./seo-approval-display";
import { approvalItemNeedsHuman, approvalReviewReadiness, workflowApprovalEffectiveItemStatus, workflowTaskHasProgress, type WorkflowSnapshot, type WorkflowTask } from "./seo-workflow";

export type WorkflowListReview = { id: string; title: string; key: string; languages: string[] };
export type WorkflowListTask = Pick<WorkflowTask, "id" | "weekStart" | "title" | "siteDomain" | "business" | "country" | "language" | "kind" | "pageType" | "pageUrl" | "keyword" | "owner" | "dueAt" | "nextAction" | "failureReason"> & {
  displayStatus: ReturnType<typeof workTaskStatus>;
  review: WorkflowListReview | null;
};
export type WorkflowWorkList = Pick<WorkflowSnapshot, "weekStart" | "weekEnd" | "generatedAt" | "storage" | "summary" | "workWeek"> & {
  format: "list";
  tasks: WorkflowListTask[];
};

// Original task-list rules run against the canonical snapshot. Their output is
// presentation data and is never an input to an approval or write transaction.
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
  const byTask = new Map<string, WorkflowListReview>();
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
        if (!byTask.has(item.taskId)) byTask.set(item.taskId, { id: approval.id, title: approval.title, languages, key: approval.id + ":" + group.key });
      }
    }
  }
  return byTask;
}


export function workflowWorkList(snapshot: WorkflowSnapshot): WorkflowWorkList {
  const reviews = multilingualReviews(snapshot);
  return {
    format: "list", weekStart: snapshot.weekStart, weekEnd: snapshot.weekEnd,
    generatedAt: snapshot.generatedAt, storage: snapshot.storage,
    summary: snapshot.summary, workWeek: snapshot.workWeek,
    tasks: snapshot.tasks.map(task => {
      const { id, weekStart, title, siteDomain, business, country, language, kind, pageType, pageUrl, keyword, owner, dueAt, nextAction, failureReason } = task;
      return { id, weekStart, title, siteDomain, business, country, language, kind, pageType, pageUrl, keyword, owner, dueAt, nextAction, failureReason,
        displayStatus: workTaskStatus(task, snapshot), review: reviews.get(task.id) ?? null };
    }),
  };
}
