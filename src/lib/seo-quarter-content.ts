import { isSeoWorkday } from "./seo-workday";
import { seoToday, workWeekDateRange } from "./seo-date-range";
import { isSeoExtraCapacity } from "./seo-extra-capacity";
import { growthResolvedIdentity, type GrowthStrategy } from "./growth-strategy";
import { isExecutableWorkflowPlan, type WorkflowPlan, type WorkflowPublication, type WorkflowTask } from "./seo-workflow";
import type { WorkflowStoredRow } from "./seo-workflow-state";
import { hasQuarterDelivery, QUARTER_NEW_WORD_COUNT, QUARTER_NEW_WORD_VERSION } from "./growth-quarter-calendar";
import { CLOSEOUT_MARKET_POLICY, closeoutMarketShares } from "./seo-quarter-targets";
import { FLATKEY_LANDING_START } from "./seo-growth-markets";
import { SATELLITE_QUARTER_SITES, satelliteProductionTask, satelliteQuarterBound, satelliteQuarterTaskMember } from "./satellite-quarter";

const word = (value: string | null) => (value ?? "").normalize("NFKC").trim().replace(/\s+/gu, " ").toLowerCase();
const content = (task: Pick<WorkflowTask, "kind" | "capacityClass">) => ["blog", "landing", "cluster"].includes(task.kind) && !isSeoExtraCapacity(task.capacityClass);
const execution = new Set(["ready", "drafting", "review_pending", "approved", "published", "verified", "observing"]);
const newFlatkeyLanding = (task: WorkflowTask) => task.kind === "landing" && task.siteDomain === "flatkey.ai" && seoToday(new Date(task.dueAt)) >= FLATKEY_LANDING_START;

export function capacityPlanAcceptsResearch(task: Omit<WorkflowTask, "version" | "recordedAt" | "updatedAt">, plan: WorkflowPlan, quarterPlanHash: string) {
  const range = workWeekDateRange(seoToday(new Date(task.dueAt)));
  const review = task.researchReview;
  if (!content(task) || !review || !task.topicId
    || Date.parse(review.reviewedAt) > Date.parse(task.dueAt) || Date.parse(review.duplicateCheckedAt) > Date.parse(task.dueAt)
    || plan.quarterlyContent?.marketPolicy !== CLOSEOUT_MARKET_POLICY || plan.quarterlyContent.quarterPlanHash !== quarterPlanHash
    || !isExecutableWorkflowPlan(plan.status) || !("executionRange" in plan.targets)
    || plan.targets.executionRange.start !== range.start || plan.targets.executionRange.end !== range.end) return false;
  if (task.siteDomain === "flatkey.ai") return (task.kind === "blog" || task.kind === "landing")
    && closeoutMarketShares.some(market => task.country === market.country && task.language === market.language);
  return satelliteProductionTask(task) && task.country === "US" && task.language === "en";
}

export function quarterContentMutationTasks(kind: string, record: { id: string }, all: WorkflowStoredRow[]): WorkflowTask[] {
  if (kind === "task") { const task = record as WorkflowTask; return execution.has(task.status) && content(task) ? [task] : []; }
  if (kind !== "plan" || !isExecutableWorkflowPlan((record as WorkflowPlan).status)) return [];
  const ids = new Set((record as WorkflowPlan).taskIds);
  return all.filter(row => row.kind === "task" && ids.has(row.record.id)).map(row => row.record as WorkflowTask).filter(content);
}

/** Quarterly membership gates new routine production, never historical original
 * commitments, maintenance, research or separately authorized hotspot work. */
