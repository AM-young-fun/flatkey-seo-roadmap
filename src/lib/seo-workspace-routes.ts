export const executionViewRoutes = {
  tasks: "/work",
  approvals: "/approvals",
  deliveries: "/work?panel=deliveries",
  optimizations: "/pages?panel=optimizations",
  issues: "/issues",
  runs: "/work?panel=runs",
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
