import "server-only";
import { prisma } from "@/lib/prisma";
import { WorkflowError, type WorkflowActor } from "@/lib/seo-workflow-state";
import type { WorkflowPlan, WorkflowRecord } from "@/lib/seo-workflow";
import { buildGrowthHotspotView } from "@/lib/growth-hotspots";
import { growthHotspotAdmissionSchema, prepareHotspotAdmission, hotspotTaskMutation, hotspotPlanMutation, preservedHotspotTask, preservedHotspotPlan, type GrowthHotspotAdmissionCommand, type HotspotAdmissionContext } from "@/lib/growth-hotspot-admission";
import { loadGrowthStrategy } from "./growth-strategy";
import { loadGrowthDashboardWorkspace } from "./growth-workspace";
import { loadWorkflowSnapshot, saveWorkflowMutation } from "./seo-workflow";

export type HotspotAdmissionReceipt = { taskId: string; status: "scheduled" | "reused" | "pending"; taskRegistered: boolean; planAppended: boolean; planId: string | null; reason: string };
export type HotspotAdmissionStore = { read: () => Promise<HotspotAdmissionContext>; save: (request: ReturnType<typeof hotspotTaskMutation> | ReturnType<typeof hotspotPlanMutation>, actor: "human") => Promise<{ record: WorkflowRecord }> };
const reason = (error: unknown) => error instanceof WorkflowError ? error.message : "正常保存或读回未完成，请按原任务重试；未盲目重发或改排期";

/** Task registration and original-plan append are separate CAS operations.
 * A failed second step leaves the registered original task visible as pending. */
