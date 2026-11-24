import { activeHotspotPriority, type HotspotPriority } from "../../scripts/lib/seo-hotspot-priority.cjs";
import type { GrowthDirection, GrowthStrategy } from "./growth-strategy";
import type { WorkflowTask, WorkflowSnapshot } from "./seo-workflow";
import { digestExecutionPeriod, digestExecutionWeek } from "./seo-digest-work-plan";

/** One shared, live seven-day source check for projection, admission and monitoring. */
export const activeGrowthHotspot = activeHotspotPriority;

export type HotspotPlan = { id: string; status: string; taskIds: string[] };
export type GrowthHotspotItem = {
  id: string; title: string; keyword: string; country: string | null; language: string | null; site: string; topicId: string | null;
  quarterTargetId: string | null; inQuarter: boolean; stage: "needs_decision" | "approved" | "scheduled" | "in_progress" | "published" | "reviewed" | "expired" | "rejected";
  eventAt: string; validUntil: string; officialEvidence: { url: string; observedAt: string }[]; demandEvidence: { url: string; observedAt: string }[];
  directionId: string | null; directionRevision: number | null; taskIds: string[]; tasks: { id: string; title: string; status: string; dueAt: string; pageUrl: string | null; kind: WorkflowTask["kind"]; source: WorkflowTask["source"]; capacityClass: WorkflowTask["capacityClass"] | null; inCurrentPlan: boolean }[];
  approvedAt: string | null; researchComplete: boolean; admission: { status: "not_approved" | "needs_research" | "needs_target_registration" | "needs_plan_append" | "scheduled" | "blocked"; reason: string };
};
export type GrowthHotspotView = { version: "growth-hotspots-v9"; generatedAt: string; businessWeek: { start: string; end: string }; items: GrowthHotspotItem[] };
const word = (value: string | null) => value?.normalize("NFKC").trim().toLowerCase().replace(/\s+/g, " ") ?? "";
const taskEvidence = (task: WorkflowTask) => [...task.evidence, ...(task.brief?.evidence ?? []), ...(task.research?.evidence ?? [])];
/** Expired items retain the last valid source pair, rather than silently being
 * converted to newly verified events. The shared rule validates the pair. */
function savedHotspot(task: WorkflowTask, now: Date): HotspotPriority | null {
  const active = activeGrowthHotspot(task, now); if (active) return active;
  const samples = taskEvidence(task).filter(row => row.label.startsWith("seo-hotspot-v1;") && Date.parse(row.observedAt) <= now.getTime()).map(row => row.observedAt).sort().reverse();
  for (const sample of samples) { const original = activeHotspotPriority(task, new Date(sample)); if (original) return original; }
  return null;
}
function directionApproved(direction: GrowthDirection | undefined, task: WorkflowTask, now: Date) {
  return Boolean(direction?.decision?.actor === "human" && direction.decision.decision === "approve" && direction.decision.revision === direction.revision
    && Date.parse(direction.expiresAt) > now.getTime() && direction.decision.scope.some(scope => scope.site === task.siteDomain && scope.topicId === task.topicId
      && scope.country === task.country && scope.language === task.language && scope.kinds.includes(task.kind === "research" ? "blog" : task.kind === "cluster" || task.kind === "landing" ? "cluster_landing" : task.kind as "blog" | "optimization" | "research" | "review") && Date.parse(scope.validUntil) > now.getTime()));
}
function fullResearch(task: WorkflowTask) {
  const review = task.researchReview;
  return Boolean(review && review.keyword === task.keyword && review.country === task.country && review.language === task.language && review.serpResults.length === 10 && review.openedResults.length >= 5 && review.evidence.length && Object.values(review.quality).every(value => value.trim().length >= 12));
}
/** Read-only facts from saved research/directions and original task/plan IDs.
 * No candidate pool, task creation, target admission, or provider calls. */
