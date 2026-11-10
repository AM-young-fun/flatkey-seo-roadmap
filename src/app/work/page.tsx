import { SeoWorkWorkspace } from "@/components/SeoWorkWorkspace";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { executionViewRoutes } from "@/lib/seo-workspace-routes";

export const metadata = { title: "工作任务 · Flatkey SEO" };

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const destination = typeof params.tab === "string" ? executionViewRoutes[params.tab as keyof typeof executionViewRoutes] : undefined;
  if (destination) {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (key === "tab") continue;
      if (typeof value === "string") query.append(key, value);
      else if (Array.isArray(value)) value.forEach(item => query.append(key, item));
    }
    redirect(`${destination}${query.size ? `?${query}` : ""}`);
  }
  return <Suspense fallback={<p role="status">正在读取工作任务…</p>}><SeoWorkWorkspace /></Suspense>;
}
