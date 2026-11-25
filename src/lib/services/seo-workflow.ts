import { indexing404History, indexing404RunPrefix, type Indexing404Response } from "@/lib/seo-indexing-404";
import { isGrowthTopicPlaceholder } from "@/lib/seo-growth-markets";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requestRead } from "@/lib/request-read-scope";
import { WORKFLOW_SCHEMAS, ACTION_KIND, isExecutableWorkflowPlan, workflowClaimSchema, workflowMutationSchema, workflowApprovalCheckSchema, type WorkflowKind, type WorkflowRecord, type WorkflowRun, type WorkflowTask, type WorkflowPlan, type WorkflowApproval, type WorkflowPublication, type WorkflowOptimization, type WorkflowTaskDetail } from "@/lib/seo-workflow";
import { validateInternalReviewAssets } from "./seo-review-assets";
import { prepareWorkflowMutation, isCompletedGrowthEvidenceAppend, workflowHash, workflowKey, workflowSnapshot, checkWorkflowApproval, WorkflowError, type WorkflowActor, type WorkflowStoredRow } from "@/lib/seo-workflow-state";
import { syncWorkflowMarketAssignment } from "./keyword-market-assignment";
import { quarterAllocationProblems } from "@/lib/growth-quarter-planning";
import { quarterContentMutationTasks, quarterContentProblems } from "@/lib/seo-quarter-content";
import { publishedMaintenanceMutationTasks } from "@/lib/seo-published-maintenance";
import { assertPublishedMaintenanceTasks } from "./seo-published-maintenance";
import { assertGrowthDirectionScope } from "@/lib/growth-strategy";
import { timedRead } from "@/lib/read-profile";

const legacyKinds = Object.keys(WORKFLOW_SCHEMAS);
const json = (value: unknown) => value as Prisma.InputJsonValue;
type LocalState = { records: WorkflowStoredRow[]; events: { requestId: string; requestHash: string; kind: WorkflowKind; record: WorkflowRecord }[] };
function localDirectory(localPreview: boolean) {
  if (!localPreview) return null;
  const directory = process.env.SEO_WORKFLOW_PREVIEW_DIR ?? join(process.cwd(), ".local", "seo-workflow");
  if (!isAbsolute(directory)) throw new WorkflowError("configuration", "本地预览目录必须是绝对路径", 503);
  return directory;
}
async function readLocal(directory: string): Promise<LocalState> {
  try { return JSON.parse(await readFile(join(directory, "workflow.json"), "utf8")) as LocalState; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return { records: [], events: [] }; throw error; }
}
function requireDatabase() { if (!process.env.DATABASE_URL) throw new WorkflowError("storage_unavailable", "执行台账尚未接通数据库，未写入任何生产记录", 503); }

export async function loadWorkflowSnapshot(options: { week?: string; pageUrl?: string; allHistory?: boolean; operational?: boolean; workList?: boolean } = {}, localPreview = false) {
  const directory = localDirectory(localPreview);
  if (directory) {
    const rows = (await requestRead(`workflow:local:${directory}`, () => timedRead("local", () => readLocal(directory)))).records;
    return timedRead("snapshot", async () => workflowSnapshot(rows, options, "local_preview"));
  }
  requireDatabase();
  // Keep the canonical graph intact and avoid rewriting every JSON document in
  // PostgreSQL. The explicit list response is compacted after snapshot rules run.
  const rows = await requestRead("workflow:database", () => timedRead("database", () => prisma.seoWorkflowRecord.findMany({ where: { kind: { in: legacyKinds } }, select: { kind: true, payload: true }, orderBy: { updatedAt: "desc" } })));
  return timedRead("snapshot", async () => workflowSnapshot(rows.map(row => ({ kind: row.kind as WorkflowKind, record: row.payload as unknown as WorkflowRecord })), options, "database"));
}

