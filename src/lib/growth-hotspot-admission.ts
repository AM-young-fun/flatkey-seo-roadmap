import { seoExtraCapacityProblem } from "./seo-extra-capacity";
export { seoExtraCapacityProblem as hotspotCapacityProblem } from "./seo-extra-capacity";
import { z } from "zod";
import { activeGrowthHotspot, buildGrowthHotspotView } from "./growth-hotspots";
import { assertGrowthDirectionScope, type GrowthStrategy } from "./growth-strategy";
import type { GrowthWorkspace } from "./growth-types";
import { workflowHash } from "./seo-workflow-state";
import { isExecutableWorkflowPlan, type WorkflowPlan, type WorkflowSnapshot, type WorkflowTask, type WorkflowRun } from "./seo-workflow";
import { isSeoWorkday } from "./seo-workday";

export const growthHotspotAdmissionSchema = z.object({
  directionId: z.string().trim().min(1).max(200), revision: z.number().int().positive(),
  taskIds: z.array(z.string().min(1).max(200)).min(1).max(100),
  confirmOriginalKeyword: z.literal(true).optional(),
}).strict().superRefine((value, context) => {
  if (new Set(value.taskIds).size !== value.taskIds.length) context.addIssue({ code: "custom", path: ["taskIds"], message: "原任务ID不能重复" });
  if (value.confirmOriginalKeyword && value.taskIds.length !== 1) context.addIssue({ code: "custom", path: ["taskIds"], message: "每次只确认一篇原热点博客的原词" });
});
export type GrowthHotspotAdmissionCommand = z.infer<typeof growthHotspotAdmissionSchema>;
export type HotspotLease = { runId: string; status: string; leaseUntil: string };
export type HotspotAdmissionContext = { strategy: GrowthStrategy; workspace: GrowthWorkspace; workflow: WorkflowSnapshot; plans: WorkflowPlan[]; leases: HotspotLease[] };
export type HotspotAdmissionDecision = { taskId: string; status: "pending" | "reuse" | "admit"; reason: string; planId: string | null; task: WorkflowTask | null; plan: WorkflowPlan | null };
const day = (stamp: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(new Date(stamp));
const word = (value: string | null) => value?.normalize("NFKC").trim().toLowerCase().replace(/\s+/g, " ") ?? "";

/** Unknown leases are not guessed away. Known unrelated task runs can continue. */
export function hotspotLeaseConflict(taskIds: string[], runs: Pick<WorkflowRun, "id" | "status" | "taskIds">[], leases: HotspotLease[], now = new Date()): string | null {
  const ids = new Set(taskIds);
  if (runs.some(run => run.status === "running" && run.taskIds.some(id => ids.has(id)))) return "原任务已有进行中的运行，保留原租约和执行状态，不登记或替换在途任务";
  for (const lease of leases) {
    if (lease.status !== "running" || Date.parse(lease.leaseUntil) <= now.getTime()) continue;
    const run = runs.find(row => row.id === lease.runId);
    if (!run || !run.taskIds.length || run.taskIds.some(id => ids.has(id))) return "存在有效租约且无法排除本原任务，待原运行读回后重试，不抢占或推断租约归属";
  }
  return null;
}
export function completeHotspotTaskResearch(task: WorkflowTask, now = new Date()): boolean {
  const review = task.researchReview;
  return Boolean(task.workflowContract === "growth-v1.5" && task.research?.evidence.length && task.research.businessValue !== null
    && (task.research.volume !== null && task.research.volume >= 10 && task.research.kd !== null && task.research.kd < 30 || task.research.exceptionReason)
    && review && review.country === task.country && review.language === task.language && review.keyword === task.keyword
    && new Set(review.serpResults).size === 10 && new Set(review.openedResults).size >= 5
    && review.serpResults.slice(0, 5).every(url => review.openedResults.includes(url)) && review.openedResults.every(url => review.serpResults.includes(url))
    && review.evidence.length && Object.values(review.quality).every(value => value.trim().length >= 12)
    && review.duplicateCheckedAt && Date.parse(review.reviewedAt) <= now.getTime() && Date.parse(review.duplicateCheckedAt) <= now.getTime());
}
export function prepareHotspotAdmission(context: HotspotAdmissionContext, command: GrowthHotspotAdmissionCommand, taskId: string, now = new Date()): HotspotAdmissionDecision {
  const task = context.workflow.tasks.find(task => task.id === taskId) ?? null;
  const pending = (reason: string, plan: WorkflowPlan | null = null): HotspotAdmissionDecision => ({ taskId, status: "pending", reason, planId: plan?.id ?? null, task, plan });
  const direction = context.strategy.directions.find(direction => direction.id === command.directionId);
  if (!direction || direction.revision !== command.revision || direction.decision?.revision !== command.revision || direction.decision.actor !== "human" || direction.decision.decision !== "approve") return pending("必须保留当前确切版本的人审方向批准；未用旧版本或方案批准代替");
  if (!task || task.deletedAt || task.kind !== "blog" || !["flatkey.ai", "modelfit.cc"].includes(task.siteDomain) || task.channel && task.channel !== "website" || task.language === "ru") return pending("缺少范围内的真实原博客任务；不转换研究类型、不造替代任务或俄语源文");
  if (task.directionId !== direction.id || task.experimentId !== direction.experimentId) return pending("原任务尚未绑定该确切方向与实验，先沿原ID补齐真实关联");
  try { assertGrowthDirectionScope(context.strategy, task, now); } catch { return pending("原任务站点、话题、国家语种、类型或有效期不在当前人审方向范围"); }
  const view = buildGrowthHotspotView(context.strategy, context.workflow, context.plans, now);
  const item = view.items.find(item => item.directionId === direction.id && item.taskIds.includes(task.id));
  if (!item || Date.parse(item.validUntil) <= now.getTime()) return pending("未找到仍在7天有效期内的同一热点官方与独立需求证据，普通归因方向不自动变成热点");
  const sourceTasks = context.workflow.tasks.filter(row => item.taskIds.includes(row.id));
  if (!sourceTasks.some(source => activeGrowthHotspot(source, now))) return pending("热点源证据已过期或无法独立对平，须重新核验，不自动刷新事件时间");
  const member = context.workspace.targets.find(target => target.membership === "formal" && target.sourceActive !== false && target.keywordId === task.keywordId && target.site === task.siteDomain && target.topicId === task.topicId && target.country === task.country && target.language === task.language && word(target.keyword) === word(task.keyword));
  if (!member || member.languageStatus !== "match" || !context.workspace.topics.some(topic => topic.site === task.siteDomain && topic.topicId === task.topicId)) return pending("原词、原国家语种与本站真实TopicMap正式成员尚未核齐，不借用发现词或跨语种排名");
  const dueDay = day(task.dueAt);
  if (dueDay < view.businessWeek.start || dueDay > view.businessWeek.end || !isSeoWorkday(new Date(task.dueAt))) return pending("原交付日不在本北京时间周五至周四的实际工作日内，保留原日期并报告冲突，不擅挪下周");
  if (Date.parse(task.dueAt) < Date.parse(item.eventAt) || Date.parse(task.dueAt) > Date.parse(item.validUntil)) {
    return pending("原交付时间须在事件发生或升温后 7 天内，保留原交付日并记录冲突");
  }
  if (!completeHotspotTaskResearch(task, now) || !item.researchComplete || Date.parse(task.researchReview!.reviewedAt) < Date.parse(item.eventAt) || Date.parse(task.researchReview!.duplicateCheckedAt) < Date.parse(item.eventAt)) return pending("原博客完整研究、Top10/实际前5页、去重、六项分析或E-E-A-T尚未齐全，批准已保存，补齐后人审入口重试");
  const existing = context.plans.find(plan => isExecutableWorkflowPlan(plan.status) && plan.taskIds.includes(task.id));
  if (existing) return { taskId, status: "reuse", reason: "原任务已在正式计划，只复用原ID、容量分类、来源及交付日，不再次登记或重复追加", planId: existing.id, task, plan: existing };
  const extra = { ...task, capacityClass: "authorized_hotspot_extra" as const };
  const scheduledIds = new Set([...context.plans.filter(plan => isExecutableWorkflowPlan(plan.status)).flatMap(plan => plan.taskIds), task.id]);
  const capacityProblem = seoExtraCapacityProblem([...context.workflow.tasks.filter(row => row.id !== task.id), extra], scheduledIds, new Set([task.id]));
  if (capacityProblem) return pending(capacityProblem);
  const duplicate = context.workflow.tasks.find(other => other.id !== task.id && !other.deletedAt && other.siteDomain === task.siteDomain && other.country === task.country && other.language === task.language && ["blog", "landing", "optimization", "cluster"].includes(other.kind)
    && (task.pageUrl && other.pageUrl === task.pageUrl || other.topicId === task.topicId && word(other.keyword) === word(task.keyword)));
  if (duplicate) return pending(`同页或同意图已有关联原任务 ${duplicate.id}，先核定复用，未重复追加或新造替代任务`);
  if (task.status !== "ready") return pending("仅追加研究完整且ready的原博客任务；在途、已发布或受阻任务不改状态、不替换");
  const leaseReason = hotspotLeaseConflict([task.id], context.workflow.runs, context.leases, now); if (leaseReason) return pending(leaseReason);
  const exact = context.plans.filter(plan => isExecutableWorkflowPlan(plan.status) && "executionRange" in plan.targets && plan.targets.executionRange.start === view.businessWeek.start && plan.targets.executionRange.end === view.businessWeek.end);
  const candidates = exact.length ? exact : context.plans.filter(plan => isExecutableWorkflowPlan(plan.status) && plan.weekStart === task.weekStart && !("executionRange" in plan.targets));
  if (candidates.length !== 1) return pending(candidates.length ? "当周存在多个可用原计划，须先核定原计划，不新建第二计划或猜测归属" : "当周尚无可追加的原scheduled/reviewed正式计划，先补原计划，不新建替代调度");
  return { taskId, status: "admit", reason: "符合热点研究、人审范围、原任务及当周计划条件；分两次正常CAS登记和读回", planId: candidates[0].id, task, plan: candidates[0] };
}
export function rawWorkflowRecord<T extends WorkflowTask | WorkflowPlan>(record: T) {
  const { version: _version, updatedAt: _updatedAt, recordedAt: _recordedAt, ...raw } = record;
  void _version; void _updatedAt; void _recordedAt; return raw;
}
export function prepareHotspotKeywordConfirmation(context: HotspotAdmissionContext, command: GrowthHotspotAdmissionCommand, now: Date) {
  const task = context.workflow.tasks.find(row => row.id === command.taskIds[0]);
  const direction = context.strategy.directions.find(row => row.id === command.directionId);
  if (!command.confirmOriginalKeyword || !task || !task.id.startsWith("seo-hotspot:") || task.source !== "human"
    || !task.keywordId || !task.keyword || !task.topicId || !["planned", "ready"].includes(task.status)
    || direction?.weeklyGrowth || direction?.taskIds.length !== 1 || direction.taskIds[0] !== task.id) {
    return { task: null, reason: "仅确认用户已登记、只关联一篇原博客的热点方向和原词" };
  }
  const members = context.workspace.targets.filter(row => row.keywordId === task.keywordId && row.site === task.siteDomain
    && row.topicId === task.topicId && row.country === task.country && row.language === task.language
    && row.languageStatus === "match" && row.sourceActive === true && word(row.keyword) === word(task.keyword)
    && (row.sourcePool === "RESEARCH" || row.sourcePool === "FORMAL"));
  if (members.length !== 1) return { task: null, reason: "须核得唯一、启用且与原任务同站同话题同市场语种的原词" };
  const candidate = { ...task, workflowContract: "growth-v1.5" as const, status: "ready" as const,
    capacityClass: "authorized_hotspot_extra" as const };
  const decision = prepareHotspotAdmission({
    ...context,
    workflow: { ...context.workflow, tasks: context.workflow.tasks.map(row => row.id === task.id ? candidate : row) },
    workspace: { ...context.workspace, targets: context.workspace.targets.map(row => row === members[0] ? { ...row, membership: "formal" } : row) },
  }, command, task.id, now);
  if (decision.status === "pending") return { task: null, reason: decision.reason };
  return { task, candidate, reason: null };
}
export function hotspotTaskMutation(task: WorkflowTask, command: GrowthHotspotAdmissionCommand) {
  const record = { ...rawWorkflowRecord(task), capacityClass: "authorized_hotspot_extra" as const };
  return { requestId: `hotspot-task:${workflowHash([command.directionId, command.revision, task.id, task.version, record])}`, action: "save_task" as const, expectedVersion: task.version, record };
}
export function hotspotPlanMutation(plan: WorkflowPlan, taskId: string, command: GrowthHotspotAdmissionCommand) {
  const record = { ...rawWorkflowRecord(plan), taskIds: [...plan.taskIds, taskId] };
  return { requestId: `hotspot-plan:${workflowHash([command.directionId, command.revision, plan.id, plan.version, taskId])}`, action: "save_plan" as const, expectedVersion: plan.version, record };
}
export function preservedHotspotTask(original: WorkflowTask, actual: WorkflowTask): boolean {
  return actual.capacityClass === "authorized_hotspot_extra" && Object.entries(rawWorkflowRecord(original)).every(([key, value]) => key === "capacityClass" || workflowHash((actual as unknown as Record<string, unknown>)[key]) === workflowHash(value));
}
export function preservedHotspotPlan(original: WorkflowPlan, actual: WorkflowPlan, taskId: string): boolean {
  return actual.id === original.id && actual.taskIds.includes(taskId) && original.taskIds.every((id, index) => actual.taskIds[index] === id)
    && Object.entries(rawWorkflowRecord(original)).every(([key, value]) => ["taskIds", "committedTaskIds"].includes(key) || workflowHash((actual as unknown as Record<string, unknown>)[key]) === workflowHash(value))
    && (original.committedTaskIds ?? []).every(id => actual.committedTaskIds?.includes(id));
}
