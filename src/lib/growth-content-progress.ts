import type { GrowthTarget } from "./growth-types";

type Task = { id: string; status: string; kind?: string };
const productionKinds = new Set(["blog", "landing", "cluster"]);
const producing = new Set(["drafting", "review_pending", "approved", "published", "verified", "observing"]);

/** Construction progress is a projection of original facts, never execution permission.
 * A URL plan, task due date or ready status alone does not prove formal scheduling. */
export function growthContentProgress(publishedUrls: string[], membership: GrowthTarget["membership"], tasks: Task[], plansByTask: ReadonlyMap<string, string[]>): Pick<GrowthTarget, "workState" | "workStateProof"> {
  if (publishedUrls.length) return { workState: "completed", workStateProof: { taskIds: [], planIds: [], reason: "已有本站公开页面库存或真实发布回执；不代表后续维护任务均已完成" } };
  const content = tasks.filter(task => productionKinds.has(task.kind ?? ""));
  const active = content.filter(task => producing.has(task.status));
  if (active.length) return { workState: "in_progress", workStateProof: { taskIds: active.map(task => task.id), planIds: [...new Set(active.flatMap(task => plansByTask.get(task.id) ?? []))], reason: "原制作任务已进入制稿、审稿或发布核验阶段；尚无真实公开页回执" } };
  const research = tasks.filter(task => task.status === "researching");
  if (research.length) return { workState: "researching", workStateProof: { taskIds: research.map(task => task.id), planIds: [], reason: "原任务正在研究；不冒称制作或研究已通过" } };
  const scheduled = content.filter(task => (plansByTask.get(task.id)?.length ?? 0) > 0);
  if (scheduled.length) return { workState: "scheduled", workStateProof: { taskIds: scheduled.map(task => task.id), planIds: [...new Set(scheduled.flatMap(task => plansByTask.get(task.id) ?? []))], reason: "原制作任务已列入真实 scheduled/reviewed 正式计划；具体依赖及受阻状态保留在原任务" } };
  return { workState: membership === "formal" || tasks.length ? "planned" : "unknown", workStateProof: { taskIds: tasks.map(task => task.id), planIds: [], reason: "尚无可核验的制作中状态或正式计划资格；未按到期日、已就绪或页面地址推定已排期" } };
}
