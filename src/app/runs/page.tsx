import { redirect } from "next/navigation";
import { workspaceRedirectHref, type WorkspaceSearchParams } from "@/lib/seo-workspace-routes";

export default async function Page({ searchParams }: { searchParams: Promise<WorkspaceSearchParams> }) {
  redirect(workspaceRedirectHref("/automations", await searchParams));
}
