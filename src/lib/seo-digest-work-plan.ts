import type { DigestKind, DigestWorkPlan } from "./seo-digest";
import { shiftDay, weeklyReportRange } from "./seo-date-range";
import { isSeoWorkday } from "./seo-workday";
import { approvalReviewReadiness, automaticTaskPolicy, isExecutableWorkflowPlan, workflowApprovalEffectiveItemStatus, type WorkflowSnapshot } from "./seo-workflow";

const weekday = (day: string) => new Date(day + "T00:00:00Z").getUTCDay();

/** Report cycles use Friday–Thursday; persisted plan IDs keep their Monday anchor. */
export function digestExecutionWeek(date: string, kind: DigestKind = "daily") {
  const day = kind === "weekly" ? shiftDay(weeklyReportRange(date).end, 1) : date;
  const monday = shiftDay(day, -((weekday(day) + 6) % 7));
  return kind === "daily" && [5, 6, 0].includes(weekday(day)) ? shiftDay(monday, 7) : monday;
}

/** Daily archive dates follow the source day; choose its execution cycle, not the collection day's. */
export function digestReportExecutionWeek(date: string, kind: DigestKind) {
  return digestExecutionWeek(kind === "daily" ? shiftDay(date, -1) : date, kind);
}

export function digestExecutionPeriod(weekStart: string) {
  const start = shiftDay(weekStart, -3), end = shiftDay(weekStart, 3);
  const workdays = Array.from({ length: 7 }, (_, index) => shiftDay(start, index))
    .filter(day => isSeoWorkday(new Date(day + "T12:00:00+08:00")));
  return { start, end, workdays };
}

/** Read-only projection across both original plans; never reschedules an original task. */
export function summarizeDigestWorkPlan(snapshots: WorkflowSnapshot[], weekStart: string): DigestWorkPlan | undefined {
  const period = digestExecutionPeriod(weekStart);
  const relevant = snapshots.filter(snapshot => [shiftDay(weekStart, -7), weekStart].includes(snapshot.weekStart));
  const primary = relevant.find(snapshot => snapshot.weekStart === weekStart)?.plan;
  const plans = relevant.flatMap(snapshot => snapshot.plan ? [snapshot.plan] : []);
  const plan = primary ?? plans.at(-1);
  const selected = new Set(plans.flatMap(plan => plan.taskIds));
  const scheduledIds = new Set(plans.filter(plan => isExecutableWorkflowPlan(plan.status)).flatMap(plan => plan.taskIds));
  const allApprovals = [...new Map(relevant.flatMap(snapshot => snapshot.approvals).map(row => [row.id, row])).values()];
  const originals = [...new Map(relevant.flatMap(snapshot => snapshot.tasks).map(task => [task.id, task])).values()];
  const tasks = originals.flatMap<DigestWorkPlan["tasks"][number]>(task => {
    const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(new Date(task.dueAt));
    const scheduled = scheduledIds.has(task.id);
    const candidate = ["research", "review"].includes(task.kind) && !["verified", "observing"].includes(task.status);
    if ((!selected.has(task.id) && !candidate) || task.deletedAt || task.channel === "product"
      || !["flatkey.ai", "rackrate.org", "modelfit.cc"].includes(task.siteDomain)
      || !relevant.some(snapshot => snapshot.weekStart === task.weekStart)
      || !period.workdays.includes(day)
      || task.siteDomain === "flatkey.ai" && task.kind === "landing" && weekStart >= "2026-11-23"
      || day < period.start || day > period.end) return [];
    const kind = task.kind === "blog" || task.kind === "optimization" || task.kind === "research" ? task.kind
      : task.kind === "landing" ? task.siteDomain === "flatkey.ai" ? "landing" : "cluster_landing"
      : task.siteDomain === "flatkey.ai" ? "other_work" : "cluster_work";
    const automatic = kind === "blog" && !task.pageUrl || Boolean(automaticTaskPolicy(task));
    const pending = task.status === "review_pending";
    const canReview = pending && !automatic && allApprovals.some(approval => approval.items.some(item =>
      item.taskId === task.id && item.contentVersion === task.contentVersion && approvalReviewReadiness(item).ready
      && workflowApprovalEffectiveItemStatus(approval, item.id, allApprovals) === "pending"));
    const status = !pending ? task.status : automatic ? "ready" : canReview ? "review_pending" : "missing_materials";
    return [{ id: task.id, weekStart: task.weekStart, siteDomain: task.siteDomain, scheduled, kind, title: task.title,
      pageUrl: task.pageUrl, keyword: task.keyword, country: task.country, language: task.language,
      owner: task.owner, dueAt: task.dueAt, status, action: task.nextAction }];
  }).sort((a, b) => a.dueAt.localeCompare(b.dueAt) || a.id.localeCompare(b.id));
  if (!plan && !tasks.length) return undefined;
  const targets = plan && "clusterLanding" in plan.targets ? {
    blogs: plan.targets.apiBlogs + plan.targets.gpuBlogs, landing: plan.targets.landing,
    optimizedPages: plan.targets.optimizedPages, clusterLanding: plan.targets.clusterLanding,
  } : undefined;
  return { weekStart, periodStart: period.start, periodEnd: period.end, workdays: period.workdays,
    status: plan?.status ?? "draft", targets, tasks };
}
