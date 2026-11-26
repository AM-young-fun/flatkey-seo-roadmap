import { groupApprovalPages, pendingTaskApproval } from "./seo-approval-display";
import { dateInListRange, listDateRange, seoToday, validRange, type ListDatePreset } from "./seo-date-range";
import { GROWTH_COUNTRIES, GROWTH_LANGUAGES } from "./seo-growth-markets";
import { approvalItemNeedsHuman, approvalReviewReadiness, workflowApprovalEffectiveItemStatus, workflowTaskHasProgress, WORKFLOW_SITES, type WorkflowSnapshot, type WorkflowTask } from "./seo-workflow";

export type WorkflowListReview = { id: string; title: string; key: string; languages: string[] };
export type WorkflowListTask = Pick<WorkflowTask, "id" | "weekStart" | "title" | "siteDomain" | "business" | "country" | "language" | "kind" | "workClass" | "pageType" | "pageUrl" | "keyword" | "owner" | "dueAt" | "nextAction" | "failureReason"> & {
  displayStatus: ReturnType<typeof workTaskStatus>;
  review: WorkflowListReview | null;
};
export type WorkflowWorkList = Pick<WorkflowSnapshot, "weekStart" | "weekEnd" | "generatedAt" | "storage" | "summary" | "workWeek"> & {
  format: "list";
  tasks: WorkflowListTask[];
};

export const workTaskTypes = [
  { value: "all", label: "全部任务" },
  { value: "blog-create", label: "制作博客" },
  { value: "blog-update", label: "优化博客" },
  { value: "content-refresh", label: "旧文翻新" },
  { value: "internal-linking", label: "主题内链" },
  { value: "landing-create", label: "制作落地页" },
  { value: "landing-update", label: "优化页面" },
  { value: "research", label: "关键词研究" },
  { value: "technical", label: "技术修复" },
  { value: "cluster", label: "集群交付" },
  { value: "promotion", label: "推广与内链" },
  { value: "review", label: "复盘" },
];

export const workTaskStatusOptions = [
  { value: "active", label: "未验收" },
  { value: "all", label: "全部状态" },
  { value: "scheduled", label: "排期" },
  { value: "accepted", label: "进行中" },
  { value: "review", label: "待审核" },
  { value: "rejected", label: "已拒绝" },
  { value: "failed", label: "失败" },
  { value: "completed", label: "已验收" },
];

export function editorialTaskType(task: Pick<WorkflowTask, "kind" | "workClass" | "pageType" | "pageUrl">) {
  if (task.workClass === "content_refresh") return "content-refresh";
  if (task.workClass === "internal_linking") return "internal-linking";
  const blog = task.pageType === "blog" || /\/blog(?:\/|$)/.test(task.pageUrl ?? "");
  if (task.kind === "blog") return "blog-create";
  if (task.kind === "landing") return "landing-create";
  if (task.kind === "optimization" || task.kind === "cluster" && task.pageUrl) return blog ? "blog-update" : "landing-update";
  return task.kind;
}

export type WorkflowWorkPage = Pick<WorkflowWorkList, "format" | "weekStart" | "generatedAt" | "storage"> & Pick<WorkflowSnapshot, "workBoardPlan"> & {
  catchUpDate: string | null;
  pagination: { page: number; pageSize: 10; total: number; pageCount: number };
  tasks: (WorkflowListTask & { delayed: boolean; rollbackPending: boolean })[];
};

const workListPageKeys = new Set(["operational", "workList", "format", "profile", "page", "site", "country", "language", "business", "taskType", "status", "q", "range", "rangeStart", "rangeEnd"]);

