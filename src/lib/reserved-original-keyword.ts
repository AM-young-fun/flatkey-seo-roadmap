import { z } from "zod";
import type { GrowthStrategy } from "./growth-strategy";
import { activeGrowthHotspot } from "./growth-hotspots";
import { completeHotspotTaskResearch } from "./growth-hotspot-admission";
import { pageBelongsToSite, type WorkflowTask } from "./seo-workflow";

export const reservedOriginalCommandSchema = z.object({
  requestId: z.string().regex(/^[a-zA-Z0-9:_-]{8,160}$/),
  taskId: z.string().min(1).max(200),
  expectedTaskVersion: z.number().int().positive(),
  quarterHash: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
export type ReservedOriginalCommand = z.infer<typeof reservedOriginalCommandSchema>;

export const reservedOriginalIdentitySchema = z.object({
  taskId: z.string().min(1), siteDomain: z.literal("modelfit.cc"), topicId: z.string().min(1),
  keywordId: z.string().min(1), keyword: z.string().min(1), country: z.literal("US"), language: z.literal("en"),
  dueAt: z.string().min(1), weekStart: z.string().min(1), pageUrl: z.url(),
});
export type ReservedOriginalIdentity = z.infer<typeof reservedOriginalIdentitySchema>;

export function reservedOriginalIdentity(task: WorkflowTask): ReservedOriginalIdentity | undefined {
  if (!task.id.startsWith("seo-hotspot:") || task.kind !== "blog" || task.channel !== "website" ||
    task.source !== "human" || task.deletedAt || task.capacityClass !== "routine" ||
    task.workflowContract !== "growth-v1.5" || !task.pageUrl || !pageBelongsToSite(task.pageUrl, task.siteDomain)) return;
  const { id: taskId, siteDomain, topicId, keywordId, keyword, country, language, dueAt, weekStart, pageUrl } = task;
  const parsed = reservedOriginalIdentitySchema.safeParse({ taskId, siteDomain, topicId, keywordId, keyword, country, language, dueAt, weekStart, pageUrl });
  if (parsed.success) return parsed.data;
}

export function reservedOriginalProblem(command: ReservedOriginalCommand, task: WorkflowTask, strategy: GrowthStrategy, dependencies: WorkflowTask[], now: Date): string | undefined {
  const versions = [strategy.quarterPlanning, ...(strategy.quarterPlanningHistory ?? [])];
  const quarter = versions.find(row => row?.hash === command.quarterHash && row?.approval?.hash === command.quarterHash);
  if (!quarter?.plan.reservedOriginalTaskIds.includes(command.taskId)) return "该原任务不在指定且已批准的冻结保留清单内";
  if (task.id !== command.taskId || !reservedOriginalIdentity(task) || task.status !== "planned") return "原任务须是同站人工确认且已转常规的待领博客";
  if (!completeHotspotTaskResearch(task, now)) return "原词同市场的完整 Top 10、前五正文及质量复核尚未齐备";
  if (!task.dependencies.length || !task.dependencies.every(id => dependencies.some(dependency =>
    dependency.id === id && !dependency.deletedAt && dependency.kind === "research" && dependency.siteDomain === task.siteDomain &&
    dependency.keywordId === task.keywordId && dependency.country === task.country && dependency.language === task.language &&
    ["verified", "observing"].includes(dependency.status)))) return "原站同词同市场的研究依赖尚未验收";
  const hadHotspot = task.evidence.some(item => {
    const observedAt = new Date(item.observedAt);
    return item.label.startsWith("seo-hotspot-v1;") && observedAt <= now && Boolean(activeGrowthHotspot(task, observedAt));
  });
  if (!hadHotspot || activeGrowthHotspot(task, now)) return "仅支持有明确原证据且已退出 P0 的保留原任务";
}

export function matchesReservedOriginal(task: WorkflowTask, identity: ReservedOriginalIdentity | undefined): boolean {
  const current = reservedOriginalIdentity(task);
  return Boolean(current && identity && Object.keys(current).every(key => {
    const field = key as keyof ReservedOriginalIdentity;
    return current[field] === identity[field];
  }));
}
