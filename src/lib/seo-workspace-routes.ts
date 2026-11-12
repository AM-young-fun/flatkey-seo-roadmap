export const executionViewRoutes = {
  tasks: "/work",
  approvals: "/approvals",
  deliveries: "/deliveries",
  optimizations: "/pages?panel=optimizations",
  issues: "/issues",
  runs: "/automations",
} as const;

export type WorkspaceSearchParams = Record<string, string | string[] | undefined>;

/** Retain filters and repeated parameters while the destination owns its panel. */
export function workspaceRedirectHref(destination: string, params: WorkspaceSearchParams): string {
  const target = new URL(destination, "https://workspace.invalid");
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (key === "tab" || target.searchParams.has(key)) continue;
    if (typeof value === "string") query.append(key, value);
    else if (Array.isArray(value)) value.forEach(item => query.append(key, item));
  }
  for (const [key, value] of target.searchParams) query.append(key, value);
  return target.pathname + (query.size ? `?${query}` : "") + target.hash;
}

const taskFilterKeys = ["week", "site", "business", "language", "country", "taskType", "status", "q"] as const;

export function workTaskHref(task: { id: string; weekStart: string }, filters?: URLSearchParams) {
  const query = new URLSearchParams({ week: task.weekStart });
  const listWeek = filters?.get("week");
  if (listWeek && listWeek !== task.weekStart) query.set("listWeek", listWeek);
  for (const key of taskFilterKeys) {
    if (key === "week") continue;
    const value = filters?.get(key);
    if (value) query.set(key, value);
  }
  return `/work/${encodeURIComponent(task.id)}?${query}`;
}

export function workTaskListHref(filters: WorkspaceSearchParams) {
  const query = new URLSearchParams();
  for (const key of taskFilterKeys) {
    const value = key === "week" ? filters.listWeek ?? filters.week : filters[key];
    if (typeof value === "string" && value) query.set(key, value);
  }
  return query.size ? `/work?${query}` : "/work";
}