export async function loadIndexing404History(localPreview = false): Promise<Indexing404Response> {
  const directory = localDirectory(localPreview);
  if (directory) {
    const runs = (await readLocal(directory)).records.filter(row => row.kind === "run").map(row => row.record as WorkflowRun);
    return { storage: "local_preview", observations: indexing404History(runs) };
  }
  requireDatabase();
  const rows = await prisma.seoWorkflowRecord.findMany({
    where: { kind: "run", recordId: { startsWith: indexing404RunPrefix } },
    select: { payload: true }, orderBy: { recordId: "desc" }, take: 30,
  });
  return { storage: "database", observations: indexing404History(rows.map(row => row.payload as unknown as WorkflowRun)) };
}

export async function loadWorkflowTaskDetail(taskId: string, localPreview = false): Promise<WorkflowTaskDetail> {
  const directory = localDirectory(localPreview);
  const local = directory ? (await readLocal(directory)).records : null;
  const toRecord = (row: { kind: string; payload: Prisma.JsonValue }): WorkflowStoredRow =>
    ({ kind: row.kind as WorkflowKind, record: row.payload as unknown as WorkflowRecord });
  const select = { kind: true, payload: true } as const;
  if (!local) requireDatabase();
  const taskRow = local
    ? local.find(row => row.kind === "task" && row.record.id === taskId)
    : await prisma.seoWorkflowRecord.findUnique({ where: { key: workflowKey("task", taskId) }, select }).then(row => row ? toRecord(row) : null);
  if (!taskRow || (taskRow.record as WorkflowTask).deletedAt) throw new WorkflowError("task_not_found", "找不到这条任务。请返回任务列表重新选择。", 404);
  const task = taskRow.record as WorkflowTask;
  const where: Prisma.SeoWorkflowRecordWhereInput[] = [
    { kind: "approval", payload: { path: ["items"], array_contains: [{ taskId }] } },
    { kind: { in: ["publication", "optimization"] }, payload: { path: ["taskId"], equals: taskId } },
  ];
  const dependencies = new Set(task.dependencies);
  if (dependencies.size) where.push({ kind: "task", recordId: { in: [...dependencies] } });
  const related = local ? local.filter(({ kind, record }) => {
    if (kind === "task") return dependencies.has(record.id);
    if (kind === "approval") return (record as WorkflowApproval).items.some(item => item.taskId === taskId);
    return (kind === "publication" || kind === "optimization") && (record as WorkflowPublication | WorkflowOptimization).taskId === taskId;
  }) : (await prisma.seoWorkflowRecord.findMany({ where: { OR: where }, select, orderBy: { updatedAt: "desc" } })).map(toRecord);
  const approvals = related.filter(row => row.kind === "approval").map(row => row.record as WorkflowApproval);
  const approvalIds = new Set(approvals.map(row => row.id));
  const replacements = approvalIds.size === 0 ? [] : local
    ? local.filter(row => row.kind === "approval" && (row.record as WorkflowApproval).supersedesApprovalIds?.some(id => approvalIds.has(id)))
    : (await prisma.seoWorkflowRecord.findMany({
      where: { kind: "approval", OR: [...approvalIds].map(id => ({ payload: { path: ["supersedesApprovalIds"], array_contains: [id] } })) }, select,
    })).map(toRecord);
  return {
    storage: local ? "local_preview" : "database", task,
    dependencies: related.filter(row => row.kind === "task").map(row => row.record as WorkflowTask),
    approvals: [...approvals, ...replacements.filter(row => !approvalIds.has(row.record.id)).map(row => row.record as WorkflowApproval)],
    publications: related.filter(row => row.kind === "publication").map(row => row.record as WorkflowPublication),
    optimizations: related.filter(row => row.kind === "optimization").map(row => row.record as WorkflowOptimization),
  };
}

