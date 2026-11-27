import { z } from "zod";
import type { WorkflowPlan, WorkflowTask } from "./seo-workflow";
import type { GrowthBaselineTarget, GrowthStrategy } from "./growth-strategy";
import { growthWebsitePageUrl } from "./growth-live-page";
import { growthLogicalTargetIdSchema } from "./growth-target-id-schema";
import { growthPublicUrl, growthWordKey } from "./growth-workspace";
import { quarterCalendarDatesValid, quarterCalendarRowSchema, QUARTER_NEW_MARKET_SHARES, QUARTER_NEW_WORD_COUNT, QUARTER_NEW_WORD_VERSION } from "./growth-quarter-calendar";
import { satelliteProductionTask, satelliteQuarterBound, satelliteQuarterTaskMember } from "./satellite-quarter";
import { isSeoExtraCapacity } from "./seo-extra-capacity";

export const MARKET_RESEARCH_WEIGHTS = { US: 35, JP: 25, BR: 20, SG: 15, other: 5 } as const;
export const DELIVERY_WEIGHTS = { primary: 60, foundation: 25, experiment: 15 } as const;
/** v1 retains its historical allocation; later versions share the business allocation. */
export const BUSINESS_DELIVERY_WEIGHTS = { gpu: 70, api: 25, other: 5 } as const;
export type DeliveryBucket = keyof typeof DELIVERY_WEIGHTS | keyof typeof BUSINESS_DELIVERY_WEIGHTS;
const bucketSchema = z.enum(["primary", "foundation", "experiment", "gpu", "api", "other"]);
const planningVersionSchema = z.enum(["quarter-planning-v1", "quarter-planning-v2", QUARTER_NEW_WORD_VERSION]);
export function deliveryWeights(version: string) { return version === "quarter-planning-v1" ? DELIVERY_WEIGHTS : BUSINESS_DELIVERY_WEIGHTS; }
/** Largest deficit assigns one slot at a time: monotonic cumulative budgets, stable tie order and no negative weekly differences. */
export function allocateIntegerBudget<K extends string>(total: number, weights: Record<K, number>): Record<K, number> {
  if (!Number.isSafeInteger(total) || total < 0) throw Error("invalid_allocation_total");
  const entries = Object.entries(weights) as [K, number][];
  const sum = entries.reduce((n, [, weight]) => n + weight, 0);
  if (!sum || entries.some(([, weight]) => !Number.isFinite(weight) || weight < 0)) throw Error("invalid_allocation_weights");
  const rows = entries.map(([key, weight]) => ({ key, weight, count: 0 }));
  for (let n = 1; n <= total; n++) {
    let best = rows[0];
    for (const row of rows.slice(1)) if (n * row.weight - row.count * sum > n * best.weight - best.count * sum) best = row;
    best.count++;
  }
  return Object.fromEntries(rows.map(row => [row.key, row.count])) as Record<K, number>;
}
const id = z.string().trim().min(1).max(200), detail = z.string().trim().min(12).max(3000), count = z.number().int().nonnegative().max(20000);
const budget = <T extends Record<string, number>>(weights: T) => z.object({ total: count, offset: count.optional(), counts: z.object(Object.fromEntries(Object.keys(weights).map(key => [key, count])) as Record<keyof T, typeof count>).strict() }).strict().superRefine((value, ctx) => {
  const before = allocateIntegerBudget(value.offset ?? 0, weights), after = allocateIntegerBudget((value.offset ?? 0) + value.total, weights);
  const expected = Object.fromEntries(Object.keys(weights).map(key => [key, after[key] - before[key]]));
  if (Object.keys(weights).some(key => (value.counts as Record<string, number>)[key] !== expected[key])) ctx.addIssue({ code: "custom", message: "整数比例须按同一总量和逐槽最大欠额法对平" });
});
export const marketResearchBudgetSchema = budget(MARKET_RESEARCH_WEIGHTS);
const quarterMarketBudgetSchema = budget(QUARTER_NEW_MARKET_SHARES);
const compatibleMarketBudgetSchema = z.union([marketResearchBudgetSchema, quarterMarketBudgetSchema]);
export const deliveryBudgetSchema = budget(DELIVERY_WEIGHTS);
export const businessDeliveryBudgetSchema = budget(BUSINESS_DELIVERY_WEIGHTS);
const compatibleDeliveryBudgetSchema = z.union([deliveryBudgetSchema, businessDeliveryBudgetSchema]);
export const quarterPlanningInputSchema = z.object({
  version: planningVersionSchema, sourceVersion: z.string().regex(/^[a-f0-9]{64}$/),
  targetUnit: z.literal("normalized_original_word").optional(),
  title: z.string().min(1).max(300), targetIds: z.array(growthLogicalTargetIdSchema).min(1).max(20000),
  artifact: z.object({ reference: z.string().min(1).max(3000), sha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict(),
  executionStart: z.iso.date(), executionEnd: z.literal("2027-02-05"),
  workstreams: z.array(z.object({ id, title: z.string().min(1).max(300), bucket: bucketSchema,
    topicIds: z.array(id).min(1).max(2000), taskIds: z.array(id).max(2000), rationale: detail, verification: detail,
    evidenceReferences: z.array(z.string().min(1).max(3000)).min(1).max(30),
  }).strict()).min(2).max(30),
  researchBudget: compatibleMarketBudgetSchema,
  deliveryBudget: compatibleDeliveryBudgetSchema,
  calendar: z.array(quarterCalendarRowSchema).length(QUARTER_NEW_WORD_COUNT).optional(),
  reservedOriginalTaskIds: z.array(id).max(3000),
  limitations: z.array(detail).min(1).max(30),
}).strict().superRefine((value, ctx) => {
  if (new Set(value.targetIds).size !== value.targetIds.length || new Set(value.reservedOriginalTaskIds).size !== value.reservedOriginalTaskIds.length || new Set(value.workstreams.map(row => row.id)).size !== value.workstreams.length) ctx.addIssue({ code: "custom", message: "季度成员、原任务和方向ID不可重复" });
  const modern = value.version !== "quarter-planning-v1", next = value.version === QUARTER_NEW_WORD_VERSION, weights = deliveryWeights(value.version);
  if (value.workstreams.some(row => !(row.bucket in weights)) || Object.keys(value.deliveryBudget.counts).some(key => !(key in weights))) ctx.addIssue({ code: "custom", message: "季度投入必须使用同一版本的分类与预算，不叠加两套比例" });
  if (modern ? !value.workstreams.some(row => row.bucket === "gpu") || !value.workstreams.some(row => row.bucket === "api") : !value.workstreams.some(row => row.bucket === "primary") || !value.workstreams.some(row => row.bucket === "foundation")) ctx.addIssue({ code: "custom", message: modern ? "季度方案须明确GPU主攻、API次重点方向" : "季度方案须明确主攻及基础覆盖方向" });
  if (modern && value.targetUnit !== "normalized_original_word") ctx.addIssue({ code: "custom", message: "季度方案须按去重原词核算" });
  if (value.executionStart > value.executionEnd) ctx.addIssue({ code: "custom", message: "执行窗口不能超过季度截止" });
  const size = next ? QUARTER_NEW_WORD_COUNT : 1600;
  if (value.targetUnit === "normalized_original_word" && value.targetIds.length !== size) ctx.addIssue({ code: "custom", message: `本版季度清单须为${size}个不重复原词` });
  if (next !== ("ES" in value.researchBudget.counts)) ctx.addIssue({ code: "custom", message: "市场研究预算须使用对应季度版本" });
  if (next) {
    const calendarIds = new Set(value.calendar?.map(row => row.targetId));
    if (!value.calendar || calendarIds.size !== size || value.targetIds.some(targetId => !calendarIds.has(targetId))
      || !quarterCalendarDatesValid(value.calendar, value.executionStart, value.executionEnd)) ctx.addIssue({ code: "custom", message: "1000个原词须逐项配对Ahrefs证据及窗口内真实工作日" });
    if (value.researchBudget.total !== size || value.researchBudget.offset) ctx.addIssue({ code: "custom", message: "新季度研究总量须为1000词" });
  } else if (value.calendar) ctx.addIssue({ code: "custom", message: "现有日历只适用于新季度版本" });
});
export type QuarterPlanningInput = z.infer<typeof quarterPlanningInputSchema>;
export const quarterPlanningStoredSchema = z.object({
  revision: z.number().int().positive(), plan: quarterPlanningInputSchema, hash: z.string().regex(/^[a-f0-9]{64}$/), submittedAt: z.iso.datetime({ offset: true }),
  approval: z.object({ actor: z.literal("human"), approvedAt: z.iso.datetime({ offset: true }), hash: z.string().regex(/^[a-f0-9]{64}$/), reason: detail }).strict().nullable(),
}).strict();
export const planStrategyAllocationSchema = z.object({
  version: planningVersionSchema, quarterPlanHash: z.string().regex(/^[a-f0-9]{64}$/),
  satelliteQuarterHash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  capacityStart: z.iso.date().optional(), capacityEnd: z.iso.date().optional(),
  futureBudget: compatibleDeliveryBudgetSchema,
  preservedTaskIds: z.array(id).max(500),
  tasks: z.array(z.object({ taskId: id, bucket: bucketSchema, workstreamId: id }).strict()).max(500),
  gaps: z.array(z.object({ bucket: bucketSchema, count: z.number().int().positive(), reason: detail }).strict()).max(30),
  marketResearchBudget: compatibleMarketBudgetSchema,
}).strict().superRefine((value, ctx) => {
  const weights = deliveryWeights(value.version);
  if ([...value.tasks, ...value.gaps].some(row => !(row.bucket in weights)) || Object.keys(value.futureBudget.counts).some(key => !(key in weights))) ctx.addIssue({ code: "custom", message: "工作包分类和预算须使用同一版本" });
  if ((value.version === QUARTER_NEW_WORD_VERSION) !== ("ES" in value.marketResearchBudget.counts)) ctx.addIssue({ code: "custom", message: "周市场研究预算须使用对应季度版本" });
});

type BusinessBucket = keyof typeof BUSINESS_DELIVERY_WEIGHTS;
const deliverySites = new Set(["flatkey.ai", "rackrate.org", "modelfit.cc"]);
function publicMaintenancePage(task: WorkflowTask) {
  if (task.kind !== "optimization" || !task.pageUrl || !deliverySites.has(task.siteDomain)) return false;
  const page = growthPublicUrl(task.pageUrl, task.siteDomain);
  if (!page) return false;
  const path = new URL(page).pathname;
  return !/^\/(?:api|console|router|admin)(?:\/|$)/iu.test(path)
    && !(task.siteDomain === "rackrate.org" && /\/blog(?:\/|$)/iu.test(path));
}

/** Attribution only: CLUSTER is a legacy delivery channel, never an "other" default. */
export function quarterTaskBusinessBucket(task: WorkflowTask, plan: QuarterPlanningInput, baselineTargets: GrowthBaselineTarget[]): BusinessBucket | null {
  if (task.business === "GPU") return "gpu";
  if (task.business === "API") return "api";
  if (task.business !== "CLUSTER" || !deliverySites.has(task.siteDomain) || !task.topicId || !task.keyword?.trim()
    || !task.country || !task.language || !["blog", "landing", "optimization"].includes(task.kind)
    || task.kind === "blog" && task.siteDomain === "rackrate.org") return null;

  const selectedIds = new Set(plan.targetIds);
  const targets = baselineTargets.filter(target => selectedIds.has(target.id) && target.site === task.siteDomain);
  const sameWord = targets.filter(target => growthWordKey(target.keyword) === growthWordKey(task.keyword!));
  const sameId = targets.filter(target => Boolean(task.keywordId) && target.keywordId === task.keywordId);
  const exact = sameWord.filter(target => Boolean(task.keywordId) && target.keywordId === task.keywordId
    && target.country === task.country && target.language === task.language && target.topicId === task.topicId);
  // An existing quarterly identity cannot be relabelled through a related topic,
  // a different market or a duplicate ID. Non-quarter old-page maintenance stays separate.
  if (sameWord.length || sameId.length) { if (!exact.length) return null; }
  else if (!publicMaintenancePage(task)) return null;

  const buckets = new Set(plan.workstreams.filter(stream => stream.topicIds.includes(task.topicId!))
    .map(stream => stream.bucket).filter((bucket): bucket is BusinessBucket => bucket === "gpu" || bucket === "api" || bucket === "other"));
  return buckets.size === 1 ? [...buckets][0] : null;
}

type QuarterRevision = z.infer<typeof quarterPlanningStoredSchema>;
type QuarterWorkstream = QuarterPlanningInput["workstreams"][number];

function hasPriorApiMaintenanceTopic(task: WorkflowTask, stream: QuarterWorkstream, quarter: QuarterRevision, approved: QuarterRevision[]) {
  const topicId = task.topicId;
  if (!topicId || quarter.plan.version !== QUARTER_NEW_WORD_VERSION || stream.bucket !== "api"
    || task.siteDomain !== "flatkey.ai" || task.channel !== "website" || task.business !== "API"
    || task.kind !== "optimization" || task.pageType !== "blog" || task.workClass
    || task.capacityClass !== "routine" || task.workflowContract !== "growth-v1.5"
    || !task.keywordId || !task.keyword || !task.country || !task.language
    || quarter.plan.workstreams.some(item => item.topicIds.includes(topicId))) return false;

  const page = growthWebsitePageUrl(task.pageUrl, task.siteDomain);
  if (!page || !/^\/(?:[a-z]{2}\/)?blog\/[^/]+$/u.test(new URL(page).pathname)) return false;

  // The workflow separately verifies the published page, original keyword and market.
  // Reuse the latest approved attribution only while the current plan has no assignment.
  const prior = approved.filter(item => item.revision < quarter.revision)
    .sort((left, right) => right.revision - left.revision)
    .map(item => item.plan.workstreams.filter(workstream => workstream.topicIds.includes(topicId)))
    .find(workstreams => workstreams.length > 0);
  return prior?.length === 1 && prior[0].id === stream.id && prior[0].bucket === "api";
}

export function quarterAllocationProblems(plan: WorkflowPlan, strategy: GrowthStrategy, tasks: WorkflowTask[], existingPlans: WorkflowPlan[] = []) {
  const allocation = plan.strategyAllocation;
  if (!allocation) return [];
  const versions = [...(strategy.quarterPlanningHistory ?? []), ...(strategy.quarterPlanning ? [strategy.quarterPlanning] : [])].filter(row => row.approval?.hash === row.hash);
  const quarter = versions.find(row => row.hash === allocation.quarterPlanHash);
  const active = [...versions].sort((a, b) => b.revision - a.revision)[0];
  const prior = existingPlans.find(row => row.id === plan.id);
  const priorWasScheduled = Boolean(prior && (["scheduled", "reviewed"].includes(prior.status) || prior.committedTaskIds !== undefined));
  const addedWork = allocation.tasks.some(row => !prior?.strategyAllocation?.tasks.some(saved => saved.taskId === row.taskId && (["scheduled", "reviewed"].includes(prior.status) || prior.committedTaskIds?.includes(saved.taskId))));
  if (!quarter || (quarter.hash !== active?.hash && (!priorWasScheduled || addedWork))) return ["正式投入计划须消费当前确切已审季度方案；旧已排计划的证据增补仍沿原已审版本"];
  if (allocation.version === "quarter-planning-v1" && (!priorWasScheduled || addedWork || !prior?.strategyAllocation)) return ["旧投入比例仅保留既有正式回执；新增常规工作须使用已审quarter-planning-v2，不能恢复旧配额"];
  const errors: string[] = [];
  if (allocation.version && allocation.version !== quarter.plan.version) errors.push("工作包投入版本须与确切已审季度方案一致");
  const satellite = satelliteQuarterBound(strategy);
  if (allocation.satelliteQuarterHash && (allocation.version !== QUARTER_NEW_WORD_VERSION
    || !("executionRange" in plan.targets) || satellite?.baselinePlanHash !== allocation.quarterPlanHash
    || satellite.selectionHash !== allocation.satelliteQuarterHash)) {
    errors.push("两站规划须绑定有效的独立季度词批次及原 Flatkey 季度版本");
  }
  if (satellite) {
    const committed = new Set([...versions.flatMap(saved => saved.plan.reservedOriginalTaskIds ?? []),
      ...existingPlans.flatMap(saved => ["scheduled", "reviewed"].includes(saved.status) ? saved.taskIds : saved.committedTaskIds ?? [])]);
    const selected = new Set(plan.taskIds);
    const newSatelliteWork = tasks.filter(task => selected.has(task.id) && !committed.has(task.id)
      && satelliteProductionTask(task) && !isSeoExtraCapacity(task.capacityClass));
    if (newSatelliteWork.some(task => !satelliteQuarterTaskMember(task, satellite)) || newSatelliteWork.length && allocation.satelliteQuarterHash !== satellite.selectionHash) {
      errors.push("两站新增制作任务须沿确切季度词批次排期，保留原任务与原名额");
    }
  }
  if (allocation.futureBudget.total + (allocation.futureBudget.offset ?? 0) > quarter.plan.deliveryBudget.total
    || allocation.marketResearchBudget.total + (allocation.marketResearchBudget.offset ?? 0) > quarter.plan.researchBudget.total) errors.push("业务周预算超出已审季度总名额，不自动扩量");
  const allocationRange = (row: WorkflowPlan) => "executionRange" in row.targets ? row.targets.executionRange : "maintenanceRange" in row.targets ? row.targets.maintenanceRange : undefined;
  const start = allocationRange(plan)?.start ?? "";
  const end = allocationRange(plan)?.end ?? "";
  if (allocation.version !== "quarter-planning-v1" && (!prior?.strategyAllocation || addedWork)) {
    const from = allocation.capacityStart ?? start, through = allocation.capacityEnd ?? end;
    if (existingPlans.some(saved => {
      const savedRange = allocationRange(saved), savedAllocation = saved.strategyAllocation;
      return saved.id !== plan.id && (["scheduled", "reviewed"].includes(saved.status) || saved.committedTaskIds !== undefined)
        && savedAllocation && savedAllocation.version !== "quarter-planning-v1" && savedRange
        && (savedAllocation.capacityStart ?? savedRange.start) <= through && (savedAllocation.capacityEnd ?? savedRange.end) >= from;
    })) errors.push("同维护或业务窗口已有原投入计划，不能另建growth或跨Monday桶重复分配预算");
  }
  if ((allocation.capacityStart ?? start) < quarter.plan.executionStart || (allocation.capacityEnd ?? end) > quarter.plan.executionEnd) errors.push("剩余投入容量须落在确切已审季度执行窗口内，恢复延迟不能补跑过去时段");
  const receipts = new Map<string, WorkflowPlan>();
  for (const saved of existingPlans) {
    const savedRange = allocationRange(saved);
    if (saved.id !== plan.id && (["scheduled", "reviewed"].includes(saved.status) || saved.committedTaskIds !== undefined) && saved.strategyAllocation && (allocation.version !== "quarter-planning-v2" || saved.strategyAllocation.version === "quarter-planning-v2") && (allocation.version !== QUARTER_NEW_WORD_VERSION || saved.strategyAllocation.quarterPlanHash === allocation.quarterPlanHash) && savedRange && savedRange.start < start) receipts.set(savedRange.start, saved);
  }
  const priorDelivery = [...receipts.values()].reduce((n, row) => n + row.strategyAllocation!.futureBudget.total, 0);
  const priorResearch = [...receipts.values()].reduce((n, row) => n + row.strategyAllocation!.marketResearchBudget.total, 0);
  if ((allocation.futureBudget.offset ?? 0) !== priorDelivery || (allocation.marketResearchBudget.offset ?? 0) !== priorResearch) errors.push("累计预算须承接原已审业务周实际回执，不可信任调用方重置offset");
  for (const row of allocation.tasks) {
    const task = tasks.find(task => task.id === row.taskId), stream = quarter.plan.workstreams.find(stream => stream.id === row.workstreamId && stream.bucket === row.bucket);
    if (!task?.topicId || !stream || !stream.topicIds.includes(task.topicId) && !hasPriorApiMaintenanceTopic(task, stream, quarter, versions)) {
      errors.push("投入任务须关联已审方案的真实话题方向");
    }
    if (row.bucket === "experiment" && (!task?.directionId || !task.experimentId)) errors.push("机会预留不是热点方向批准；实际试验任务须关联用户已审方向及原实验身份");
    if (task) {
      if (allocation.version !== "quarter-planning-v1" && quarterTaskBusinessBucket(task, quarter.plan, strategy.baseline?.targets ?? []) !== row.bucket) errors.push("预算须按原词及真实已审话题的唯一业务方向归因；CLUSTER仅是旧交付渠道，不改旧business或默认填其他预留");
      const dueDay = new Date(task.dueAt).toLocaleDateString("en-CA", { timeZone: "Asia/Shanghai" });
      if (dueDay < quarter.plan.executionStart || dueDay > quarter.plan.executionEnd) errors.push("新增投入任务须在已审季度窗口内交付，不改原延期任务dueAt");
    }
  }
  return errors;
}
