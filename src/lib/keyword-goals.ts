import { workflowTaskSchema, workflowWeek, WORKFLOW_MARKETS, type WorkflowTask } from "./seo-workflow";

export type KeywordGoalInput = {
  keyword: string; country: keyof typeof WORKFLOW_MARKETS; siteDomain: WorkflowTask["siteDomain"];
  business: "GPU" | "API" | "CLUSTER"; pageUrl: string; owner: string; dueDate: string; goal: string;
};

export function keywordGoalTask(input: KeywordGoalInput, id: string) {
  const pageUrl = input.pageUrl.trim() ? new URL(input.pageUrl.trim()).toString() : null;
  const dueAt = `${input.dueDate}T16:00:00+08:00`;
  const kind = pageUrl ? "optimization" : "landing";
  return workflowTaskSchema.parse({
    id, weekStart: workflowWeek(new Date(dueAt)), title: `${kind === "optimization" ? "页面优化" : "关键词页面搭建"} · ${input.keyword.trim()}`,
    siteDomain: input.siteDomain, kind, country: input.country, language: WORKFLOW_MARKETS[input.country], business: input.siteDomain === "flatkey.ai" ? input.business : "CLUSTER",
    pageType: pageUrl && /\/blog(?:\/|$)/.test(new URL(pageUrl).pathname) ? "blog" : kind === "landing" ? "landing" : "other",
    keyword: input.keyword.trim(), pageUrl, owner: input.owner.trim(), dueAt, status: "planned", dependencies: [], evidence: [],
    nextAction: input.goal.trim() || "核对目标国家的搜索意图与现有页面，形成具体制作方案。",
    contentVersion: null, source: "human", acceptanceCriteria: ["补齐目标国家搜索意图、搜索量、KD 和页面冲突证据", ...(input.goal.trim() ? [input.goal.trim()] : []), "按页面类型完成正式发布核验并持续跟踪效果"],
  });
}

export function matchingKeywordGoal(tasks: WorkflowTask[], candidate: ReturnType<typeof keywordGoalTask>) {
  const key = (value: string | null) => (value ?? "").normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
  return tasks.find(task => task.siteDomain === candidate.siteDomain && task.country === candidate.country &&
    key(task.keyword) === key(candidate.keyword) && task.pageUrl === candidate.pageUrl && task.kind === candidate.kind &&
    !["verified", "observing", "completed"].includes(task.status));
}

export function keywordGoalTaskHref(task: Pick<WorkflowTask, "id" | "weekStart" | "kind">) {
  return `/work?${new URLSearchParams({ week: task.weekStart, taskType: task.kind === "optimization" ? "optimization" : "landing" })}#task-${encodeURIComponent(task.id)}`;
}
