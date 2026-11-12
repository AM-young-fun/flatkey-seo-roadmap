import { SeoWorkWorkspace } from "@/components/SeoWorkWorkspace";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { executionViewRoutes, workspaceRedirectHref, type WorkspaceSearchParams } from "@/lib/seo-workspace-routes";

export const metadata = { title: "工作任务 · Flatkey SEO" };

const formerPanels: Record<string, string> = {
  deliveries: "/deliveries",
  approvals: "/approvals",
  priority: "/opportunities?view=priority",
  "published-traffic": "/reports?view=published",
  traffic: "/reports",
  runs: "/automations",
};

export default async function Page({ searchParams }: { searchParams: Promise<WorkspaceSearchParams> }) {
  const { panel, ...params } = await searchParams;
  if (typeof panel === "string" && Object.hasOwn(formerPanels, panel)) {
    redirect(workspaceRedirectHref(formerPanels[panel], params));
  }
  if (params.new === "1") {
    const query = new URLSearchParams({ view: "new" });
    for (const key of ["keyword", "targetUrl", "country", "site"]) {
      const value = params[key];
      if (typeof value === "string") query.set(key, value);
    }
    redirect("/opportunities?" + query.toString());
  }
  const destination = typeof params.tab === "string" && Object.hasOwn(executionViewRoutes, params.tab)
    ? executionViewRoutes[params.tab as keyof typeof executionViewRoutes] : undefined;
  if (destination) redirect(workspaceRedirectHref(destination, params));

  return <Suspense fallback={<p role="status">正在读取工作任务…</p>}><SeoWorkWorkspace /></Suspense>;
}
