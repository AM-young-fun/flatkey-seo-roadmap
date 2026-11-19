import { Suspense } from "react";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/PageHeader";
import { ReportLoading } from "@/components/ReportLoading";
import { SeoDigestReports } from "@/components/SeoDigestReports";
import workspace from "@/components/SeoWorkspace.module.css";

export const metadata = { title: "日／周效果总结 · Flatkey SEO" };

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  if (params.view === "published") {
    const query = new URLSearchParams();
    for (const key of ["publication", "country"]) {
      if (typeof params[key] === "string") query.set(key, params[key]);
    }
    redirect(query.size ? `/optimization-effects?${query}` : "/optimization-effects");
  }
  return <main className={workspace.shell}>
    <Suspense fallback={<ReportLoading label="正在读取日／周效果总结" />}>
      <PageHeader active="reports" />
      <SeoDigestReports />
    </Suspense>
  </main>;
}
