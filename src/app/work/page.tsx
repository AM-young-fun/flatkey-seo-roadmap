import { PageHeader } from "@/components/PageHeader";
import { WorkTabs } from "@/components/WorkTabs";
import { PagePriorityWorkspace } from "@/components/PagePriorityWorkspace";
import { PublishedPageTraffic } from "@/components/PublishedPageTraffic";
import workspace from "@/components/SeoWorkspace.module.css";
import { SeoApprovalWorkspace } from "@/components/SeoApprovalWorkspace";
import { SeoWorkWorkspace } from "@/components/SeoWorkWorkspace";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { executionViewRoutes, workspaceRedirectHref } from "@/lib/seo-workspace-routes";

export const metadata = { title: "工作任务 · Flatkey SEO" };

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const destination = typeof params.tab === "string" ? executionViewRoutes[params.tab as keyof typeof executionViewRoutes] : undefined;
  if (destination) {
    redirect(workspaceRedirectHref(destination, params));
  }
  if (params.panel === "published-traffic" || params.panel === "priority") return <main className={workspace.shell}>
    <Suspense fallback={<p role="status">正在读取上线效果…</p>}>
      <PageHeader active="work" />
      <WorkTabs active={params.panel === "priority" ? "priority" : "traffic"} />
      {params.panel === "priority" ? <PagePriorityWorkspace /> : <PublishedPageTraffic />}
    </Suspense>
  </main>;
  return <Suspense fallback={<p role="status">正在读取工作任务…</p>}>{params.panel === "approvals" ? <SeoApprovalWorkspace /> : <SeoWorkWorkspace />}</Suspense>;
}
