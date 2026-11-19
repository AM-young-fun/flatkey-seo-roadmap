import { BasicAnalyticsHealth } from "@/components/BasicAnalyticsHealth";
import { collectionDateRange } from "@/lib/seo-date-range";
import { seoCountry } from "@/lib/seo";
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
      <details><summary>基础数据监控（近14个已结束日）</summary><BasicAnalyticsHealth range={collectionDateRange(14, new Date())} country={seoCountry(typeof params.country === "string" ? params.country : null)} /></details>
      <SeoDigestReports />
    </Suspense>
  </main>;
}
