import { redirect } from "next/navigation";
import { workspaceRedirectHref, type WorkspaceSearchParams } from "@/lib/seo-workspace-routes";

export default async function Page({ searchParams }: { searchParams: Promise<WorkspaceSearchParams> }) {
  const { newApproval: _legacyEditor, fromPreview: _legacyPreview, ...params } = await searchParams;
  redirect(workspaceRedirectHref("/work?panel=approvals", params));
}