async function saveLocalWorkflow(input: unknown, actor: WorkflowActor, directory: string) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const lock = join(directory, "write.lock");
  try { await mkdir(lock); } catch (error) { if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new WorkflowError("preview_busy", "本地预览正在写入；稍后重试。遗留锁须确认原进程结束后清理。"); throw error; }
  const temporary = join(directory, `.${randomUUID()}.json`);
  try {
    const state = await readLocal(directory), request = workflowMutationSchema.parse(input), hash = workflowHash(request);
    const prior = state.events.find(event => event.requestId === request.requestId);
    if (prior) { if (prior.requestHash !== hash) throw new WorkflowError("idempotency_conflict", "同一请求编号已用于不同内容"); return { stored: true, replay: true, kind: prior.kind, record: prior.record, storage: "local_preview" as const }; }
    const prepared = prepareWorkflowMutation(request, state.records, actor);
    const contentTasks = quarterContentMutationTasks(prepared.kind, prepared.record, state.records);
    if (contentTasks.length) {
      const { loadGrowthStrategy } = await import("./growth-strategy");
      const problems = quarterContentProblems(contentTasks, await loadGrowthStrategy(true), state.records);
      if (problems.length) throw new WorkflowError("quarter_content_membership_required", problems.join("；"));
    }
    if (prepared.kind === "plan" && (prepared.record as WorkflowPlan).strategyAllocation && isExecutableWorkflowPlan((prepared.record as WorkflowPlan).status)) {
      const { loadGrowthStrategy } = await import("./growth-strategy");
      const problems = quarterAllocationProblems(prepared.record as WorkflowPlan, await loadGrowthStrategy(true), state.records.filter(row => row.kind === "task").map(row => row.record as WorkflowTask), state.records.filter(row => row.kind === "plan").map(row => row.record as WorkflowPlan));
      if (problems.length) throw new WorkflowError("quarter_plan_approval_required", problems.join("；"));
    }
    state.records = state.records.filter(row => row.kind !== prepared.kind || row.record.id !== prepared.record.id);
    state.records.push({ kind: prepared.kind, record: prepared.record });
    state.events.push({ requestId: request.requestId, requestHash: hash, kind: prepared.kind, record: prepared.record });
    await writeFile(temporary, JSON.stringify(state), { flag: "wx", mode: 0o600 });
    await rename(temporary, join(directory, "workflow.json"));
    return { stored: true, replay: false, kind: prepared.kind, record: prepared.record, storage: "local_preview" as const };
  } finally { await rm(temporary, { force: true }); await rm(lock, { recursive: true, force: true }); }
}

