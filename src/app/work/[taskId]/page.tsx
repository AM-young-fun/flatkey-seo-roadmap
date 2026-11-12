import { WorkTaskPage } from "@/components/SeoWorkWorkspace";
import { workTaskListHref, type WorkspaceSearchParams } from "@/lib/seo-workspace-routes";

export const metadata = { title: "任务详情 · Flatkey SEO" };

export default async function Page({ params, searchParams }: {
  params: Promise<{ taskId: string }>;
  searchParams: Promise<WorkspaceSearchParams>;
}) {
  const [{ taskId }, filters] = await Promise.all([params, searchParams]);
  const week = typeof filters.week === "string" ? filters.week : "current";
  return <WorkTaskPage taskId={taskId} week={week} listHref={workTaskListHref(filters)} />;
}
