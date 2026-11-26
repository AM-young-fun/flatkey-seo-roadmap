import "server-only";
import { prisma } from "@/lib/prisma";
import { WorkflowError, workflowHash, type WorkflowActor } from "@/lib/seo-workflow-state";
import type { WorkflowPlan, WorkflowRecord } from "@/lib/seo-workflow";
import { buildGrowthHotspotView } from "@/lib/growth-hotspots";
import { HOTSPOT_CONFIRMED_REVIEW_STATUS, HOTSPOT_KEYWORD_CONFIRMED, growthHotspotAdmissionSchema, prepareHotspotAdmission, prepareHotspotKeywordConfirmation, rawWorkflowRecord, hotspotTaskMutation, hotspotPlanMutation, preservedHotspotTask, preservedHotspotPlan, type GrowthHotspotAdmissionCommand, type HotspotAdmissionContext } from "@/lib/growth-hotspot-admission";
import { assertGrowthDirectionScope } from "@/lib/growth-strategy";
import { loadGrowthStrategy, readGrowthStrategy } from "./growth-strategy";
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
function hotspotKeywordAuditId(command: GrowthHotspotAdmissionCommand, taskId: string, keywordId: string) {
  return "hotspot-keyword:" + workflowHash([taskId, keywordId, command.directionId, command.revision]);
}

/** Resume an exact approved confirmation from the normal persisted member and
 * its immutable audit, even while a broader target projection is incomplete. */
async function readConfirmedKeywordTask(command: GrowthHotspotAdmissionCommand | undefined,
  workflow: HotspotAdmissionContext["workflow"], strategy: HotspotAdmissionContext["strategy"], now: Date) {
  if (!command?.confirmOriginalKeyword) return undefined;
  const task = workflow.tasks.find(row => row.id === command.taskIds[0]);
  if (!task?.keywordId || !task.topicId || !task.keyword || !task.country || !task.language
    || task.directionId !== command.directionId || !["planned", "ready"].includes(task.status)) return undefined;
  const link = { siteDomain: task.siteDomain, keywordId: task.keywordId };
  const direction = strategy.directions.find(row => row.id === command.directionId);
  if (!direction?.decision || direction.revision !== command.revision) return undefined;
  assertGrowthDirectionScope(strategy, task, now);
  const [member, audit] = await Promise.all([
    prisma.siteKeyword.findUnique({ where: { siteDomain_keywordId: link }, select: {
      active: true, pool: true, reviewStatus: true, topicId: true, keyword: { select: { text: true, active: true } },
    } }),
    prisma.keywordCurationAudit.findUnique({ where: { id: hotspotKeywordAuditId(command, task.id, task.keywordId) } }),
  ]);
  if (member?.reviewStatus !== HOTSPOT_CONFIRMED_REVIEW_STATUS) return undefined;
  const fail = (part: string): never => {
    throw new WorkflowError("hotspot_confirmation_readback_conflict", `已确认原词的${part}与当前原任务不一致`, 409);
  };
  if (!member.active || !member.keyword.active || member.keyword.text !== task.keyword || member.topicId !== task.topicId
    || member.pool !== "FORMAL") return fail("本站正式成员身份");
  if (!audit || audit.siteDomain !== task.siteDomain || audit.restoredAt || audit.status !== HOTSPOT_KEYWORD_CONFIRMED) return fail("正式成员审核回执");
  if (audit.payloadHash !== workflowHash(command)) return fail("审核请求版本");
  const expectedMember = { ...link, topicId: task.topicId, pool: "FORMAL", reviewStatus: HOTSPOT_CONFIRMED_REVIEW_STATUS };
  const expectedDecision = {
    kind: "hotspot-keyword-confirmation", actor: "human", taskId: task.id, directionId: direction.id,
    revision: direction.revision, keyword: task.keyword, country: task.country, language: task.language,
  };
  if (workflowHash(audit.after) !== workflowHash([expectedMember])) return fail("带版本的正式成员快照");
  if (!audit.summary || typeof audit.summary !== "object"
    || Object.entries(expectedDecision).some(([key, value]) => (audit.summary as Record<string, unknown>)[key] !== value)) return fail("市场语种或人审范围");
  const summary = audit.summary as Record<string, unknown>;
  if (summary.researchHash !== undefined && summary.researchHash !== workflowHash(task.researchReview)) return fail("原研究版本哈希");
  return task.id;
}

async function readAdmissionContext(localPreview: boolean, now: Date, command?: GrowthHotspotAdmissionCommand): Promise<HotspotAdmissionContext> {
  const [strategy, workspace, workflow, planRows, leases] = await Promise.all([
    loadGrowthStrategy(localPreview), loadGrowthDashboardWorkspace(localPreview, now), loadWorkflowSnapshot({ allHistory: true }, localPreview),
    localPreview ? Promise.resolve([]) : prisma.seoWorkflowRecord.findMany({ where: { kind: "plan", status: { in: ["scheduled", "reviewed"] } }, select: { payload: true } }),
    localPreview ? Promise.resolve([]) : prisma.seoWorkflowLease.findMany({ where: { status: "running", leaseUntil: { gt: now } }, select: { runId: true, status: true, stage: true, scheduledFor: true, leaseUntil: true } }),
  ]);
  const plans = planRows.map(row => row.payload as unknown as WorkflowPlan);
  if (localPreview && workflow.plan) plans.push(workflow.plan);
  const confirmedKeywordTaskId = localPreview ? undefined : await readConfirmedKeywordTask(command, workflow, strategy, now);
  return { strategy, workspace, workflow, plans, confirmedKeywordTaskId, leases: leases.map(lease => ({ ...lease, leaseUntil: lease.leaseUntil.toISOString(), scheduledFor: lease.scheduledFor.toISOString() })) };
}
function admissionStore(localPreview: boolean, now: Date, command?: GrowthHotspotAdmissionCommand): HotspotAdmissionStore {
  return { read: () => readAdmissionContext(localPreview, now, command), save: (request, actor) => saveWorkflowMutation(request, actor, localPreview) };
}
export async function saveGrowthHotspotAdmission(raw: unknown, actor: WorkflowActor, localPreview = false, now = new Date()) {
  if (actor !== "human") throw new WorkflowError("human_hotspot_admission_required", "热点额外目标登记只接受已登录用户同源操作", 403);
  const command = growthHotspotAdmissionSchema.parse(raw);
  const confirmation = command.confirmOriginalKeyword
    ? await confirmHotspotKeyword(command, localPreview, now)
    : null;
  return { ...await runGrowthHotspotAdmission(command, actor, admissionStore(localPreview, now, command), now), ...(confirmation ? { keywordConfirmation: confirmation } : {}) };
}

