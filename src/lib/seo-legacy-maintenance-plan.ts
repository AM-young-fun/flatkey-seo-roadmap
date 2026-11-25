import { isSeoExtraCapacity } from "./seo-extra-capacity";
import type { WorkflowPlan, WorkflowTask } from "./seo-workflow";
import type { WorkflowStoredRow } from "./seo-workflow-state";
import { isExecutableWorkflowPlan } from "./seo-workflow";
import { shiftDay, workWeekDateRange } from "./seo-date-range";
import { isSeoWorkday } from "./seo-workday";
import { deliveryWeights, type DeliveryBucket } from "./growth-quarter-planning";
import { maintenanceTaskProblems } from "./seo-maintenance";

type Problem = { code: string; message: string };
const localDay = (at: string | Date) => new Date(at).toLocaleDateString("en-CA", { timeZone: "Asia/Shanghai" });
const executable = (plan: WorkflowPlan) => isExecutableWorkflowPlan(plan.status) || plan.committedTaskIds !== undefined;
const day = (task: WorkflowTask) => localDay(task.dueAt);
const delivery = (task: WorkflowTask) => ["blog", "landing", "optimization"].includes(task.kind) && !isSeoExtraCapacity(task.capacityClass);
const baseTargets = (targets: WorkflowPlan["targets"]) => Object.fromEntries(Object.entries(targets).filter(([key]) => !["maintenanceVersion", "contentRefreshPages", "maintenanceRange"].includes(key)));
const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical) : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)])) : value;
const same = (a: unknown, b: unknown) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
const page = (task: WorkflowTask) => {
  try { const url = new URL(task.pageUrl!); url.hostname = url.hostname.replace(/^www\./, ""); return url.href.replace(/\/$/u, ""); }
  catch { return task.pageUrl; }
};

/** Additive maintenance for an existing Monday workdays plan. Its old targets,
 * committed IDs and delivery dates never migrate to a new business-week plan. */
