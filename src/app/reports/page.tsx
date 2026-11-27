import { redirect } from "next/navigation";
import type { WorkspaceSearchParams } from "@/lib/seo-workspace-routes";

export default async function Page({ searchParams }: { searchParams: Promise<WorkspaceSearchParams> }) {
  const params = await searchParams;
  const query = new URLSearchParams();
  if (params.view === "published") {
    for (const key of ["publication", "country"]) {
      if (typeof params[key] === "string") query.set(key, params[key]);
    }
    redirect(query.size ? `/optimization-effects?${query}` : "/optimization-effects");
  }
  redirect("/");
}