async function confirmHotspotKeyword(command: GrowthHotspotAdmissionCommand, localPreview: boolean, now: Date) {
  if (localPreview) throw new WorkflowError("hotspot_confirmation_production_required", "原词确认须使用当前生产任务和词库", 403);
  const context = await readAdmissionContext(false, now, command);
  const prepared = prepareHotspotKeywordConfirmation(context, command, now);
  if (!prepared.task || !prepared.candidate) throw new WorkflowError("hotspot_keyword_not_ready", prepared.reason, 409);
  const { task, candidate } = prepared;
  const siteDomain = task.siteDomain, keywordId = task.keywordId!, topicId = task.topicId!;
  const auditId = hotspotKeywordAuditId(command, task.id, keywordId);
  const identity = { siteDomain, keywordId };
  const confirmed = await prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('flatkey-seo-workflow-v1'))`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`seo-import:${siteDomain}`}))`;
    const stored = await tx.seoWorkflowRecord.findFirst({ where: { kind: "task", recordId: task.id }, select: { version: true } });
    const state = await readGrowthStrategy(tx);
    const direction = state.directions.find(row => row.id === command.directionId);
    if (stored?.version !== task.version || direction?.revision !== command.revision) {
      throw new WorkflowError("hotspot_confirmation_changed", "原任务或已批准方向版本已变化，请重读后再确认", 409);
    }
    assertGrowthDirectionScope(state, task, new Date());
    const member = await tx.siteKeyword.findUnique({
      where: { siteDomain_keywordId: identity },
      select: { active: true, pool: true, reviewStatus: true, curationId: true, topicId: true,
        keyword: { select: { active: true, text: true } },
        topic: { select: { active: true, sites: { select: { siteDomain: true } } } } },
    });
    if (!member?.active || !member.keyword.active || member.keyword.text !== task.keyword || member.topicId !== topicId
      || !member.topic?.active || !member.topic.sites.some(site => site.siteDomain === siteDomain)) {
      throw new WorkflowError("hotspot_keyword_identity_changed", "本站原词或主话题已变化，请重新核对", 409);
    }
    if (member.pool === "FORMAL") return { ...identity, topicId, pool: member.pool, changed: false };
    if (member.pool !== "RESEARCH" || member.reviewStatus !== "UNREVIEWED" || member.curationId) {
      throw new WorkflowError("hotspot_keyword_review_changed", "仅确认仍启用且未被其他审核处置的本站研究原词", 409);
    }
    const updated = await tx.siteKeyword.updateMany({
      where: { ...identity, active: true, topicId, pool: "RESEARCH", reviewStatus: "UNREVIEWED", curationId: null },
      data: { pool: "FORMAL", reviewStatus: HOTSPOT_CONFIRMED_REVIEW_STATUS },
    });
    if (updated.count !== 1) throw new WorkflowError("hotspot_keyword_conflict", "研究原词在确认时发生变化", 409);
    await tx.keywordCurationAudit.create({ data: {
      id: auditId, siteDomain, status: HOTSPOT_KEYWORD_CONFIRMED, payloadHash: workflowHash(command),
      before: [{ ...identity, topicId, pool: member.pool, reviewStatus: member.reviewStatus }],
      after: [{ ...identity, topicId, pool: "FORMAL", reviewStatus: HOTSPOT_CONFIRMED_REVIEW_STATUS }],
      summary: { kind: "hotspot-keyword-confirmation", taskId: task.id, directionId: direction.id, revision: direction.revision,
        keywordId, topicId, keyword: task.keyword, country: task.country, language: task.language, actor: "human",
        approvedAt: direction.decision!.decidedAt, researchHash: workflowHash(task.researchReview) },
    } });
    return { ...identity, topicId, pool: "FORMAL", changed: true, auditId };
  });
  const readback = await prisma.siteKeyword.findUnique({
    where: { siteDomain_keywordId: identity }, select: { active: true, pool: true, topicId: true },
  });
  if (!readback?.active || readback.pool !== "FORMAL" || readback.topicId !== topicId) {
    throw new WorkflowError("hotspot_keyword_readback_failed", "正式原词读回未核实，原计划暂不追加", 503);
  }
  if (task.status !== candidate.status || task.workflowContract !== candidate.workflowContract || task.capacityClass !== candidate.capacityClass) {
    const record = rawWorkflowRecord(candidate);
    await saveWorkflowMutation({ action: "save_task", expectedVersion: task.version,
      requestId: "hotspot-keyword-ready:" + workflowHash([auditId, task.version, record]), record }, "human", false);
  }
  return confirmed;
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