export function legacyMaintenancePlanProblems(plan: WorkflowPlan, previous: WorkflowPlan | undefined, all: WorkflowStoredRow[], now: Date): Problem[] {
  const fail = (code: string, message: string): Problem[] => [{ code, message }];
  const targets = plan.targets;
  const priorTargets = previous && "cadence" in previous.targets && previous.targets.cadence === "workdays" ? previous.targets : null;
  const hadMaintenance = priorTargets?.maintenanceVersion !== undefined;
  if (hadMaintenance && (!("cadence" in targets) || targets.cadence !== "workdays" || targets.maintenanceVersion !== priorTargets?.maintenanceVersion)) return fail("legacy_refresh_contract_immutable", "原workdays维护契约不撤回或迁其他cadence，保留原目标与任务");
  if (!("cadence" in targets) || targets.cadence !== "workdays") return [];
  const lookup = new Map(all.filter(row => row.kind === "task").map(row => [row.record.id, row.record as WorkflowTask]));
  const own = plan.taskIds.flatMap(id => lookup.get(id) ? [lookup.get(id)!] : []);
  const enabled = targets.maintenanceVersion !== undefined;
  if ([enabled, targets.contentRefreshPages !== undefined, targets.maintenanceRange !== undefined].some(Boolean) && !(enabled && targets.contentRefreshPages !== undefined && targets.maintenanceRange)) return fail("legacy_refresh_contract_incomplete", "旧计划翻新须同时追加维护版本、独立总量和明确执行窗口");
  if (!enabled) return own.some(task => task.workClass === "content_refresh") ? fail("legacy_refresh_contract_required", "原workdays计划须先追加独立维护契约，翻新不能挤占旧优化额度") : [];
  if (!priorTargets || !same(baseTargets(targets), baseTargets(priorTargets))) return fail("legacy_refresh_original_targets", "仅增补原workdays计划维护字段，不改原cadence、源文、语言、落地页和优化目标");
  if (hadMaintenance && (!same(targets.maintenanceRange, priorTargets.maintenanceRange) || targets.contentRefreshPages !== priorTargets.contentRefreshPages)) return fail("legacy_refresh_contract_immutable", "已保存的独立维护窗口和总量保持原值，延期沿原任务续跑");
  const range = targets.maintenanceRange!;
  const business = workWeekDateRange(range.start);
  if (range.start > range.end || range.start < plan.weekStart || range.end > shiftDay(plan.weekStart, 6) || range.end > business.end || !hadMaintenance && range.start < localDay(now)) return fail("legacy_refresh_window", "维护窗口须是原存储周内尚未过去的同一业务周，不迁移原任务或补跑已过时段");
  const dates = Array.from({ length: 7 }, (_, index) => shiftDay(plan.weekStart, index)).filter(date => date >= range.start && date <= range.end && isSeoWorkday(new Date(date + "T00:00:00+08:00")));
  if (!dates.length || targets.contentRefreshPages !== 2 * dates.length) return fail("legacy_refresh_capacity", "两站独立翻新按实际剩余工作日每天2篇核算，不扣常规优化或增加其他额度");
  if (own.some(task => task.workClass === "content_refresh" && (task.deletedAt || !dates.includes(day(task)) || maintenanceTaskProblems(task).length))) return fail("legacy_refresh_task_scope", "翻新须为对应工作日的真实Flatkey/ModelFit原博客维护任务，研究和发布门槛保持");
  const selected = new Set(plan.taskIds);
  for (const row of all) if (row.kind === "plan" && row.record.id !== plan.id && executable(row.record as WorkflowPlan)) {
    const other = row.record as WorkflowPlan;
    const otherRange = "maintenanceRange" in other.targets ? other.targets.maintenanceRange : "executionRange" in other.targets ? other.targets.executionRange : undefined;
    if ("maintenanceVersion" in other.targets && other.targets.maintenanceVersion && otherRange && otherRange.start <= range.end && otherRange.end >= range.start) return fail("legacy_refresh_duplicate_contract", "同执行窗口已有独立维护计划，不能跨Monday桶重复分配翻新容量");
    for (const id of other.taskIds) { const task = lookup.get(id); if (task && day(task) >= range.start && day(task) <= range.end) selected.add(id); }
  }
  const scoped = [...selected].flatMap(id => { const task = lookup.get(id); return task && !task.deletedAt && dates.includes(day(task)) ? [task] : []; });
  const refreshes = scoped.filter(task => task.workClass === "content_refresh");
  if (new Set(refreshes.map(page)).size !== refreshes.length || refreshes.some(task => scoped.some(other => other.id !== task.id && other.kind === "optimization" && page(other) === page(task)))) return fail("legacy_refresh_duplicate_page", "同页翻新与普通优化只交付一次，不重复建任务、跨站或跨计划计数");
  for (const date of dates) {
    const count = refreshes.filter(task => day(task) === date).length;
    const gap = plan.gaps.filter(gap => gap.category === "contentRefreshPages" && gap.date === date).reduce((n, gap) => n + gap.count, 0);
    if (count > 2) return fail("legacy_refresh_daily_capacity", "Flatkey与ModelFit每天合计最多2篇独立翻新");
    if (count + gap !== 2) return fail("legacy_refresh_daily_gap", "每个维护工作日须用真实原任务或具体研究缺口对平2篇，不把未研究标成可执行");
  }
  if (!isExecutableWorkflowPlan(plan.status)) return [];
  const original = new Set<string>(), classified = new Map<string, { bucket: DeliveryBucket; workstreamId: string }>();
  for (const row of all) if (row.kind === "plan" && executable(row.record as WorkflowPlan)) {
    const saved = row.record as WorkflowPlan, futureIds = new Set(saved.strategyAllocation?.tasks.map(task => task.taskId) ?? []);
    for (const id of saved.taskIds) if (!futureIds.has(id)) original.add(id);
    for (const item of saved.strategyAllocation?.tasks ?? []) classified.set(item.taskId, item);
  }
  const future = own.filter(task => task.workClass === "content_refresh" && !original.has(task.id));
  const allocation = plan.strategyAllocation;
  if (future.length && !allocation) return fail("legacy_refresh_allocation_required", "新增正式翻新须消费已审季度GPU/API投入；旧常规预留不吞独立维护名额");
  if (!allocation) return [];
  if (allocation.version !== "quarter-planning-v2" || (allocation.capacityStart ?? range.start) !== range.start || (allocation.capacityEnd ?? range.end) !== range.end) return fail("legacy_refresh_allocation_window", "旧计划本次新增投入仅为明确维护窗口，不重算或重排原常规任务");
  const delivered = new Set(all.filter(row => row.kind === "publication" && ["published", "verified"].includes(row.record.status) && localDay((row.record as import("./seo-workflow").WorkflowPublication).publishedAt) < range.start).map(row => (row.record as import("./seo-workflow").WorkflowPublication).taskId));
  const mustPreserve = own.filter(task => delivery(task) && original.has(task.id) && !delivered.has(task.id) && day(task) <= range.end).map(task => task.id);
  if (new Set(allocation.preservedTaskIds).size !== allocation.preservedTaskIds.length || mustPreserve.some(id => !allocation.preservedTaskIds.includes(id))) return fail("legacy_refresh_preserve_original", "原未完常规交付须显式预留原ID，不能改类、改dueAt或移除来释放维护预算");
  for (const id of allocation.preservedTaskIds) {
    const task = lookup.get(id);
    if (!task || task.deletedAt || !delivery(task) || !original.has(id) || delivered.has(id) || day(task) > range.end) return fail("legacy_refresh_invalid_reservation", "预留只能引用窗口前已授权且尚需交付的原内容任务，不能造任务或重复算已交付");
  }
  const reservedRefresh = allocation.preservedTaskIds.filter(id => lookup.get(id)?.workClass === "content_refresh").length;
  if (allocation.futureBudget.total !== Math.max(0, targets.contentRefreshPages! - reservedRefresh)) return fail("legacy_refresh_future_capacity", "独立翻新容量只扣原翻新预留，不以常规延期预留挤掉4个维护名额");
  if (new Set(allocation.tasks.map(row => row.taskId)).size !== allocation.tasks.length || !same(allocation.tasks.map(row => row.taskId).sort(), future.map(task => task.id).sort())) return fail("legacy_refresh_allocation_tasks", "本次旧计划投入只列新增翻新原ID，不把旧常规任务换类或另算新增");
  if (allocation.tasks.some(row => classified.has(row.taskId) && (classified.get(row.taskId)!.bucket !== row.bucket || classified.get(row.taskId)!.workstreamId !== row.workstreamId))) return fail("legacy_refresh_allocation_immutable", "已排维护任务保留原投入归因，不换类凑比例");
  for (const bucket of Object.keys(deliveryWeights(allocation.version)) as DeliveryBucket[]) {
    const actual = allocation.tasks.filter(row => row.bucket === bucket).length, gap = allocation.gaps.filter(row => row.bucket === bucket).reduce((n, row) => n + row.count, 0);
    if (actual + gap !== (allocation.futureBudget.counts as Record<string, number>)[bucket]) return fail("legacy_refresh_allocation_gap", "独立维护投入用真实任务和具体不足对平，不用研究名额或虚构任务凑额度");
  }
  return [];
}
