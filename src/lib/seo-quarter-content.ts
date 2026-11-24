import { growthResolvedIdentity, type GrowthStrategy } from "./growth-strategy";
import { isExecutableWorkflowPlan, type WorkflowPlan, type WorkflowPublication, type WorkflowTask } from "./seo-workflow";
import type { WorkflowStoredRow } from "./seo-workflow-state";

const word = (value: string | null) => (value ?? "").normalize("NFKC").trim().replace(/\s+/gu, " ").toLowerCase();
const content = (task: WorkflowTask) => ["blog", "landing", "cluster"].includes(task.kind) && task.capacityClass !== "authorized_hotspot_extra";
const execution = new Set(["ready", "drafting", "review_pending", "approved", "published", "verified", "observing"]);
export function quarterContentMutationTasks(kind: string, record: { id: string }, all: WorkflowStoredRow[]): WorkflowTask[] {
  if (kind === "task") { const task = record as WorkflowTask; return execution.has(task.status) && content(task) ? [task] : []; }
  if (kind !== "plan" || !isExecutableWorkflowPlan((record as WorkflowPlan).status)) return [];
  const ids = new Set((record as WorkflowPlan).taskIds);
  return all.filter(row => row.kind === "task" && ids.has(row.record.id)).map(row => row.record as WorkflowTask).filter(content);
}

/** Quarterly membership gates new routine production, never historical original
 * commitments, maintenance, research or separately authorized hotspot work. */
export function quarterContentProblems(tasks: WorkflowTask[], strategy: GrowthStrategy, all: WorkflowStoredRow[]): string[] {
  const committed = new Set(all.filter(row => row.kind === "plan").flatMap(row => {
    const plan = row.record as WorkflowPlan;
    return isExecutableWorkflowPlan(plan.status) ? plan.taskIds : plan.committedTaskIds ?? [];
  }));
  const fresh = tasks.filter(content).filter(task => {
    const original = all.find(row => row.kind === "task" && row.record.id === task.id)?.record as WorkflowTask | undefined;
    const sameOriginal = original && ["siteDomain", "topicId", "keywordId", "keyword", "country", "language", "kind", "dueAt"].every(key => original[key as keyof WorkflowTask] === task[key as keyof WorkflowTask]);
    const published = all.some(row => {
      if (row.kind !== "publication") return false;
      const publication = row.record as WorkflowPublication;
      return publication.taskId === task.id && publication.status === "verified" && publication.siteDomain === task.siteDomain
        && publication.pageUrl === task.pageUrl && publication.language === task.language && publication.contentVersion === task.contentVersion;
    });
    return !(sameOriginal && (committed.has(task.id) || published));
  });
  if (!fresh.length) return [];
  const targets = strategy.baseline?.targets ?? [];
  const quarter = [...(strategy.quarterPlanningHistory ?? []), ...(strategy.quarterPlanning ? [strategy.quarterPlanning] : [])]
    .filter(row => row.approval?.hash === row.hash).sort((a, b) => b.revision - a.revision)[0];
  const frozen = new Set(targets.map(target => target.id));
  if (!strategy.baseline || targets.length !== 1600 || new Set(targets.map(target => word(target.keyword))).size !== 1600
    || quarter?.plan.version !== "quarter-planning-v2" || quarter.plan.targetIds.length !== 1600 || quarter.plan.targetIds.some(id => !frozen.has(id))) {
    return ["季度1600词尚未核定并审核冻结；常规新博客和页面不得用全量正式池或扩词结果代替季度成员，原已排任务与维护继续保留"];
  }
  return fresh.flatMap(task => targets.some(target => {
    const identity = growthResolvedIdentity(strategy, target);
    return identity.country && identity.language && target.site === task.siteDomain && target.topicId === task.topicId && target.keywordId === task.keywordId && target.keywordId
      && word(target.keyword) === word(task.keyword) && identity.country === task.country && identity.language === task.language;
  }) ? [] : [`任务${task.id}的原词、话题、站点及国家语种不在已审季度成员中；先研究或经独立热点流程，不自动进入常规制作排期`]);
}