export function parseWorkflowWorkPageQuery(params: URLSearchParams) {
  if ([...params.keys()].some(key => !workListPageKeys.has(key) || params.getAll(key).length > 1)) return null;
  const rawPage = params.get("page") ?? "";
  const page = Number(rawPage);
  const site = params.get("site") ?? "all", country = params.get("country") ?? "all";
  const language = params.get("language") ?? "all", business = params.get("business") ?? "all";
  const taskType = params.get("taskType") ?? "all", status = params.get("status") ?? "active";
  const query = params.get("q") ?? "", preset = params.get("range") ?? "week";
  const customRange = { start: params.get("rangeStart") ?? "", end: params.get("rangeEnd") ?? "" };
  if (!/^[1-9]\d*$/.test(rawPage) || !Number.isSafeInteger(page) || query.length > 250
    || !["all", ...WORKFLOW_SITES].includes(site) || !["all", ...GROWTH_COUNTRIES].includes(country)
    || !["all", ...GROWTH_LANGUAGES].includes(language) || !["all", "API", "GPU", "CLUSTER"].includes(business)
    || !workTaskTypes.some(option => option.value === taskType) || !workTaskStatusOptions.some(option => option.value === status)
    || !["all", "week", "nextWeek", "month", "custom"].includes(preset) || preset === "custom" && !validRange(customRange)) return null;
  return { page, site, country, language, business, taskType, status, query, preset: preset as ListDatePreset, customRange };
}

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
      return { id, weekStart, title, siteDomain, business, country, language, kind, ...(task.workClass ? { workClass: task.workClass } : {}), pageType, pageUrl, keyword, owner, dueAt, nextAction, failureReason,
        displayStatus: workTaskStatus(task, snapshot), review: reviews.get(task.id) ?? null };
    }),
  };
}

/** Resolve display status, filters and multilingual review groups before slicing. */
export function workflowWorkPage(snapshot: WorkflowSnapshot, filter: NonNullable<ReturnType<typeof parseWorkflowWorkPageQuery>>): WorkflowWorkPage {
  const list = workflowWorkList(snapshot);
  const range = listDateRange(filter.preset, seoToday(new Date(list.generatedAt)), filter.customRange, "work");
  const overdue = new Set(list.workWeek?.overdueTaskIds);
  const pendingRollback = new Set(list.workWeek?.pendingRollbackTaskIds);
  const scoped = list.tasks.filter(task => (filter.site === "all" || task.siteDomain === filter.site)
    && (filter.country === "all" || task.country === filter.country) && (filter.language === "all" || task.language === filter.language)
    && (filter.business === "all" || task.business === filter.business));
  const overdueGroups = new Set(scoped.flatMap(task => task.review && overdue.has(task.id) ? [task.review.key] : []));
  const seen = new Set<string>(), query = filter.query.toLowerCase();
  const rows = scoped.filter(task => {
    if ((filter.taskType !== "all" && editorialTaskType(task) !== filter.taskType)
      || !(filter.preset === "week" && overdue.has(task.id) || dateInListRange(task.dueAt, range))
      || (filter.status !== "all" && (filter.status === "active" ? task.displayStatus === "completed" : task.displayStatus !== filter.status))
      || ![task.title, task.keyword, task.pageUrl, task.owner, task.review?.title].some(value => value?.toLowerCase().includes(query))) return false;
    if (!task.review) return true;
    if (seen.has(task.review.key)) return false;
    seen.add(task.review.key);
    return true;
  });
  const pageSize = 10, pageCount = Math.max(1, Math.ceil(rows.length / pageSize)), page = Math.min(filter.page, pageCount);
  return {
    format: list.format, weekStart: list.weekStart, generatedAt: list.generatedAt, storage: list.storage,
    ...(snapshot.workBoardPlan ? { workBoardPlan: snapshot.workBoardPlan } : {}),
    catchUpDate: list.workWeek?.catchUpDate ?? null,
    pagination: { page, pageSize, total: rows.length, pageCount },
    tasks: rows.slice((page - 1) * pageSize, page * pageSize).map(task => ({
      ...task, delayed: overdue.has(task.id) || Boolean(task.review && overdueGroups.has(task.review.key)), rollbackPending: pendingRollback.has(task.id),
    })),
  };
}
