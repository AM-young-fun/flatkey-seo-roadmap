import { Suspense } from "react";
import { PageHeader } from "@/components/PageHeader";
import { PublishedPageTraffic } from "@/components/PublishedPageTraffic";
import { SeoDigestReports } from "@/components/SeoDigestReports";
import workspace from "@/components/SeoWorkspace.module.css";

export const metadata = { title: "日／周效果总结 · Flatkey SEO" };

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  return <main className={workspace.shell}>
    <Suspense fallback={<p role="status">正在读取日／周效果总结…</p>}>
      <PageHeader active="reports" />
      {params.view === "published" ? <div className={workspace.pageSection}><PublishedPageTraffic /></div> : <SeoDigestReports />}
    </Suspense>
  </main>;
}