export function quarterContentProblems(tasks: WorkflowTask[], strategy: GrowthStrategy, all: WorkflowStoredRow[], incomingPlan?: WorkflowPlan): string[] {
  const versions = [...(strategy.quarterPlanningHistory ?? []), ...(strategy.quarterPlanning ? [strategy.quarterPlanning] : [])]
    .filter(row => row.approval?.hash === row.hash).sort((a, b) => b.revision - a.revision);
  const quarter = strategy.baseline?.planHash ? versions.find(row => row.hash === strategy.baseline?.planHash) : versions[0];
  const reserved = new Set(versions.flatMap(row => row.plan.reservedOriginalTaskIds));
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
    return !(sameOriginal && (committed.has(task.id) || published || !newFlatkeyLanding(task) && reserved.has(task.id)));
  });
  if (!fresh.length) return [];
  const targets = strategy.baseline?.targets ?? [];

  const frozen = new Set(targets.map(target => target.id));
  const modern = quarter?.plan.version === QUARTER_NEW_WORD_VERSION;
  const count = modern ? QUARTER_NEW_WORD_COUNT : 1600;
  if (!quarter) {
    return [`季度${count}词尚未核定并冻结；常规新博客和页面须沿有效季度成员和原排期进入制作`];
  }
  const frozenValid = strategy.baseline && targets.length === count && new Set(targets.map(target => word(target.keyword))).size === count
    && (modern || quarter.plan.version === "quarter-planning-v2") && quarter.plan.targetIds.length === count
    && quarter.plan.targetIds.every(id => frozen.has(id));
  const calendar = new Map(quarter.plan.calendar?.map(row => [row.targetId, row]));
  const allTasks = [...all.flatMap(row => row.kind === "task" ? [row.record as WorkflowTask] : []), ...tasks];
  const satellite = satelliteQuarterBound(strategy);
  const capacityPlans = [...(incomingPlan ? [incomingPlan] : []), ...all.flatMap(row => row.kind === "plan" ? [row.record as WorkflowPlan] : [])];
  const approvedCapacity = modern && strategy.baseline?.planHash === quarter.hash;
  const canSchedule = (task: WorkflowTask, earliestDeliveryDate: string) => {
    const dueAt = new Date(task.dueAt), dueDay = seoToday(dueAt), review = task.researchReview;
    return task.workflowContract === "growth-v1.5" && execution.has(task.status) && Boolean(task.research?.intent && review?.evidence.length
      && review.keyword === task.keyword && review.country === task.country && review.language === task.language)
      && isSeoWorkday(dueAt) && dueDay >= earliestDeliveryDate && dueDay <= quarter.plan.executionEnd
      && !allTasks.some(other => other.id !== task.id && !other.deletedAt && content(other) && other.siteDomain === task.siteDomain
        && other.country === task.country && other.language === task.language && word(other.keyword) === word(task.keyword));
  };
  const valid = (task: WorkflowTask) => {
    // Formal site/word membership is checked separately by the workflow write.
    if (approvedCapacity && capacityPlans.some(plan => capacityPlanAcceptsResearch(task, plan, quarter.hash))) {
      return Boolean(task.keywordId && canSchedule(task, quarter.plan.executionStart));
    }
    if (!frozenValid) return false;
    if (satellite && SATELLITE_QUARTER_SITES.some(site => site === task.siteDomain)) {
      const member = satelliteQuarterTaskMember(task, satellite);
      return Boolean(member && canSchedule(task, member.researchDate));
    }
    return targets.some(target => {
      if (newFlatkeyLanding(task) && !modern) return false;
      const identity = growthResolvedIdentity(strategy, target);
      const matches = identity.country && identity.language && target.site === task.siteDomain && target.topicId === task.topicId && target.keywordId === task.keywordId && target.keywordId
        && word(target.keyword) === word(task.keyword) && identity.country === task.country && identity.language === task.language;
      if (!matches || !modern) return matches;
      const slot = calendar.get(target.id);
      if (!slot) return false;
      if (hasQuarterDelivery(slot)) return slot.primary && slot.kind === (task.kind === "blog" ? "blog" : "cluster_landing")
        && slot.deliveryDate === seoToday(new Date(task.dueAt));
      // Flatkey can research any frozen word early. The calendar remains the
      // research plan, and completed research and deduplication precede delivery.
      const review = task.researchReview;
      return Boolean(review && Date.parse(review.reviewedAt) <= Date.parse(task.dueAt)
        && Date.parse(review.duplicateCheckedAt) <= Date.parse(task.dueAt)
        && canSchedule(task, quarter.plan.executionStart));
    });
  };
  return fresh.flatMap(task => valid(task) ? [] : [`任务${task.id}须通过同市场原词研究并进入有效季度制作周，或符合原季度词交付资格；同意图次词共用主词原任务`]);
}