export async function runGrowthHotspotAdmission(raw: unknown, actor: WorkflowActor, store: HotspotAdmissionStore, now = new Date(), budgetMs = 45_000) {
  if (actor !== "human") throw new WorkflowError("human_hotspot_admission_required", "热点额外目标登记只接受已登录用户同源操作，采集器不能冒充human", 403);
  const command = growthHotspotAdmissionSchema.parse(raw), items: HotspotAdmissionReceipt[] = [], started = Date.now();
  for (const taskId of command.taskIds) {
    let registered = false, planId: string | null = null;
    const pending = (message: string) => items.push({ taskId, status: "pending", taskRegistered: registered, planAppended: false, planId, reason: message });
    if (Date.now() - started >= budgetMs) { pending("本次正常核验时间已到，保留原任务与原交付日，后续从本条重试"); continue; }
    try {
      const context = await store.read(), decision = prepareHotspotAdmission(context, command, taskId, now);
      registered = decision.task?.capacityClass === "authorized_hotspot_extra"; planId = decision.planId;
      if (decision.status === "pending") { pending(decision.reason); continue; }
      if (decision.status === "reuse") { items.push({ taskId, status: "reused", taskRegistered: registered, planAppended: false, planId, reason: decision.reason }); continue; }
      const originalTask = decision.task!;
      if (!registered) {
        let failure: unknown;
        try { await store.save(hotspotTaskMutation(originalTask, command), "human"); } catch (error) { failure = error; }
        // A timeout can follow a committed write: read before deciding, never
        // immediately repeat a mutation with a new operation ID.
        const readback = await store.read(), actual = readback.workflow.tasks.find(task => task.id === taskId);
        if (!actual || !preservedHotspotTask(originalTask, actual)) { pending(failure ? reason(failure) : "原任务登记后读回未对平，未继续追加计划"); continue; }
        registered = true;
      }
      const latest = await store.read(), current = prepareHotspotAdmission(latest, command, taskId, now);
      planId = current.planId;
      if (current.status === "reuse") { items.push({ taskId, status: "reused", taskRegistered: registered, planAppended: false, planId, reason: current.reason }); continue; }
      if (current.status !== "admit" || !current.plan) { pending(current.reason); continue; }
      const originalPlan = current.plan;
      let failure: unknown;
      try { await store.save(hotspotPlanMutation(originalPlan, taskId, command), "human"); } catch (error) { failure = error; }
      const readback = await store.read(), actualPlan = readback.plans.find(plan => plan.id === originalPlan.id), actualTask = readback.workflow.tasks.find(task => task.id === taskId);
      if (!actualPlan || !actualTask || !preservedHotspotPlan(originalPlan, actualPlan, taskId) || !preservedHotspotTask(originalTask, actualTask)) { pending(failure ? reason(failure) : "原计划追加后读回未对平，已登记原任务保持pending，未新建计划"); continue; }
      items.push({ taskId, status: "scheduled", taskRegistered: true, planAppended: true, planId: originalPlan.id, reason: "原任务仅登记热点额外容量，已追加并读回当周原计划；原ID、来源、交付日及原计划targets均保留" });
    } catch (error) { pending(reason(error)); }
  }
  return { version: "growth-hotspot-admission-v1" as const, directionId: command.directionId, revision: command.revision, items, createdTasks: 0, createdPlans: 0, paidRequests: 0 };
}
async function readAdmissionContext(localPreview: boolean, now: Date): Promise<HotspotAdmissionContext> {
  const [strategy, workspace, workflow, planRows, leases] = await Promise.all([
    loadGrowthStrategy(localPreview), loadGrowthDashboardWorkspace(localPreview, now), loadWorkflowSnapshot({ allHistory: true }, localPreview),
    localPreview ? Promise.resolve([]) : prisma.seoWorkflowRecord.findMany({ where: { kind: "plan", status: { in: ["scheduled", "reviewed"] } }, select: { payload: true } }),
    localPreview ? Promise.resolve([]) : prisma.seoWorkflowLease.findMany({ where: { status: "running", leaseUntil: { gt: now } }, select: { runId: true, status: true, leaseUntil: true } }),
  ]);
  const plans = planRows.map(row => row.payload as unknown as WorkflowPlan);
  if (localPreview && workflow.plan) plans.push(workflow.plan);
  return { strategy, workspace, workflow, plans, leases: leases.map(lease => ({ ...lease, leaseUntil: lease.leaseUntil.toISOString() })) };
}
function admissionStore(localPreview: boolean, now: Date): HotspotAdmissionStore {
  return { read: () => readAdmissionContext(localPreview, now), save: (request, actor) => saveWorkflowMutation(request, actor, localPreview) };
}
export async function saveGrowthHotspotAdmission(raw: unknown, actor: WorkflowActor, localPreview = false, now = new Date()) {
  return runGrowthHotspotAdmission(raw, actor, admissionStore(localPreview, now), now);
}
/** This is invoked only after an exact human direction approval was saved.
 * Ordinary attribution directions do not produce hotspot candidates. */
export async function admitApprovedGrowthDirection(directionId: string, revision: number, actor: WorkflowActor, localPreview = false, now = new Date()) {
  if (actor !== "human") throw new WorkflowError("human_hotspot_admission_required", "只有真实human操作可登记热点额外工作", 403);
  const store = admissionStore(localPreview, now), context = await store.read();
  const view = buildGrowthHotspotView(context.strategy, context.workflow, context.plans, now);
  const relevant = view.items.filter(item => item.directionId === directionId);
  if (!relevant.length) return { status: "not_applicable", reason: "该方向没有已保存的热点源证据，未触发热点排期" };
  const ids = new Set(relevant.flatMap(item => item.taskIds));
  const taskIds = context.workflow.tasks.filter(task => ids.has(task.id) && task.kind === "blog" && task.directionId === directionId).map(task => task.id);
  if (!taskIds.length) return { status: "pending", reason: "热点方向批准已保存；尚无可复用的原博客制作任务，先沿原研究流程补齐，不转换研究任务或新造替代ID" };
  const command: GrowthHotspotAdmissionCommand = { directionId, revision, taskIds: taskIds.slice(0, 100) };
  return runGrowthHotspotAdmission(command, actor, store, now);
}