export async function saveWorkflowMutation(input: unknown, actor: WorkflowActor, localPreview = false) {
  const directory = localDirectory(localPreview);
  if (directory) return saveLocalWorkflow(input, actor, directory);
  requireDatabase();
  const request = workflowMutationSchema.parse(input), requestHash = workflowHash(request);
  return prisma.$transaction(async tx => {
    // Serializes dependent plan/task/publication transitions across all instances;
    // these low-volume writes need a consistent graph, not a process-local mutex.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('flatkey-seo-workflow-v1'))`;
    const replay = await tx.seoWorkflowEvent.findUnique({ where: { requestId: request.requestId } });
    if (replay) {
      if (replay.requestHash !== requestHash) throw new WorkflowError("idempotency_conflict", "同一请求编号已用于不同内容");
      return { stored: true, replay: true, kind: replay.kind as WorkflowKind, record: replay.payload as unknown as WorkflowRecord, storage: "database" as const };
    }
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('flatkey-seo-workflow-claims-v1'))`;
    const rawRecord = request.record as Record<string, unknown> | null;
    const associatedRun = request.claim?.runId ?? (request.action === "record_run" ? rawRecord?.id : request.action === "record_publication" ? rawRecord?.runId : undefined);
    if (request.claim && (request.action === "record_run" && rawRecord?.id !== request.claim.runId || request.action === "record_publication" && rawRecord?.runId !== request.claim.runId)) throw new WorkflowError("claim_record_mismatch", "回执记录与阶段租约编号不一致");
    if (typeof associatedRun === "string") {
      const lease = await tx.seoWorkflowLease.findUnique({ where: { runId: associatedRun } });
      if (lease || request.claim) {
        const [clock] = await tx.$queryRaw<{ now: Date }[]>`SELECT CURRENT_TIMESTAMP AS now`;
        if (!request.claim || !lease || lease.status !== "running" || lease.owner !== request.claim.owner || lease.fencingToken !== request.claim.fencingToken || lease.leaseUntil <= clock.now) throw new WorkflowError("lease_lost", "当前阶段租约无效；不能由旧执行器覆盖新回执");
      }
    }
    const rows = await tx.seoWorkflowRecord.findMany({ where: { kind: { in: legacyKinds } } });
    const all = rows.map(row => ({ kind: row.kind as WorkflowKind, record: row.payload as unknown as WorkflowRecord }));
    const prepared = prepareWorkflowMutation(request, all, actor);
    const newMaintenance = publishedMaintenanceMutationTasks(prepared.kind, prepared.record, all);
    await assertPublishedMaintenanceTasks(tx, newMaintenance, all, new Date(prepared.record.updatedAt));
    const contentTasks = quarterContentMutationTasks(prepared.kind, prepared.record, all);
    if (contentTasks.length) {
      const { readGrowthStrategy } = await import("./growth-strategy");
      const problems = quarterContentProblems(contentTasks, await readGrowthStrategy(tx), all);
      if (problems.length) throw new WorkflowError("quarter_content_membership_required", problems.join("；"));
    }
    if (prepared.kind === "plan" && (prepared.record as WorkflowPlan).strategyAllocation && isExecutableWorkflowPlan((prepared.record as WorkflowPlan).status)) {
      const { readGrowthStrategy } = await import("./growth-strategy");
      const problems = quarterAllocationProblems(prepared.record as WorkflowPlan, await readGrowthStrategy(tx), all.filter(row => row.kind === "task").map(row => row.record as WorkflowTask), all.filter(row => row.kind === "plan").map(row => row.record as WorkflowPlan));
      if (problems.length) throw new WorkflowError("quarter_plan_approval_required", problems.join("；"));
    }
    if (prepared.kind === "task" || prepared.kind === "plan") {
      const prior = all.find(row => row.kind === prepared.kind && row.record.id === prepared.record.id)?.record;
      const previousPlan = prepared.kind === "plan" ? prior as WorkflowPlan | undefined : undefined;
      const previouslyCommitted = previousPlan && isExecutableWorkflowPlan(previousPlan.status) ? previousPlan.taskIds : previousPlan?.committedTaskIds ?? [];
      const extraIds = prepared.kind === "task"
        ? (prepared.record as WorkflowTask).capacityClass === "authorized_hotspot_extra" && (prior as WorkflowTask | undefined)?.capacityClass !== "authorized_hotspot_extra" ? [prepared.record.id] : []
        : (prepared.record as WorkflowPlan).taskIds.filter(id => !previouslyCommitted.includes(id) && all.some(row => row.kind === "task" && row.record.id === id && (row.record as WorkflowTask).capacityClass === "authorized_hotspot_extra"));
      if (extraIds.length) {
        if (prepared.kind === "task" && all.some(row => row.kind === "plan" &&
          (isExecutableWorkflowPlan(row.record.status) ? (row.record as WorkflowPlan).taskIds : (row.record as WorkflowPlan).committedTaskIds ?? []).includes(prepared.record.id))) {
          throw new WorkflowError("extra_existing_commitment", "已经正式排期的原任务保留原容量分类");
        }
        if (prepared.kind === "plan" && isExecutableWorkflowPlan(prepared.record.status)) {
          const plan = prepared.record as WorkflowPlan;
          const existingPlans = all.filter(row => row.kind === "plan" && row.record.id !== plan.id).map(row => row.record as WorkflowPlan);
          const before = new Set([...previouslyCommitted,
            ...existingPlans.flatMap(row => isExecutableWorkflowPlan(row.status) ? row.taskIds : row.committedTaskIds ?? [])]);
          const { hotspotCapacityProblem } = await import("../growth-hotspot-admission");
          const problem = hotspotCapacityProblem(all.filter(row => row.kind === "task").map(row => row.record as WorkflowTask),
            new Set([...before, ...plan.taskIds]), new Set(plan.taskIds.filter(id => !before.has(id))));
          if (problem) throw new WorkflowError("hotspot_capacity_limit", problem);
        }
        // The claims advisory lock is already held. A lease cannot be acquired
        // between this check and the normal task/plan CAS write.
        const [clock] = await tx.$queryRaw<{ now: Date }[]>`SELECT CURRENT_TIMESTAMP AS now`;
        const leases = await tx.seoWorkflowLease.findMany({ where: { status: "running", leaseUntil: { gt: clock.now } }, select: { runId: true, status: true, leaseUntil: true } });
        const { hotspotLeaseConflict } = await import("../growth-hotspot-admission");
        const conflict = hotspotLeaseConflict(extraIds, all.filter(row => row.kind === "run").map(row => row.record as import("../seo-workflow").WorkflowRun), leases.map(lease => ({ ...lease, leaseUntil: lease.leaseUntil.toISOString() })), clock.now);
        if (conflict) throw new WorkflowError("hotspot_in_flight", conflict);
      }
      const tasks = prepared.kind === "task" ? [prepared.record as WorkflowTask] : all.filter(row => row.kind === "task" && (prepared.record as WorkflowPlan).taskIds.includes(row.record.id)).map(row => row.record as WorkflowTask);
      const requiresExecutionCheck = (task: WorkflowTask) => !isCompletedGrowthEvidenceAppend(task, all.find(row => row.kind === "task" && row.record.id === task.id)?.record as WorkflowTask | undefined);
      for (const task of tasks.filter(task => requiresExecutionCheck(task) && task.workflowContract === "growth-v1.5" && ["blog", "landing", "optimization", "cluster"].includes(task.kind) && ["ready", "drafting", "review_pending", "approved", "published", "verified", "observing"].includes(task.status))) {
        const member = task.keywordId ? await tx.siteKeyword.findUnique({ where: { siteDomain_keywordId: { siteDomain: task.siteDomain, keywordId: task.keywordId } }, select: { active: true, pool: true, topicId: true, topicAssignments: { select: { topicId: true } }, keyword: { select: { text: true, active: true } } } }) : null;
        const topic = task.topicId ? await tx.topic.findUnique({ where: { id: task.topicId }, select: { text: true, active: true, createdAt: true, sites: { select: { siteDomain: true } } } }) : null;
        if (!member?.active || !member.keyword.active || member.pool !== "FORMAL" || member.keyword.text.normalize("NFKC").trim().toLowerCase() !== task.keyword?.normalize("NFKC").trim().toLowerCase() || !topic?.active || isGrowthTopicPlaceholder(topic.text) || !topic.sites.some(site => site.siteDomain === task.siteDomain) || member.topicId !== task.topicId && !member.topicAssignments.some(row => row.topicId === task.topicId)) throw new WorkflowError("growth_target_membership", "新制作任务须关联本站真实正式TopicMap词及原话题，不能编造ID或借用发现占位词", 422);
        if (topic.createdAt >= new Date("2026-11-23T00:00:00Z") && !task.directionId) throw new WorkflowError("new_direction_approval_required", "新建话题须关联用户确认的方向卡，已有正式方向继续自动执行", 403);
      }
      const guarded = tasks.filter(task => requiresExecutionCheck(task) && task.directionId && ["ready", "drafting", "review_pending", "approved", "published", "verified", "observing"].includes(task.status));
      if (guarded.length) {
        const { readGrowthStrategy } = await import("./growth-strategy");
        const state = await readGrowthStrategy(tx);
        const graph = new Map(all.filter(row => row.kind === "task").map(row => [row.record.id, row.record as WorkflowTask]));
        for (const task of guarded) graph.set(task.id, task);
        for (const task of guarded) {
          let scope;
          try { scope = assertGrowthDirectionScope(state, task); }
          catch (error) { const failure = error as Error & { code: string; status: number }; throw new WorkflowError(failure.code, failure.message, failure.status); }
          if (scope) {
            const count = [...graph.values()].filter(row => !row.deletedAt && row.directionId === task.directionId && row.experimentId === task.experimentId && row.siteDomain === scope.site && row.topicId === scope.topicId && row.country === scope.country && row.language === scope.language && scope.kinds.some(kind => kind === row.kind || kind === "cluster_landing" && ["landing", "cluster"].includes(row.kind))).length;
            if (count > scope.maxTasks) throw new WorkflowError("direction_task_limit", "该方向已超出人工批准的任务数量，请复用原任务或先确认投入范围", 403);
          }
        }
      }
    }
    if (prepared.kind === "approval") await validateInternalReviewAssets(prepared.record as WorkflowApproval, tx);
    if (prepared.kind === "publication") {
      const approvalId = (prepared.record as { approvalId: string }).approvalId;
      const approval = all.find(row => row.kind === "approval" && row.record.id === approvalId)?.record as WorkflowApproval | undefined;
      if (approval) await validateInternalReviewAssets(approval, tx, true);
    }
    const data = { kind: prepared.kind, recordId: prepared.record.id, weekStart: prepared.record.weekStart, siteDomain: "siteDomain" in prepared.record ? prepared.record.siteDomain : null, status: prepared.record.status, version: prepared.record.version, payload: json(prepared.record) };
    await tx.seoWorkflowRecord.upsert({ where: { key: prepared.key }, create: { key: prepared.key, ...data }, update: data });
    await tx.seoWorkflowEvent.create({ data: { requestId: request.requestId, requestHash, recordKey: prepared.key, kind: prepared.kind, version: prepared.record.version, payload: json(prepared.record) } });
    const marketTasks: WorkflowTask[] = prepared.kind === "task" && (prepared.record as WorkflowTask).status === "approved" ? [prepared.record as WorkflowTask]
      : prepared.kind === "plan" && isExecutableWorkflowPlan(prepared.record.status) ? all.filter(row => row.kind === "task" && (prepared.record as WorkflowPlan).taskIds.includes(row.record.id)).map(row => row.record as WorkflowTask) : [];
    for (const task of marketTasks) if (task.keywordId && task.keyword && task.country && task.language && task.evidence.length) {
      await syncWorkflowMarketAssignment(tx, { siteDomain: task.siteDomain, keywordId: task.keywordId, keyword: task.keyword, country: task.country, language: task.language, evidence: task.evidence, reviewedAt: prepared.record.updatedAt });
    }
    return { stored: true, replay: false, kind: prepared.kind, record: prepared.record, storage: "database" as const };
  }, { maxWait: 10_000, timeout: 30_000 });
}

/** Read-only preflight before an external CMS/deploy. Publication receipts recheck
 * the same graph in their write transaction; this cannot make an external CMS atomic. */
export async function checkWorkflowApprovalRequest(input: unknown, localPreview = false) {
  const request = workflowApprovalCheckSchema.parse(input), directory = localDirectory(localPreview);
  if (directory) return { ...checkWorkflowApproval(request, (await readLocal(directory)).records), storage: "local_preview" as const };
  requireDatabase();
  const rows = await prisma.seoWorkflowRecord.findMany({ where: { kind: { in: legacyKinds } } });
  const approval = rows.find(row => row.kind === "approval" && row.recordId === request.approvalId)?.payload as unknown as WorkflowApproval | undefined;
  if (approval) await validateInternalReviewAssets(approval, undefined, true);
  return { ...checkWorkflowApproval(request, rows.map(row => ({ kind: row.kind as WorkflowKind, record: row.payload as unknown as WorkflowRecord }))), storage: "database" as const };
}

export async function readWorkflowHistory(kind: WorkflowKind, recordId: string, localPreview = false) {
  const directory = localDirectory(localPreview);
  if (directory) return (await readLocal(directory)).events.filter(row => row.kind === kind && row.record.id === recordId).map(row => row.record);
  requireDatabase();
  const rows = await prisma.seoWorkflowEvent.findMany({ where: { recordKey: `${kind}:${recordId}` }, orderBy: { version: "asc" }, select: { payload: true } });
  return rows.map(row => row.payload as unknown as WorkflowRecord);
}

export async function mutateWorkflowClaim(input: unknown) {
  requireDatabase();
  const command = workflowClaimSchema.parse(input);
  return prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('flatkey-seo-workflow-claims-v1'))`;
    // Database clock is shared by all workers; local clocks do not decide leases.
    const [clock] = await tx.$queryRaw<{ now: Date }[]>`SELECT CURRENT_TIMESTAMP AS now`;
    const now = clock.now, expires = new Date(now.getTime() + command.leaseSeconds * 1000);
    const existing = await tx.seoWorkflowLease.findUnique({ where: { runId: command.runId } });
    if (existing && (existing.stage !== command.stage || existing.scheduledFor.getTime() !== Date.parse(command.scheduledFor))) throw new WorkflowError("claim_identity_conflict", "同一运行编号不能改换阶段或计划时间");
    if (command.action === "claim") {
      if (existing?.status === "completed") return { acquired: false, reason: "completed", runId: existing.runId, status: existing.status };
      if (existing && existing.status === "running" && existing.leaseUntil > now) return { acquired: false, reason: "leased", runId: existing.runId, status: existing.status, leaseUntil: existing.leaseUntil.toISOString() };
      const other = await tx.seoWorkflowLease.findUnique({ where: { stage_scheduledFor: { stage: command.stage, scheduledFor: new Date(command.scheduledFor) } } });
      if (other && other.runId !== command.runId) throw new WorkflowError("stage_already_claimed", "同一阶段与计划时间已有运行编号，请续跑原编号");
      const lease = await tx.seoWorkflowLease.upsert({ where: { runId: command.runId }, create: { runId: command.runId, stage: command.stage, scheduledFor: new Date(command.scheduledFor), owner: command.owner, fencingToken: 1, leaseUntil: expires }, update: { owner: command.owner, fencingToken: { increment: 1 }, leaseUntil: expires, status: "running", result: Prisma.DbNull } });
      return { acquired: true, runId: lease.runId, status: lease.status, fencingToken: lease.fencingToken, leaseUntil: lease.leaseUntil.toISOString() };
    }
    if (!existing || existing.status !== "running" || existing.owner !== command.owner || existing.fencingToken !== command.fencingToken || existing.leaseUntil <= now) throw new WorkflowError("lease_lost", "租约已失效或已被其他执行器续跑；旧执行器不得提交完成");
    if (command.action === "renew") {
      const renewed = await tx.seoWorkflowLease.update({ where: { runId: command.runId }, data: { leaseUntil: expires } });
      return { acquired: true, runId: renewed.runId, status: renewed.status, fencingToken: renewed.fencingToken, leaseUntil: renewed.leaseUntil.toISOString() };
    }
    if (!command.status || !command.evidence.length) throw new WorkflowError("completion_evidence_missing", "结束租约需要实际状态和回执证据");
    const receipt = await tx.seoWorkflowRecord.findUnique({ where: { key: `run:${command.runId}` } });
    const receiptPayload = receipt?.payload as Record<string, unknown> | undefined;
    if (!receipt || receipt.status !== command.status || receiptPayload?.stage !== command.stage || Date.parse(String(receiptPayload?.scheduledFor)) !== Date.parse(command.scheduledFor)) throw new WorkflowError("run_receipt_missing", "先保存同阶段、计划时间及状态的回执，再结束租约");
    const completed = await tx.seoWorkflowLease.update({ where: { runId: command.runId }, data: { status: command.status, leaseUntil: now, result: json({ evidence: command.evidence, completedAt: now.toISOString() }) } });
    return { acquired: false, runId: completed.runId, status: completed.status, fencingToken: completed.fencingToken };
  }, { maxWait: 10_000, timeout: 15_000 });
}

export { ACTION_KIND };
