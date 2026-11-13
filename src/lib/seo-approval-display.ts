import { approvalReviewReadiness, approvalItemNeedsHuman, reviewPreviewUrl, workflowApprovalEffectiveItemStatus, type WorkflowApproval, type WorkflowTask } from "./seo-workflow";

export type ReviewItem = WorkflowApproval["items"][number];

export function groupApprovalPages(items: ReviewItem[]) {
  const groups = new Map<string, { path: string; items: ReviewItem[] }>();
  for (const item of items) {
    const url = new URL(item.pageUrl);
    const parts = url.pathname.split("/").filter(Boolean);
    const language = item.language.toLowerCase();
    const prefix = parts[0]?.toLowerCase();
    if (prefix === language || prefix === language.split("-")[0]) parts.shift();
    const path = "/" + parts.join("/") + url.search;
    const key = JSON.stringify([url.hostname, path, item.operation]);
    const group = groups.get(key) ?? { path, items: [] };
    group.items.push(item);
    groups.set(key, group);
  }
  return [...groups.entries()].map(([key, group]) => ({ key, ...group }));
}

export function approvalPreview(item: ReviewItem) {
  const url = item.previewContentVersion === item.contentVersion ? reviewPreviewUrl(item.previewUrl, item.pageUrl) : null;
  return { url, verified: Boolean(url) };
}

export function pendingTaskApproval(task: WorkflowTask, approvals: WorkflowApproval[]) {
  for (const approval of approvals) {
    if (approval.siteDomain !== task.siteDomain || !approval.submittedAt) continue;
    const item = approval.items.find(item => item.taskId === task.id && item.contentVersion === task.contentVersion
      && (!task.pageUrl || task.pageUrl === item.pageUrl)
      && approvalItemNeedsHuman(item, [task])
      && workflowApprovalEffectiveItemStatus(approval, item.id, approvals) === "pending");
    if (item) return { approval, item };
  }
  return null;
}

export function visibleApprovalItemStatus(approval: WorkflowApproval, item: ReviewItem, all: WorkflowApproval[], tasks: WorkflowTask[]) {
  if (!approvalItemNeedsHuman(item, tasks)) return "automatic_history";
  const status = workflowApprovalEffectiveItemStatus(approval, item.id, all);
  return (status === "pending" || status === "draft") && !approvalReviewReadiness(item).ready ? "missing_materials" : status;
}

export function approvalMaterialBacklog(approvals: WorkflowApproval[], tasks: WorkflowTask[]) {
  const taskById = new Map(tasks.map(task => [task.id, task]));
  return approvals.flatMap(approval => approval.items.flatMap(item => {
    const task = taskById.get(item.taskId);
    if (!task || task.siteDomain !== approval.siteDomain || ["published", "verified", "observing"].includes(task.status)) return [];
    if (task.contentVersion && (!task.language || task.language === item.language) && task.contentVersion !== item.contentVersion) return [];
    const status = visibleApprovalItemStatus(approval, item, approvals, [task]);
    if (status !== "missing_materials" && status !== "draft") return [];
    return [{ approvalId: approval.id, taskId: item.taskId, siteDomain: approval.siteDomain, pageUrl: item.pageUrl, language: item.language,
      contentVersion: item.contentVersion, codeSource: item.codeSource ?? task.codeSource,
      missing: approvalReviewReadiness(item).missing, status }];
  }));
}