export function buildGrowthHotspotView(strategy: GrowthStrategy, workflow: Pick<WorkflowSnapshot, "tasks" | "publications">, plans: HotspotPlan[], now = new Date()): GrowthHotspotView {
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(now);
  const period = digestExecutionPeriod(digestExecutionWeek(day));
  const tasks = workflow.tasks.filter(task => !task.deletedAt && task.channel !== "product" && task.channel !== "github" && ["flatkey.ai", "modelfit.cc"].includes(task.siteDomain) && task.language !== "ru");
  const groups = new Map<string, { priority: HotspotPriority; tasks: WorkflowTask[] }>();
  for (const task of tasks) {
    if (!task.keyword || !task.topicId) continue;
    const priority = savedHotspot(task, now); if (!priority) continue;
    const key = [priority.eventKey, task.siteDomain, task.country, task.language, word(task.keyword)].join("|");
    const group = groups.get(key) ?? { priority, tasks: [] }; group.tasks.push(task); groups.set(key, group);
  }
  const scheduled = new Set(plans.filter(plan => ["scheduled", "reviewed"].includes(plan.status)).flatMap(plan => plan.taskIds));
  const items: GrowthHotspotItem[] = [...groups].map(([key, group]) => {
    const seed = group.tasks[0];
    // Only explicit same-intent dependency links extend a research group. A
    // direction may contain multiple keywords and must not merge their tasks.
    const originalIds = new Set(group.tasks.map(task => task.id));
    const related = tasks.filter(task => task.siteDomain === seed.siteDomain && task.country === seed.country && task.language === seed.language && task.topicId === seed.topicId && word(task.keyword) === word(seed.keyword)
      && (originalIds.has(task.id) || task.dependencies.some(id => originalIds.has(id)) || group.tasks.some(row => row.dependencies.includes(task.id))));
    const linked = [...new Map([...group.tasks, ...related].map(task => [task.id, task])).values()].sort((a, b) => a.dueAt.localeCompare(b.dueAt) || a.id.localeCompare(b.id));
    const direction = strategy.directions.filter(direction => linked.some(task => task.directionId === direction.id || direction.taskIds.includes(task.id))).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
    const content = linked.filter(task => task.kind === "blog");
    const representative = content[0] ?? seed;
    const quarter = strategy.baseline?.targets.find(target => target.site === seed.siteDomain && target.topicId === seed.topicId && target.country === seed.country && target.language === seed.language && word(target.keyword) === word(seed.keyword));
    const approved = directionApproved(direction, representative, now), researchComplete = linked.some(task => fullResearch(task) && Date.parse(task.researchReview!.reviewedAt) >= Date.parse(group.priority.at) && Date.parse(task.researchReview!.reviewedAt) <= now.getTime());
    const expired = Date.parse(group.priority.expiresAt) <= now.getTime();
    const publication = workflow.publications.filter(row => content.some(task => task.id === row.taskId) && ["published", "verified"].includes(row.status));
    const published = publication.length > 0 || content.some(task => ["published", "verified", "observing"].includes(task.status));
    const reviewed = published && strategy.observations.some(row => content.some(task => task.id === row.taskId));
    const inProgress = content.some(task => ["drafting", "review_pending", "approved"].includes(task.status));
    const currentContent = content.filter(task => { const due = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(new Date(task.dueAt)); return due >= period.start && due <= period.end; });
    const registered = currentContent.some(task => task.capacityClass === "authorized_hotspot_extra" || Boolean(quarter) && scheduled.has(task.id));
    const inPlan = currentContent.some(task => scheduled.has(task.id));
    const blocked = content.find(task => ["blocked", "failed"].includes(task.status));
    let admission: GrowthHotspotItem["admission"];
    if (expired) admission = { status: "blocked", reason: "原事件或升温已超过7天有效期；须重核官方及独立需求，不自动续期" };
    else if (blocked) admission = { status: "blocked", reason: blocked.failureReason ?? "原任务受阻，保留原ID与交付日" };
    else if (!researchComplete) admission = { status: "needs_research", reason: "已保存热点源证据，完整原词/原市场SERP、逐页分析及质量研究尚未齐全，未冒称可制作" };
    else if (!approved) admission = { status: "not_approved", reason: "等待人工批准当前方向范围；研究完成不等于已授权排期" };
    else if (!registered) admission = { status: "needs_target_registration", reason: "尚未读取到当周真实human额外目标或可复用的原季度任务登记" };
    else if (!inPlan) admission = { status: "needs_plan_append", reason: "已登记额外目标，尚未追加原当周正式计划taskIds；不能仅凭任务存在冒称已排期" };
    else admission = { status: "scheduled", reason: "已关联当周原计划与原任务，热点额外工作不挤占常规名额，不修改原交付日" };
    const stage: GrowthHotspotItem["stage"] = reviewed ? "reviewed" : published ? "published" : direction?.decision?.decision === "reject" ? "rejected" : expired ? "expired" : inProgress ? "in_progress" : admission.status === "scheduled" ? "scheduled" : approved ? "approved" : "needs_decision";
    return { id: `hotspot:${key}`, title: direction?.title ?? seed.title, keyword: seed.keyword!, site: seed.siteDomain, country: seed.country, language: seed.language, topicId: seed.topicId ?? null,
      quarterTargetId: quarter?.id ?? null, inQuarter: Boolean(quarter), stage, eventAt: group.priority.at, validUntil: group.priority.expiresAt, officialEvidence: [group.priority.official], demandEvidence: [group.priority.demand],
      directionId: direction?.id ?? null, directionRevision: direction?.revision ?? null, taskIds: linked.map(task => task.id), tasks: linked.map(task => ({ id: task.id, title: task.title, status: task.status, dueAt: task.dueAt, kind: task.kind, source: task.source, capacityClass: task.capacityClass ?? null, inCurrentPlan: currentContent.some(row => row.id === task.id) && scheduled.has(task.id), pageUrl: publication.find(row => row.taskId === task.id)?.pageUrl ?? task.pageUrl })), approvedAt: direction?.decision?.actor === "human" && direction.decision.decision === "approve" ? direction.decision.decidedAt : null, researchComplete, admission };
  }).sort((a, b) => b.eventAt.localeCompare(a.eventAt) || a.id.localeCompare(b.id));
  return { version: "growth-hotspots-v9", generatedAt: now.toISOString(), businessWeek: { start: period.start, end: period.end }, items };
}
