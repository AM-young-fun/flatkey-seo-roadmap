import { shiftDay } from "./seo-date-range";

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

const taskFilterKeys = ["country", "site", "business", "language", "taskType", "status", "q", "range", "rangeStart", "rangeEnd", "page"] as const;

export function workTaskHref(task: { id: string; weekStart?: string }, filters?: URLSearchParams) {
  const query = new URLSearchParams(task.weekStart ? { week: task.weekStart } : undefined);
  for (const key of taskFilterKeys) {
    const value = filters?.get(key);
    if (value) query.set(key, value);
  }
  return `/work/${encodeURIComponent(task.id)}` + (query.size ? `?${query}` : "");
}

export function workPlanTaskFilters(weekStart: string) {
  return new URLSearchParams({ range: "custom", rangeStart: weekStart, rangeEnd: shiftDay(weekStart, 6) });
}

export function workTaskListHref(filters: WorkspaceSearchParams) {
  const query = new URLSearchParams();
  for (const key of taskFilterKeys) {
    const value = filters[key];
    if (typeof value === "string" && value) query.set(key, value);
  }
  return query.size ? `/work?${query}` : "/work";
}
